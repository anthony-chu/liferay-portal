/**
 * SPDX-FileCopyrightText: (c) 2000 Liferay, Inc. https://liferay.com
 * SPDX-License-Identifier: LGPL-2.1-or-later OR LicenseRef-Liferay-DXP-EULA-2.0.0-2023-06
 */

import {evaluate} from '@lmnr-ai/lmnr';
import {randomUUID} from 'node:crypto';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {basename} from 'node:path';

import {createAgentTask} from './lib/agent-task';
import {projectApiKey} from './lib/bootstrap';
import {skillsInvokedEvaluator} from './lib/evaluators';
import {liferay} from './lib/liferay';

const config = {
	baseUrl: 'http://localhost',
	grpcPort: 9001,
	httpPort: 9000,
	projectApiKey: projectApiKey.value,
};

const data = [
	{
		data: 'When a registration is added, it should trigger a POST request with the following body: createdAt (date on which the registration was added), emailAddress (registrant email address), fullName (registrant full name), interestedTopic (event registered for), and leadSource, which is always "Tech Conference 2026". The endpoint for the request does not exist yet, so instead write the body of the request to a file. We already have the event and registration objects defined. Leave the microservice running when you are done. You may not use the Liferay Portal source code on this machine. Use only the workspace rules and skills, and whatever they direct you to. You do not need to ask me for confirmation.',
		target: {
			skillsInvoked: ['manage-object-logic', 'scaffold-client-extension'],
		},
	},
];

const STRUCTURED_OUTPUT_SCHEMA = {
	additionalProperties: false,
	properties: {
		batchClientExtension: {
			description:
				"Workspace relative path of the batch client extension that creates the object action, e.g. 'client-extensions/registration-lead-batch'.",
			type: 'string',
		},
		eventObject: {
			description:
				"Name of the object definition holding the events registrants register for, e.g. 'Event'.",
			type: 'string',
		},
		microserviceClientExtension: {
			description:
				"Workspace relative path of the microservice client extension that handles the object action, e.g. 'client-extensions/registration-lead-microservice'.",
			type: 'string',
		},
		outputFile: {
			description:
				"Absolute path of the file the microservice writes the request body to, e.g. '/home/user/workspace/client-extensions/registration-lead-microservice/leads.json'.",
			type: 'string',
		},
		registrationObject: {
			description:
				"Name of the object definition whose added entries trigger the request, e.g. 'Registration'.",
			type: 'string',
		},
	},
	required: [
		'batchClientExtension',
		'eventObject',
		'microserviceClientExtension',
		'outputFile',
		'registrationObject',
	],
	type: 'object',
};

