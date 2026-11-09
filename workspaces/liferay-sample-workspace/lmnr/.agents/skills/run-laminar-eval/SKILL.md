---

description: Bring up the local eval stack — Laminar via Docker Compose, a fresh Liferay bundle configured for one eval, and that eval's client extensions — through the harness in `lmnr/env`, then run the eval. Use when the user asks to run an eval, run the Laminar/lmnr evals, or start the eval environment from scratch.
name: run-laminar-eval

---

# Run Laminar Eval

Every eval is a folder under `lmnr/evals/<eval>` with its `<eval>.eval.ts`. The harness in `lmnr/env` builds the environment that eval needs: Laminar, a fresh bundle from `liferay.workspace.product`, the merged portal properties, OSGi configs, and the client extensions the eval lists. Then the eval runs from the workspace root.

## When to Invoke

- The user asks to "run the eval", "run the create-site eval", or names anything under `lmnr/evals`.
- The user asks to start or reset the eval environment.

## Prerequisites

`docker`, `blade`, `node`, `yarn`, `curl`, and `jq` on the path.

| Variable | Needed for | Where it comes from |
| --- | --- | --- |
| `LICENSE_XML_URL` | A DXP `liferay.workspace.product` | An `http(s):/` URL is downloaded; anything else is copied as a local path (`~` is expanded). Every run needs it, since every run starts from a new bundle. Ask the user when it is not set. Never copy the key into `configs/local/deploy`, which is not gitignored |
| `CLAUDE_CODE_OAUTH_TOKEN` | The eval's agent | `claude setup-token`. Export it in the shell, or put `CLAUDE_CODE_OAUTH_TOKEN=<token>` in `.env` at the workspace root (the Laminar SDK loads it; the workspace `.gitignore` excludes it). The environment wins over `.env` |

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
LICENSE_XML_URL=<url or path> lmnr/env/set_up.sh <eval>
```

`<eval>` is the folder name under `lmnr/evals`, for example `create-site`. The script exits nonzero on the first failure or timeout, naming the step that failed. Most of its run time is `blade server init` and the first boot.

`set_up.sh` stops and deletes any existing `bundles`. Under the workspace's restart policy this counts as a restart: say so before running it. If port 8080 is held by a process this session did not start, ask first.

| Step | What happens |
| --- | --- |
| Start Laminar | Skipped when the sign-in endpoint already answers. Otherwise `docker compose up --detach` in `lmnr/compose`, then a wait of up to 15 minutes (a new Postgres volume runs migrations first) |
| Leftovers | When the last run was never torn down, deletes what its eval generated first (see Tear Down) |
| Eval hook | When `lmnr/evals/<eval>/env/set_up.sh` exists, it runs **instead of** every step below |
| New bundle | `blade server stop` if running, `rm -fr bundles`, `blade server init`, then remove the seeded `data` and `osgi/state`, and `portal-env.properties` (it points at a Docker host name that does not resolve from Tomcat on the host) |
| Database | Starts the workspace's own `database` service (`docker-compose.yaml`, Postgres 16 on `localhost:5432`) through the `docker_compose` function in `scripts/_common.sh`, waiting for its healthcheck. Then drops and creates `lportal`, so each run boots on an empty database. Never `scripts/bootstrap/start.sh`: it also starts the `liferay` container on 8080 |
| License | Copied to `bundles/deploy/license.xml` before the first boot |
| Properties | Merged into `bundles/portal-ext.properties` (see Configuration), then printed |
| OSGi configs | Each level's `env/osgi/configs` copied into `bundles/osgi/configs` |
| Boot | `blade server start`, a wait for HTTP, then for the log to go quiet |
| Client extensions | Each level's `client-extensions.list`, in order: `blade gw clean deploy` from `lmnr/client-extensions/<name>`, then a wait for its zip, every object definition it ships to be published, and every site it creates to exist |

The client extensions build with `-Pliferay.workspace.client-extension.dir=lmnr/client-extensions`, so `gradle.properties` is not changed.

The script ends by recording the workspace's untracked paths (outside `lmnr`) in `lmnr/untracked-paths.list`, gitignored, then printing the command that runs the eval.

### Run the Eval

From the workspace root, not from `lmnr/evals`:

```bash
lmnr/evals/node_modules/.bin/tsx lmnr/evals/<eval>/<eval>.eval.ts
```

`lmnr/evals/lib/agent-task.ts` reads `.claude/skills` relative to the working directory and throws when it finds nothing. That is also why the command calls `tsx` directly: `yarn --cwd lmnr/evals tsx` would move the working directory.

Use `tsx`, not `yarn lmnr eval`. The CLI bundles the eval with esbuild and runs it in a sandbox, which breaks the Claude Agent SDK's `createRequire(import.meta.url)`.

### Report the Result

Give the user the per evaluator scores from the run output and the `Check results at` link it prints (on port 9667), where the executor and evaluator span tree is recorded.

### Tear Down

Leave Laminar and the `database` service running between runs; the next `set_up.sh` starts from a new bundle and an empty `lportal` anyway. Neither command below stops `database`; stop it from the workspace root with `docker compose stop database`.

| Command | Effect |
| --- | --- |
| `lmnr/env/tear_down.sh [<eval>]` | The eval's `env/tear_down.sh` if it has one, otherwise `blade server stop`. Then deletes what the eval generated |
| `lmnr/env/tear_down.sh [<eval>] --laminar` | Also `docker compose down` in `lmnr/compose`. Never removes volumes |

The agent writes what it builds into the workspace, mostly `client-extensions`. Tear down deletes every untracked path that was not in `lmnr/untracked-paths.list` when `set_up.sh` finished, so the next eval starts from the committed workspace plus whatever was already untracked before. It leaves `lmnr`, untracked paths that existed before the run, and changes to tracked files alone; check `git status` for the last. Read what the agent built before tearing down.

## Configuration

Configuration lives at two levels, applied in this order: global `lmnr/env`, then the eval's own `lmnr/evals/<eval>/env`. The agent is denied `Read(./lmnr/**)`, so it cannot see any of it. It can read the merged `bundles/portal-ext.properties`.

| File, in an `env` folder | Effect |
| --- | --- |
| `portal-ext.properties` | Merged into `bundles/portal-ext.properties`. A key set again at a later level replaces the earlier value |
| `delete-properties.list` | One key per line. Removed after this level's merge, so a later level can set it again. A key that is not there stops the setup |
| `osgi/configs/*.config` | Copied into `bundles/osgi/configs` before boot |
| `delete-osgi-configs.list` | One `.config` file name per line. Removed from `bundles/osgi/configs` after this level's copy. A file that is not there stops the setup |
| `client-extensions.list` | One `lmnr/client-extensions` folder name per line, deployed in order after boot |
| `set_up.sh`, `tear_down.sh` | Eval level only. Replace the default sequence; source `lmnr/env/_common.sh` and call its functions (`default_set_up`, `delete_osgi_config`, `delete_property`, …) |

In every `.list` file, blank lines and lines starting with `#` are skipped.

The global level sets what every eval needs:

| Setting | Why |
| --- | --- |
| BasicAuth verifier on `/api/*,/xmlrpc/*,/o/*` | The evaluators call the headless APIs with Basic auth |
| `jdbc.default.*` for `jdbc:postgresql://localhost:5432/lportal`, user `postgres`, no password | The workspace `database` service, reached from Tomcat on the host. The workspace's own `portal-env.properties` names the host `database`, which resolves only inside Compose |
| Instance and admin properties (`company.default.web.id=liferay.com`, `test@liferay.com`, no setup wizard, no terms of use, no reminder queries, no forced password change) | No first login steps, so nothing waits on a person |
| `feature.flag.LPD-35443` | The page API that `build-site` and `manage-pages` drive |
| `feature.flag.LPD-39244` | The fragment API that `build-site` and `scaffold-fragment` drive |
| `feature.flag.LPD-63311` and `MCPServerConfiguration` `enabled=B"true"` | The MCP server at `/o/mcp` the agent connects to. On 2026.Q3 the flag alone leaves it at `404` |

To give an eval its own settings, create `lmnr/evals/<eval>/env` with the files above. A global property or OSGi config that must be absent for one eval goes in its `delete-properties.list` or `delete-osgi-configs.list`. For an eval where the agent has to set up MCP itself, list `feature.flag.LPD-63311` and `com.liferay.mcp.server.rest.internal.configuration.MCPServerConfiguration.config`.

## Laminar

Laminar is self hosted from `lmnr/compose/docker-compose.yml`. Its one shot `init` service generates the secrets into the `init-secrets` volume on first start; there is no `.env` to create. Every host port starts with `9`, so nothing collides with Liferay (`catalina.sh jpda start` takes 8000).

| Service | Host port |
| --- | --- |
| Frontend / dashboard | 9667 |
| App server HTTP API | 9000 |
| App server gRPC | 9001 |
| Quickwit REST | 9280 |
| Postgres | 9433 |

This Postgres is Laminar's own. Liferay's is the workspace `database` service on 5432; the two share no port, container name, network, or volume.

The harness treats Laminar as ready when the sign-in call that `lmnr/evals/lib/bootstrap.ts` makes returns a `token`. The dashboard itself answers `307` well before that.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Set the environment variable LICENSE_XML_URL` | The product is DXP and no license was given. Ask the user for it |
| `Timed out after …s waiting until …` | The step named did not finish. Check `bundles/logs/liferay.<date>.log`; for a client extension, also its `blade gw` output above the message |
| `Unable to start the database service …` | Port 5432 or the container name `database` is taken, often by the same service from another workspace generated from this template. Check `docker ps` and `ss --listening --tcp` |
| `Unable to find an eval in lmnr/evals/<eval>` | The name is not a folder with a `*.eval.ts`. List the folders in `lmnr/evals` |
| `Unable to find the client extension …` | A `client-extensions.list` names a folder missing from `lmnr/client-extensions` |
| `401` from Laminar during the eval | The SDK defaulted to `api.lmnr.ai`. Every eval must pass `config` from `lmnr/evals/lib/bootstrap.ts` to `evaluate`; it sets `baseUrl: 'http://localhost'`, `httpPort: 9000`, `grpcPort: 9001` |
| `401` with the config correct | The project API key in that `config` comes from a sign-in at import time, so that sign-in failed: check Laminar is up. Never hardcode a key; it goes stale when the Postgres volume is recreated |
| The `Check results at` link does not open | The link uses `frontendPort` from the same `config`, which must match the dashboard's host port (9667). The SDK default is 5667 |
| The agent fails to authenticate with Anthropic | `CLAUDE_CODE_OAUTH_TOKEN` is not set, or `.env` is not at the workspace root |
| `No skills found in .claude/skills` | The eval ran from the wrong working directory. Run it from the workspace root |
| `Unable to find … in …/portal-ext.properties` or `Unable to find …/osgi/configs/…` | A `delete-properties.list` or `delete-osgi-configs.list` names a key or file that no earlier level set. Check the spelling |
| `403` on `/o/*` from the evaluators | The BasicAuth verifier is missing from `bundles/portal-ext.properties`. Check that no `delete-properties.list` removes it |
| `404` on `/o/mcp` | An eval level `delete-properties.list`, `delete-osgi-configs.list` or `portal-ext.properties` turned off `LPD-63311` or removed the MCP config. Expected for an eval where the agent sets up MCP |
| No LLM token or cost data on the spans | The agent SDK runs `claude` as a separate process. `lmnr/evals/lib/agent-task.ts` wraps `query` with `Laminar.wrapClaudeAgentQuery` for this |

## Related Skills

- `stop-laminar-eval` — take the stack down when finished.
- `workspace-init` — the general Liferay setup; the harness applies the eval's version of it.
- `deploy-and-verify` — deploying client extensions to a running bundle.