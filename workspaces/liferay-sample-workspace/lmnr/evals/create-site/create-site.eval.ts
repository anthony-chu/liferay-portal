/**
 * SPDX-FileCopyrightText: (c) 2000 Liferay, Inc. https://liferay.com
 * SPDX-License-Identifier: LGPL-2.1-or-later OR LicenseRef-Liferay-DXP-EULA-2.0.0-2023-06
 */

import {existsSync} from 'node:fs';
import {chromium} from 'playwright';

import {createAgentTask} from '../lib/agent-task';
import {skillsInvokedEvaluator} from '../lib/evaluators';
import {
	LIFERAY_AUTH,
	LIFERAY_URL,
	fetchLiferay,
	fetchObjectDefinition,
	fetchObjectEntries,
} from '../lib/liferay';
import {runEvaluation} from '../lib/run-evaluation';
import {words} from '../lib/words';

const data = [
	{
		data: 'Please create a site for me for an upcoming DEVCON event. Please create three pages in this site. The first page should have a prominent section highlighting the event. The page should also display other upcoming events. The second page should display upcoming events along with their dates, locations, and spots remaining. The third page should present a registration form, where users can register for an event for their choice. We already have the event and registration objects defined. There should be a menu across the top linking the three pages. Please build the pages so that they can be rearranged or reused. You do not need to confirm scope with me. You may not consult any `liferay-portal` repository files (remotely or locally). You should not have to restart the portal instance for any reason.',
		target: {
			skillsInvoked: ['build-site'],
		},
	},
];

const STRUCTURED_OUTPUT_SCHEMA = {
	additionalProperties: false,
	properties: {
		fragments: {
			description:
				"Names of the fragments created for the site, copied verbatim from the `name` field of each fragment's `fragment.json`, e.g. ['Hero Banner', 'Event Card', 'Registration Form'].",
			items: {type: 'string'},
			type: 'array',
		},
		pages: {
			description:
				"Names of the pages created in the site, e.g. ['Home', 'Events', 'Register'].",
			items: {type: 'string'},
			type: 'array',
		},
		site: {
			description:
				"Exact display name of the site created, copied verbatim from the `siteName` field of the site initializer's client-extension.yaml. Not the external reference code (`siteExternalReferenceCode`) and not the initializer's own `name` — e.g. for an initializer named 'DEVCON Site Initializer' with siteExternalReferenceCode 'DEVCON_SITE' and siteName 'DEVCON', the correct value is 'DEVCON'.",
			type: 'string',
		},
		siteInitializer: {
			description:
				"Workspace relative path of the site initializer client extension created, e.g. 'lmnr/client-extensions/01-devcon-site-initializer'.",
			type: 'string',
		},
	},
	required: ['siteInitializer', 'site', 'pages', 'fragments'],
	type: 'object',
};

/** Objects the `event-registration-batch` client extension deploys as a precondition. */
const EVENT_OBJECT_NAME = 'Event';

const REGISTRATION_OBJECT_NAME = 'Registration';

/** Compared shape-insensitively: agents pick their own casing and word separators. */
const normalize = (value: string) => {
	const lowerCase = String(value ?? '').toLowerCase();

	return lowerCase.replace(/[^a-z0-9]/g, '');
};

/** Words too common to identify anything on their own. */
const GENERIC_WORDS = new Set([
	'address',
	'code',
	'data',
	'field',
	'form',
	'input',
	'item',
	'key',
	'list',
	'name',
	'reference',
	'select',
	'text',
	'type',
	'value',
]);

const distinctiveWords = (value: string) =>
	new Set(
		words(value).filter(
			(word) => word.length >= 4 && !GENERIC_WORDS.has(word)
		)
	);

/**
 * Whether a rendered control or label stands in for an object field.
 *
 * Compared on distinctive words rather than whole identifiers, because this asks whether the
 * field is *rendered*, not whether the markup adopts the object's exact vocabulary. A dietary
 * control named `dietaryRequirement` renders the site's `dietaryRestrictions` field as far as
 * a visitor is concerned; whether it submits under the right key is the integration eval's
 * question. A field whose words are all generic falls back to an exact comparison, so a field
 * called plainly `name` cannot be satisfied by any control that merely mentions a name.
 */
