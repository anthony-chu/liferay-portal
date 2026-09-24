import { existsSync } from 'node:fs';

import { evaluate } from '@lmnr-ai/lmnr';

import { createAgentTask } from './lib/agent-task';
import { projectApiKey } from './lib/bootstrap';
import { skillsInvokedEvaluator } from './lib/evaluators';
import { liferay } from './lib/liferay';
import { fetchRenderedPage } from './lib/rendered-page';

const config = {
    baseUrl: 'http://localhost',
    grpcPort: 9001,
    httpPort: 9000,
    projectApiKey: projectApiKey.value,
};

const data = [
    {
        data: "Please create a site for me for an upcoming DEVCON event. Please create three pages in this site. The first page should have a prominent section highlighting the event. The page should also display other upcoming events. The second page should display upcoming events along with their dates, locations, and spots remaining. The third page should present a registration form, where users can register for an event for their choice. We already have the event and registration objects defined. There should be a menu across the top linking the three pages. Please build the pages so that they can be rearranged or reused. You do not need to confirm scope with me. You may not consult any `liferay-portal` repository files (remotely or locally). You should not have to restart the portal instance for any reason.",
        target: {
            skillsInvoked: ["build-site"],
        }
    }
]

const STRUCTURED_OUTPUT_SCHEMA = {
    additionalProperties: false,
    properties: {
        fragments: {
            description: "Names of the fragments created for the site, copied verbatim from the `name` field of each fragment's `fragment.json`, e.g. ['Hero Banner', 'Event Card', 'Registration Form'].",
            items: { type: "string" },
            type: "array",
        },
        pages: {
            description: "Names of the pages created in the site, e.g. ['Home', 'Events', 'Register'].",
            items: { type: "string" },
            type: "array",
        },
        site: {
            description: "Exact display name of the site created, copied verbatim from the `siteName` field of the site initializer's client-extension.yaml. Not the external reference code (`siteExternalReferenceCode`) and not the initializer's own `name` — e.g. for an initializer named 'DEVCON Site Initializer' with siteExternalReferenceCode 'DEVCON_SITE' and siteName 'DEVCON', the correct value is 'DEVCON'.",
            type: "string",
        },
        siteInitializer: {
            description: "Workspace relative path of the site initializer client extension created, e.g. 'client-extensions/devcon-site-initializer'.",
            type: "string",
        },
    },
    required: ["siteInitializer", "site", "pages", "fragments"],
    type: "object",
};

/** Objects the `event-registration-batch` client extension deploys as a precondition. */
const EVENT_OBJECT_NAME = "Event";

const REGISTRATION_OBJECT_NAME = "Registration";

/** Compared shape-insensitively: agents pick their own casing and word separators. */
const normalize = (value: string) => {
    const lowerCase = String(value ?? "").toLowerCase();

    return lowerCase.replace(/[^a-z0-9]/g, "");
};

const stripTags = (html: string) => html.replace(/<[^>]*>/g, " ");

const IDENTIFIER_WORD = /[A-Z]?[a-z]+|[A-Z]+(?![a-z])|[0-9]+/g;

/** Words in an identifier, however cased or separated: `dietaryRestrictions` -> dietary, restrictions. */
const words = (value: string) => {
    const matched = String(value ?? "").match(IDENTIFIER_WORD) ?? [];

    return matched.map((word) => word.toLowerCase());
};

/** Words too common to identify anything on their own. */
const GENERIC_WORDS = new Set([
    "address", "code", "data", "field", "form", "input", "item", "key", "list",
    "name", "reference", "select", "text", "type", "value",
]);

const distinctiveWords = (value: string) =>
    new Set(words(value).filter((word) => word.length >= 4 && !GENERIC_WORDS.has(word)));

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
    const fieldWords = distinctiveWords(`${field.name} ${field.label?.en_US ?? ""}`);

    if (fieldWords.size === 0) {
        return normalize(value) === normalize(field.name);
    }

    const valueWords = distinctiveWords(value);

    return [...fieldWords].some((word) => valueWords.has(word));
};

/**
 * What a visitor reads. Scripts are dropped first, so an event name that appears only in
 * a fragment's own source cannot score as content the page rendered.
 */
const visibleText = (html: string) => {
    const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, " ");

    const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style>/gi, " ");

    return stripTags(withoutStyles);
};

/**
 * BEM class names from a fragment's own markup, used as its fingerprint in a rendered
 * page. FreeMarker interpolations are dropped because the deployed HTML resolves them.
 */
const fragmentSelectors = (html: string) => {
    const classAttributes = [...html.matchAll(/class="([^"]*)"/gi)];

    const tokens = classAttributes.flatMap((match) => match[1].split(/\s+/));

    const selectors = tokens.filter((token) => /__|--/.test(token) && !token.includes("$"));

    return [...new Set(selectors)];
};

