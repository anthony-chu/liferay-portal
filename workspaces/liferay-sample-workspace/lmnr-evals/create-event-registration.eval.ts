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
        data: "Please define an event for me. An event has a name, description, start and end dates, location, and capacity. I also need registrations for each event. Each registration includes the attendee's name, email address, company, dietary restrictions from a set list, and their registration status. Each registration belongs to one event. Please create one event and one registration.",
        target: {
            skillsInvoked: ["manage-objects"]
        }
    }
];

const OBJECT_REPORT_SCHEMA = {
    additionalProperties: false,
    properties: {
        objects: {
            description: "One item per object definition created, e.g. 'Event' and 'Registration'.",
            items: {
                additionalProperties: false,
                properties: {
                    entries: {
                        description: "Names of the entries created for this object, e.g. event names or attendee names.",
                        items: { type: "string" },
                        type: "array",
                    },
                    fields: {
                        description: "Names of the fields added to this object, e.g. ['name', 'startDate'].",
                        items: { type: "string" },
                        type: "array",
                    },
                    name: {
                        description: "Object definition name, e.g. 'Event'.",
                        type: "string",
                    },
                },
                required: ["name", "fields", "entries"],
                type: "object",
            },
            type: "array",
        },
    },
    required: ["objects"],
    type: "object",
};

const objectsCreatedEvaluator = async(output, _) => {
    try {
        const { objects } = output.result;

        if (objects.length < 2) {
            return 0.0;
        }

        const definitions = [];

        for (const { entries, fields, name } of objects) {
            const { data: definitionsResponse } = await liferay.get("/o/object-admin/v1.0/object-definitions", {
                params: { filter: `name eq '${name}'` },
            });
            const definition = definitionsResponse.items[0];

            if (!definition) {
                return 0.0;
            }

            definitions.push(definition);

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

            if (!pass) {
                return 0.0;
            }
        }

        const definitionNames = definitions.map((definition) => definition.name);

        const related = definitions.some((definition) => {
            const objectRelationships = definition.objectRelationships ?? [];

            return objectRelationships.some((objectRelationship) => !objectRelationship.reverse
                && objectRelationship.type === "oneToMany"
                && definitionNames.includes(objectRelationship.objectDefinitionName2));
        });

        return related ? 1.0 : 0.0;
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