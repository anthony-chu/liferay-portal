import 'dotenv/config';

import type { Evaluator, ExperimentItem } from "@langfuse/client"
import { LangfuseClient } from "@langfuse/client";

import { createAgentTask } from "./lib/agent-task.ts";
import { skillsInvokedEvaluator } from "./lib/evaluators.ts";
import { liferay } from "./lib/liferay.ts";
import { otelSdk } from "./lib/otel.ts";

otelSdk.start();

const langfuse = new LangfuseClient();

const data: ExperimentItem[] = [
    {
        expectedOutput: { skillsInvoked: ["manage-objects"] },
        input: "Add a books object with fields for the author and book title. Add some entries for the books."
    },
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

const objectsCreatedEvaluator : Evaluator = async({ output }) => {
    const { entries, fields, name } = output.result;

    try {
        const { data: definitionsResponse } = await liferay.get("/o/object-admin/v1.0/object-definitions", {
            params: { filter: `name eq '${name}'` },
        });
        const definition = definitionsResponse.items[0];

        if (!definition) {
            return {
                name: "objectsCreated",
                value: 0.0,
                comment: `no object definition named '${name}'`,
            };
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

        return {
            name: "objectsCreated",
            value: pass ? 1.0 : 0.0,
            comment: pass
                ? "object and entries verified"
                : `found fields ${actualFieldNames} across ${actualEntries.length} entries`,
        };
    }
    catch (error) {
        return {
            name: "objectsCreated",
            value: 0.0,
            comment: `verification failed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
};

const result = await langfuse.experiment.run({
    name: "Manage Objects",
    description: "Validate /manage-objects skill works as intended",
    data,
    task: createAgentTask(OBJECT_REPORT_SCHEMA),
    evaluators: [skillsInvokedEvaluator, objectsCreatedEvaluator],
});

console.log(await result.format({ includeItemResults: true }));

await otelSdk.shutdown();
