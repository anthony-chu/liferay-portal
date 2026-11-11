/**
 * SPDX-FileCopyrightText: (c) 2000 Liferay, Inc. https://liferay.com
 * SPDX-License-Identifier: LGPL-2.1-or-later OR LicenseRef-Liferay-DXP-EULA-2.0.0-2023-06
 */

export const LIFERAY_AUTH = `Basic ${Buffer.from('test@liferay.com:test').toString('base64')}`;

export const LIFERAY_URL = 'http://localhost:8080';

export async function fetchLiferay(
	path: string,
	searchParams: Record<string, number | string> = {}
) {
	const url = new URL(path, LIFERAY_URL);

	for (const [name, value] of Object.entries(searchParams)) {
		url.searchParams.set(name, String(value));
	}

	const response = await fetch(url, {
		headers: {Authorization: LIFERAY_AUTH},
	});

	if (!response.ok) {
		throw new Error(`${response.status} from ${url}`);
	}

	return response.json();
}

export async function fetchObjectDefinition(name: string) {
	const definitionsResponse = await fetchLiferay(
		'/o/object-admin/v1.0/object-definitions',
		{filter: `name eq '${name}'`}
	);

	return definitionsResponse.items[0];
}

export async function fetchObjectEntries(definition) {
	const entriesResponse = await fetchLiferay(definition.restContextPath, {
		pageSize: 200,
	});

	return entriesResponse.items ?? [];
}
