/**
 * SPDX-FileCopyrightText: (c) 2000 Liferay, Inc. https://liferay.com
 * SPDX-License-Identifier: LGPL-2.1-or-later OR LicenseRef-Liferay-DXP-EULA-2.0.0-2023-06
 */

import {evaluate} from '@lmnr-ai/lmnr';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
import tinycolor from 'tinycolor2';

import {createAgentTask} from './lib/agent-task.ts';
import {projectApiKey} from './lib/bootstrap.ts';
import {isAmber, isDeepNavy} from './lib/color.ts';
import {skillsInvokedEvaluator} from './lib/evaluators.ts';
import {LIFERAY_URL, liferay} from './lib/liferay.ts';
import {fetchRenderedPage} from './lib/rendered-page.ts';

const config = {
	baseUrl: 'http://localhost',
	grpcPort: 9001,
	httpPort: 9000,
	projectApiKey: projectApiKey.value,
};

const data = [
	{
		data: 'The site still looks like the software it was built with. Give it a look of its own: deep navy with amber accents, and a bold, heavy typeface for the headings. Every page should carry the same branded header with the conference name and the menu, and a footer with our contact details. Then show me what changed. You do not need to confirm scope with me. You may not consult any `liferay-portal` repository files (remotely or locally). You should not have to restart the portal instance for any reason.',
		target: {
			skillsInvoked: ['theme-and-design'],
		},
	},
];

const STRUCTURED_OUTPUT_SCHEMA = {
	additionalProperties: false,
	properties: {
		clientExtensions: {
			description:
				"Workspace relative paths of the client extensions created or changed to theme the site, e.g. ['lmnr/client-extensions/02-devcon-theme-css'].",
			items: {type: 'string'},
			type: 'array',
		},
	},
	required: ['clientExtensions'],
	type: 'object',
};

const SITE_EXTERNAL_REFERENCE_CODE = 'devcon';

const DEFAULT_PRIMARY = '#0b5fff';

const FRONTEND_CET_TYPES = [
	'customElement',
	'globalCSS',
	'globalJS',
	'iframe',
	'jsImportMapsEntry',
	'themeCSS',
	'themeFavicon',
	'themeSpritemap',
];

const STOCK_CHROME = [
	/\bid="banner"/i,
	/\bid="footer"/i,
	/powered[\s-]by/i,
	/lfr-product-menu/i,
];

