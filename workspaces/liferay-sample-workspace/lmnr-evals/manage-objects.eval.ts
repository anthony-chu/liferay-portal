import { evaluate } from '@lmnr-ai/lmnr';

import { createAgentTask } from './lib/agent-task.ts';
import { skillsInvokedEvaluator } from './lib/evaluators.ts'
import { liferay } from './lib/liferay.ts'

const config = {
    baseUrl: 'http://localhost',
    grpcPort: 8001,
    httpPort: 8000,
    projectApiKey: 'c7DpvjYUP0ciV1i7gDE2ariT7pZ24tcEFbfTvpe1EACt7D6GTx6RY1ffTiAlVixM',
};

const data = [
    {
        data: "Add a books object with fields for the author and book title. Add some entries for the books.",
        target: {
            skillsInvoked: ["manage-objects"]
        }
    }
];

const OBJECT_REPORT_SCHEMA = {
        additionalProperties: false,
        properties: {
            entries: {
                description: "Names of the entries created, e.g. book titles.",
                items: { type: "string" },
                type: "array",
            },
            fields: {
                description: "Names of the fields added, e.g. ['title', 'author'].",
                items: { type: "string" },
                type: "array",
            },
            name: {
                description: "Object definition name, e.g. 'Book'.",
                type: "string",
            },
        },
        required: ["name", "fields", "entries"],
        type: "object",
    };

const objectsCreatedEvaluator = async(output, _) => {
    const { entries, fields, name } = output.result;

    try {
        const { data: definitionsResponse } = await liferay.get("/o/object-admin/v1.0/object-definitions", {
            params: { filter: `name eq '${name}'` },
        });
        const definition = definitionsResponse.items[0];

        if (!definition) {
            return 0.0;
        }

        const actualFieldNames = definition.objectFields
            .filter((field) => !field.system)
            .map((field) => field.name);

        const { data: entriesResponse } = await liferay.get(definition.restContextPath, {
            params: { pageSize: 200 },
        });
        const actualEntries = entriesResponse.items;

        const pass = fields.every((field) => actualFieldNames.includes(field))
            && actualEntries.length >= entries.length
            && actualEntries.every((entry) => fields.every((field) => Boolean(entry[field])));

        return pass ? 1.0 : 0.0;
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
        "Objects created": objectsCreatedEvaluator,
    },
    executor: createAgentTask(OBJECT_REPORT_SCHEMA),
});