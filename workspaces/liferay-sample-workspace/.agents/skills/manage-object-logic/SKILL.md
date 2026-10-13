---

description: Add business logic to Liferay Objects via object actions, workflow definitions, and notification templates. Use when the user asks to send a notification on create, trigger an action on update, wire a workflow, or automate any response to object entry lifecycle events.
name: manage-object-logic

---

# Manage Object Logic

Attach triggers, conditions, and actions to object definitions. The three extension points are object actions (immediate), Kaleo workflows (approval, see "Approval Workflow"), and notification templates (user facing messages).

## When to Invoke

- "Send a notification when a Book is created"
- "Trigger a webhook on order update"
- "Wire an approval workflow to this object"
- "Run a Groovy script after an entry is deleted"
- Called by `build-site` during the logic phase

## Prerequisites

Object definition must already exist and be published (see `manage-objects`). Client Extension actions require the CET to be deployed first (see `scaffold-client-extension`).

## Workflow

### Choose the Trigger

| Trigger | When It Fires |
| --- | --- |
| `onAfterAdd` | After an entry is created |
| `onAfterUpdate` | After an entry is updated |
| `onAfterDelete` | After an entry is deleted |
| `standalone` | On demand, invoked explicitly by a user or API call |

### Choose the Action Type

Consult `rules/object-actions-catalog.md` for the full catalog. Summary:

| Action Type | Payload | Notes |
| --- | --- | --- |
| Notification | Template ID | Sends in app or email notification |
| `addObjectEntry` | Definition name + field map | Creates an entry in another object |
| `updateObjectEntry` | Entry ID + field map | Updates an entry in the same or another object |
| Webhook | URL + secret | HTTP POST to external endpoint |
| Groovy Script | Script body | Self hosted or PaaS **and** script execution enabled — off by default, see `rules/object-actions-catalog.md`. Probe before designing around it |
| Client Extension | CET `objectAction` or `workflowAction` externalReferenceCode | Calls a deployed microservice |

### Object Action — Notification (Site Initializer, Preferred)

When the object lives in a site initializer, author the template **and** its action in the tree so the whole thing survives delete and redeploy. The REST recipe further down is for one off changes to a running instance.

Three files in one directory, `site-initializer/notification-templates/<name>/`:

```
notification-templates/
  registration-confirmation/
    notification-template.json                  # metadata
    en-US.html                                  # body, one file per locale
    notification-template.object-actions.json   # the action(s) that fire it
```

`notification-template.json` — note there is **no `body` key**; the handler builds `body` from every `*.html` in the directory, keyed by filename (`en-US.html` → `en-US`):

```json
{
	"editorType": "richText",
	"externalReferenceCode": "<TEMPLATE_ERC>",
	"name": "<Template Name>",
	"recipientType": "email",
	"recipients": [
		{
			"from": "noreply@example.com",
			"fromName": {
				"en_US": "<Sender>"
			},
			"singleRecipient": true,
			"to": {
				"en_US": "[%<OBJECTNAME>_<FIELDNAME>%]"
			}
		}
	],
	"subject": {
		"en_US": "<Subject>"
	},
	"type": "email"
}
```

`notification-template.object-actions.json` — a bare array. **Do not set `notificationTemplateId`**; the handler injects the ID of the template it sits beside, which is what makes the pair portable:

```json
[
	{
		"active": true,
		"externalReferenceCode": "<ACTION_ERC>",
		"label": {"en_US": "<Action Label>"},
		"name": "<actionName>",
		"objectActionExecutorKey": "notification",
		"objectActionTriggerKey": "onAfterAdd",
		"objectDefinitionId": "[$OBJECT_DEFINITION_ID:<ObjectName>$]"
	}
]
```

#### Field Tokens

A term is `[%` + the object's **short name** + `_` + the **field name**, all uppercased, + `%]`. For a `Registration` object with fields `attendeeName` and `email`: `[%REGISTRATION_ATTENDEENAME%]` and `[%REGISTRATION_EMAIL%]`. Camel case collapses — there is no separator inside the field name.