const PRODUCT_LOGO =
	/(?:src|href)="[^"]*(?:liferay[^"]*logo|logo[^"]*liferay|classic-theme\/images\/(?:logo|company))[^"]*"/i;

const PALETTE_TOKEN =
	/^--(?:black|blue|cyan|gray|green|grey|indigo|orange|pink|purple|red|teal|white|yellow)(?:-|$)/;

const HEADING_SELECTOR =
	'h1, h2, h3, h4, h5, h6, [class*="__title"], [class*="__heading"]';

const colorTokenNames = (styled: string) => {
	const matches = styled.matchAll(
		/(--[a-z0-9-]+)\s*:\s*#[0-9a-f]{3,8}\s*[;}]/gi
	);

	return [...new Set([...matches].map((match) => match[1].toLowerCase()))];
};

const renderedStyles = async (browser, url: string, tokenNames: string[]) => {
	const page = await browser.newPage();

	try {
		await page.goto(`${LIFERAY_URL}${url}`, {waitUntil: 'networkidle'});

		const rendered = await page.evaluate(
			([names, headingSelector]) => {
				const rootStyle = getComputedStyle(document.documentElement);

				const headings = [
					...document.querySelectorAll(headingSelector),
				].filter((heading) => heading.getClientRects().length);

				const headingStyles = headings.map((heading) =>
					getComputedStyle(heading)
				);

				return {
					headingWeight: Math.max(
						0,
						...headingStyles.map((style) =>
							Number(style.fontWeight)
						)
					),
					tokens: names.map((name) => [
						name,
						rootStyle.getPropertyValue(name).trim(),
					]),
				};
			},
			[tokenNames, HEADING_SELECTOR]
		);

		const tokens = new Map<string, string>();

		for (const [name, value] of rendered.tokens) {
			const color = tinycolor(value);

			if (value && color.isValid()) {
				tokens.set(name, color.toHexString());
			}
		}

		return {
			headingWeight: rendered.headingWeight,
			tokens,
		};
	}
	finally {
		await page.close();
	}
};

const chromeClasses = (html: string) => {
	const classAttributes = [...html.matchAll(/class="([^"]*)"/gi)];

	const names = classAttributes.flatMap((match) => match[1].split(/\s+/));

	const chrome = names.filter((name) => /site-(?:header|footer)/i.test(name));

	return [...new Set(chrome)].sort().join(' ');
};

const declaredClientExtensionTypes = (clientExtensions: string[]) => {
	const types: string[] = [];

	for (const clientExtension of clientExtensions ?? []) {
		try {
			const yaml = readFileSync(
				`${clientExtension}/client-extension.yaml`,
				'utf8'
			);

			for (const match of yaml.matchAll(/^\s+type:\s*(\S+)/gm)) {
				types.push(match[1]);
			}
		}
		catch (error) {
			continue;
		}
	}

	return types;
};

const readSite = async (clientExtensions: string[]) => {
	let site;

	try {
		({data: site} = await liferay.get(
			`/o/headless-admin-site/v1.0/sites/${SITE_EXTERNAL_REFERENCE_CODE}`
		));
	}
	catch (error) {
		return {pages: [], siteFound: false};
	}

	const {data: sitePages} = await liferay.get(
		`/o/headless-delivery/v1.0/sites/${site.id}/site-pages`,
		{params: {pageSize: 200}}
	);

	const {data: masterPages} = await liferay.get(
		`/o/headless-admin-site/v1.0/sites/${site.externalReferenceCode}/master-pages`,
		{params: {pageSize: 200}}
	);

	const browser = await chromium.launch({channel: 'chrome'});

	const pages = await Promise.all(
		sitePages.items.map(async (sitePage) => {
			const url = `/web${site.friendlyUrlPath}${sitePage.friendlyUrlPath}`;

			const {html, styled, stylesheets} = await fetchRenderedPage(url);

			const {headingWeight, tokens} = await renderedStyles(
				browser,
				url,
				colorTokenNames(styled)
			);

			const amberTokens = [...tokens].filter(
				([name, value]) => isAmber(value) && !PALETTE_TOKEN.test(name)
			);

			const stockChrome = STOCK_CHROME.filter((pattern) =>
				pattern.test(html)
			);

			const productLogos =
				html.match(new RegExp(PRODUCT_LOGO, 'gi')) ?? [];

			const brokenStylesheets = stylesheets.filter(
				(stylesheet) => !stylesheet.ok
			);

			return {
				amberTokens: amberTokens.map(
					([name, value]) => `${name}=${value}`
				),
				brokenStylesheets: brokenStylesheets.map(
					(stylesheet) => stylesheet.href
				),
				chrome: chromeClasses(html),
				headingWeight,
				primary: tokens.get('--primary') ?? null,
				productLogos,
				stockChrome: stockChrome.map(String),
				stylesheetCount: stylesheets.length,
				title: sitePage.title,
				url,
			};
		})
	).finally(() => browser.close());

	const types = declaredClientExtensionTypes(clientExtensions);

	return {
		clientExtensionTypes: [...new Set(types)],
		frontendClientExtensionTypes: types.filter((type) =>
			FRONTEND_CET_TYPES.includes(type)
		),
		masterPageNames: (masterPages.items ?? []).map(
			(masterPage) => masterPage.name
		),
		pages,
		siteFound: true,
	};
};

let inspection;

const inspectSite = (clientExtensions: string[]) => {
	inspection ??= readSite(clientExtensions);

	return inspection;
};

const scored = (check) => async (output, _) => {
	try {
		return (await check(output)) ? 1.0 : 0.0;
	}
	catch (error) {
		return 0.0;
	}
};

const brandColors = scored(async ({result}) => {
	const {pages} = await inspectSite(result.clientExtensions);

	const [first] = pages;

	return (
		!!pages.length &&
		first.primary !== null &&
		!first.primary.includes(DEFAULT_PRIMARY) &&
		isDeepNavy(first.primary) &&
		!!first.amberTokens.length
	);
});

const consistentThroughout = scored(async ({result}) => {
	const {pages} = await inspectSite(result.clientExtensions);

	const primaries = new Set(pages.map((page) => page.primary));

	const weights = new Set(pages.map((page) => page.headingWeight));

	return !!pages.length && primaries.size === 1 && weights.size === 1;
});

const headingTypeface = scored(async ({result}) => {
	const {pages} = await inspectSite(result.clientExtensions);

	return !!pages.length && pages.every((page) => page.headingWeight >= 800);
});

const frontendClientExtension = scored(async ({result}) => {
	const {frontendClientExtensionTypes} = await inspectSite(
		result.clientExtensions
	);

	return !!frontendClientExtensionTypes.length;
});

const themeAssetsServe = scored(async ({result}) => {
	const {pages} = await inspectSite(result.clientExtensions);

	return (
		!!pages.length &&
		pages.every(
			(page) => page.stylesheetCount > 0 && !page.brokenStylesheets.length
		)
	);
});

const noStockBranding = scored(async ({result}) => {
	const {pages} = await inspectSite(result.clientExtensions);

	return (
		!!pages.length &&
		pages.every(
			(page) => !page.stockChrome.length && !page.productLogos.length
		)
	);
});

const headerAndFooterOnEveryPage = scored(async ({result}) => {
	const {masterPageNames, pages} = await inspectSite(result.clientExtensions);

	const fingerprints = new Set(pages.map((page) => page.chrome));

	return (
		!!pages.length &&
		!!masterPageNames.length &&
		fingerprints.size === 1 &&
		!!pages[0].chrome.length
	);
});

evaluate({
	config,
	data,
	evaluators: {
		'Brand colors': brandColors,
		'Consistent throughout': consistentThroughout,
		'Frontend client extension': frontendClientExtension,
		'Header and footer on every page': headerAndFooterOnEveryPage,
		'Heading typeface': headingTypeface,
		'No stock branding': noStockBranding,
		'Skills invoked': skillsInvokedEvaluator,
		'Theme assets serve': themeAssetsServe,
	},
	executor: createAgentTask(STRUCTURED_OUTPUT_SCHEMA),
	groupName: 'Theme check',
});
