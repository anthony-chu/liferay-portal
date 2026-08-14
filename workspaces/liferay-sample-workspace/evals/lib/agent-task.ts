import { readdirSync } from "node:fs";

import * as ClaudeAgentSDK from "@anthropic-ai/claude-agent-sdk";
import { ClaudeAgentSDKInstrumentation } from "@arizeai/openinference-instrumentation-claude-agent-sdk";
import type { ExperimentTask } from "@langfuse/client";

import { LIFERAY_AUTH, LIFERAY_URL } from "./liferay.ts";

const PROJECT_SKILLS = readdirSync(".claude/skills", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

if (PROJECT_SKILLS.length === 0) {
    throw new Error("No skills found in .claude/skills — run this eval from the workspace root.");
}

const instrumentation = new ClaudeAgentSDKInstrumentation();

const claudeAgentSDK = instrumentation.manuallyInstrument(ClaudeAgentSDK);

export const createAgentTask = (schema: Record<string, unknown>): ExperimentTask => async (item) => {
    const prompt = item.input;

    const skillsInvoked: string[] = [];

    let failure;
    let modelUsage;
    let numTurns = 0;
    let result;

    try {
        for await (const message of claudeAgentSDK.query({
            options: {
                allowDangerouslySkipPermissions: true,
                maxTurns: 50,
                mcpServers: {
                    liferay: {
                        headers: {
                            Authorization: LIFERAY_AUTH
                        },
                        type: "http",
                        url: `${LIFERAY_URL}/o/mcp`,
                    },
                },
                model: "sonnet",
                outputFormat: {
                    schema,
                    type: "json_schema",
                },
                permissionMode: "bypassPermissions",
                settingSources: ["project"],
                skills: PROJECT_SKILLS,
            },
            prompt,
        })) {
            if (message.type === "assistant") {
                for (const block of message.message.content) {
                    if (block.type !== "tool_use") continue;

                    toolCalls.push({ input: block.input, name: block.name });

                    if (block.name === "Skill") {
                        const input = block.input as { skill?: string };

                        if (input.skill) skillsInvoked.push(input.skill);
                    }
                }
            }

            if (message.type === "user" && Array.isArray(message.message.content)) {
                for (const block of message.message.content) {
                    if (block.type === "tool_result") {
                        toolResults.push(block.content);
                    }
                }
            }

            if (message.type !== "result") continue;

            costUSD = message.total_cost_usd;
            modelUsage = message.modelUsage;
            numTurns = message.num_turns;

            if (message.subtype === "success" && message.structured_output) {
                result = message.structured_output;
            }
            else if (message.subtype !== "success") {
                failure = message.subtype;
            }
        }
    }
    catch (error) {
        failure = error instanceof Error ? error.message : String(error);
    }

    return {
        costUSD,
        failure: failure ?? null,
        modelUsage,
        numTurns,
        result,
        skillsInvoked,
        toolCalls,
        toolResults,
    };
};
