---

description: Bring up the local eval stack — Laminar via Docker Compose, and a new Liferay and PostgreSQL built by the workspace's own Docker bootstrap scripts with the eval's configuration and client extensions baked into the image — through the harness in `lmnr/env`, then run the eval. Use when the user asks to run an eval, run the Laminar/lmnr evals, or start the eval environment from scratch.
name: run-laminar-eval

---

# Run Laminar Eval

Every eval is a folder under `lmnr/evals/<eval>` with its `<eval>.eval.ts`. The harness in `lmnr/env` builds the environment that eval needs: Laminar, then a new Liferay and PostgreSQL in Docker, built by the workspace's own `scripts/bootstrap/build.sh` and `start.sh` with the eval's portal properties, OSGi configs, and client extensions baked into the image. Then the eval runs from the workspace root. The Liferay environment is thrown away after each run.

## When to Invoke

- The user asks to "run the eval", "run the create-site eval", or names anything under `lmnr/evals`.
- The user asks to start or reset the eval environment.

## Prerequisites

`docker`, `blade`, `node`, `yarn`, `curl`, and `jq` on the path, and bash 4.4 or newer (the workspace's `scripts` need it).

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
lmnr/env/set_up.sh <eval>
```

`<eval>` is the folder name under `lmnr/evals`, for example `create-site`. The script exits nonzero on the first failure or timeout, naming the step that failed. It takes about three minutes.

`set_up.sh` removes the workspace's `liferay` and `database` containers and their volumes (`docker compose down --volumes`), so any running Liferay from this workspace and its data are gone. Under the workspace's restart policy this counts as a restart: say so before running it. If port 8080 is held by something else, ask first.

| Step | What happens |
| --- | --- |
| Leftovers | When the last run was never torn down, deletes what it generated first (see Tear Down) |
| Start Laminar | Skipped when the sign-in endpoint already answers. Otherwise `docker compose up --detach` in `lmnr/compose`, then a wait of up to 15 minutes (a new Postgres volume runs migrations first) |
| Eval hook | When `lmnr/evals/<eval>/env/set_up.sh` exists, it runs **instead of** every step below |
| Remove the old stack | `docker compose down --volumes` for the workspace's `liferay` and `database` |
| Configuration | Every `env` level (see Configuration) is merged into `configs/local` of a temporary folder outside the workspace, then printed |
| Build the image | `scripts/bootstrap/build.sh` with the temporary folder as `liferay.workspace.configs.dir` and `lmnr/client-extensions` as `liferay.workspace.client-extension.dir`, plus `--init-script lmnr/env/exclude-client-extensions.gradle -Pclient.extensions.include=<the eval's list>` |
| Start | `scripts/bootstrap/start.sh` with an empty folder as `liferay.workspace.client-extension.dir`, so its `post-start.sh` deploys nothing |
| Client extensions | For each CET in the lists: a wait for every object definition it ships to be published and every site it creates to exist. They deploy from the image when the container starts |

The temporary folder is deleted when `set_up.sh` exits. The script ends by recording the untracked paths under `client-extensions` (and `bundles`, if present) in `lmnr/generated-paths.list`, gitignored, then printing the command that runs the eval.

#### How Only the Listed Client Extensions Get Into the Image

`build.sh` forwards its arguments to `gradlew buildDockerImage`, and `lmnr/env/exclude-client-extensions.gradle` excludes `dockerDeploy` and `buildDockerImage` for every project directly inside a `client-extensions` folder whose name is not in `client.extensions.include`. With `client-extension.dir` set to `lmnr/client-extensions` (a relative path: an absolute one registers nothing), only the harness's dependency CETs are projects, and only the listed ones are built and staged into `build/docker/client-extensions`, which the image copies into `/opt/liferay/osgi/client-extensions`.

The image's configuration comes only from the temporary `configs/local`, because `docker-compose.yaml` sets `LIFERAY_WORKSPACE_ENVIRONMENT: local`. The workspace's own `configs/local/portal-ext.properties` never reaches it.

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
| `lmnr/env/tear_down.sh [<eval>]` | The eval's `env/tear_down.sh` if it has one, otherwise `docker compose down --volumes` for `liferay` and `database`. Then deletes what the run generated |
| `lmnr/env/tear_down.sh [<eval>] --laminar` | Also `docker compose down` in `lmnr/compose`. Never removes Laminar's volumes |

What the run generated: every untracked path under `client-extensions` that was not in `lmnr/generated-paths.list` when `set_up.sh` finished (the client extensions the agent wrote), `bundles` when it was not there (container deploys leave an empty `bundles/osgi/client-extensions`), and `build/docker` (the image's staging, with the trial license). Changes to tracked files and anything outside `client-extensions` stay; check `git status`. Read what the agent built before tearing down.

To stop the stack without losing it, for example to resume later, use `docker compose stop` in the workspace root and in `lmnr/compose`, then `docker compose start`. Never `docker compose down` without meaning to: the `database` service keeps PostgreSQL in an anonymous volume, which `down` does not reattach.

## Configuration

Configuration lives at two levels, applied in this order: global `lmnr/env`, then the eval's own `lmnr/evals/<eval>/env`. The agent is denied `lmnr/**`, so it cannot see any of it.

| File, in an `env` folder | Effect |
| --- | --- |
| `portal-ext.properties` | Merged into the image's `portal-ext.properties`. A key set again at a later level replaces the earlier value |
| `delete-properties.list` | One key per line. Removed after this level's merge, so a later level can set it again. A key that is not there stops the setup |
| `osgi/configs/*.config` | Copied into the image's `osgi/configs` |
| `delete-osgi-configs.list` | One `.config` file name per line. Removed after this level's copy. A file that is not there stops the setup |
| `client-extensions.list` | One `lmnr/client-extensions` folder name per line, built into the image |
| `set_up.sh`, `tear_down.sh` | Eval level only. Replace the default sequence; source `lmnr/env/_common.sh` and call its functions (`default_set_up`, `delete_osgi_config`, `delete_property`, …) |

In every `.list` file, blank lines and lines starting with `#` are skipped.

The global level sets what every eval needs:

| Setting | Why |
| --- | --- |
| BasicAuth verifier on `/api/*,/xmlrpc/*,/o/*` | The evaluators call the headless APIs with Basic auth |
| `jdbc.default.*` for `jdbc:postgresql://database:5432/lportal`, user `postgres`, no password | The workspace's `database` service, reached by its Compose host name |
| Instance and admin properties (`company.default.web.id=liferay.com`, `test@liferay.com`, no setup wizard, no terms of use, no reminder queries, no forced password change) | No first login steps, so nothing waits on a person |
| `feature.flag.LPD-35443` | The page API that `build-site` and `manage-pages` drive |
| `feature.flag.LPD-39244` | The fragment API that `build-site` and `scaffold-fragment` drive |
| `feature.flag.LPD-63311` and `MCPServerConfiguration` `enabled=B"true"` | The MCP server at `/o/mcp` the agent connects to. On 2026.Q3 the flag alone leaves it at `404` |

To give an eval its own settings, create `lmnr/evals/<eval>/env` with the files above. A global property or OSGi config that must be absent for one eval goes in its `delete-properties.list` or `delete-osgi-configs.list`. For an eval where the agent has to set up MCP itself, list `feature.flag.LPD-63311` and `com.liferay.mcp.server.rest.internal.configuration.MCPServerConfiguration.config`.

## Laminar

Laminar is self hosted from `lmnr/compose/docker-compose.yml`. Its one shot `init` service generates the secrets into the `init-secrets` volume on first start; there is no `.env` to create. Every host port starts with `9`, so nothing collides with Liferay (8080, 8000, 11311) or its `database` (5432).

| Service | Host port |
| --- | --- |
| Frontend / dashboard | 9667 |
| App server HTTP API | 9000 |
| App server gRPC | 9001 |
| Quickwit REST | 9280 |
| Postgres | 9433 |

This Postgres is Laminar's own. Liferay's is the workspace `database` service; the two share no port, container name, network, or volume.

The harness treats Laminar as ready when the sign-in call that `lmnr/evals/lib/bootstrap.ts` makes returns a `token`. The dashboard itself answers `307` well before that.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Unable to find a valid trial license in "liferay/dxp:latest"` | The newest `latest` image's trial license has expired too. Add an unexpired license to `build/docker/deploy/license.xml`, or wait for a newer image |
| `Timed out after …s waiting until …` | The step named did not finish. Check `docker compose logs liferay` |
| `Unable to build the Liferay image …` | The `build.sh` output above the message. A listed CET that fails to build stops it here |
| `Unable to find client extension in …` | A `client-extensions.list` names a folder missing from `lmnr/client-extensions` |
| `Unable to find an eval in lmnr/evals/<eval>` | The name is not a folder with a `*.eval.ts`. List the folders in `lmnr/evals` |
| `401` from Laminar during the eval | The SDK defaulted to `api.lmnr.ai`. Every eval must pass `config` from `lmnr/evals/lib/bootstrap.ts` to `evaluate`; it sets `baseUrl: 'http://localhost'`, `httpPort: 9000`, `grpcPort: 9001` |
| `401` with the config correct | The project API key in that `config` comes from a sign-in at import time, so that sign-in failed: check Laminar is up. Never hardcode a key; it goes stale when the Postgres volume is recreated |
| The `Check results at` link does not open | The link uses `frontendPort` from the same `config`, which must match the dashboard's host port (9667). The SDK default is 5667 |
| The agent fails to authenticate with Anthropic | `CLAUDE_CODE_OAUTH_TOKEN` is not set, or `.env` is not at the workspace root |
| `No skills found in .claude/skills` | The eval ran from the wrong working directory. Run it from the workspace root |
| `Unable to find … in …/portal-ext.properties` or `Unable to find …/osgi/configs/…` | A `delete-properties.list` or `delete-osgi-configs.list` names a key or file that no earlier level set. Check the spelling |
| `403` on `/o/*` from the evaluators | The BasicAuth verifier is missing from the merged properties. Check that no `delete-properties.list` removes it |
| `404` on `/o/mcp` | An eval level `delete-properties.list`, `delete-osgi-configs.list` or `portal-ext.properties` turned off `LPD-63311` or removed the MCP config. Expected for an eval where the agent sets up MCP |
| No LLM token or cost data on the spans | The agent SDK runs `claude` as a separate process. `lmnr/evals/lib/agent-task.ts` wraps `query` with `Laminar.wrapClaudeAgentQuery` for this |

## Related Skills

- `stop-laminar-eval` — take the stack down when finished.
- `workspace-init` — the general Liferay setup, including the Docker path the harness builds on.
- `deploy-and-verify` — deploying client extensions to a running container.