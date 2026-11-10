/**
 * SPDX-FileCopyrightText: (c) 2000 Liferay, Inc. https://liferay.com
 * SPDX-License-Identifier: LGPL-2.1-or-later OR LicenseRef-Liferay-DXP-EULA-2.0.0-2023-06
 */

import {query} from '@anthropic-ai/claude-agent-sdk';
import {Laminar} from '@lmnr-ai/lmnr';
import {readdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve} from 'node:path';

import {LIFERAY_AUTH, LIFERAY_URL} from './liferay.ts';

const PROJECT_SKILLS = readdirSync('.claude/skills', {withFileTypes: true})
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name);

if (!PROJECT_SKILLS.length) {
	throw new Error(
		'No skills found in .claude/skills — run this eval from the workspace root.'
	);
}

const HOME_DIR = homedir();

const REPOSITORY_DIR = resolve('../..');

const wrappedQuery = Laminar.wrapClaudeAgentQuery(query);

export function createAgentTask(schema: Record<string, unknown>) {
	return async (prompt: string) => {
		const skillsInvoked: string[] = [];

		let costUsd = 0;
		let durationMs = 0;
		let failure;
		let modelUsage;
		let numTurns = 0;
		let result;

		try {
			for await (const message of wrappedQuery({
				options: {
					allowDangerouslySkipPermissions: true,
					disallowedTools: [
						'Bash(git:*)',
						'Edit(./.agents/**)',
						'Edit(./.claude/**)',
						'Edit(./lmnr/**)',
						'Monitor',
						'Read(./lmnr/**)',
						'ScheduleWakeup',
						'Write(./.agents/**)',
						'Write(./.claude/**)',
					],
					maxTurns: 500,
					mcpServers: {
						liferay: {
							headers: {
								Authorization: LIFERAY_AUTH,
							},
							type: 'http',
							url: `${LIFERAY_URL}/o/mcp`,
						},
					},
					model: 'sonnet',
					outputFormat: {
						schema,
						type: 'json_schema',
					},
					permissionMode: 'bypassPermissions',
					settingSources: ['project'],
					settings: {
						autoMemoryEnabled: false,
						claudeMdExcludes: [
							`${REPOSITORY_DIR}/.claude/CLAUDE.md`,
							`${REPOSITORY_DIR}/.claude/rules/**`,
							`${HOME_DIR}/CLAUDE.md`,
							`${HOME_DIR}/.claude/**`,
						],
					},
					skills: PROJECT_SKILLS,
				},
				prompt,
			})) {
				if (message.type === 'assistant') {
					for (const block of message.message.content) {
						if (block.type !== 'tool_use') {
							continue;
						}

						if (block.name === 'Skill') {
							const input = block.input as {skill?: string};

							if (input.skill) {
								skillsInvoked.push(input.skill);
							}
						}
					}
				}

				if (message.type !== 'result') {
					continue;
				}

				costUsd = message.total_cost_usd;
				durationMs = message.duration_ms;
				modelUsage = message.modelUsage;
				numTurns = message.num_turns;

				if (
					message.subtype === 'success' &&
					message.structured_output
				) {
					result = message.structured_output;
				}
				else if (message.subtype !== 'success') {
					failure = message.subtype;
				}
			}
		}
		catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		}

		return {
			costUsd,
			durationMs,
			failure: failure ?? null,
			modelUsage,
			numTurns,
			result,
			skillsInvoked,
		};
	};
}
