---

description: Bring up the local eval stack — Laminar via Docker Compose, a clean Liferay bundle, workspace dependencies — and run an eval file against it. Use when the user asks to run an eval, run the Laminar/lmnr evals, or start the eval environment from scratch.
name: run-eval

---

# Run Eval

Stand up everything an eval needs, in order, then run it: Laminar for observability, a Liferay bundle with cleared runtime state, and the workspace's Node dependencies.

## When to Invoke

- The user asks to "run the eval", "run the manage-objects eval", or names any file under `lmnr-evals/`.
- The user asks to start or reset the eval environment.

Every step is idempotent, so the skill is safe to rerun against a stack that is already partly up.

## Prerequisites

`docker`, `blade`, `node`, and `yarn` on the path. The workspace product is DXP (`liferay.workspace.product` in `gradle.properties`), so a license file is required on a freshly initialized bundle.

## Workflow

### Start Laminar

```bash
cd lmnr && docker compose up --detach
```

Laminar is self-hosted here, not `laminar.sh`. The stack publishes:

| Service | Host port |
| --- | --- |
| Frontend / dashboard | 5667 |
| App server HTTP API | 8000 |
| App server gRPC | 8001 |
| ClickHouse | 7280 |
| Postgres | 5433 |

Poll the dashboard until it answers:

```bash
curl --fail --output /dev/null --silent http://localhost:5667
```

**Port conflict**: the workspace's own `docker-compose.yaml` (the `liferay-stack` Postgres + Liferay containers) also binds host port 8000, for JPDA. Do not run that stack and Laminar at the same time — this skill starts Liferay through Blade, not through that compose file.

### Ensure a Liferay Bundle Exists

From the workspace root:

```bash
ls -d bundles
```

- **Present** — the server already exists. Remember this; the license checkpoint below is skipped.
- **Absent** — run `blade server init` and remember that the bundle is newly initialized.

### Clear Runtime State

```bash
rm -rf bundles/data bundles/logs
```

This clears the embedded database, the search indexes, and the logs. Note the scope: when `configs/local/portal-env.properties` points `jdbc.default.url` at an external database, the portal's data lives in that database and survives this step. Reset that database separately when the eval needs a genuinely empty portal.

### License Checkpoint

Run this **only when the bundle was just initialized** in the step above. A bundle that already existed is assumed to be licensed.

Liferay identifies a license by XML content, not by filename. Look for any `.xml` file in `bundles/deploy/` whose root element is `<license>` or `<licenses>`. If none is there, **stop and ask the user to drop their license file into `bundles/deploy/`**, and wait for them to confirm. Do not start the server without it.

### Confirm the Database Is Reachable

`blade server init` copies `configs/common` and `configs/local` into the bundle, so the bundle's JDBC settings come from `configs/local/portal-env.properties`. Read the copied `bundles/portal-env.properties` and check the `jdbc.default.url` host.

The current local config points at `jdbc:postgresql://database/lportal`. `database` is a Docker Compose service name from the workspace's `docker-compose.yaml`; it does not resolve from a Tomcat started by Blade on the host. When the host does not resolve, raise it with the user and let them choose how to resolve it — starting the compose `database` service and making the name resolve, or pointing `jdbc.default.url` at a host that is reachable. Do not edit their config unprompted.

### Start the Bundle

```bash
blade server start
```

This runs in the background. Follow progress in `bundles/tomcat*/logs/catalina.out` and watch for `Server startup in`. A first boot against an empty database takes several minutes.

### Verify Port 8080

Poll until the portal answers with `200`:

```bash
curl --output /dev/null --silent --write-out '%{http_code}' http://localhost:8080
```

A failing request does not mean the server died — it may still be booting. Distinguish the two by checking for the Tomcat JVM process: process present and HTTP failing means starting; process absent means it stopped, so read `catalina.out` and the daily log under `bundles/logs/` for the cause.

### Install Workspace Dependencies

The workspace declares Yarn (`liferay.workspace.node.package.manager=yarn`) and carries a `yarn.lock` plus a `workspaces` block in `package.json`. From the workspace root:

```bash
yarn install
```

Skip only when `node_modules/` is already present and current.

### Run the Eval

From the workspace root — not from `lmnr-evals/`:

```bash
yarn tsx lmnr-evals/manage-objects.eval.ts
```

`lib/agent-task.ts` reads `.claude/skills` relative to the working directory and throws when it finds nothing, so the working directory has to be the workspace root.

Use `yarn tsx` rather than `yarn lmnr eval`. The CLI bundles the eval with esbuild and runs it in a sandbox, which breaks the Claude Agent SDK's `createRequire(import.meta.url)` unless `--external-packages @anthropic-ai/claude-agent-sdk` is passed.

### Report the Result

Give the user the per-evaluator scores from the run output and the dashboard link at `http://localhost:5667`, where the executor and evaluator span tree for the run is recorded.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `401` from Laminar during the eval | The SDK defaulted to `api.lmnr.ai` instead of the local instance. Check the `config` block in the eval file: `baseUrl: 'http://localhost'`, `httpPort: 8000`, `grpcPort: 8001`. The local project API key always fails against the cloud. |
| `401` with the config correct | Every eval takes `projectApiKey` from `lib/bootstrap.ts`, which signs in against `localhost:5667` and mints a fresh key at import time. A `401` here means that sign-in failed, so check that the Laminar frontend is up before looking at the key. A new eval file must import `projectApiKey` too — never hardcode a key, since it goes stale whenever the Laminar Postgres volume is recreated. |
| `No skills found in .claude/skills` | The eval was run from the wrong working directory. Run it from the workspace root. |
| `403` on `/o/*` calls from the evaluators | The BasicAuth verifier is missing from the bundle. `configs/local/portal-ext.properties` carries `auth.verifier.BasicAuthHeaderAuthVerifier.urls.includes=/api/*,/xmlrpc/*,/o/*`; confirm it reached `bundles/portal-ext.properties`. |
| No LLM token or cost data on the spans | The agent SDK runs the `claude` CLI as a separate process, so auto-instrumentation sees nothing. `lib/agent-task.ts` handles this by wrapping `query` with `Laminar.wrapClaudeAgentQuery`. |

## Related Skills

- `workspace-init` — full workspace bootstrap, BasicAuth verifier, and first login setup.
- `deploy-and-verify` — deploying client extensions to the bundle this skill starts.