Tokens work in `subject`, in the body HTML, and in `recipients[].to`, which is how a confirmation is addressed to the address the visitor just typed.

Only fields **on that object** resolve. A token reaching across a relationship stays in the output as literal `[%…%]` text.

**The fix is to denormalize.** Add a plain `Text` field to the object holding the related value, populate it when the entry is created, and token that field instead. A registration confirmation that must name the event needs an `eventName` copied onto `Registration` — `[%REGISTRATION_EVENTNAME%]` resolves, a reach through `eventRegistrations` does not. Same pattern as `manage-pages` → "Mapping Limits"; the relationship stays authoritative, the copy is for display.

Verify after sending:

```bash
curl \
	--silent \
	--url "http://localhost:${PORT}/o/notification/v1.0/notification-queue-entries?pageSize=50" \
	--user "test@liferay.com:test" \
	| jq '.items | sort_by(.id) | last
		| {id, recipientsSummary, status, unresolved: (.body | test("\\[%"))}'
```

> **Do not add `sort=` to that URL.** `notification-queue-entries` does not support the common `sort` parameter and **fails silently** — `?sort=id:desc` returns `{"totalCount": null, "items": []}` with a `200`, which reads exactly like "the action never fired". Fetch unsorted and sort in `jq`, as above.

`unresolved: false` with the right `recipientsSummary` means Liferay **built** a correctly addressed message. That is the part this endpoint can actually tell you.

#### `status: 1` Is `STATUS_SENT` and It Lies

The status codes are not a queue depth. From `NotificationQueueEntryConstants`:

| Value | Constant |
| --- | --- |
| `0` | `STATUS_FAILED` |
| `1` | `STATUS_SENT` |
| `2` | `STATUS_UNSENT` |

So `status: 1` is Liferay asserting the mail **was sent** — and it asserts that even when nothing was transmitted. Verified on 2026.Q2 with a local SMTP sink on `127.0.0.1:2525` and the mail session pointed at it: two entries came back `status: 1` with `sent: null`, and the sink received **nothing**. Not a delayed send, not a failure code — a claim of success with no traffic behind it.

Treat this field as worthless for delivery. `sent: null` alongside `status: 1` is the tell that the two are not wired to the same truth, but the only real check is at the receiving end.

#### Localize a Mail Failure Before Blaming the Notification

When the message builds but nothing arrives, the fault is either the notification framework or the mail transport, and the queue entry cannot distinguish them. **Trigger an unrelated portal email and see whether that arrives**, which needs no admin session:

```bash
curl \
	--data-urlencode "emailAddress=test@liferay.com" \
	--data-urlencode "step=2" \
	--request POST \
	--silent \
	--url "http://localhost:${PORT}/c/portal/forgot_password"
```

If the password reset mail is missing too, the notification wiring is fine and the mail session is the problem — stop debugging object actions. That one call saved a long detour here.

Then check **Control Panel → Server Administration → Mail** before trusting `portal-ext.properties`. Adding `mail.session.mail.smtp.*` to that file and restarting was not sufficient on a bundle in this run; the cause was not isolated (that page needs an admin session), so verify the effective host and port there rather than assuming the properties won.

Report queueing and delivery as separate facts. "Composed and addressed correctly, delivery unverified" is honest; "the confirmation email was sent" is not, no matter what `status` says.

### Object Action — Notification (Live API)

Create a notification template first if one does not exist:

```bash
curl \
	--data '{
		"body": {"en_US": "A new [%OBJECT_FIELD_NAME%] was created."},
		"description": "",
		"editorType": "richText",
		"name": "<TemplateName>",
		"objectDefinitionExternalReferenceCode": "<objectERC>",
		"recipientType": "user",
		"subject": {"en_US": "New entry created"},
		"type": "email"
	}' \
	--header "Content-Type: application/json" \
	--request POST \
	--silent \
	--url "http://localhost:${PORT}/o/notification/v1.0/notification-templates" \
	--user "test@liferay.com:test"
```

That shape mails a **portal user**. A public form has no user — the address was typed into a field — so `recipientType: "user"` is wrong there and there is no `recipients` block to carry the address.

