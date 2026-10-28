/**
 * SPDX-FileCopyrightText: (c) 2000 Liferay, Inc. https://liferay.com
 * SPDX-License-Identifier: LGPL-2.1-or-later OR LicenseRef-Liferay-DXP-EULA-2.0.0-2023-06
 */

import {evaluate} from '@lmnr-ai/lmnr';

import {createAgentTask} from './lib/agent-task.ts';
import {projectApiKey} from './lib/bootstrap.ts';
import {skillsInvokedEvaluator} from './lib/evaluators.ts';
import {fetchObjectEntries, liferay} from './lib/liferay.ts';
import {words} from './lib/words.ts';

const config = {
	baseUrl: 'http://localhost',
	grpcPort: 9001,
	httpPort: 9000,
	projectApiKey: projectApiKey.value,
};

const data = [
	{
		data: "Please define an event for me. An event has a name, description, start and end dates, location, and capacity. I also need registrations for each event. Each registration includes the attendee's name, email address, company, dietary restrictions from a set list, and their registration status. Each registration belongs to one event. Please create one event and one registration.",
		target: {
			skillsInvoked: ['manage-objects'],
		},
	},
];

const STRUCTURED_OUTPUT_SCHEMA = {
	additionalProperties: false,
	properties: {
		objects: {
			description:
				"One item per object definition created, e.g. 'Event' and 'Registration'.",
			items: {
				additionalProperties: false,
				properties: {
					entries: {
						description:
							'Names of the entries created for this object, e.g. event names or attendee names.',
						items: {type: 'string'},
						type: 'array',
					},
					fields: {
						description:
							"Names of the fields added to this object, e.g. ['name', 'startDate'].",
						items: {type: 'string'},
						type: 'array',
					},
					name: {
						description: "Object definition name, e.g. 'Event'.",
						type: 'string',
					},
				},
				required: ['name', 'fields', 'entries'],
				type: 'object',
			},
			type: 'array',
		},
	},
	required: ['objects'],
	type: 'object',
};

/**
 * The fields the prompt asks each object for, as the words that identify them. A field
 * counts when its name or label carries every word of one alternative, however cased or
 * separated, so `startDate`, `eventStartDate` and "Start Date" all satisfy the start date.
 * Name comes last because it is the least specific: `companyName` is the company.
 *
 * Every field has to exist, but only a `required` one has to hold a value. An entry without
 * a name or a start date says nothing, while a registration with no company or no dietary
 * restrictions is an ordinary one: the reference seed data leaves both empty.
 */
const EVENT_FIELDS = [
	{alternatives: [['description']]},
	{alternatives: [['start']], required: true},
	{alternatives: [['end']]},
	{alternatives: [['location'], ['venue']]},
	{alternatives: [['capacity']]},
	{alternatives: [['name'], ['title']], required: true},
];

const PICKLIST_TYPES = ['MultiselectPicklist', 'Picklist'];

const REGISTRATION_FIELDS = [
	{alternatives: [['email']], required: true},
	{alternatives: [['company'], ['organization']]},
	{alternatives: [['dietary']], businessTypes: PICKLIST_TYPES},
	{alternatives: [['status']]},
	{alternatives: [['name']], required: true},
];

const fieldWords = (field) =>
	new Set([...words(field.name), ...words(field.label?.en_US ?? '')]);

/**
 * The definition's fields that satisfy each requirement, in order, or null when one is
 * missing. Each field satisfies one requirement at most, so `endDate` cannot stand in for
 * the start date as well.
 */
const matchFields = (definition, requirements) => {
	const candidates = definition.objectFields.filter(
		(field) => !field.system && field.businessType !== 'Relationship'
	);

	const matched = [];

	for (const {alternatives, businessTypes} of requirements) {
		const field = candidates.find((candidate) => {
			if (
				matched.includes(candidate) ||
				(businessTypes &&
					!businessTypes.includes(candidate.businessType))
			) {
				return false;
			}

			const candidateWords = fieldWords(candidate);

			return alternatives.some((alternative) =>
				alternative.every((word) => candidateWords.has(word))
			);
		});

		if (!field) {
			return null;
		}

		matched.push(field);
	}

	return matched;
};

/** Present rather than truthy, so a value such as 0 counts. */
const hasValue = (value) =>
	value !== null && value !== undefined && value !== '';

/** Entries holding a value in every field whose requirement is `required`. */
const completeEntries = (entries, fields, requirements) => {
	const requiredFields = fields.filter(
		(_, index) => requirements[index].required
	);

	return entries.filter((entry) =>
		requiredFields.every((field) => hasValue(entry[field.name]))
	);
};

/**
 * Read from the portal rather than from what the agent reports, so the score follows what
 * was built: an Event object and a Registration object with the fields the prompt lists,
 * the dietary restrictions from a set list, a one to many relationship from Event to
 * Registration, and an event with a registration that belongs to it.
 */
const objectsCreatedEvaluator = async () => {
	try {
		const {data: definitionsResponse} = await liferay.get(
			'/o/object-admin/v1.0/object-definitions',
			{params: {pageSize: 200}}
		);

		const definitions = (definitionsResponse.items ?? []).filter(
			(definition) => !definition.system
		);

		for (const eventDefinition of definitions) {
			const eventFields = matchFields(eventDefinition, EVENT_FIELDS);

			if (!eventFields) {
				continue;
			}

			const relationships = (
				eventDefinition.objectRelationships ?? []
			).filter(
				(relationship) =>
					!relationship.reverse && relationship.type === 'oneToMany'
			);

			for (const relationship of relationships) {
				const registrationDefinition = definitions.find(
					(definition) =>
						definition.name === relationship.objectDefinitionName2
				);

				if (!registrationDefinition) {
					continue;
				}

				const registrationFields = matchFields(
					registrationDefinition,
					REGISTRATION_FIELDS
				);

				const eventField = registrationDefinition.objectFields.find(
					(field) =>
						field.businessType === 'Relationship' &&
						field.name.startsWith(`r_${relationship.name}_`)
				);

				if (!registrationFields || !eventField) {
					continue;
				}

				const events = completeEntries(
					await fetchObjectEntries(eventDefinition),
					eventFields,
					EVENT_FIELDS
				);

				const eventIds = events.map((event) => event.id);

				const registrations = completeEntries(
					await fetchObjectEntries(registrationDefinition),
					registrationFields,
					REGISTRATION_FIELDS
				);

				if (
					registrations.some((registration) =>
						eventIds.includes(Number(registration[eventField.name]))
					)
				) {
					return 1.0;
				}
			}
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
		'Objects created': objectsCreatedEvaluator,
		'Skills invoked': skillsInvokedEvaluator,
	},
	executor: createAgentTask(STRUCTURED_OUTPUT_SCHEMA),
	groupName: 'Create event registration',
});
