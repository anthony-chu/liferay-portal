import { readFileSync, readdirSync } from 'node:fs';

import { evaluate } from '@lmnr-ai/lmnr';

import { projectApiKey } from './lib/bootstrap.ts';
import { isAmber, isDeepNavy } from './lib/color.ts';
import { liferay } from './lib/liferay.ts';
import { fetchRenderedPage } from './lib/rendered-page.ts';

/**
 * Checks a site's theme as it currently stands. No agent runs: the executor reads the
 * site, the evaluators judge the reading. That makes a run about a second, repeatable,
 * and — the point — read-only, so checking the site cannot change the site.
 */

const SITE_EXTERNAL_REFERENCE_CODE = process.env.EVAL_SITE_ERC ?? 'event-site';

const SITE_NAME = process.env.EVAL_SITE_NAME ?? 'Tech Conference';

/** Client extensions for the site above, which need not be the current directory. */
const CLIENT_EXTENSIONS_DIR =
    process.env.EVAL_CLIENT_EXTENSIONS_DIR ??
    '/home/me/dev/projects/workspaces/event-site-run/client-extensions';

const config = {
    baseUrl: 'http://localhost',
    grpcPort: 8001,
    httpPort: 8000,
    projectApiKey: projectApiKey.value,
};

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

const LIFERAY_THEME_ASSETS = [
    '/o/classic-theme/css/clay.',
    '/o/classic-theme/css/main.',
    '/o/classic-theme/images/favicon.ico',
];

/** Clay's raw palette. An accent named like this is stock, not this site's branding. */
const PALETTE_TOKEN = /^--(?:black|blue|cyan|gray|green|grey|indigo|orange|pink|purple|red|teal|white|yellow)(?:-|$)/;

const FAVICON_LINK = /<link[^>]*\brel=["'][^"']*icon[^"']*["'][^>]*>/gi;

const HREF = /\bhref=["']([^"']+)["']/i;

const HEADING_SELECTOR = /h[1-6]\b|__title|__heading/i;

const NAMED_WEIGHTS = { bold: 700, bolder: 800 };

/** Effective value of every custom property resolving to a hex — last declaration wins. */
const colorTokens = (styled: string) => {
    const tokens = new Map<string, string>();

    for (const match of styled.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,8})\s*[;}]/gi)) {
        tokens.set(match[1].toLowerCase(), match[2].toLowerCase());
    }

    return tokens;
};

/** Heaviest weight any rule declares for a heading, and the families they ask for. */
const headingTypography = (styled: string) => {
    const rules = styled.split('}');

    let weight = 0;

    const families: string[] = [];

    for (const rule of rules) {
        const [selector, body] = rule.split('{');

        if (!body || !HEADING_SELECTOR.test(selector)) {
            continue;
        }

        const weightMatch = body.match(/font-weight\s*:\s*(\d{3}|bold|bolder)/i);

        if (weightMatch) {
            const declared = weightMatch[1].toLowerCase();

            weight = Math.max(weight, NAMED_WEIGHTS[declared] ?? Number(declared));
        }

        const familyMatch = body.match(/font-family\s*:\s*([^;]+)/i);

        if (familyMatch) {
            families.push(familyMatch[1].trim());
        }
    }

    return { families, weight };
};

/** What a visitor reads: scripts dropped first, since Liferay's JS names itself constantly. */
const visibleText = (html: string) => {
    const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');

    const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style>/gi, ' ');

    return withoutStyles.replace(/<[^>]*>/g, ' ');
};

/** Every favicon the page points at, in declaration order. */
const faviconHrefs = (html: string) => {
    const links = html.match(FAVICON_LINK) ?? [];

    const matched = links.map((link) => link.match(HREF));

    const hrefs = matched.filter(Boolean).map((match) => match[1]);

    return [...new Set(hrefs)];
};

/** Header and footer wrapper classes, as a fingerprint of the chrome on a page. */
const chromeClasses = (html: string) => {
    const classAttributes = [...html.matchAll(/class="([^"]*)"/gi)];

    const names = classAttributes.flatMap((match) => match[1].split(/\s+/));

    const chrome = names.filter((name) => /^site-(?:header|footer)/i.test(name));

    return [...new Set(chrome)].sort().join(' ');
};