const corresponds = (field, value: string) => {
	const fieldWords = distinctiveWords(
		`${field.name} ${field.label?.en_US ?? ''}`
	);

	if (fieldWords.size === 0) {
		return normalize(value) === normalize(field.name);
	}

	const valueWords = distinctiveWords(value);

	return [...fieldWords].some((word) => valueWords.has(word));
};

/** Every fragment key a page definition references, at any nesting depth. */
const referencedFragmentKeys = (node): string[] => {
	if (Array.isArray(node)) {
		return node.flatMap(referencedFragmentKeys);
	}

	if (!node || typeof node !== 'object') {
		return [];
	}

	return Object.entries(node).flatMap(([name, value]: [string, any]) =>
		name === 'fragment' && value?.key
			? [value.key]
			: referencedFragmentKeys(value)
	);
};

/** A field a visitor fills in: system bookkeeping and relationship keys are neither. */
const editableFields = (definition) =>
	definition.objectFields.filter(
		(field) => !field.system && field.businessType !== 'Relationship'
	);

/**
 * Liferay reports "no default" as the string `null` on a field that never had one, so an
 * emptiness test alone would read every field as system-supplied.
 */
const hasDefaultValue = (field) => {
	const value = field.defaultValue;

	return (
		value !== null &&
		value !== undefined &&
		value !== '' &&
		value !== 'null'
	);
};

/**
 * A field the visitor is the source of. A state field, or one carrying a default, is the
 * system's to fill: a signup form that demanded the registration's status would be wrong
 * rather than thorough.
 */
const visitorFields = (definition) =>
	editableFields(definition).filter(
		(field) => !field.state && !hasDefaultValue(field)
	);

const MONTH_NAMES = [
	'january',
	'february',
	'march',
	'april',
	'may',
	'june',
	'july',
	'august',
	'september',
	'october',
	'november',
	'december',
];

const isoDate = (value) => String(value ?? '').slice(0, 10);

const upcomingEntries = (entries) => {
	const today = new Date().toISOString().slice(0, 10);

	const upcoming = entries.filter(
		(entry) => isoDate(entry.endDate ?? entry.startDate) >= today
	);

	return upcoming.length ? upcoming : entries;
};

const showsNumber = (text: string, value) =>
	Number.isFinite(value) && new RegExp(`(^|\\D)${value}(\\D|$)`).test(text);

const dateShown = (text: string, entry) => {
	if (entry.dateRangeLabel && text.includes(entry.dateRangeLabel)) {
		return true;
	}

	const date = isoDate(entry.startDate);

	if (!date) {
		return false;
	}

	if (text.includes(date)) {
		return true;
	}

	const [year, month, day] = date.split('-').map(Number);

	const monthName = MONTH_NAMES[month - 1];

	const monthNames = [
		monthName,
		monthName.slice(0, 4),
		monthName.slice(0, 3),
	];

	const named = new RegExp(`\\b(${monthNames.join('|')})\\.?\\b`, 'i').test(
		text
	);

	const numeric = new RegExp(
		`(^|\\D)0?(${month}\\D0?${day}|${day}\\D0?${month})\\D(${year}|${year % 100})(\\D|$)`
	).test(text);

	return (
		(named && new RegExp(`(^|\\D)0?${day}(\\D|$)`).test(text)) || numeric
	);
};

const locationShown = (text: string, entry) => {
	const location = String(entry.location ?? '');

	return (
		!location ||
		text.includes(location) ||
		text.includes(location.split(',')[0].trim())
	);
};

const spotsShown = (text: string, entry, registrationEntries) => {
	const registrations = registrationEntries.filter((registration) =>
		Object.entries(registration).some(
			([key, value]) =>
				key.startsWith('r_') && key.endsWith('Id') && value === entry.id
		)
	);

	return (
		showsNumber(text, entry.spotsRemaining) ||
		showsNumber(text, entry.capacity - registrations.length)
	);
};

