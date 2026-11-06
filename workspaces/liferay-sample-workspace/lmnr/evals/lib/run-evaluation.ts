/**
 * SPDX-FileCopyrightText: (c) 2000 Liferay, Inc. https://liferay.com
 * SPDX-License-Identifier: LGPL-2.1-or-later OR LicenseRef-Liferay-DXP-EULA-2.0.0-2023-06
 */

import {Datapoint, EvaluatorFunction, evaluate} from '@lmnr-ai/lmnr';

import {config} from './bootstrap.ts';

export async function runEvaluation({
	data,
	evaluators,
	executor,
	groupName,
}: {
	data: Datapoint<string, unknown>[];
	evaluators: Record<string, EvaluatorFunction<any, unknown, string>>;
	executor: (data: string, ...args: any[]) => unknown;
	groupName: string;
}) {
	const result = await evaluate({
		config,
		data,
		evaluators,
		executor,
		groupName,
		name: new Date().toISOString(),
	});

	if (!result) {
		console.error('The evaluation returned no result.');

		process.exitCode = 1;

		return;
	}

	if (result.errorMessage) {
		console.error(`The evaluation failed: ${result.errorMessage}`);

		process.exitCode = 1;

		return;
	}

	const failedEvaluators = Object.entries(result.averageScores).filter(
		([, score]) => score < 1
	);

	if (failedEvaluators.length) {
		const failures = failedEvaluators.map(
			([name, score]) => `${name} (${score})`
		);

		console.error(`Evaluators below 1: ${failures.join(', ')}`);

		process.exitCode = 1;
	}
}
