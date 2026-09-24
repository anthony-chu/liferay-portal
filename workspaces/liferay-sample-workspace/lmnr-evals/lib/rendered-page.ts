import { liferay } from './liferay.ts';

const STYLESHEET_LINK_PATTERN = /<link[^>]*\brel=["']stylesheet["'][^>]*>/gi;

// Matched separately because `href` may come before or after `rel` on the tag.
const HREF_PATTERN = /\bhref=["'](\/[^"']+)["']/i;

/**
 * A page's HTML, and that HTML plus every stylesheet it links, as one string.
 *
 * Both are needed: the three theme layers land in three different places — style book
 * tokens inline in the page, a themeCSS client extension as its own file, master page
 * fragment CSS under `/o/layout-common-styles` — so anything about how the site *looks*
 * has to search `styled`. Anything about what the page *says* searches `html`, so a
 * stray match inside 800KB of CSS cannot score a point.
 */
export const fetchRenderedPage = async (path: string) => {
    const { data: html } = await liferay.get(path, { responseType: 'text' });

    const links = html.match(STYLESHEET_LINK_PATTERN) ?? [];

    const matched = links.map((link) => link.match(HREF_PATTERN));

    const hrefs = new Set(matched.filter(Boolean).map((match) => match[1]));

    const stylesheets = await Promise.all(
        [...hrefs].map(async (href) => {
            try {
                const { data } = await liferay.get(href, { responseType: 'text' });

                return { css: String(data), href, ok: true };
            }
            catch (error) {
                return { css: '', href, ok: false };
            }
        })
    );

    // Reported rather than swallowed: a themeCSS build that failed to deploy 404s here, and
    // its tokens then go missing — which looks like the wrong colors, not a broken deploy.
    const css = stylesheets.map((stylesheet) => stylesheet.css);

    return { html, styled: `${html}\n${css.join('\n')}`, stylesheets };
};