const eventPassages = (text: string, entry, eventEntries) => {
	const otherNames = eventEntries
		.filter((other) => other.id !== entry.id)
		.map((other) => String(other.name));

	const passages = [];

	let index = text.indexOf(entry.name);

	while (index !== -1) {
		const rest = text.slice(index + String(entry.name).length);

		const ends = otherNames
			.map((name) => rest.indexOf(name))
			.filter((position) => position !== -1);

		passages.push(
			text.slice(index, index + String(entry.name).length) +
				rest.slice(0, ends.length ? Math.min(...ends) : 600)
		);

		index = text.indexOf(entry.name, index + 1);
	}

	return passages;
};

const fetchSiteFragments = async (siteExternalReferenceCode: string) => {
	const fragmentSetsResponse = await fetchLiferay(
		`/o/headless-admin-fragment/v1.0/sites/${siteExternalReferenceCode}/fragment-sets`,
		{pageSize: 200}
	);

	const fragmentSets = fragmentSetsResponse.items ?? [];

	const nested = await Promise.all(
		fragmentSets.map(async (fragmentSet) => {
			const fragmentsResponse = await fetchLiferay(
				`/o/headless-admin-fragment/v1.0/sites/${siteExternalReferenceCode}/fragment-sets/${fragmentSet.externalReferenceCode}/fragments`,
				{pageSize: 200}
			);

			return (fragmentsResponse.items ?? []).map((fragment) => ({
				key: fragment.key,
				name: fragment.name,
			}));
		})
	);

	return nested.flat();
};

const findSite = async (siteName: string) => {
	const sitesResponse = await fetchLiferay(
		'/o/headless-admin-site/v1.0/sites',
		{pageSize: 200}
	);

	return sitesResponse.items.find((site) => site.name === siteName);
};

/**
 * What a visitor gets from a page once it has run in a browser, so a fragment that renders
 * its content with JavaScript counts the same as one that renders it on the server.
 */
const readRenderedPage = async (browserPage, url: string) => {
	await browserPage.goto(`${LIFERAY_URL}${url}`, {waitUntil: 'networkidle'});

	const controls = await browserPage
		.locator('input, select, textarea')
		.evaluateAll((elements) =>
			elements.map((element) => {
				const attributes = [...element.attributes].filter(
					(attribute) =>
						attribute.name === 'id' ||
						attribute.name === 'name' ||
						attribute.name.startsWith('data-')
				);

				const options = [...(element.options ?? [])];

				return {
					options: options.map((option) => option.text),
					values: attributes.map((attribute) => attribute.value),
				};
			})
		);

	const hrefs = await browserPage
		.locator('a[href]')
		.evaluateAll((anchors) => anchors.map((anchor) => anchor.href));

	const links: string[] = hrefs.map((href) => new URL(href).pathname);

	return {
		controls,
		labels: await browserPage.locator('label').allInnerTexts(),
		links: new Set<string>(links),
		text: await browserPage.locator('body').innerText(),
	};
};

const readSite = async (siteName: string) => {
	const site = await findSite(siteName);

	if (!site) {
		return {pages: [], siteFound: false};
	}

	const sitePagesResponse = await fetchLiferay(
		`/o/headless-delivery/v1.0/sites/${site.id}/site-pages`,
		{nestedFields: 'pageDefinition', pageSize: 200}
	);

	const sitePrefix = `/web${site.friendlyUrlPath}`;

	const browser = await chromium.launch({channel: 'chrome'});

	const pages = [];

	try {
		const browserPage = await browser.newPage();

		for (const sitePage of sitePagesResponse.items ?? []) {
			const url = `${sitePrefix}${sitePage.friendlyUrlPath}`;

			const renderedPage = await readRenderedPage(browserPage, url);

			const links = [...renderedPage.links].filter((link) =>
				link.startsWith(`${sitePrefix}/`)
			);

			pages.push({
				...renderedPage,
				fragmentKeys: referencedFragmentKeys(
					sitePage.pageDefinition ?? {}
				),
				links: new Set(links),
				title: sitePage.title,
				url,
			});
		}
	}
	finally {
		await browser.close();
	}

	const eventDefinition = await fetchObjectDefinition(EVENT_OBJECT_NAME);

	const registrationDefinition = await fetchObjectDefinition(
		REGISTRATION_OBJECT_NAME
	);

	return {
		eventDefinition,
		eventEntries: eventDefinition
			? await fetchObjectEntries(eventDefinition)
			: [],
		fragments: await fetchSiteFragments(site.externalReferenceCode),
		pages,
		registrationDefinition,
		registrationEntries: registrationDefinition
			? await fetchObjectEntries(registrationDefinition)
			: [],
		siteFound: true,
	};
};