const readClientExtensionTypes = (clientExtension: string) => {
	const types = new Map<string, string>();

	const clientExtensionYAML = readFileSync(
		`${clientExtension}/client-extension.yaml`,
		'utf8'
	);

	let key;

	for (const line of clientExtensionYAML.split('\n')) {
		const keyMatch = line.match(/^([^\s#][^:]*):\s*$/);

		if (keyMatch) {
			key = keyMatch[1].trim();

			continue;
		}

		const typeMatch = line.match(/^\s+type:\s*(\S+)\s*$/);

		if (key && typeMatch) {
			types.set(key, typeMatch[1]);
		}
	}

	return types;
};

const clientExtensionsCreatedEvaluator = (output, _) => {
	try {
		const {batchClientExtension, microserviceClientExtension} =
			output.result;

		const microserviceClientExtensionTypes = readClientExtensionTypes(
			microserviceClientExtension
		);

		const objectActionKeys = [...microserviceClientExtensionTypes]
			.filter(([, type]) => type === 'objectAction')
			.map(([key]) => key);

		if (!objectActionKeys.length) {
			return 0.0;
		}

		const batchClientExtensionTypes =
			readClientExtensionTypes(batchClientExtension);

		if (![...batchClientExtensionTypes.values()].includes('batch')) {
			return 0.0;
		}

		const batchDirectory = `${batchClientExtension}/batch`;

		const objectActions = readdirSync(batchDirectory)
			.filter((fileName) => fileName.endsWith('.json'))
			.map((fileName) =>
				JSON.parse(
					readFileSync(`${batchDirectory}/${fileName}`, 'utf8')
				)
			)
			.filter(
				(batchData) =>
					batchData.configuration?.className ===
					'com.liferay.object.admin.rest.dto.v1_0.ObjectAction'
			)
			.flatMap((batchData) => batchData.items ?? []);

		return objectActions.some((objectAction) =>
			objectActionKeys.some(
				(key) =>
					objectAction.objectActionExecutorKey === `function#${key}`
			)
		)
			? 1.0
			: 0.0;
	}
	catch (error) {
		return 0.0;
	}
};

const oAuthApplicationRegisteredEvaluator = (output, _) => {
	try {
		const {microserviceClientExtension} = output.result;

		const microserviceClientExtensionTypes = readClientExtensionTypes(
			microserviceClientExtension
		);

		const oAuthApplicationKeys = [...microserviceClientExtensionTypes]
			.filter(([, type]) => type === 'oAuthApplicationUserAgent')
			.map(([key]) => key);

		if (!oAuthApplicationKeys.length) {
			return 0.0;
		}

		const routesDirectory = `bundles/routes/default/${basename(microserviceClientExtension)}`;

		return oAuthApplicationKeys.every((key) => {
			const clientIdFile = `${routesDirectory}/${key}.oauth2.user.agent.client.id`;

			return existsSync(clientIdFile) && statSync(clientIdFile).size > 0;
		})
			? 1.0
			: 0.0;
	}
	catch (error) {
		return 0.0;
	}
};

const findObjectDefinition = async (name: string) => {
	const {data: objectDefinitionsResponse} = await liferay.get(
		'/o/object-admin/v1.0/object-definitions',
		{
			params: {filter: `name eq '${name}'`},
		}
	);

	return objectDefinitionsResponse.items[0];
};

const readLeads = (outputFile: string) => {
	if (!existsSync(outputFile)) {
		return [];
	}

	const leadsJSON = readFileSync(outputFile, 'utf8');

	try {
		return [JSON.parse(leadsJSON)].flat();
	}
	catch (error) {
		return leadsJSON
			.split('\n')
			.filter(Boolean)
			.flatMap((line) => {
				try {
					return [JSON.parse(line)];
				}
				catch (lineError) {
					return [];
				}
			});
	}
};

const leadWrittenEvaluator = async (output, _) => {
	try {
		const {eventObject, outputFile, registrationObject} = output.result;

		const eventObjectDefinition = await findObjectDefinition(eventObject);
		const registrationObjectDefinition =
			await findObjectDefinition(registrationObject);

		if (!eventObjectDefinition || !registrationObjectDefinition) {
			return 0.0;
		}

		const objectRelationship =
			eventObjectDefinition.objectRelationships.find(
				(objectRelationship) =>
					!objectRelationship.reverse &&
					objectRelationship.type === 'oneToMany' &&
					objectRelationship.objectDefinitionName2 ===
						registrationObjectDefinition.name
			);

		if (!objectRelationship) {
			return 0.0;
		}

		const {data: eventsResponse} = await liferay.get(
			eventObjectDefinition.restContextPath,
			{
				params: {pageSize: 200},
			}
		);
		const events = eventsResponse.items;

		if (!events.length) {
			return 0.0;
		}

		const event = events[Math.floor(Math.random() * events.length)];

		const id = randomUUID();

		const emailAddress = `${id}@example.com`;
		const fullName = `Eval ${id.slice(0, 8)}`;

		const eventFieldName = eventObjectDefinition.name.replace(
			/^./,
			(character) => character.toLowerCase()
		);

		const {data: registration} = await liferay.post(
			registrationObjectDefinition.restContextPath,
			{
				emailAddress,
				name: fullName,
				[`r_${objectRelationship.name}_c_${eventFieldName}Id`]:
					event.id,
			}
		);

		const registrationDateString = registration.dateCreated.slice(0, 10);

		for (let attempt = 0; attempt < 30; attempt++) {
			const lead = readLeads(outputFile).find(
				(lead) =>
					lead.emailAddress === emailAddress &&
					lead.fullName === fullName
			);

			if (lead) {
				return lead.interestedTopic === event.name &&
					lead.leadSource === 'Tech Conference 2026' &&
					new Date(lead.createdAt).toISOString().slice(0, 10) ===
						registrationDateString
					? 1.0
					: 0.0;
			}

			await new Promise((resolve) => setTimeout(resolve, 2000));
		}

		return 0.0;
	}
	catch (error) {
		return 0.0;
	}
};

evaluate({
	config,
	data,
	evaluators: {
		'Client extensions created': clientExtensionsCreatedEvaluator,
		'Lead written': leadWrittenEvaluator,
		'OAuth application registered': oAuthApplicationRegisteredEvaluator,
		'Skills invoked': skillsInvokedEvaluator,
	},
	executor: createAgentTask(STRUCTURED_OUTPUT_SCHEMA),
	groupName: 'Create object action microservice',
});