#### Mailing an Address Held in a Field (Public Forms)

Combine the live create with the tree format's `recipients` array. This is the shape a registration or enquiry confirmation needs:

```bash
curl \
	--data '{
		"body": {"en_US": "<p>Hi [%REGISTRATION_ATTENDEENAME%], we received your registration for [%REGISTRATION_EVENTNAME%].</p>"},
		"editorType": "richText",
		"externalReferenceCode": "REGISTRATION_CONFIRMATION",
		"name": "Registration Confirmation",
		"objectDefinitionExternalReferenceCode": "REGISTRATION",
		"recipientType": "email",
		"recipients": [
			{
				"from": "noreply@example.com",
				"fromName": {"en_US": "DevCon Registration"},
				"singleRecipient": true,
				"to": {"en_US": "[%REGISTRATION_EMAIL%]"}
			}
		],
		"subject": {"en_US": "We received your registration"},
		"type": "email"
	}' \
	--header "Content-Type: application/json" \
	--request POST \
	--silent \
	--url "http://localhost:${PORT}/o/notification/v1.0/notification-templates" \
	--user "test@liferay.com:test"
```

`recipients[].to` takes a token, which is what addresses the mail to whatever the visitor typed.

**`from` persists on the template; it is the queue entry that reports `null`.** Verified on 2026.Q2 — a fresh `GET /notification-templates/<id>` read back `"from": "noreply@devcon.example"` exactly as posted, alongside `fromName`. The `null` turns up one layer down, on the `notification-queue-entries` record, so a check there is what makes `from` look dropped. Set it on the template as documented, and confirm the actual sender on the received message rather than on the queue entry.

The `NotificationTemplate` schema exposes no enums for `type` or `recipientType` and publishes no nested `Recipient` schema, so the OpenAPI spec will not confirm this shape — it is verified by creating one and reading the queue entry.

Save the returned `id` as `<template-id>`. Then create the action:

```bash
curl \
	--data '{
		"active": true,
		"label": {"en_US": "<ActionLabel>"},
		"name": "<actionName>",
		"objectActionExecutorKey": "notification",
		"objectActionTriggerKey": "onAfterAdd",
		"parameters": {
			"notificationTemplateId": <template-id>
		}
	}' \
	--header "Content-Type: application/json" \
	--request POST \
	--silent \
	--url "http://localhost:${PORT}/o/object-admin/v1.0/object-definitions/<definition-id>/object-actions" \
	--user "test@liferay.com:test"
```

### Object Action — Webhook

```bash
curl \
	--data '{
		"active": true,
		"label": {"en_US": "<ActionLabel>"},
		"name": "<actionName>",
		"objectActionExecutorKey": "webhook",
		"objectActionTriggerKey": "onAfterAdd",
		"parameters": {
			"secret": "<hmac-secret>",
			"url": "<https://endpoint.example.com/hook>"
		}
	}' \
	--header "Content-Type: application/json" \
	--request POST \
	--silent \
	--url "http://localhost:${PORT}/o/object-admin/v1.0/object-definitions/<definition-id>/object-actions" \
	--user "test@liferay.com:test"
```

### Object Action — Client Extension

First deploy the `objectAction` CET via `scaffold-client-extension`. Then reference its `externalReferenceCode`:

```bash
curl \
	--data '{
		"active": true,
		"label": {"en_US": "<ActionLabel>"},
		"name": "<actionName>",
		"objectActionExecutorKey": "objectAction",
		"objectActionTriggerKey": "onAfterAdd",
		"parameters": {
			"clientExtensionEntryExternalReferenceCode": "<cet-erc>"
		}
	}' \
	--header "Content-Type: application/json" \
	--request POST \
	--silent \
	--url "http://localhost:${PORT}/o/object-admin/v1.0/object-definitions/<definition-id>/object-actions" \
	--user "test@liferay.com:test"
```

The executor key for a Client Extension action is `"objectAction"` (not `"groovy"` — that key is only for the inline Groovy executor). See `rules/object-actions-catalog.md`.

### Approval Workflow

Use this when a reviewer approves or rejects each entry. Everything in this section was verified end to end on a 2026.Q2 bundle.

