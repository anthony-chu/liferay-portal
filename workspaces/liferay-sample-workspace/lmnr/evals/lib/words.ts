/**
 * SPDX-FileCopyrightText: (c) 2000 Liferay, Inc. https://liferay.com
 * SPDX-License-Identifier: LGPL-2.1-or-later OR LicenseRef-Liferay-DXP-EULA-2.0.0-2023-06
 */

const IDENTIFIER_WORD = /[A-Z]?[a-z]+|[A-Z]+(?![a-z])|[0-9]+/g;

/** Words in an identifier, however cased or separated: `dietaryRestrictions` -> dietary, restrictions. */
export function words(value: string) {
	const matched = String(value ?? '').match(IDENTIFIER_WORD) ?? [];

	return matched.map((word) => word.toLowerCase());
}
