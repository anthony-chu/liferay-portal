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

/**
 * Prompt 3 — theming an event site that already exists.
 *
 * The agent runs, then the checks read the site it themed. The preconditions are the
 * deployables under `lmnr/client-extensions`: the objects, and the site the
 * second prompt produced. Without those deployed there is nothing here to rebrand.
 */

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

/** The site `01-devcon-site-initializer` provisions before the agent runs. */
const SITE_EXTERNAL_REFERENCE_CODE = 'devcon';

/** Liferay's default primary. Still in effect means nothing was rebranded. */
const DEFAULT_PRIMARY = '#0b5fff';

/** Client extension types that ship look and feel. A `siteInitializer` is `batch`. */
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

/**
 * Furniture the stock theme renders when its chrome is left switched on: the product
 * header, the product menu, and the "Powered by Liferay" footer. These are what a visitor
 * reads as "this is a Liferay install", and the layout set settings can switch them off.
 */
const STOCK_CHROME = [
	/\bid="banner"/i,
	/\bid="footer"/i,
	/powered[\s-]by/i,
	/lfr-product-menu/i,
];

/** The product's own mark, as opposed to a stylesheet that merely ships with it. */
const PRODUCT_LOGO =
	/(?:src|href)="[^"]*(?:liferay[^"]*logo|logo[^"]*liferay|classic-theme\/images\/(?:logo|company))[^"]*"/i;

/** Clay's raw palette. An accent named like this is stock, not this site's branding. */
const PALETTE_TOKEN =
	/^--(?:black|blue|cyan|gray|green|grey|indigo|orange|pink|purple|red|teal|white|yellow)(?:-|$)/;

const HEADING_SELECTOR =
	'h1, h2, h3, h4, h5, h6, [class*="__title"], [class*="__heading"]';

/** Custom properties the page or its stylesheets declare with a hex value. */
const colorTokenNames = (styled: string) => {
	const matches = styled.matchAll(
		/(--[a-z0-9-]+)\s*:\s*#[0-9a-f]{3,8}\s*[;}]/gi
	);

	return [...new Set([...matches].map((match) => match[1].toLowerCase()))];
};

/**
 * The page as the browser renders it for a guest: the value each color token takes on
 * `:root`, as a hex, and the heaviest weight a visible heading renders at.
 *
 * Read from computed styles, not from the stylesheet text. A compiled Clay declares the
 * same tokens again inside `prefers-color-scheme: dark` and `[data-color-scheme]` blocks,
 * so the last declaration in the text is not the one in effect, and a heading's weight
 * comes from the cascade, not from whichever rule happens to name a heading.
 */
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

/**
 * Header and footer wrapper classes, as a fingerprint of the chrome on a page.
 *
 * Matched anywhere in the class name rather than at its start: a site prefixes its own
 * fragments, so the chrome arrives as `devcon-site-header`, and anchoring the pattern
 * finds nothing and reports a page that has both as a page that has neither.
 */
const chromeClasses = (html: string) => {
	const classAttributes = [...html.matchAll(/class="([^"]*)"/gi)];

	const names = classAttributes.flatMap((match) => match[1].split(/\s+/));

	const chrome = names.filter((name) => /site-(?:header|footer)/i.test(name));

	return [...new Set(chrome)].sort().join(' ');
};

/** Types declared by the client extensions the agent says it created. */
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

/**
 * Reads the themed site once and derives every signal the checks below need.
 *
 * Memoized: the agent has finished by the time any evaluator runs, so one reading serves
 * them all, and re-rendering every page per check would dominate the run.
 */
let inspection;

const inspectSite = (clientExtensions: string[]) => {
	inspection ??= readSite(clientExtensions);

	return inspection;
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

/** Deep navy leads, with an amber accent the site defines rather than inherits. */
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

/** One scheme site-wide: the same primary and the same heading weight on every page. */
const consistentThroughout = scored(async ({result}) => {
	const {pages} = await inspectSite(result.clientExtensions);

	const primaries = new Set(pages.map((page) => page.primary));

	const weights = new Set(pages.map((page) => page.headingWeight));

	return !!pages.length && primaries.size === 1 && weights.size === 1;
});

/**
 * Headings render heavy. Above 700, because Clay's own headings are already bold: the
 * prompt asks for "a bold, heavy typeface", and a stock page renders its headings at 700.
 */
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

/**
 * Every stylesheet the page asks for actually serves.
 *
 * A themeCSS build that failed to deploy 404s its CSS, the design tokens go missing with
 * it, and every color check then fails — reading as "the wrong colors" when the truth is
 * "the theme never deployed". This separates the two.
 */
const themeAssetsServe = scored(async ({result}) => {
	const {pages} = await inspectSite(result.clientExtensions);

	return (
		!!pages.length &&
		pages.every(
			(page) => page.stylesheetCount > 0 && !page.brokenStylesheets.length
		)
	);
});

/**
 * No stock product furniture reaches the visitor: no product header or footer, no product
 * menu, no "Powered by" line, and no Liferay logo.
 *
 * Deliberately not a search for the word "Liferay" in the page text. The events this site
 * exists to advertise are Liferay's own — "Liferay DEVCON", "the Liferay engineering team",
 * a `@liferay.com` contact address — so that search fails a perfectly rebranded site for
 * saying what it is about. Nor is it a search for `classic-theme` asset paths: the only way
 * to remove those is a `themeCSS` client extension, which the skills call for only when the
 * look needs Clay level overrides, while swapping Classic for another bundled Liferay theme
 * would satisfy the letter of it and rebrand nothing.
 *
 * The `<title>` suffix is a third thing this cannot check — a page renders as
 * "Home - DEVCON - Liferay" because the *instance* is named Liferay, which is outside the
 * reach of a site scoped theme task.
 */
const noStockBranding = scored(async ({result}) => {
	const {pages} = await inspectSite(result.clientExtensions);

	return (
		!!pages.length &&
		pages.every(
			(page) => !page.stockChrome.length && !page.productLogos.length
		)
	);
});

/**
 * The same chrome on every page, from a master page. Identical header and footer class
 * fingerprints is the check — matching text would only prove each page has *a* footer,
 * not the same one.
 */
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
