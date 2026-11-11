---

description: Bring up the local eval stack — Laminar via Docker Compose, and a new Liferay and PostgreSQL built by the workspace's own Docker bootstrap scripts with the eval's configuration and client extensions baked into the image — through the harness tasks in `lmnr.gradle`, then run the eval. Use when the user asks to run an eval, run the Laminar/lmnr evals, or start the eval environment from scratch.
name: run-laminar-eval

---

# Run Laminar Eval

Every eval is a folder under `lmnr/evals/<eval>` with its `<eval>.eval.ts`. The harness in `lmnr.gradle` at the workspace root builds the environment that eval needs: Laminar, then a new Liferay and PostgreSQL in Docker, from an image the workspace's own `buildDockerImage` builds with the eval's client extensions baked in, and with its portal properties and OSGi configs set as environment variables. Then the eval runs from the workspace root. The Liferay environment is thrown away after each run.

## When to Invoke

- The user asks to "run the eval", "run the create-site eval", or names anything under `lmnr/evals`.
- The user asks to start or reset the eval environment.

## Prerequisites

`docker`, `node`, `yarn`, and `curl` on the path, and bash 4.4 or newer (the workspace's `scripts` need it).

| Variable | Needed for | Where it comes from |
| --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | The eval's agent | `claude setup-token`. Export it in the shell, or put `CLAUDE_CODE_OAUTH_TOKEN=<token>` in `.env` at the workspace root (the Laminar SDK loads it; the workspace `.gitignore` excludes it). The environment wins over `.env` |

No license is needed: `scripts/bootstrap/extract_license.sh` copies the trial license out of the local `liferay/dxp:latest` image, and pulls `latest` again only when that license has expired.

Check the token before starting anything, and ask the user for it when neither is set:

```bash
[[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]] || grep --quiet '^CLAUDE_CODE_OAUTH_TOKEN=.' .env
```

## Workflow

### Install Eval Dependencies

`lmnr/evals` is its own Yarn project, separate from the workspace root. From the workspace root:

```bash
yarn --cwd lmnr/evals install
```

Skip only when `lmnr/evals/node_modules` is already present and current.

### Set Up the Environment

From the workspace root:

```bash
./gradlew --init-script lmnr.gradle setUpEval -Plmnr.eval=<eval>
```

`<eval>` is the folder name under `lmnr/evals`, for example `create-site`. The build fails on the first failure or timeout, naming the task that failed. It takes about three minutes once Laminar is up.

`lmnr.gradle` is an init script, so it runs only when passed with `--init-script`, and `settings.gradle` does not know about it. In `beforeSettings` it sets `liferay.workspace.client-extension.dir` to `lmnr/client-extensions` and `liferay.workspace.configs.dir` to the empty `build/lmnr/configs`, before the workspace plugin reads them, so in that build only the harness's client extensions are projects and the workspace's own `configs/local` never reaches the image.

`setUpEval` removes the workspace's `liferay` and `database` containers and their volumes (`docker compose down --volumes`), so any running Liferay from this workspace and its data are gone. Under the workspace's restart policy this counts as a restart: say so before running it. If port 8080 is held by something else, ask first.

| Task, in order | What happens |
| --- | --- |
| `startLaminar` | Skipped when the sign in endpoint already answers. Otherwise `docker compose up --detach app-server frontend`, then a wait of up to 15 minutes (a new Postgres volume runs migrations first) |
| `stopLiferay` | `docker compose down --volumes database liferay` |
| `deleteEvalGeneratedPaths` | When the last run was never torn down, deletes what it generated first (see Tear Down) |
| `extractDockerFiles` | `scripts/bootstrap/extract_hotfix.sh` and `extract_license.sh`, as `build.sh` runs them |
| `buildDockerImage` | Builds the image. `dockerDeploy` and `buildDockerImage` are excluded for every client extension not in the eval's `env/client-extensions.list`, so only the listed ones are staged into `build/docker/client-extensions` |
| `tagLiferayImage` | Tags `<workspace>-liferay:<product>` as `liferay:local` |
| `startLiferay` | `docker compose up --detach database liferay`, then a wait for `/c/portal/status`. Laminar is left alone, and no client extension is deployed after start: they are in the image |
| `waitForClientExtensions` | For each listed client extension: a wait for every object definition it ships to be published and every site it creates to exist |

`setUpEval` ends by recording the untracked paths under `client-extensions` (and `bundles`, if present) in `lmnr/generated-paths.list`, gitignored, then printing the command that runs the eval.

Every Compose call goes through `docker_compose` in `scripts/_common.sh` with `LIFERAY_COMPOSE_OVERRIDES=lmnr`, plus the eval's `env/docker-compose.yaml` when it exists.

### Run the Eval

From the workspace root, not from `lmnr/evals`:

```bash
lmnr/evals/node_modules/.bin/tsx lmnr/evals/<eval>/<eval>.eval.ts
```

`lmnr/evals/lib/agent-task.ts` reads `.claude/skills` relative to the working directory and throws when it finds nothing. That is also why the command calls `tsx` directly: `yarn --cwd lmnr/evals tsx` would move the working directory.

Use `tsx`, not `yarn lmnr eval`. The CLI bundles the eval with esbuild and runs it in a sandbox, which breaks the Claude Agent SDK's `createRequire(import.meta.url)`.

The eval's agent may not edit `.agents` or `.claude` (`disallowedTools` in `agent-task.ts`), so every run tests the same skills, and may not read or edit `lmnr`.

### Report the Result

Give the user the per evaluator scores from the run output and the `Check results at` link it prints (on port 9667), where the executor and evaluator span tree is recorded.

### Tear Down

Leave Laminar running between runs.

| Command | Effect |
| --- | --- |
| `./gradlew --init-script lmnr.gradle tearDownEval -Plmnr.eval=<eval>` | `docker compose down --volumes database liferay`, then deletes what the run generated |
| `./gradlew --init-script lmnr.gradle tearDownEval stopLaminar -Plmnr.eval=<eval>` | Also `docker compose down` for the Laminar services. Never removes Laminar's volumes |

What the run generated: every untracked path under `client-extensions` that was not in `lmnr/generated-paths.list` when `setUpEval` finished (the client extensions the agent wrote), `bundles` when it was not there (container deploys leave an empty `bundles/osgi/client-extensions`), and `build/docker` (the image's staging, with the trial license). Changes to tracked files and anything outside `client-extensions` stay; check `git status`. Read what the agent built before tearing down.

To stop the stack without losing it, for example to resume later, use `docker compose --file docker-compose.yaml --file docker-compose-lmnr.yaml stop` in the workspace root, then `docker compose --file docker-compose.yaml --file docker-compose-lmnr.yaml start`. Never `docker compose down` without meaning to: the `database` service keeps PostgreSQL in an anonymous volume, which `down` does not reattach.

## Configuration

Portal properties and OSGi configs are environment variables on the `liferay` service, at two levels: global in `docker-compose-lmnr.yaml`, then the eval's own `lmnr/evals/<eval>/env/docker-compose.yaml` when it exists. The harness sets `LIFERAY_COMPOSE_OVERRIDES=lmnr,lmnr/evals/<eval>/env/docker-compose.yaml`, and `docker_compose` in `scripts/_common.sh` passes each entry as a `--file`: an entry with a `/` is a path from the workspace root, any other is `docker-compose-<name>.yaml`. Compose merges the files in order, so the eval's file holds only what it changes. The agent is denied `lmnr/**`, so it cannot see any of it.

A property is `LIFERAY_` plus its key encoded: `.` is `_PERIOD_`, `-` is `_MINUS_`, `_` is `_UNDERLINE_`, an uppercase letter is `_UPPERCASE<letter>_`, a digit is `_NUMBER<digit>_`, and lowercase letters are uppercased. An OSGi config is the property `configuration.override.<pid>_<key>`, with the value typed as in a `.config` file (`B"true"`, `I"3310"`). Copy each name from the `Env:` line above the key in `portal.properties` or `portal-osgi-configuration.properties` rather than encoding it by hand.

| In the eval's `docker-compose.yaml` | Effect |
| --- | --- |
| `LIFERAY_<KEY>: <value>` under `services.liferay.environment` | Adds the property, or replaces the global value |
| `LIFERAY_<KEY>:` with no value | Removes the global property: Compose leaves a key with no value out of the container unless the shell that runs it sets that variable. `!reset null` does not work here: Compose v5.1.4 ignores it on a key once two earlier files both set `environment` |

| File, in an `env` folder | Effect |
| --- | --- |
| `client-extensions.list` | One `lmnr/client-extensions` folder name per line, built into the image. Blank lines and lines starting with `#` are skipped |

The global level sets what every eval needs:

| Setting | Why |
| --- | --- |
| BasicAuth verifier on `/api/*,/xmlrpc/*,/o/*` | The evaluators call the headless APIs with Basic auth |
| `jdbc.default.*` for `jdbc:postgresql://database:5432/lportal`, user `postgres`, no password | The workspace's `database` service, reached by its Compose host name |
| Instance and admin properties (`company.default.web.id=liferay.com`, `test@liferay.com`, no setup wizard, no terms of use, no reminder queries, no forced password change) | No first login steps, so nothing waits on a person |
| `feature.flag.LPD-35443` | The page API that `build-site` and `manage-pages` drive |
| `feature.flag.LPD-39244` | The fragment API that `build-site` and `scaffold-fragment` drive |
| `feature.flag.LPD-63311` and `MCPServerConfiguration` `enabled=B"true"` | The MCP server at `/o/mcp` the agent connects to. On 2026.Q3 the flag alone leaves it at `404` |

For an eval where the agent has to set up MCP itself, list the `LPD-63311` flag and the `MCPServerConfiguration` `enabled` variable with no value in its `docker-compose.yaml`.

## Laminar

Laminar is self hosted from `docker-compose-lmnr.yaml`, an override of the workspace's `docker-compose.yaml`: the harness sets `LIFERAY_COMPOSE_OVERRIDES=lmnr`, so Laminar, `liferay`, and `database` are one Compose project, `liferay-stack`. The ClickHouse configs and the Quickwit build stay in `lmnr/compose`. Laminar's one shot `init` service generates the secrets into the `init-secrets` volume on first start; there is no `.env` to create. Every host port starts with `9`, so nothing collides with Liferay (8080, 8000, 11311) or its `database` (5432).

| Service | Host port |
| --- | --- |
| Frontend / dashboard | 9667 |
| App server HTTP API | 9000 |
| App server gRPC | 9001 |
| Quickwit REST | 9280 |
| Postgres | 9433 |

This Postgres is Laminar's own. Liferay's is the workspace `database` service; the two share no port, container name, network, or volume.

The harness treats Laminar as ready when the sign in call that `lmnr/evals/lib/bootstrap.ts` makes returns a `token`. The dashboard itself answers `307` well before that.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Unable to find a valid trial license in "liferay/dxp:latest"` | The newest `latest` image's trial license has expired too. Add an unexpired license to `build/docker/deploy/license.xml`, or wait for a newer image |
| `Timed out after …s waiting until …` | The step named did not finish. Check `docker compose logs liferay` |
| `Unable to build the Liferay image …` | The `build.sh` output above the message. A listed CET that fails to build stops it here |
| `Unable to find client extension in …` | A `client-extensions.list` names a folder missing from `lmnr/client-extensions` |
| `Unable to find an eval in lmnr/evals/<eval>` | The name is not a folder with a `*.eval.ts`. List the folders in `lmnr/evals` |
| `401` from Laminar during the eval | The SDK defaulted to `api.lmnr.ai`. Every eval must pass `config` from `lmnr/evals/lib/bootstrap.ts` to `evaluate`; it sets `baseUrl: 'http://localhost'`, `httpPort: 9000`, `grpcPort: 9001` |
| `401` with the config correct | The project API key in that `config` comes from a sign in at import time, so that sign in failed: check Laminar is up. Never hardcode a key; it goes stale when the Postgres volume is recreated |
| The `Check results at` link does not open | The link uses `frontendPort` from the same `config`, which must match the dashboard's host port (9667). The SDK default is 5667 |
| The agent fails to authenticate with Anthropic | `CLAUDE_CODE_OAUTH_TOKEN` is not set, or `.env` is not at the workspace root |
| `No skills found in .claude/skills` | The eval ran from the wrong working directory. Run it from the workspace root |
| `No compose override file found at …` | `LIFERAY_COMPOSE_OVERRIDES` names a path that does not exist. Check the eval's `env/docker-compose.yaml` |
| `403` on `/o/*` from the evaluators | The BasicAuth verifier is missing. Check that the eval's `docker-compose.yaml` does not remove it |
| `404` on `/o/mcp` | The eval's `docker-compose.yaml` turned off `LPD-63311` or removed the MCP config. Expected for an eval where the agent sets up MCP |
| No LLM token or cost data on the spans | The agent SDK runs `claude` as a separate process. `lmnr/evals/lib/agent-task.ts` wraps `query` with `Laminar.wrapClaudeAgentQuery` for this |

## Related Skills

- `stop-laminar-eval` — take the stack down when finished.
- `workspace-init` — the general Liferay setup, including the Docker path the harness builds on.
- `deploy-and-verify` — deploying client extensions to a running container.