**Do not link the stock Single Approver.** Its `reject` transition goes to an `update` task that sets the entry back to Pending for the author to revise, so a rejected entry never leaves Pending, and a Guest submitter has no account to act on `update` with. **Do not write a Groovy script action either.** Deploying one fails with `KaleoDefinitionValidationException.NotAllowedScriptLanguage` (`Groovy is not allowed`).

Set the status with declarative `<status>` actions on two terminal states instead:

```xml
<?xml version="1.0"?>
<workflow-definition xmlns="urn:liferay.com:liferay-workflow_7.4.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="urn:liferay.com:liferay-workflow_7.4.0 http://www.liferay.com/dtd/liferay-workflow-definition_7_4_0.xsd">
	<name><Workflow Name></name>
	<version>1</version>
	<state>
		<name>created</name>
		<initial>true</initial>
		<transitions>
			<transition>
				<name>review</name>
				<target>review</target>
				<default>true</default>
			</transition>
		</transitions>
	</state>
	<task>
		<name>review</name>
		<assignments>
			<roles>
				<role>
					<role-type>regular</role-type>
					<name>Administrator</name>
				</role>
			</roles>
		</assignments>
		<transitions>
			<transition>
				<name>approve</name>
				<target>approved</target>
				<default>true</default>
			</transition>
			<transition>
				<name>reject</name>
				<target>rejected</target>
				<default>false</default>
			</transition>
		</transitions>
	</task>
	<state>
		<name>approved</name>
		<actions>
			<action>
				<name>approve</name>
				<status>0</status>
				<execution-type>onEntry</execution-type>
			</action>
		</actions>
	</state>
	<state>
		<name>rejected</name>
		<actions>
			<action>
				<name>reject</name>
				<status>4</status>
				<execution-type>onEntry</execution-type>
			</action>
		</actions>
	</state>
</workflow-definition>
```

The entry's system `status` follows the workflow: `1` pending on submission, `0` approved, `4` denied. There is no separate "rejected" code. A rejected entry reads `{"code": 4, "label": "denied"}`.

#### Deploy and Link Over REST

Deploy the definition, building the body with `jq` so the XML is escaped:

```bash
jq \
	--arg content "$(cat <workflow>.xml)" \
	--null-input \
	'{active: true, content: $content, name: "<Workflow Name>", title: "<Workflow Name>"}' \
	| curl \
		--data @- \
		--header "Content-Type: application/json" \
		--request POST \
		--silent \
		--url "http://localhost:${PORT}/o/headless-admin-workflow/v1.0/workflow-definitions/deploy" \
		--user "test@liferay.com:test"
```

Link it to the object with the returned `id`:

```bash
curl \
	--data '{
		"className": "<object definition className>",
		"groupId": 0,
		"workflowDefinitionName": "<Workflow Name>"
	}' \
	--header "Content-Type: application/json" \
	--request POST \
	--silent \
	--url "http://localhost:${PORT}/o/headless-admin-workflow/v1.0/workflow-definitions/<workflow-definition-id>/workflow-definition-links" \
	--user "test@liferay.com:test"
```

- `className` is the object definition's `className` field (`com.liferay.object.model.ObjectDefinition#<code>`), not its `name`. Read it with `GET /o/object-admin/v1.0/object-definitions/<id>`.
- `groupId` is `0` for a company scoped object. A link at the site's group ID is accepted and then never applies to entries posted to `/o/c/<plural>`.
- A link cannot be deleted (`405`), and there is no top level `GET /workflow-definition-links` (`404`). List a definition's links with `GET /workflow-definitions/<id>/workflow-definition-links`, and repoint one with `PUT /workflow-definition-links/by-external-reference-code/<erc>`.

Confirm by posting an entry: the response `status.label` is `pending`.

#### In a Site Initializer

`site-initializer/workflow-definitions/<name>/` holds `workflow-definition.json` (the DTO without `content`), `workflow-definition.xml`, and `workflow-definition.properties.json`, which links it:

