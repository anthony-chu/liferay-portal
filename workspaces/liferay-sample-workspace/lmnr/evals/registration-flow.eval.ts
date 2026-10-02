/**
 * SPDX-FileCopyrightText: (c) 2000 Liferay, Inc. https://liferay.com
 * SPDX-License-Identifier: LGPL-2.1-or-later OR LicenseRef-Liferay-DXP-EULA-2.0.0-2023-06
 */

import {evaluate} from '@lmnr-ai/lmnr';
import {chromium} from 'playwright';

import {createAgentTask} from './lib/agent-task.ts';
import {projectApiKey} from './lib/bootstrap.ts';
import {skillsInvokedEvaluator} from './lib/evaluators.ts';
import {liferay, LIFERAY_URL} from './lib/liferay.ts';

/**
 * Prompt 4 — making the signup form actually submit.
 *
 * The first eval here that needs a browser. The form is rendered by fragment JavaScript and
 * submits through it, so fetching the page proves nothing: the markup can be perfect while
 * the script never runs. This drives a real Chrome, fills the form, clicks submit, and then
 * asks the object API whether a row landed.
 *
 * Preconditions are the deployables numbered 00, 02 and 03 — the objects and the themed
 * site. See `lmnr/client-extensions/README.md`.
 */

const config = {
	baseUrl: 'http://localhost',
	grpcPort: 9001,
	httpPort: 9000,
	projectApiKey: projectApiKey.value,
};

const data = [
	{
		data: "Last piece: make the signup form actually work. When someone fills it in, their details should be saved against the event they picked and start out as pending, and they should land on a thank-you page. Don't build anything for sending email — we'll connect our mailing tool later. Same as before: this is the demo I'll be walking through signed in as the administrator, so it doesn't need to work for the public or deal with who's allowed to do what. Then run through it yourself from start to finish and tell me what worked and what didn't. You do not need to confirm scope with me. You may not consult any `liferay-portal` repository files (remotely or locally). You should not have to restart the portal instance for any reason.",
		target: {
			skillsInvoked: ['manage-pages'],
		},
	},
];

const STRUCTURED_OUTPUT_SCHEMA = {
	additionalProperties: false,
	properties: {
		registrationPage: {
			description:
				"Friendly URL path of the page carrying the signup form, relative to the site — e.g. '/register'.",
			type: 'string',
		},
		site: {
			description:
				"Exact display name of the site worked on, copied verbatim from the site list — e.g. 'DEVCON Themed'. Not its friendly URL and not its external reference code.",
			type: 'string',
		},
		thankYouPage: {
			description:
				"Friendly URL path of the page a visitor lands on after submitting, relative to the site — e.g. '/thank-you'.",
			type: 'string',
		},
	},
	required: ['site', 'registrationPage', 'thankYouPage'],
	type: 'object',
};

/** Something recognisable in the saved row, so the entry this run created can be told apart. */
const PROBE = `eval-${Date.now()}`;

const CREDENTIALS = {login: 'test@liferay.com', password: 'test'};

const findSite = async (siteName: string) => {
	const {data: sitesResponse} = await liferay.get(
		'/o/headless-admin-site/v1.0/sites',
		{
			params: {pageSize: 200},
		}
	);

	return sitesResponse.items.find((site) => site.name === siteName);
};

const fetchRegistrations = async () => {
	const {data: entriesResponse} = await liferay.get('/o/c/registrations', {
		params: {pageSize: 200},
	});

	return entriesResponse.items ?? [];
};

/**
 * Signs in before filling anything. The prompt scopes this to an administrator walking
 * through a demo — "it doesn't need to work for the public" — so testing it as Guest would
 * fail the agent for a requirement it was told to ignore.
 */
const signIn = async (page) => {
	await page.goto(`${LIFERAY_URL}/c/portal/login`, {
		waitUntil: 'domcontentloaded',
	});

	const loginField =
		'[name="_com_liferay_login_web_portlet_LoginPortlet_login"]';

	await page.fill(loginField, CREDENTIALS.login);

	const passwordField =
		'[name="_com_liferay_login_web_portlet_LoginPortlet_password"]';

	await page.fill(passwordField, CREDENTIALS.password);

	await page.press(passwordField, 'Enter');

	await page.waitForLoadState('networkidle');
};

/**
 * Fills every control the form renders rather than naming the fields.
 *
 * The agent is free to rename them, and a check that hardcoded `emailAddress` would fail a
 * working form for calling it something else. Email inputs get an address, the event control
 * gets a real option, other selects get their first usable choice, and text inputs get the
 * probe string so the saved row can be identified afterwards.
 */
const fillForm = async (page) => {
	const controls = page.locator(
		'form input:visible, form select:visible, form textarea:visible'
	);

	const count = await controls.count();

	let selectedEvent = null;

	for (let index = 0; index < count; index++) {
		const control = controls.nth(index);

		const tagName = await control.evaluate((element) =>
			element.tagName.toLowerCase()
		);

		const name = (await control.getAttribute('name')) ?? '';

		if (tagName === 'select') {
			const values = await control
				.locator('option')
				.evaluateAll((options) =>
					options
						.filter((option) => !option.disabled && option.value)
						.map((option) => option.value)
				);

			if (values.length === 0) {
				continue;
			}

			await control.selectOption(values[0]);

			if (/event/i.test(name)) {
				selectedEvent = values[0];
			}

			continue;
		}

		const type = (await control.getAttribute('type')) ?? 'text';

		if (['checkbox', 'hidden', 'radio', 'submit'].includes(type)) {
			continue;
		}

		if (type === 'email' || /mail/i.test(name)) {
			await control.fill(`${PROBE}@example.com`);

			continue;
		}

		await control.fill(PROBE);
	}

	return selectedEvent;
};

