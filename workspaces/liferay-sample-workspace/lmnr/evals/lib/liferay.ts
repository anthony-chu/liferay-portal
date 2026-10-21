/**
 * SPDX-FileCopyrightText: (c) 2000 Liferay, Inc. https://liferay.com
 * SPDX-License-Identifier: LGPL-2.1-or-later OR LicenseRef-Liferay-DXP-EULA-2.0.0-2023-06
 */

import axios from 'axios';

export const LIFERAY_AUTH = `Basic ${Buffer.from('test@liferay.com:test').toString('base64')}`;

export const LIFERAY_URL = 'http://localhost:8080';

export const liferay = axios.create({
	baseURL: LIFERAY_URL,
	headers: {Authorization: LIFERAY_AUTH},
});

export async function fetchObjectDefinition(name: string) {
	const {data: definitionsResponse} = await liferay.get(
		'/o/object-admin/v1.0/object-definitions',
		{
			params: {filter: `name eq '${name}'`},
		}
	);

	return definitionsResponse.items[0];
}

export async function fetchObjectEntries(definition) {
	const {data: entriesResponse} = await liferay.get(
		definition.restContextPath,
		{
			params: {pageSize: 200},
		}
	);

	return entriesResponse.items ?? [];
}