const declaredClientExtensionTypes = () => {
    const types: string[] = [];

    for (const entry of readdirSync(CLIENT_EXTENSIONS_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }

        try {
            const yaml = readFileSync(
                `${CLIENT_EXTENSIONS_DIR}/${entry.name}/client-extension.yaml`,
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

/** Reads the site once and derives every signal the checks below need. */
const inspectSite = async () => {
    const { data: sites } = await liferay.get('/o/headless-admin-site/v1.0/sites', {
        params: { pageSize: 200 },
    });

    const site = sites.items.find((item) => item.name === SITE_NAME);

    if (!site) {
        return { pages: [], siteFound: false };
    }

    const { data: sitePages } = await liferay.get(
        `/o/headless-delivery/v1.0/sites/${site.id}/site-pages`,
        { params: { pageSize: 200 } }
    );

    const { data: masterPages } = await liferay.get(
        `/o/headless-admin-site/v1.0/sites/${SITE_EXTERNAL_REFERENCE_CODE}/master-pages`,
        { params: { pageSize: 200 } }
    );

    const pages = await Promise.all(
        sitePages.items.map(async (sitePage) => {
            const url = `/web${site.friendlyUrlPath}${sitePage.friendlyUrlPath}`;

            const { html, styled, stylesheets } = await fetchRenderedPage(url);

            const tokens = colorTokens(styled);

            const amberTokens = [...tokens].filter(
                ([name, value]) => isAmber(value) && !PALETTE_TOKEN.test(name)
            );

            const typography = headingTypography(styled);

            const liferayAssets = LIFERAY_THEME_ASSETS.filter((asset) => html.includes(asset));

            const liferayText = /liferay/i.test(visibleText(html));

            const brokenStylesheets = stylesheets.filter((stylesheet) => !stylesheet.ok);

            return {
                amberTokens: amberTokens.map(([name, value]) => `${name}=${value}`),
                brokenStylesheets: brokenStylesheets.map((stylesheet) => stylesheet.href),
                chrome: chromeClasses(html),
                favicons: faviconHrefs(html),
                headingFamilies: typography.families,
                headingWeight: typography.weight,
                liferayAssets,
                liferayText,
                primary: tokens.get('--primary') ?? null,
                stylesheetCount: stylesheets.length,
                title: sitePage.title,
                url,
            };
        })
    );

    const types = declaredClientExtensionTypes();

    return {
        clientExtensionTypes: [...new Set(types)],
        frontendClientExtensionTypes: types.filter((type) => FRONTEND_CET_TYPES.includes(type)),
        masterPageNames: (masterPages.items ?? []).map((masterPage) => masterPage.name),
        pages,
        siteFound: true,
    };
};

/** Turns a plain true/false check into a score, so an unexpected shape reads as 0. */
const scored = (check) => (output, _) => {
    try {
        return check(output) ? 1.0 : 0.0;
    }
    catch (error) {
        return 0.0;
    }
};

/** Deep navy leads, with an amber accent the site defines rather than inherits. */
const brandColors = scored(({ pages }) => {
    const [first] = pages;

    return (
        pages.length > 0 &&
        first.primary !== null &&
        !first.primary.includes(DEFAULT_PRIMARY) &&
        isDeepNavy(first.primary) &&
        first.amberTokens.length > 0
    );
});

/** One scheme site-wide: the same primary and the same heading weight on every page. */
const consistentThroughout = scored(({ pages }) => {
    const primaries = new Set(pages.map((page) => page.primary));

    const weights = new Set(pages.map((page) => page.headingWeight));

    return pages.length > 0 && primaries.size === 1 && weights.size === 1;
});

/** Headings ask for a heavy weight and a family of their own. */
const headingTypeface = scored(({ pages }) => {
    return (
        pages.length > 0 &&
        pages.every((page) => page.headingWeight >= 700 && page.headingFamilies.length > 0)
    );
});

const frontendClientExtension = scored(
    ({ frontendClientExtensionTypes }) => frontendClientExtensionTypes.length > 0
);

/**
 * Every stylesheet the page asks for actually serves.
 *
 * A themeCSS build that failed to deploy 404s its CSS, the design tokens go missing with
 * it, and every color check then fails — reading as "the wrong colors" when the truth is
 * "the theme never deployed". This separates the two.
 */
const themeAssetsServe = scored(({ pages }) => {
    return (
        pages.length > 0 &&
        pages.every((page) => page.stylesheetCount > 0 && page.brokenStylesheets.length === 0)
    );
});

/**
 * The site has a favicon of its own. Liferay's being absent is not the same thing —
 * a site with no favicon at all satisfies "no Liferay branding" and still looks unfinished.
 */
const customFavicon = scored(({ pages }) => {
    const isOwn = (href: string) => !href.includes('/o/classic-theme/');

    return (
        pages.length > 0 &&
        pages.every((page) => page.favicons.length > 0 && page.favicons.every(isOwn))
    );
});

/** No Liferay stylesheets, no Liferay favicon, no "Liferay" anywhere a visitor can read. */
const noLiferayBranding = scored(({ pages }) => {
    return (
        pages.length > 0 &&
        pages.every((page) => page.liferayAssets.length === 0 && !page.liferayText)
    );
});

/**
 * The same chrome on every page, from a master page. Identical header and footer class
 * fingerprints is the check — matching text would only prove each page has *a* footer,
 * not the same one.
 */
const headerAndFooterOnEveryPage = scored(({ masterPageNames, pages }) => {
    const fingerprints = new Set(pages.map((page) => page.chrome));

    return (
        pages.length > 0 &&
        masterPageNames.length > 0 &&
        fingerprints.size === 1 &&
        pages[0].chrome.length > 0
    );
});

evaluate({
    config,
    data: [{ data: SITE_NAME, target: {} }],
    evaluators: {
        'Theme assets serve': themeAssetsServe,
        'Brand colors': brandColors,
        'Consistent throughout': consistentThroughout,
        'Heading typeface': headingTypeface,
        'Custom favicon': customFavicon,
        'Frontend client extension': frontendClientExtension,
        'No Liferay branding': noLiferayBranding,
        'Header and footer on every page': headerAndFooterOnEveryPage,
    },
    executor: inspectSite,
    groupName: 'Theme check',
});
