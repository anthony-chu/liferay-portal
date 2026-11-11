/**
 * SPDX-FileCopyrightText: (c) 2000 Liferay, Inc. https://liferay.com
 * SPDX-License-Identifier: LGPL-2.1-or-later OR LicenseRef-Liferay-DXP-EULA-2.0.0-2023-06
 */

const baseURL = 'http://localhost:9667';

const signInResponse = await fetch(`${baseURL}/api/auth/sign-in/local-email`, {
	body: JSON.stringify({email: 'test@liferay.com', name: 'Test'}),
	headers: {'Content-Type': 'application/json'},
	method: 'POST',
});

const {token} = await signInResponse.json();

const request = async (method: string, path: string, body?) => {
	const response = await fetch(`${baseURL}${path}`, {
		body: body && JSON.stringify(body),
		headers: {
			'Authorization': `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		method,
	});

	if (!response.ok) {
		throw new Error(`${response.status} from ${method} ${path}`);
	}

	const text = await response.text();

	return text ? JSON.parse(text) : undefined;
};

const lmnrApi = {
	delete: (path: string, body?) => request('DELETE', path, body),
	get: (path: string) => request('GET', path),
	post: (path: string, body?) => request('POST', path, body),
};

const workspaces = await lmnrApi.get('/api/workspaces');

let workspaceId;

if (!workspaces.length) {
	const workspace = await lmnrApi.post('/api/workspaces', {
		name: 'Eval Workspace',
	});

	workspaceId = workspace.id;
}
else {
	workspaceId = workspaces[0].id;
}

const projects = await lmnrApi.get(`/api/workspaces/${workspaceId}/projects`);

let projectId;

if (!projects.length) {
	const project = await lmnrApi.post(
		`/api/workspaces/${workspaceId}/projects`,
		{
			name: 'Eval Project',
		}
	);

	projectId = project.id;
}
else {
	projectId = projects[0].id;
}

const apiKeys = await lmnrApi.get(`/api/projects/${projectId}/api-keys`);

for (const apiKey of apiKeys) {
	await lmnrApi.delete(`/api/projects/${projectId}/api-keys`, {
		id: apiKey.id,
	});
}

const projectApiKey = await lmnrApi.post(
	`/api/projects/${projectId}/api-keys`,
	{
		isIngestOnly: false,
		name: 'Eval Project - API Key',
	}
);

export const config = {
	baseUrl: 'http://localhost',
	frontendPort: 9667,
	grpcPort: 9001,
	httpPort: 9000,
	projectApiKey: projectApiKey.value,
};
