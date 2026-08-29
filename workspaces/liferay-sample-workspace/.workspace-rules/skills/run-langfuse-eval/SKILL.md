---

description: Bring up the local eval stack — Langfuse via Docker Compose, a clean Liferay bundle, workspace dependencies — and run an eval file against it. Use when the user asks to run a Langfuse eval, run the evals under langfuse-evals/, or start the Langfuse eval environment from scratch.
name: run-langfuse-eval

---

# Run Langfuse Eval

Stand up everything an eval needs, in order, then run it: Langfuse for observability, a Liferay bundle with cleared runtime state, and the workspace's Node dependencies.

## When to Invoke

- The user asks to "run the Langfuse eval", "run the manage-objects eval against Langfuse", or names any file under `langfuse-evals/`.
- The user asks to start or reset the Langfuse eval environment.

Every step is idempotent, so the skill is safe to rerun against a stack that is already partly up.

For the Laminar-backed evals under `lmnr-evals/`, use `run-laminar-eval` instead. The two stacks share no host ports and can run side by side.

## Prerequisites

`docker`, `blade`, `node`, and `yarn` on the path. The workspace product is DXP (`liferay.workspace.product` in `gradle.properties`), so a license file is required on a freshly initialized bundle.

This skill drives `langfuse/docker-compose.yml`, a checkout of Langfuse 4.24.0 at the workspace root. The repository records that path as a gitlink with no `.gitmodules` entry, so no file under it is tracked and a fresh clone gets an empty directory — populate it from `github.com/langfuse/langfuse` at v4.24.0 before starting.

## Workflow

### Start Langfuse

```bash
cd langfuse && docker compose up --detach
```

No `.env` step is needed. Every `${VAR}` in `langfuse/docker-compose.yml` carries a `:-` fallback, so the stack boots on its defaults with no environment file present. This is the opposite of the Laminar stack, where a missing `lmnr/.env` fails obscurely — do not copy that precaution over.

Langfuse is self-hosted here, not `cloud.langfuse.com`. The stack publishes:

| Service | Host port |
| --- | --- |
| Web / dashboard and public API | 3000 |
| Worker | 3030 (localhost only) |
| ClickHouse HTTP / native | 8123, 9000 (localhost only) |
| Redis | 6379 (localhost only) |
| Postgres | 5432 (localhost only) |
| MinIO API / console | 9090, 9091 |

Poll the health endpoint until it answers `200`:

```bash
curl --silent --write-out '\nHTTP %{http_code}\n' http://localhost:3000/api/public/health
```

A ready stack returns `{"status":"OK","version":"4.24.0"}`. Unlike the Laminar dashboard, which answers `307` and needs `curl --fail` to read as success, this endpoint returns a clean `200`, so check the status code directly. On a wiped Postgres volume the web container runs its migrations on first boot, so a few minutes of refused connections here is normal.

**Port conflict**: the workspace's own `docker-compose.yaml` (the `liferay-stack` Postgres + Liferay containers) binds host port 5432, and so does Langfuse's Postgres. Do not run that stack and Langfuse at the same time — this skill starts Liferay through Blade, not through that compose file.

### Confirm the Seeded Project Credentials

`langfuse-evals/lib/langfuse.ts` hardcodes `baseUrl`, `publicKey`, and `secretKey`, and those values have to match the `LANGFUSE_INIT_PROJECT_*` entries in `langfuse/docker-compose.yml`. Verify the pair actually authenticates before running anything:

```bash
curl --silent --user "pk-lf-public-key:sk-lf-secret-key" \
    http://localhost:3000/api/public/projects
```

A `200` listing the project (`my-eval-project`) means the credentials are good; a `401` means they are not.

The `LANGFUSE_INIT_*` variables seed the database **only on a fresh Postgres volume**. On a volume that already exists they are ignored, so an older volume carrying different keys will keep failing this check no matter how the compose file reads. Recreating the volume is destructive to prior run history — confirm with the user before doing it.

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

**Spare `bundles/data/license`.** A registered license lives there as a `.li` file, and the portal reads it back on the next boot. A plain `rm -rf bundles/data` destroys that registration, and the portal then boots unlicensed.