/**
 * Runs the flow once and reports what happened. Memoized on what identifies the run, so a
 * second datapoint gets its own submission rather than inheriting the first one's — driving
 * the browser twice for the same datapoint would create two registrations and leave the
 * second check judging a different row than the first.
 */
const submissions = new Map();

const submitRegistration = (result) => {
	const key = `${result.site}|${result.registrationPage}`;

	if (!submissions.has(key)) {
		submissions.set(key, runSubmission(result));
	}

	return submissions.get(key);
};

/**
 * Every exit carries a `failure` naming what stopped it.
 *
 * Without one a broken precondition, a timed out selector and a form that genuinely does not
 * save are the same score, and a run that cost twenty minutes reports only `0`. The string is
 * what makes the difference readable afterwards — the first run of this eval scored 0/0
 * because the site had been rolled back before the agent ever touched it, and nothing in the
 * output said so.
 */
const runSubmission = async (result) => {
	const site = await findSite(result.site);

	if (!site) {
		return {
			failure:
				`No site named "${result.site}". The agent reported working on it, so ` +
				`either it was renamed or the site initializer rolled back — check ` +
				`bundles/tomcat/logs/catalina.out for InitializationException.`,
		};
	}

	const before = await fetchRegistrations();

	const browser = await chromium.launch({channel: 'chrome'});

	try {
		const page = await browser.newPage();

		await signIn(page);

		const registrationURL = `${LIFERAY_URL}/web${site.friendlyUrlPath}${result.registrationPage}`;

		const response = await page.goto(registrationURL, {
			waitUntil: 'networkidle',
		});

		if (!response?.ok()) {
			return {
				failure: `${registrationURL} returned ${response?.status()}.`,
			};
		}

		//
		// The controls arrive with the fragment's script, not with the page, and the event
		// list is fetched after that. Waiting for the submit button is what makes this a
		// test of the rendered form rather than of the markup.
		//

		try {
			await page.waitForSelector('form button[type="submit"]:visible', {
				timeout: 20000,
			});
		}
		catch (error) {
			return {
				failure:
					`No visible submit button on ${registrationURL} after 20s — the ` +
					`form markup may be there but its script never ran.`,
			};
		}

		const selectedEvent = await fillForm(page);

		await page
			.locator('form button[type="submit"]:visible')
			.first()
			.click();

		await page.waitForTimeout(6000);

		const landedURL = page.url();

		const landedText = await page.locator('body').innerText();

		const after = await fetchRegistrations();

		const beforeIds = new Set(before.map((entry) => entry.id));

		const created = after.filter((entry) => !beforeIds.has(entry.id));

		return {created, landedText, landedURL, selectedEvent, site};
	}
	catch (error) {
		return {failure: `Browser run threw: ${error.message.split('\n')[0]}`};
	}
	finally {
		await browser.close();
	}
};

/**
 * Turns a check into a score and prints why it scored what it did.
 *
 * A check returns a reason string when it fails and `null` when it passes, so a thrown error
 * and a real failure stay distinguishable in the output instead of both reading as `0`.
 */
const scored = (label, check) => async (output, _) => {
	try {
		const reason = await check(output);

		if (reason) {
			console.log(`  ${label}: 0 — ${reason}`);

			return 0.0;
		}

		console.log(`  ${label}: 1`);

		return 1.0;
	}
	catch (error) {
		console.log(
			`  ${label}: 0 — evaluator threw: ${error.message.split('\n')[0]}`
		);

		return 0.0;
	}
};

/**
 * Clicking submit saves the registration: exactly one new entry, carrying what was typed,
 * attached to the event that was picked, and starting out pending.
 */
const registrationSaved = scored('Registration saved', async ({result}) => {
	const {created, failure, selectedEvent} = await submitRegistration(result);

	if (failure) {
		return failure;
	}

	if (created.length !== 1) {
		return `Submit created ${created.length} registrations, expected 1.`;
	}

	const [entry] = created;

	const values = JSON.stringify(entry);

	if (!values.includes(PROBE)) {
		return `The new registration does not carry what was typed (${PROBE}).`;
	}

	const relationshipKey = Object.keys(entry).find((key) =>
		key.startsWith('r_')
	);

	const linkedToEvent =
		selectedEvent === null ||
		values.includes(selectedEvent) ||
		Boolean(relationshipKey && entry[relationshipKey]);

	if (!linkedToEvent) {
		return `The new registration is not attached to event ${selectedEvent}.`;
	}

	const status = entry.registrationStatus?.key ?? entry.registrationStatus;

	if (status !== 'pending') {
		return `Status is "${status}", expected "pending".`;
	}

	return null;
});

/**
 * The visitor ends up on the thank-you page the agent reported, rather than being left on
 * the form with an inline message.
 */
const thankYouPageShown = scored('Thank you page shown', async ({result}) => {
	const {failure, landedText, landedURL} = await submitRegistration(result);

	if (failure) {
		return failure;
	}

	const [path] = String(result.thankYouPage ?? '').split(/[?#]/);

	if (!path) {
		return `The agent reported no thank-you page.`;
	}

	if (!landedURL.includes(path)) {
		return `Landed on ${landedURL}, which does not contain ${path}.`;
	}

	if (/error|sorry/i.test(landedText)) {
		return `${path} rendered, but its text reads as an error.`;
	}

	return null;
});

evaluate({
	config,
	data,
	evaluators: {
		'Skills invoked': skillsInvokedEvaluator,
		'Registration saved': registrationSaved,
		'Thank you page shown': thankYouPageShown,
	},
	executor: createAgentTask(STRUCTURED_OUTPUT_SCHEMA),
	groupName: 'Registration flow',
});