/**
 * Reads the built site once and derives every signal the checks below need: each page as
 * a visitor sees it, the fragments each page is built from, the site's own fragments, and
 * the two precondition objects with their entries.
 *
 * Memoized because the agent has already finished by the time any evaluator runs, so one
 * reading serves them all — and because rendering every page per check is slow enough to
 * matter.
 */
const inspections = new Map();

const inspectSite = (siteName: string) => {
	if (!inspections.has(siteName)) {
		inspections.set(siteName, readSite(siteName));
	}

	return inspections.get(siteName);
};

/** Only the pages the agent says it created, so an initializer's extras cannot fail a check. */
const reportedPages = (pages, titles: string[]) => {
	const wanted = new Set(titles.map(normalize));

	return pages.filter((page) => wanted.has(normalize(page.title)));
};

/** Turns a plain true/false check into a score, so an unexpected shape reads as 0. */
const scored = (check) => async (output, _) => {
	try {
		return (await check(output)) ? 1.0 : 0.0;
	}
	catch (error) {
		return 0.0;
	}
};

const siteInitializerCreatedEvaluator = scored(({result}) => {
	const {siteInitializer} = result;

	return (
		existsSync(`${siteInitializer}/client-extension.yaml`) &&
		existsSync(`${siteInitializer}/site-initializer`)
	);
});

const siteCreatedEvaluator = scored(async ({result}) => {
	const {siteFound} = await inspectSite(result.site);

	return siteFound;
});

const pagesCreatedEvaluator = scored(async ({result}) => {
	const {pages} = await inspectSite(result.site);

	return (
		!!result.pages.length &&
		reportedPages(pages, result.pages).length === result.pages.length
	);
});

/** Every fragment the agent reports is really on the site, under a set of its own. */
const fragmentsCreatedEvaluator = scored(async ({result}) => {
	const {fragments} = await inspectSite(result.site);

	const names = new Set(
		fragments.flatMap((fragment) => [
			normalize(fragment.key),
			normalize(fragment.name),
		])
	);

	return (
		!!result.fragments.length &&
		!!fragments.length &&
		result.fragments.every((fragment) => names.has(normalize(fragment)))
	);
});

/**
 * Each page is composed from fragments, which is what makes the pieces rearrangeable: a
 * page built from fragments can be reordered in the editor while one built from raw
 * markup cannot. Liferay's own fragments count as much as the site's. Whether they render
 * what they should is left to the checks on the page content below.
 */
const fragmentsOnPagesEvaluator = scored(async ({result}) => {
	const {pages} = await inspectSite(result.site);

	const candidates = reportedPages(pages, result.pages);

	return (
		!!candidates.length &&
		candidates.every((page) => !!page.fragmentKeys.length)
	);
});

/**
 * The upcoming events reach the page. Only the upcoming ones, because the prompt asks for
 * upcoming events and the seed data's dates are fixed, so a page that rightly leaves past
 * events out would otherwise fail as the calendar moves on.
 */
const eventsRenderedEvaluator = scored(async ({result}) => {
	const {eventDefinition, eventEntries, pages} = await inspectSite(
		result.site
	);

	if (!eventDefinition || !eventEntries.length) {
		return false;
	}

	const titleField = eventDefinition.titleObjectFieldName ?? 'name';

	const titles = upcomingEntries(eventEntries).map((entry) =>
		String(entry[titleField])
	);

	return reportedPages(pages, result.pages).some((page) =>
		titles.every((title) => page.text.includes(title))
	);
});

/**
 * Not just that the events are listed, but that each upcoming one carries the three details
 * the prompt asks for — when it is, where it is, and how many places are left — as a
 * visitor sees them, so a page passes on what it shows, whatever fields it reads.
 */