`portal-env.properties` has to go too. `blade server init` copies it out of `configs/local`, where it points `jdbc.default.url` at `jdbc:postgresql://database/lportal` — `database` is a Docker Compose service name from the workspace's `docker-compose.yaml` and does not resolve from a Tomcat that Blade started on the host. `portal-ext.properties` pulls it in through `include-and-override`, which tolerates the file being absent, so removing it drops the bundle back to the embedded Hypersonic database and the boot needs no external database at all.

### License Checkpoint

Run this on **every** run, not only after a fresh `blade server init`. Do not infer that an existing bundle is licensed — a previous run's clear step may have destroyed the registration, and the boot that follows fails quietly rather than loudly.

The product is DXP, so a license is required. It counts as present when either of these holds:

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

From the workspace root — not from `langfuse-evals/`:

```bash
yarn tsx langfuse-evals/manage-objects.eval.ts
```

`lib/agent-task.ts` reads `.claude/skills` relative to the working directory and throws when it finds nothing, so the working directory has to be the workspace root.

Run the file directly with `tsx`. Langfuse ships no eval CLI runner — `langfuse.experiment.run` is invoked from the eval file itself, and the file's own `otelSdk.start()` and trailing `await otelSdk.shutdown()` are what open and flush the trace export.

To type-check without running, use `npx tsc` from the workspace root. `tsconfig.json` covers `langfuse-evals/**/*.ts` and exits clean; `tsx` itself strips types without checking them.

### Report the Result

Give the user the per-evaluator scores from the run output and the dashboard link at `http://localhost:3000`, where the task and evaluator span tree for the run is recorded. Sign in with `test@liferay.com` / `Liferay123!`, the `LANGFUSE_INIT_USER_*` values from the compose file.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `401` from Langfuse during the eval | The keys in `lib/langfuse.ts` do not match `LANGFUSE_INIT_PROJECT_PUBLIC_KEY` / `LANGFUSE_INIT_PROJECT_SECRET_KEY` in `langfuse/docker-compose.yml`. Run the projects curl above to confirm. Remember those variables seed only on a fresh Postgres volume, so an older volume keeps its original keys. |
| `401` with the keys correct | The SDK reached `cloud.langfuse.com` instead of the local instance. Check `baseUrl` in `lib/langfuse.ts` — it must be `http://localhost:3000`. A local project key always fails against the cloud. |
| Run finishes, but no trace in the dashboard | Spans were never flushed. The eval has to `await otelSdk.shutdown()` at the end; without it the process exits before the batch processor exports. |
| Trace present, but the agent's spans missing | `otel.ts` filters exports through `shouldExportSpan`, which admits only `@arizeai/openinference` scopes plus default export spans. A span from any other instrumentation scope is dropped by design. |
| No LLM token or cost data on the spans | The agent SDK runs the `claude` CLI as a separate process, so auto-instrumentation sees nothing. `lib/agent-task.ts` handles this by passing the SDK module through `ClaudeAgentSDKInstrumentation.manuallyInstrument`. |
| `No skills found in .claude/skills` | The eval was run from the wrong working directory. Run it from the workspace root. |
| `403` on `/o/*` calls from the evaluators | The BasicAuth verifier is missing from the bundle. `configs/local/portal-ext.properties` carries `auth.verifier.BasicAuthHeaderAuthVerifier.urls.includes=/api/*,/xmlrpc/*,/o/*`; confirm it reached `bundles/portal-ext.properties`. |
| Postgres container exits on `bind: address already in use` | The workspace's own `docker-compose.yaml` stack is up and holding host port 5432. Take it down first. |

## Related Skills

- `run-laminar-eval` — the same procedure against the Laminar stack and the `lmnr-evals/` files.
- `stop-laminar-eval` — take the Laminar stack back down. There is no Langfuse equivalent yet; stop this stack with `docker compose down` from `langfuse/` and `blade server stop` from the workspace root.
- `workspace-init` — full workspace bootstrap, BasicAuth verifier, and first login setup.
- `deploy-and-verify` — deploying client extensions to the bundle this skill starts.