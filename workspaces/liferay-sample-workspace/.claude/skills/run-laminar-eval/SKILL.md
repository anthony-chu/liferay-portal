---

description: Bring up the local eval stack — Laminar via Docker Compose, a clean Liferay bundle, workspace dependencies — and run an eval file against it. Use when the user asks to run an eval, run the Laminar/lmnr evals, or start the eval environment from scratch.
name: run-laminar-eval

---

# Run Laminar Eval

Stand up everything an eval needs, in order, then run it: Laminar for observability, a Liferay bundle with cleared runtime state, and the workspace's Node dependencies.

## When to Invoke

- The user asks to "run the eval", "run the manage-objects eval", or names any file under `lmnr-evals/`.
- The user asks to start or reset the eval environment.

Every step is idempotent, so the skill is safe to rerun against a stack that is already partly up.

## Prerequisites

`docker`, `blade`, `node`, and `yarn` on the path. The workspace product is DXP (`liferay.workspace.product` in `gradle.properties`), so a license file is required on a freshly initialized bundle.

## Workflow

### Start Laminar

The stack reads its credentials from `lmnr/.env`, and `lmnr/docker-compose.yml` writes every one of them as a bare `${VAR}` with no fallback. That file is gitignored, so a fresh checkout will not have it. Recreate it from the committed template before starting anything:

```bash
[ -f lmnr/.env ] || cp lmnr/.env.example lmnr/.env
```

`.env.example` ships working local-dev values, so the copy needs no editing. Skipping this step does not fail loudly — postgres exits with `Database is uninitialized and superuser password is not specified`, and app-server and quickwit then report a dependency failure rather than the real cause.

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

Do not wait for a literal `200` — the dashboard answers `307`, redirecting to sign-in. `curl --fail` treats that as success, which is why the check is written this way. On a wiped Postgres volume the frontend also runs its migrations on first boot (`Applying ClickHouse schema. This may take a while...`), so several minutes of refused connections here is normal. The endpoint that actually has to work is the one `lib/bootstrap.ts` calls:

```bash
curl --silent --request POST http://localhost:5667/api/auth/sign-in/local-email \
    --header 'Content-Type: application/json' \
    --data '{"email":"test@liferay.com","name":"Test"}'
```

A `200` with a `token` in the body means Laminar is genuinely ready.

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
rm -rf bundles/logs bundles/portal-env.properties
find bundles/data -mindepth 1 -maxdepth 1 ! -name license -exec rm -rf {} +
```

`data` and `logs` hold the database, the search indexes, and the log files, so removing them is what makes the run start from an empty portal.

**Spare `bundles/data/license`.** A registered license lives there as a `.li` file, and the portal reads it back on the next boot — verified: with `bundles/deploy/` empty, a boot off a preserved `bundles/data/license` logs `DXP Development license validation passed` from `[main]` at startup. A plain `rm -rf bundles/data` destroys that registration, and the portal then boots unlicensed.

`portal-env.properties` has to go too. `blade server init` copies it out of `configs/local`, where it points `jdbc.default.url` at `jdbc:postgresql://database/lportal` — `database` is a Docker Compose service name from the workspace's `docker-compose.yaml` and does not resolve from a Tomcat that Blade started on the host. `portal-ext.properties` pulls it in through `include-and-override`, which tolerates the file being absent, so removing it drops the bundle back to the embedded Hypersonic database and the boot needs no external database at all.

### License Checkpoint

Run this on **every** run, not only after a fresh `blade server init`. Do not infer that an existing bundle is licensed — a previous run's clear step may have destroyed the registration, and the boot that follows fails quietly rather than loudly.

The product is DXP (`liferay.workspace.product` in `gradle.properties`), so a license is required. It counts as present when either of these holds:

- a `.li` file under `bundles/data/license/` — a registration the portal reads at startup, and what the clear step above preserves.
- an `.xml` file in `bundles/deploy/` whose root element is `<license>` or `<licenses>` — an activation key that auto-deploy processes during boot. Liferay identifies these by content, not by filename. Note that auto-deploy consumes the file, so `bundles/deploy/` is empty again afterwards.

When neither is there, **stop and ask the user for a license**, and wait for them to confirm before starting the server. The durable place to keep one is `configs/local/deploy/`: `blade server init` copies `configs/<environment>/` into the bundle root with its subdirectories intact, so a key there lands in `bundles/deploy/` on the next init. That copy runs only at init time, so on an already-initialized bundle put the key straight into `bundles/deploy/`.

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

- `stop-laminar-eval` — take the same stack back down when the run is finished.
- `workspace-init` — full workspace bootstrap, BasicAuth verifier, and first login setup.
- `deploy-and-verify` — deploying client extensions to the bundle this skill starts.