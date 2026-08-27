import axios from 'axios';

const baseURL = 'http://localhost:5667';

const { data: { token } } = await axios.post(`${baseURL}/api/auth/sign-in/local-email`, {
    email: 'test@liferay.com',
    name: 'Test',
});

const client = axios.create({
    baseURL,
    headers: {
        Authorization: `Bearer ${token}`,
    }
});

const lmnrApi = {
    delete: async(url, body?) => (await client.delete(url, { data: body})).data,
    get: async(url,body?) => (await client.get(url, body)).data,
    post: async(url, body?) => (await client.post(url, body)).data,
}

const workspaces = await lmnrApi.get('/api/workspaces');

let workspaceId;

if (workspaces.length === 0) {
    const workspace = await lmnrApi.post('/api/workspaces', {
        name: "Eval Workspace",
    });

    workspaceId = workspace.id;
}
else {
    workspaceId = workspaces[0].id;
}

const projects = await lmnrApi.get(`/api/workspaces/${workspaceId}/projects`);

let projectId;

if (projects.length === 0) {
    const project = await lmnrApi.post(`/api/workspaces/${workspaceId}/projects`, {
        name: "Eval Project",
    });

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

export const projectApiKey = await lmnrApi.post(`/api/projects/${projectId}/api-keys`, {
    isIngestOnly: false,
    name: "Eval Project - API Key",
});