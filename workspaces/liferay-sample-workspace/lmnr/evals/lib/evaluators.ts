/**
 * SPDX-FileCopyrightText: (c) 2000 Liferay, Inc. https://liferay.com
 * SPDX-License-Identifier: LGPL-2.1-or-later OR LicenseRef-Liferay-DXP-EULA-2.0.0-2023-06
 */

const sumUsage = (modelUsage, key: string) =>
	Object.values<any>(modelUsage ?? {}).reduce(
		(total, usage) => total + usage[key],
		0
	);

export function runMetricsEvaluator({costUsd, durationMs, modelUsage, numTurns}) {
	return {
		'Cache creation tokens': sumUsage(
			modelUsage,
			'cacheCreationInputTokens'
		),
		'Cache read tokens': sumUsage(modelUsage, 'cacheReadInputTokens'),
		'Cost USD': costUsd,
		'Duration seconds': durationMs / 1000,
		'Input tokens': sumUsage(modelUsage, 'inputTokens'),
		'Output tokens': sumUsage(modelUsage, 'outputTokens'),
		'Steps taken': numTurns,
	};
}

export function skillsInvokedEvaluator(output, target) {
	const actualSkillsInvoked = new Set(output.skillsInvoked);

	return target.skillsInvoked.every((skill) => actualSkillsInvoked.has(skill))
		? 1.0
		: 0.0;
}