const eventDetailsRenderedEvaluator = scored(async ({result}) => {
	const {eventDefinition, eventEntries, pages, registrationEntries} =
		await inspectSite(result.site);

	if (!eventDefinition || !eventEntries.length) {
		return false;
	}

	const expected = upcomingEntries(eventEntries);

	return reportedPages(pages, result.pages).some((page) =>
		expected.every((entry) =>
			eventPassages(page.text, entry, eventEntries).some(
				(passage) =>
					dateShown(passage, entry) &&
					locationShown(passage, entry) &&
					spotsShown(passage, entry, registrationEntries)
			)
		)
	);
});

/**
 * The signup page renders a form asking for everything the Registration object needs.
 *
 * Each field has to reach the visitor as its own control, or at least its own label — see
 * `corresponds` for why that match is made on words rather than on the exact field name.
 * Controls are claimed one at a time, so a single `<select>` cannot satisfy every field.
 *
 * This is a rendering check. It does not submit the form, and it does not require the
 * markup to carry the object's field names: both belong to the integration eval.
 */
const registrationFormRenderedEvaluator = scored(async ({result}) => {
	const {eventEntries, pages, registrationDefinition} = await inspectSite(
		result.site
	);

	if (!registrationDefinition) {
		return false;
	}

	const fields = visitorFields(registrationDefinition);

	const candidates = reportedPages(pages, result.pages);

	const allFieldsRendered = (page) => {
		const claimed = new Set();

		const matched = fields.filter((field) => {
			const index = page.controls.findIndex((control, position) => {
				if (claimed.has(position)) {
					return false;
				}

				return control.values.some((value) =>
					corresponds(field, value)
				);
			});

			if (index !== -1) {
				claimed.add(index);

				return true;
			}

			return page.labels.some((text) => corresponds(field, text));
		});

		return matched.length === fields.length;
	};

	const eventNames = new Set(eventEntries.map((entry) => String(entry.name)));

	/** "the person picks which event they want" — the form needs an event control. */
	const picksAnEvent = (page) =>
		page.controls.some(
			(control) =>
				control.values.some((value) =>
					words(value).includes('event')
				) || control.options.some((option) => eventNames.has(option))
		);

	return (
		!!fields.length &&
		candidates.some((page) => allFieldsRendered(page) && picksAnEvent(page))
	);
});

/**
 * A menu across the top of every page, linking the pages that were created, with nothing
 * broken behind it. Read off the rendered pages rather than the navigation menu entity:
 * a menu built from the site's page hierarchy has no entity of its own, its items point
 * at layouts by reference code rather than by URL, and a link is only good if it resolves.
 */
const menuLinksEvaluator = scored(async ({result}) => {
	const {pages} = await inspectSite(result.site);

	const candidates = reportedPages(pages, result.pages);

	if (candidates.length !== result.pages.length || !candidates.length) {
		return false;
	}

	const urls = candidates.map((page) => page.url);

	const linkedEverywhere = candidates.every((page) =>
		urls.every((url) => page.links.has(url))
	);

	const linked = new Set<string>(
		candidates.flatMap((page) => [...page.links])
	);

	const resolved = await Promise.all(
		[...linked].map(async (url) => {
			try {
				const response = await fetch(new URL(url, LIFERAY_URL), {
					headers: {Authorization: LIFERAY_AUTH},
				});

				await response.body?.cancel();

				return response.status === 200;
			}
			catch (error) {
				return false;
			}
		})
	);

	return linkedEverywhere && resolved.every(Boolean);
});

await runEvaluation({
	data,
	evaluators: {
		'Event details rendered': eventDetailsRenderedEvaluator,
		'Events rendered': eventsRenderedEvaluator,
		'Fragments created': fragmentsCreatedEvaluator,
		'Fragments on pages': fragmentsOnPagesEvaluator,
		'Menu links resolve': menuLinksEvaluator,
		'Pages created': pagesCreatedEvaluator,
		'Registration form rendered': registrationFormRenderedEvaluator,
		'Site created': siteCreatedEvaluator,
		'Site initializer created': siteInitializerCreatedEvaluator,
		'Skills invoked': skillsInvokedEvaluator,
	},
	executor: createAgentTask(STRUCTURED_OUTPUT_SCHEMA),
	groupName: 'Create registration site',
});