```json
[
	{
		"assetName": "C_<ObjectName>",
		"className": "com.liferay.object.model.ObjectDefinition",
		"scope": "company"
	}
]
```

`assetName` is the definition's database name, prefixed with `C_`. A bare `<ObjectName>` matches nothing and the link is skipped without a log line. The handler also declares no dependency on the object definition handlers, so the object may not exist yet when it runs. After provisioning, list the links as above, and link over REST when the link is missing.

#### Approve or Reject as the Administrator

```bash
WF="http://localhost:${PORT}/o/headless-admin-workflow/v1.0"

INSTANCE=$(curl \
	--silent \
	--url "${WF}/workflow-instances?completed=false&pageSize=200" \
	--user "test@liferay.com:test" \
	| jq --argjson id <entry-id> '.items[] | select(.objectReviewed.id == $id) | .id')

TASK=$(curl \
	--silent \
	--url "${WF}/workflow-instances/${INSTANCE}/workflow-tasks?completed=false" \
	--user "test@liferay.com:test" \
	| jq '.items[0].id')

curl \
	--data '{}' \
	--header "Content-Type: application/json" \
	--request POST \
	--silent \
	--url "${WF}/workflow-tasks/${TASK}/assign-to-me" \
	--user "test@liferay.com:test"

curl \
	--data '{"transitionName": "approve"}' \
	--header "Content-Type: application/json" \
	--request POST \
	--silent \
	--url "${WF}/workflow-tasks/${TASK}/change-transition" \
	--user "test@liferay.com:test"
```

- `assign-to-me` needs the JSON `{}` body. Without it the call returns `415`, and transitioning an unclaimed task returns `403`.
- The body field is `transitionName`. `{"name": ...}` returns `400`.
- Use `"reject"` for the other outcome. The entry's status changes within a second.

### Verify Object Actions

```bash
curl \
	--silent \
	--url "http://localhost:${PORT}/o/object-admin/v1.0/object-definitions/<definition-id>/object-actions" \
	--user "test@liferay.com:test" \
	| jq '[.items[] | {name, objectActionTriggerKey, objectActionExecutorKey, active}]'
```

Confirm each action is `"active": true`.

### Test the Trigger

Create a test entry and check the expected side effect (email received, webhook payload, other entry created):

```bash
curl \
	--data '{"<fieldName>": "test value"}' \
	--header "Content-Type: application/json" \
	--request POST \
	--silent \
	--url "http://localhost:${PORT}/o/c/<pluralLabel>" \
	--user "test@liferay.com:test"
```

## Patterns and Gotchas

### Object Action Refire Loop

`onAfterUpdate` fires on **every** REST PATCH — including PATCHes made by the action itself. If your action writes back to the same record via REST, it will loop.

**Safe path**: call `ObjectEntryLocalServiceUtil.updateObjectEntry` directly from within the Object Action. Direct service layer calls do **not** retrigger the Object Action — only REST API calls do. Use this pattern for any script that needs to update the same record it is acting on.

### Groovy Output Binding

Object Action Groovy scripts have no `out` binding. Use bare `println` to write to `catalina.out`. Using `out.println` throws `No such property: out`.

### Diagnostic Action Hygiene

Stale diagnostic Object Actions are a silent data hazard: they continue firing on every matching event after a session ends and can revert data changes at unexpected times — often with no error, just a wrong value in the database. Secondary concern: they accumulate output in `catalina.out` and interleave with real logs.

Rules:

- Prefix all diagnostic actions with `diag-` (e.g., `diag-check-balance`).
- Delete all `diag-` actions before shipping — they are not safe to leave running in any persistent environment.
- Bulk delete when done: filter by name prefix in Control Panel → Objects → [Object] → Actions, or via the Object Admin REST API.

### Type Safety in Groovy

Never pass interpolated strings (`"${var}"`) to Liferay Service APIs. Groovy `GStringImpl` causes cast exceptions. Always use explicit string concatenation: `"" + var`.

## Success Signal

TODO / inferred — verify against a running bundle. The Verify Object Actions and Test the Trigger steps above (each action `"active": true`; a test entry fires the expected side effect) are the observable completion checks; confirm on a live bundle.