/** Every fragment key a page definition references, at any nesting depth. */
const referencedFragmentKeys = (node): string[] => {
    if (Array.isArray(node)) {
        return node.flatMap(referencedFragmentKeys);
    }

    if (!node || typeof node !== "object") {
        return [];
    }

    return Object.entries(node).flatMap(([name, value]: [string, any]) =>
        name === "fragment" && value?.key
            ? [value.key]
            : referencedFragmentKeys(value)
    );
};

const formControls = (html: string) => {
    const matches = [...html.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)];

    return matches.map((match) => {
        const attributes = [...match[2].matchAll(/\b(?:name|id|data-[a-z-]+)="([^"]*)"/gi)];

        return { values: attributes.map((attribute) => attribute[1]) };
    });
};

const labelTexts = (html: string) => {
    const matches = [...html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gi)];

    return matches.map((match) => stripTags(match[1]).trim());
};

const fetchObjectDefinition = async (name: string) => {
    const { data: definitionsResponse } = await liferay.get("/o/object-admin/v1.0/object-definitions", {
        params: { filter: `name eq '${name}'` },
    });

    return definitionsResponse.items[0];
};

const fetchObjectEntries = async (definition) => {
    const { data: entriesResponse } = await liferay.get(definition.restContextPath, {
        params: { pageSize: 200 },
    });

    return entriesResponse.items ?? [];
};

/** A field a visitor fills in: system bookkeeping and relationship keys are neither. */
const editableFields = (definition) =>
    definition.objectFields.filter(
        (field) => !field.system && field.businessType !== "Relationship"
    );

/**
 * Liferay reports "no default" as the string `null` on a field that never had one, so an
 * emptiness test alone would read every field as system-supplied.
 */
