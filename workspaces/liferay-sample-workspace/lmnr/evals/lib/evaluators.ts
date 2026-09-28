/**
 * SPDX-FileCopyrightText: (c) 2000 Liferay, Inc. https://liferay.com
 * SPDX-License-Identifier: LGPL-2.1-or-later OR LicenseRef-Liferay-DXP-EULA-2.0.0-2023-06
 */

export function skillsInvokedEvaluator(output, target) {
	const actualSkillsInvoked = new Set(output.skillsInvoked);

	return target.skillsInvoked.every((skill) => actualSkillsInvoked.has(skill))
		? 1.0
		: 0.0;
}
