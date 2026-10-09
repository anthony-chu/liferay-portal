/**
 * SPDX-FileCopyrightText: (c) 2026 Liferay, Inc. https://liferay.com
 * SPDX-License-Identifier: LGPL-2.1-or-later OR LicenseRef-Liferay-DXP-EULA-2.0.0-2023-06
 */

import {evaluate} from '@lmnr-ai/lmnr';
import {copyFileSync, readFileSync, renameSync, rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';

import {createAgentTask} from './lib/agent-task.ts';
import {projectApiKey} from './lib/bootstrap.ts';
import {isAmber, isDeepNavy} from './lib/color.ts';
import {skillsInvokedEvaluator} from './lib/evaluators.ts';
import {liferay, LIFERAY_URL} from './lib/liferay.ts';

/**
 * The whole conference site from `specs/conference-site.md` and a single prompt. One check
 * per "Done when" line in the spec, run against a fresh bundle with nothing deployed.
 */

const config = {
	baseUrl: 'http://localhost',
	grpcPort: 9001,
	httpPort: 9000,
	projectApiKey: projectApiKey.value,
};

const data = [
	{
		data: 'Implement @conference-site.md for my Liferay install. You may not consult any `liferay-portal` repository files (remotely or locally). You should not have to restart the portal instance for any reason.',
		target: {
			skillsInvoked: ['build-site', 'manage-objects', 'theme-and-design'],
		},
	},
];

const STRUCTURED_OUTPUT_SCHEMA = {
	additionalProperties: false,
	properties: {
		clientExtensions: {
			description:
				'Workspace relative paths of every client extension project created.',
			items: {type: 'string'},
			type: 'array',
		},
		eventObject: {
			description: 'Name of the event object definition.',
			type: 'string',
		},
		pages: {
			additionalProperties: false,
			description:
				"Friendly URL path of each page, relative to the site, e.g. {home: '/home'}.",
			properties: {
				events: {type: 'string'},
				home: {type: 'string'},
				signUp: {type: 'string'},
				thankYou: {type: 'string'},
			},
			required: ['home', 'events', 'signUp', 'thankYou'],
			type: 'object',
		},
		signupObject: {
			description: 'Name of the signup object definition.',
			type: 'string',
		},
		site: {
			description: 'Exact display name of the site.',
			type: 'string',
		},
	},
	required: ['site', 'pages', 'eventObject', 'signupObject', 'clientExtensions'],
	type: 'object',
};

const CONFERENCE_NAME = 'Annual Tech Conference';

const CONTACT_EMAIL = 'events@example.com';

const DIETARY_REQUIREMENTS = [
	'None',
	'Vegetarian',
	'Vegan',
	'Gluten Free',
	'Halal',
	'Kosher',
	'Other',
];

const EVENTS = [
	{
		capacity: 300,
		location: 'Main Hall',
		name: 'Opening Keynote: The Next Decade of Software',
	},
	{
		capacity: 120,
		location: 'Room 2',
		name: 'Shipping Faster With AI Coding Agents',
	},
	{
		capacity: 30,
		location: 'Workshop Lab',
		name: 'Workshop: Securing Your Cloud Applications',
	},
];

const PROBE = `eval-${Date.now()}`;

const WORKFLOW_STATUS_APPROVED = 0;

const WORKFLOW_STATUS_DENIED = 4;

const WORKFLOW_STATUS_PENDING = 1;

const get = async (url: string, params = {}) => {
	const {data: response} = await liferay.get(url, {
		params: {pageSize: 200, ...params},
	});

	return response;
};

const getObjectDefinition = async (name: string) => {
	const {items} = await get('/o/object-admin/v1.0/object-definitions', {
		filter: `name eq '${name}'`,
	});

	return items[0];
};

const getEntries = async (definition) =>
	(await get(definition.restContextPath)).items;

const eventIdOf = (entry) => {
	const key = Object.keys(entry).find(
		(name) => name.startsWith('r_') && name.endsWith('Id')
	);

	return key ? entry[key] : null;
};

const toHex = (rgb: string) => {
	const [r, g, b] = rgb.match(/\d+/g).map(Number);

	return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
};

/** Text, links, colors and heading weight of a page, as a guest sees it. */
const readPage = async (page, url: string) => {
	const response = await page.goto(url, {waitUntil: 'networkidle'});

	return {
		status: response?.status(),
		...(await page.evaluate(() => {
			const colors = new Set<string>();

			for (const element of document.querySelectorAll('body *')) {
				const style = getComputedStyle(element);

				colors.add(style.backgroundColor);
				colors.add(style.color);
			}

			const headings = [...document.querySelectorAll('h1, h2, h3')];

			return {
				colors: [...colors].filter(
					(color) => color !== 'rgba(0, 0, 0, 0)'
				),
				headingWeight: Math.max(
					0,
					...headings.map((heading) =>
						Number(getComputedStyle(heading).fontWeight)
					)
				),
				links: [...document.querySelectorAll('a[href]')].map(
					(anchor) =>
						new URL(
							(anchor as HTMLAnchorElement).href
						).pathname.replace(/\/$/, '')
				),
				text: document.body.innerText,
			};
		})),
	};
};

const fillForm = async (page) => {
	const controls = page.locator(
		'form input:visible, form select:visible, form textarea:visible'
	);

	let selectedEvent = null;

	for (let index = 0; index < (await controls.count()); index++) {
		const control = controls.nth(index);

		const name = (await control.getAttribute('name')) ?? '';
		const type = (await control.getAttribute('type')) ?? 'text';

		if (await control.evaluate((element) => element.tagName === 'SELECT')) {
			const values = await control
				.locator('option:not([disabled])')
				.evaluateAll((options) =>
					options.map((option) => option.value).filter(Boolean)
				);

			await control.selectOption(values[0]);

			if (/event/i.test(name)) {
				selectedEvent = values[0];
			}
		}
		else if (type === 'email') {
			await control.fill(`${PROBE}@example.com`);
		}
		else if (!['checkbox', 'hidden', 'radio', 'submit'].includes(type)) {
			await control.fill(PROBE);
		}
	}

	return selectedEvent;
};

const approve = async (entry) => {
	const instances = await get(
		'/o/headless-admin-workflow/v1.0/workflow-instances',
		{completed: false}
	);

	const instance = instances.items.find(
		(item) => item.objectReviewed?.id === entry.id
	);

	if (!instance) {
		return 'The new signup did not enter a workflow.';
	}

	const tasks = await get(
		`/o/headless-admin-workflow/v1.0/workflow-instances/${instance.id}/workflow-tasks`,
		{completed: false}
	);

	const taskURL = `/o/headless-admin-workflow/v1.0/workflow-tasks/${tasks.items[0].id}`;

	await liferay.post(`${taskURL}/assign-to-me`, {});

	await liferay.post(`${taskURL}/change-transition`, {
		transitionName: 'approve',
	});

	return null;
};

const checkInformation = async (result) => {
	const eventDefinition = await getObjectDefinition(result.eventObject);
	const signupDefinition = await getObjectDefinition(result.signupObject);

	for (const definition of [eventDefinition, signupDefinition]) {
		if (!definition?.active || !definition.panelCategoryKey) {
			return `${definition?.name ?? 'An object'} is not in the admin area.`;
		}
	}

	const picklists = await Promise.all(
		signupDefinition.objectFields
			.filter((field) => field.businessType === 'Picklist')
			.map((field) =>
				get(
					`/o/headless-admin-list-type/v1.0/list-type-definitions/${field.listTypeDefinitionId}`
				)
			)
	);

	const dietary = picklists.some(
		(picklist) =>
			picklist.listTypeEntries.map((entry) => entry.name).join() ===
			DIETARY_REQUIREMENTS.join()
	);

	if (!dietary) {
		return `No signup picklist lists exactly ${DIETARY_REQUIREMENTS.join(', ')}.`;
	}

	const related = eventDefinition.objectRelationships.some(
		(relationship) =>
			relationship.type === 'oneToMany' &&
			relationship.objectDefinitionName2 === signupDefinition.name
	);

	if (!related) {
		return 'Events and signups are not related one to many.';
	}

	const events = JSON.stringify(await getEntries(eventDefinition));

	if (!EVENTS.every((event) => events.includes(event.name))) {
		return 'The events from the spec are not all seeded.';
	}

	if (!(await getEntries(signupDefinition)).length) {
		return 'No signups are saved.';
	}

	return null;
};

const checkPages = async (result, site, pages) => {
	for (const [key, page] of Object.entries<any>(pages)) {
		if (page.status !== 200) {
			return `The ${key} page returned ${page.status} to a guest.`;
		}
	}

	const sitePath = `/web${site.friendlyUrlPath}`;

	for (const key of ['home', 'events', 'signUp']) {
		const path = `${sitePath}${result.pages[key]}`;

		const linked =
			pages.home.links.includes(path) ||
			(key === 'home' && pages.home.links.includes(sitePath));

		if (!linked) {
			return `The Home page does not link to ${path}.`;
		}
	}

	const eventDefinition = await getObjectDefinition(result.eventObject);
	const signupDefinition = await getObjectDefinition(result.signupObject);

	const events = await getEntries(eventDefinition);
	const signups = await getEntries(signupDefinition);

	for (const event of EVENTS) {
		const entry = events.find((item) =>
			JSON.stringify(item).includes(event.name)
		);

		const taken = signups.filter(
			(signup) =>
				eventIdOf(signup) === entry?.id &&
				signup.status.code !== WORKFLOW_STATUS_DENIED
		);

		for (const expected of [event.name, event.location]) {
			if (!pages.events.text.includes(expected)) {
				return `The Events page does not show "${expected}".`;
			}
		}

		const placesLeft = event.capacity - taken.length;

		if (!new RegExp(`(?<![\\d:])${placesLeft}(?![\\d:])`).test(pages.events.text)) {
			return `The Events page does not show ${placesLeft} places left for "${event.name}".`;
		}
	}

	const sitePages = await get(
		`/o/headless-delivery/v1.0/sites/${site.id}/site-pages`,
		{nestedFields: 'pageDefinition'}
	);

	const home = sitePages.items.find(
		(sitePage) => sitePage.friendlyUrlPath === result.pages.home
	);

	const fragments = JSON.stringify(home?.pageDefinition).match(
		/"fragment":\{/g
	);

	if ((fragments?.length ?? 0) < 2) {
		return 'The Home page is not built from fragments an editor can rearrange.';
	}

	return null;
};

const checkBrand = async (result, site, pages) => {
	for (const [key, page] of Object.entries<any>(pages)) {
		const colors = page.colors.map(toHex);

		if (!colors.some(isDeepNavy) || !colors.some(isAmber)) {
			return `The ${key} page is not deep navy and amber.`;
		}

		if (page.headingWeight < 700) {
			return `Headings on the ${key} page are weight ${page.headingWeight}.`;
		}

		if (
			!page.text.includes(CONFERENCE_NAME) ||
			!page.text.includes(CONTACT_EMAIL)
		) {
			return `The ${key} page is missing the header or footer.`;
		}
	}

	const masterPages = await get(
		`/o/headless-admin-site/v1.0/sites/${site.externalReferenceCode}/master-pages`
	);

	if (!masterPages.items.some((masterPage) => masterPage.markedAsDefault)) {
		return 'No default master page, so new pages miss the header and footer.';
	}

	return null;
};

const checkSignupFlow = async (result, site, page) => {
	const signupDefinition = await getObjectDefinition(result.signupObject);

	const before = new Set(
		(await getEntries(signupDefinition)).map((entry) => entry.id)
	);

	await page.goto(
		`${LIFERAY_URL}/web${site.friendlyUrlPath}${result.pages.signUp}`,
		{waitUntil: 'networkidle'}
	);

	const selectedEvent = await fillForm(page);

	await page.locator('form [type="submit"]:visible').first().click();

	try {
		await page.waitForURL(
			(url) => url.pathname.endsWith(result.pages.thankYou),
			{timeout: 30000}
		);
	}
	catch (error) {
		return `A guest submission landed on ${page.url()}.`;
	}

	const created = (await getEntries(signupDefinition)).filter(
		(entry) => !before.has(entry.id)
	);

	if (created.length !== 1 || !JSON.stringify(created).includes(PROBE)) {
		return `A guest submission created ${created.length} matching signups.`;
	}

	const [entry] = created;

	if (String(eventIdOf(entry)) !== selectedEvent) {
		return `The signup is not attached to event ${selectedEvent}.`;
	}

	if (entry.status.code !== WORKFLOW_STATUS_PENDING) {
		return `The signup is ${entry.status.label}, not pending.`;
	}

	const reason = await approve(entry);

	if (reason) {
		return reason;
	}

	let status;

	for (let attempt = 0; attempt < 30; attempt++) {
		const {data: approved} = await liferay.get(
			`${signupDefinition.restContextPath}/${entry.id}`
		);

		status = approved.status;

		if (status.code === WORKFLOW_STATUS_APPROVED) {
			return null;
		}

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	return `The signup is ${status.label} 30 seconds after approval.`;
};

const checkPortable = async (result) => {
	const initializer = result.clientExtensions.some((clientExtension) => {
		const yaml = readFileSync(
			join(clientExtension, 'client-extension.yaml'),
			'utf8'
		);

		return (
			/type:\s*siteInitializer/.test(yaml) &&
			yaml.includes(`siteName: ${result.site}`)
		);
	});

	return initializer
		? null
		: `No site initializer client extension creates "${result.site}".`;
};

const LABELS = [
	'Event and signup information',
	'Pages',
	'Brand',
	'Signup flow',
	'Portable',
];

/** Runs every check once per output and maps each label to its failure, or `null`. */
const inspections = new WeakMap();

const inspect = (output) => {
	if (!inspections.has(output)) {
		inspections.set(output, runChecks(output));
	}

	return inspections.get(output);
};

const attempt = async (check) => {
	try {
		return await check();
	}
	catch (error) {
		return `Check threw: ${error.message.split('\n')[0]}`;
	}
};

const failAll = (reason: string) =>
	Object.fromEntries(LABELS.map((label) => [label, reason]));

const runChecks = async ({failure, result: reported}) => {
	if (!reported) {
		return failAll(`No agent result (${failure}).`);
	}

	const {items: sites} = await get('/o/headless-admin-site/v1.0/sites');

	const site = sites.find((item) => item.name === reported.site);

	if (!site) {
		return failAll(`No site named "${reported.site}".`);
	}

	const sitePath = `/web${site.friendlyUrlPath}`;

	const result = {
		...reported,
		pages: Object.fromEntries(
			Object.entries<string>(reported.pages).map(([key, path]) => [
				key,
				path.startsWith(sitePath) ? path.slice(sitePath.length) : path,
			])
		),
	};

	const browser = await chromium.launch({channel: 'chrome'});

	try {
		const page = await browser.newPage();

		const pages = {};

		for (const [key, path] of Object.entries(result.pages)) {
			pages[key] = await attempt(() =>
				readPage(page, `${LIFERAY_URL}/web${site.friendlyUrlPath}${path}`)
			);
		}

		const reasons = {
			'Event and signup information': await attempt(() =>
				checkInformation(result)
			),
			Pages: await attempt(() => checkPages(result, site, pages)),
			Brand: await attempt(() => checkBrand(result, site, pages)),
			'Signup flow': await attempt(() =>
				checkSignupFlow(result, site, page)
			),
			Portable: await attempt(() => checkPortable(result)),
		};

		for (const [label, reason] of Object.entries(reasons)) {
			console.log(`  ${label}: ${reason ? `0 — ${reason}` : 1}`);
		}

		return reasons;
	}
	finally {
		await browser.close();
	}
};

const requirementEvaluators = Object.fromEntries(
	LABELS.map((label) => [
		label,
		async (output) => ((await inspect(output))[label] ? 0.0 : 1.0),
	])
);

const allRequirements = async (output) => {
	const reasons = Object.values(await inspect(output));

	return reasons.every((reason) => reason === null) ? 1.0 : 0.0;
};

const sumUsage = (modelUsage, key: string) =>
	Object.values<any>(modelUsage ?? {}).reduce(
		(total, usage) => total + usage[key],
		0
	);

const runMetrics = ({modelUsage, numTurns}) => ({
	'Cache creation tokens': sumUsage(modelUsage, 'cacheCreationInputTokens'),
	'Cache read tokens': sumUsage(modelUsage, 'cacheReadInputTokens'),
	'Input tokens': sumUsage(modelUsage, 'inputTokens'),
	'Output tokens': sumUsage(modelUsage, 'outputTokens'),
	'Steps taken': numTurns,
});

const agentTask = createAgentTask(STRUCTURED_OUTPUT_SCHEMA);

/** The finished deployables of the step by step evals would hand the agent the answer. */
const ANSWER_KEY = 'lmnr/client-extensions';

const HIDDEN_ANSWER_KEY = join(homedir(), '.conference-eval-answer-key');

/** The prompt mentions the spec at the workspace root, where the agent runs. */
const executor = async (prompt: string) => {
	copyFileSync(
		new URL('./specs/conference-site.md', import.meta.url),
		'conference-site.md'
	);

	renameSync(ANSWER_KEY, HIDDEN_ANSWER_KEY);

	try {
		return await agentTask(prompt);
	}
	finally {
		renameSync(HIDDEN_ANSWER_KEY, ANSWER_KEY);

		rmSync('conference-site.md', {force: true});
	}
};

evaluate({
	config,
	data,
	evaluators: {
		'Skills invoked': skillsInvokedEvaluator,
		...requirementEvaluators,
		'All requirements': allRequirements,
		'Run metrics': runMetrics,
	},
	executor,
	groupName: 'Conference site',
});
