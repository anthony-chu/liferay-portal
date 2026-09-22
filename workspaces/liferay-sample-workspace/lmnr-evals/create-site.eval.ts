import { existsSync } from 'node:fs';

import { evaluate } from '@lmnr-ai/lmnr';

import { createAgentTask } from './lib/agent-task';
import { projectApiKey } from './lib/bootstrap';
import { skillsInvokedEvaluator } from './lib/evaluators';
import { liferay } from './lib/liferay';

const config = {
    baseUrl: 'http://localhost',
    grpcPort: 8001,
    httpPort: 8000,
    projectApiKey: projectApiKey.value,
};

const data = [
    {
        data: "Please create a site for me for an upcoming DEVCON event. Please create three pages in this site. The first page should have a prominent section highlighting the event. The page should also display other upcoming events. The second page should display upcoming events along with their dates, locations, and spots remaining. The third page should present a registration form, where users can register for an event for their choice. We already have the event and registration objects defined. There should be a menu across the top linking the three pages. Please build the pages so that they can be rearranged or reused. You do not need to confirm scope with me. You may not consult any `liferay-portal` repository files (remotely or locally).",
        target: {
            skillsInvoked: ["build-site"],
        }
    }
]

const STRUCTURED_OUTPUT_SCHEMA = {
    additionalProperties: false,
    properties: {
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
    required: ["siteInitializer", "site", "pages"],
    type: "object",
};

const siteInitializerCreatedEvaluator = (output, _) => {
    try {
        const { siteInitializer } = output.result;

        return existsSync(`${siteInitializer}/client-extension.yaml`)
            && existsSync(`${siteInitializer}/site-initializer`)
            ? 1.0
            : 0.0;
    }
    catch (error) {
        return 0.0;
    }
};

const findSite = async (siteName: string) => {
    const { data: sitesResponse } = await liferay.get("/o/headless-admin-site/v1.0/sites", {
        params: { pageSize: 200 },
    });

    return sitesResponse.items.find((site) => site.name === siteName);
};

const siteCreatedEvaluator = async (output, _) => {
    try {
        const { site } = output.result;

        return await findSite(site) ? 1.0 : 0.0;
    }
    catch (error) {
        return 0.0;
    }
};

const pagesCreatedEvaluator = async (output, _) => {
    try {
        const { pages, site } = output.result;

        const actualSite = await findSite(site);

        if (!actualSite) {
            return 0.0;
        }

        const { data: sitePagesResponse } = await liferay.get(
            `/o/headless-delivery/v1.0/sites/${actualSite.id}/site-pages`,
            { params: { pageSize: 200 } },
        );
        const actualTitles = sitePagesResponse.items.map((sitePage) => sitePage.title);

        return pages.every((page) => actualTitles.includes(page)) ? 1.0 : 0.0;
    }
    catch (error) {
        return 0.0;
    }
};

evaluate({
    config,
    data,
    evaluators: {
        "Skills invoked": skillsInvokedEvaluator,
        "Site initializer created": siteInitializerCreatedEvaluator,
        "Site created": siteCreatedEvaluator,
        "Pages created": pagesCreatedEvaluator,
    },
    executor: createAgentTask(STRUCTURED_OUTPUT_SCHEMA),
    groupName: "Create registration site",
})