const hasDefaultValue = (field) => {
    const value = field.defaultValue;

    return value !== null && value !== undefined && value !== "" && value !== "null";
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

/**
 * The three details the prompt asks an event to carry — when it is, where it is, and how
 * many places are left — resolved to whatever the Event object happens to call them, so
 * the check still means something against an object the agent named differently.
 */
const EVENT_DETAIL_PATTERNS = [
    /date|start|when/,
    /location|venue|place|where/,
    /spots|remaining|available|capacity|seats/,
];

const eventDetailFields = (definition) => {
    const fields = editableFields(definition);

    const matched = EVENT_DETAIL_PATTERNS.map((pattern) =>
        fields.find((field) => pattern.test(normalize(field.name)))
    );

    const names = new Set();

    return matched.filter((field) => {
        if (!field || names.has(field.name)) {
            return false;
        }

        names.add(field.name);

        return true;
    });
};

const fetchSiteFragments = async (siteExternalReferenceCode: string) => {
    const { data: fragmentSetsResponse } = await liferay.get(
        `/o/headless-admin-fragment/v1.0/sites/${siteExternalReferenceCode}/fragment-sets`,
        { params: { pageSize: 200 } },
    );

    const fragmentSets = fragmentSetsResponse.items ?? [];

    const nested = await Promise.all(
        fragmentSets.map(async (fragmentSet) => {
            const { data: fragmentsResponse } = await liferay.get(
                `/o/headless-admin-fragment/v1.0/sites/${siteExternalReferenceCode}/fragment-sets/${fragmentSet.externalReferenceCode}/fragments`,
                { params: { pageSize: 200 } },
            );

            return (fragmentsResponse.items ?? []).map((fragment) => {
                const [version] = fragment.fragmentVersions ?? [];

                return {
                    key: fragment.key,
                    name: fragment.name,
                    selectors: fragmentSelectors(version?.html ?? ""),
                    source: `${version?.html ?? ""}\n${version?.js ?? ""}`,
                };
            });
        })
    );

    return nested.flat();
};

const findSite = async (siteName: string) => {
    const { data: sitesResponse } = await liferay.get("/o/headless-admin-site/v1.0/sites", {
        params: { pageSize: 200 },
    });

    return sitesResponse.items.find((site) => site.name === siteName);
};

/**
 * Reads the built site once and derives every signal the checks below need: each page's
 * rendered HTML, the site's own fragments and which of them each page is built from, and
 * the two precondition objects with their entries.
 *
 * Memoized because the agent has already finished by the time any evaluator runs, so one
 * reading serves them all — and because re-rendering every page per check is slow enough
 * to matter.
 */
const inspections = new Map();

const inspectSite = (siteName: string) => {
    if (!inspections.has(siteName)) {
        inspections.set(siteName, readSite(siteName));
    }

    return inspections.get(siteName);
};

const readSite = async (siteName: string) => {
    const site = await findSite(siteName);

    if (!site) {
        return { pages: [], siteFound: false };
    }

    const { data: sitePagesResponse } = await liferay.get(
        `/o/headless-delivery/v1.0/sites/${site.id}/site-pages`,
        { params: { nestedFields: "pageDefinition", pageSize: 200 } },
    );

    const fragments = await fetchSiteFragments(site.externalReferenceCode);

    const fragmentsByKey = new Map(fragments.map((fragment) => [fragment.key, fragment]));

    const sitePrefix = `/web${site.friendlyUrlPath}`;

    /**
     * In-site page links, reduced to paths.
     *
     * Both quote styles and both URL forms have to be accepted. The site navigation menu
     * portlet emits single-quoted absolute hrefs, while fragments tend to write
     * double-quoted relative ones — a reader that understood only one of those would
     * report a perfectly good menu as missing.
     */
    const inSiteLinks = (html: string) => {
        const matches = [...html.matchAll(/\bhref=(["'])(.*?)\1/gi)];

        const paths = matches.map((match) => {
            const href = match[2].replace(/[#?][\s\S]*$/, "");

            return href.replace(/^https?:\/\/[^/]+/i, "");
        });

        return new Set(paths.filter((path) => path.startsWith(`${sitePrefix}/`)));
    };

    const pages = await Promise.all(
        (sitePagesResponse.items ?? []).map(async (sitePage) => {
            const url = `${sitePrefix}${sitePage.friendlyUrlPath}`;

            const { html } = await fetchRenderedPage(url);

            const keys = referencedFragmentKeys(sitePage.pageDefinition ?? {});

            const ownFragments = [...new Set(keys)]
                .map((key) => fragmentsByKey.get(key))
                .filter(Boolean);

            const rendered = ownFragments.filter((fragment) =>
                fragment.selectors.some((selector) => html.includes(selector))
            );

            return {
                controls: formControls(html),
                labels: labelTexts(html),
                links: inSiteLinks(html),
                ownFragments,
                renderedFragments: rendered,
                sources: ownFragments.map((fragment) => fragment.source),
                text: visibleText(html),
                title: sitePage.title,
                url,
            };
        })
    );

    const eventDefinition = await fetchObjectDefinition(EVENT_OBJECT_NAME);

    const registrationDefinition = await fetchObjectDefinition(REGISTRATION_OBJECT_NAME);

    return {
        eventDefinition,
        eventEntries: eventDefinition ? await fetchObjectEntries(eventDefinition) : [],
        fragments,
        pages,
        registrationDefinition,
        siteFound: true,
    };
};

/** Only the pages the agent says it created, so an initializer's extras cannot fail a check. */
const reportedPages = (pages, titles: string[]) => {
    const wanted = new Set(titles.map(normalize));

    return pages.filter((page) => wanted.has(normalize(page.title)));
};

/** Turns a plain true/false check into a score, so an unexpected shape reads as 0. */
const scored = (check) => async (output, _) => {
    try {
        return await check(output) ? 1.0 : 0.0;
    }
    catch (error) {
        return 0.0;
    }
};

const siteInitializerCreatedEvaluator = scored(({ result }) => {
    const { siteInitializer } = result;

    return existsSync(`${siteInitializer}/client-extension.yaml`)
        && existsSync(`${siteInitializer}/site-initializer`);
});

const siteCreatedEvaluator = scored(async ({ result }) => {
    const { siteFound } = await inspectSite(result.site);

    return siteFound;
});

const pagesCreatedEvaluator = scored(async ({ result }) => {
    const { pages } = await inspectSite(result.site);

    return result.pages.length > 0
        && reportedPages(pages, result.pages).length === result.pages.length;
});

/** Every fragment the agent reports is really on the site, under a set of its own. */
const fragmentsCreatedEvaluator = scored(async ({ result }) => {
    const { fragments } = await inspectSite(result.site);

    const names = new Set(
        fragments.flatMap((fragment) => [normalize(fragment.key), normalize(fragment.name)])
    );

    return result.fragments.length > 0
        && fragments.length > 0
        && result.fragments.every((fragment) => names.has(normalize(fragment)));
});

/**
 * Each page is composed from the site's own fragments, and those fragments reach the
 * visitor: the page definition has to reference the fragment *and* a class from that
 * fragment's markup has to appear in the rendered HTML. The definition on its own would
 * pass a fragment that fails to render, which is the failure worth catching — it is also
 * what makes the pieces rearrangeable, since a page built from fragments can be
 * reordered in the editor while one built from raw markup cannot.
 */
const fragmentsOnPagesEvaluator = scored(async ({ result }) => {
    const { pages } = await inspectSite(result.site);

    const candidates = reportedPages(pages, result.pages);

    return candidates.length > 0
        && candidates.every((page) => page.renderedFragments.length > 0);
});

/**
 * The events reach the page. Two implementations are both legitimate, and both count:
 * a collection display mapped to the Event object puts the entry data straight into the
 * HTML, while a fragment calling the object's REST endpoint puts it there only once the
 * browser runs the script. Fetched HTML cannot watch the second one paint, so its wiring
 * is what gets credit here; proving it paints belongs to the integration eval.
 */
const eventsRenderedEvaluator = scored(async ({ result }) => {
    const { eventDefinition, eventEntries, pages } = await inspectSite(result.site);

    if (!eventDefinition || eventEntries.length === 0) {
        return false;
    }

    const candidates = reportedPages(pages, result.pages);

    const titleField = eventDefinition.titleObjectFieldName ?? "name";

    const titles = eventEntries.map((entry) => String(entry[titleField]));

    const serverRendered = candidates.some((page) =>
        titles.every((title) => page.text.includes(title))
    );

    const clientWired = candidates.some((page) =>
        page.sources.some((source) => source.includes(eventDefinition.restContextPath))
    );

    return serverRendered || clientWired;
});

/**
 * Not just that the events are listed, but that each one carries the three details the
 * prompt asks for — when it is, where it is, and how many places are left.
 */
const eventDetailsRenderedEvaluator = scored(async ({ result }) => {
    const { eventDefinition, eventEntries, pages } = await inspectSite(result.site);

    if (!eventDefinition || eventEntries.length === 0) {
        return false;
    }

    const detailFields = eventDetailFields(eventDefinition);

    if (detailFields.length < EVENT_DETAIL_PATTERNS.length) {
        return false;
    }

    const candidates = reportedPages(pages, result.pages);

    const shown = (page, field) =>
        eventEntries.every((entry) => {
            const value = entry[field.name];

            return value === null || value === undefined
                || page.text.includes(String(value));
        });

    const serverRendered = candidates.some((page) =>
        detailFields.every((field) => shown(page, field))
    );

    const clientWired = candidates.some((page) =>
        page.sources.some((source) =>
            detailFields.every((field) => new RegExp(`\\b${field.name}\\b`).test(source))
        )
    );

    return serverRendered || clientWired;
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
const registrationFormRenderedEvaluator = scored(async ({ result }) => {
    const { eventDefinition, pages, registrationDefinition } = await inspectSite(result.site);

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

                return control.values.some((value) => corresponds(field, value));
            });

            if (index !== -1) {
                claimed.add(index);

                return true;
            }

            return page.labels.some((text) => corresponds(field, text));
        });

        return matched.length === fields.length;
    };

    /** "the person picks which event they want" — the form needs an event control. */
    const picksAnEvent = (page) => {
        const named = page.controls.some((control) =>
            control.values.some((value) => words(value).includes("event"))
        );

        const restContextPath = eventDefinition?.restContextPath;

        return named
            || Boolean(restContextPath)
                && page.sources.some((source) => source.includes(restContextPath));
    };

    return fields.length > 0
        && candidates.some((page) => allFieldsRendered(page) && picksAnEvent(page));
});

/**
 * A menu across the top of every page, linking the pages that were created, with nothing
 * broken behind it. Read off the rendered pages rather than the navigation menu entity:
 * a menu built from the site's page hierarchy has no entity of its own, its items point
 * at layouts by reference code rather than by URL, and a link is only good if it resolves.
 */
const menuLinksEvaluator = scored(async ({ result }) => {
    const { pages } = await inspectSite(result.site);

    const candidates = reportedPages(pages, result.pages);

    if (candidates.length !== result.pages.length || candidates.length === 0) {
        return false;
    }

    const urls = candidates.map((page) => page.url);

    const linkedEverywhere = candidates.every((page) =>
        urls.every((url) => page.links.has(url))
    );

    const linked = new Set<string>(candidates.flatMap((page) => [...page.links]));

    const resolved = await Promise.all(
        [...linked].map(async (url) => {
            try {
                const { status } = await liferay.get(url, { responseType: "text" });

                return status === 200;
            }
            catch (error) {
                return false;
            }
        })
    );

    return linkedEverywhere && resolved.every(Boolean);
});

evaluate({
    config,
    data,
    evaluators: {
        "Skills invoked": skillsInvokedEvaluator,
        "Site initializer created": siteInitializerCreatedEvaluator,
        "Site created": siteCreatedEvaluator,
        "Pages created": pagesCreatedEvaluator,
        "Fragments created": fragmentsCreatedEvaluator,
        "Fragments on pages": fragmentsOnPagesEvaluator,
        "Events rendered": eventsRenderedEvaluator,
        "Event details rendered": eventDetailsRenderedEvaluator,
        "Registration form rendered": registrationFormRenderedEvaluator,
        "Menu links resolve": menuLinksEvaluator,
    },
    executor: createAgentTask(STRUCTURED_OUTPUT_SCHEMA),
    groupName: "Create registration site",
})
