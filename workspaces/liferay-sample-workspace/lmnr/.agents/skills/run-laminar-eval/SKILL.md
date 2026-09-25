---

description: Bring up the local eval stack — Laminar via Docker Compose, a clean Liferay bundle, workspace dependencies — and run an eval file against it. Use when the user asks to run an eval, run the Laminar/lmnr evals, or start the eval environment from scratch.
name: run-laminar-eval

---

# Run Laminar Eval

Stand up everything an eval needs, in order, then run it: Laminar for observability, a Liferay bundle set up through `workspace-init`, and the workspace's Node dependencies.

## When to Invoke

- The user asks to "run the eval", "run the create-site eval", or names any file under `lmnr/evals/`.
- The user asks to start or reset the eval environment.

Every step is idempotent, so the skill is safe to rerun against a stack that is already partly up.

## Prerequisites

`docker`, `blade`, `node`, and `yarn` on the path. The workspace product is DXP (`liferay.workspace.product` in `gradle.properties`), so a license file is required on a freshly initialized bundle.

## Workflow

### Start Laminar

Everything the stack needs is in `lmnr/docker-compose.yml` — there is no `.env` file to create. The one-shot `init` service generates the app secrets and database passwords into the `init-secrets` volume on first start and reuses them afterwards.

```bash
cd lmnr && docker compose up --detach
```

Laminar is self-hosted here, not `laminar.sh`. The stack publishes:

| Service | Host port |
| --- | --- |
| Frontend / dashboard | 9667 |
| App server HTTP API | 9000 |
| App server gRPC | 9001 |
| Quickwit REST | 9280 |
| Postgres | 9433 |

Poll the dashboard until it answers:

```bash
curl --fail --output /dev/null --silent http://localhost:9667
```

Do not wait for a literal `200` — the dashboard answers `307`, redirecting to sign-in. `curl --fail` treats that as success, which is why the check is written this way. On a wiped Postgres volume the frontend also runs its migrations on first boot (`Applying ClickHouse schema. This may take a while...`), so several minutes of refused connections here is normal. The endpoint that actually has to work is the one `lmnr/evals/lib/bootstrap.ts` calls:

```bash
curl --silent --request POST http://localhost:9667/api/auth/sign-in/local-email \
    --header 'Content-Type: application/json' \
    --data '{"email":"test@liferay.com","name":"Test"}'
```

A `200` with a `token` in the body means Laminar is genuinely ready.

**Ports**: every Laminar host port starts with `9`, chosen so the stack never collides with Liferay. In particular `catalina.sh jpda start` takes host port 8000 for the debugger, which the app server used to claim.

### Point the Workspace at the Eval Client Extensions

The evals run against the client extensions in `lmnr/client-extensions`, not the workspace's default `client-extensions`. Set `liferay.workspace.client-extension.dir` in `gradle.properties` so the workspace discovers, builds, and deploys client extension projects from there. From the workspace root:

```bash
if grep --quiet '^liferay.workspace.client-extension.dir=' gradle.properties; then
    sed --in-place 's|^liferay.workspace.client-extension.dir=.*|liferay.workspace.client-extension.dir=lmnr/client-extensions|' gradle.properties
else
    printf '\nliferay.workspace.client-extension.dir=lmnr/client-extensions' >> gradle.properties
fi
```

The branch keeps the step idempotent: rerunning it rewrites an existing entry instead of appending a duplicate. Confirm the result:

```bash
grep '^liferay.workspace.client-extension.dir=' gradle.properties
```

Exactly one line, reading `liferay.workspace.client-extension.dir=lmnr/client-extensions`, means the step took.

### Set Up Liferay With `workspace-init`

Load `workspace-init` with the Skill tool and follow its **Tomcat** path — do not reimplement it here. The eval needs a portal that has never booted, so start from no bundle, and apply the adjustments below where `workspace-init` says otherwise.

#### Start From No Bundle

`workspace-init` clears the seeded database only on a bundle that has never started. A bundle left by an earlier run falls through to its manual first login, which an unattended eval cannot do, so remove the bundle before following it. If a Tomcat JVM is running, stop it first as `stop-laminar-eval` describes. Then, from the workspace root:

```bash
rm -rf bundles
```

This deletes the registered license too, so every run needs the key again — `workspace-init`'s DXP License check covers asking the user for it. Run that check after `blade server init`, since `bundles/deploy/` does not exist before then. Do not keep the key in `configs/local/deploy/`: that directory is not gitignored.

#### Adjustments to `workspace-init`

| `workspace-init` step | For the eval |
| --- | --- |
| Configure MCP Before Starting the Server | Enable only the flag, through Configure the Bundle below. Skip the client configuration and the CLI restart — the eval's agent is its own MCP client, configured in `lmnr/evals/lib/agent-task.ts`, and connects to `/o/mcp` when it starts. |
| Clear the seeded database | Follow it, and also remove `portal-env.properties` as described below. |
| BasicAuth verifier, Instance and admin properties | Write them to `bundles/portal-ext.properties` through Configure the Bundle, not to `configs/local`. `configs/local/portal-ext.properties` must stay identical to upstream. |
| Configuration sync | Follow it, then run Configure the Bundle — the copy overwrites anything written to the bundle before it. |
| Start server | Use `blade server start`, so the portal runs in the background. |
| First Login Bootstrap | Nothing to do: the bundle was cleared and configured before its first start. |
| MCP Connection Check | Skip it; the eval's agent connects on its own. |

#### Remove `portal-env.properties`

```bash
rm -f bundles/portal-env.properties
```

`blade server init` copies it out of `configs/local`, where it points `jdbc.default.url` at `jdbc:postgresql://database/lportal` — `database` is a Docker Compose service name from the workspace's `docker-compose.yaml` and does not resolve from a Tomcat that Blade started on the host. `portal-ext.properties` pulls it in through `include-and-override`, which tolerates the file being absent, so removing it drops the bundle back to the embedded Hypersonic database and the boot needs no external database at all.

#### Configure the Bundle

Run this after `workspace-init`'s configuration sync and before the server starts. From the workspace root:

```bash
for property in \
    'admin.email.from.address=test@liferay.com' \
    'admin.email.from.name=Test Test' \
    'auth.verifier.BasicAuthHeaderAuthVerifier.urls.includes=/api/*,/xmlrpc/*,/o/*' \
    'company.default.time.zone=UTC' \
    'company.default.web.id=liferay.com' \
    'default.admin.email.address.prefix=test' \
    'feature.flag.LPD-35443=true' \
    'feature.flag.LPD-39244=true' \
    'feature.flag.LPD-63311=true' \
    'passwords.default.policy.change.required=false' \
    'setup.wizard.enabled=false' \
    'terms.of.use.required=false' \
    'users.reminder.queries.enabled=false'; do
    key="${property%%=*}"

    if grep --quiet "^${key}=" bundles/portal-ext.properties; then
        sed --in-place "s|^${key}=.*|${property}|" bundles/portal-ext.properties
    else
        printf '\n%s' "${property}" >> bundles/portal-ext.properties
    fi
done
```

The branch keeps the step idempotent: rerunning it rewrites an existing entry instead of appending a duplicate.

- **BasicAuth verifier and the instance and admin properties** — exactly the lines `workspace-init` prescribes; it explains each one.
- **`LPD-35443`** — the Headless Admin Site page API that `build-site` and `manage-pages` drive.
- **`LPD-39244`** — the Headless Admin Fragment API that `build-site` and `scaffold-fragment` drive.
- **`LPD-63311`** — the MCP server at `/o/mcp` that the eval's agent connects to. Without it the endpoint answers `404`.

### Install Workspace Dependencies

The workspace declares Yarn (`liferay.workspace.node.package.manager=yarn`) and carries a `yarn.lock` plus a `workspaces` block in `package.json`. From the workspace root:

```bash
yarn install
```

Skip only when `node_modules/` is already present and current.

### Run the Eval

From the workspace root — not from `lmnr/evals/`:

```bash
yarn tsx lmnr/evals/create-site.eval.ts
```

`lmnr/evals/lib/agent-task.ts` reads `.claude/skills` relative to the working directory and throws when it finds nothing, so the working directory has to be the workspace root.

Use `yarn tsx` rather than `yarn lmnr eval`. The CLI bundles the eval with esbuild and runs it in a sandbox, which breaks the Claude Agent SDK's `createRequire(import.meta.url)` unless `--external-packages @anthropic-ai/claude-agent-sdk` is passed.

### Report the Result

Give the user the per-evaluator scores from the run output and the dashboard link at `http://localhost:9667`, where the executor and evaluator span tree for the run is recorded.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `401` from Laminar during the eval | The SDK defaulted to `api.lmnr.ai` instead of the local instance. Check the `config` block in the eval file: `baseUrl: 'http://localhost'`, `httpPort: 9000`, `grpcPort: 9001`. The local project API key always fails against the cloud. |
| `401` with the config correct | Every eval takes `projectApiKey` from `lmnr/evals/lib/bootstrap.ts`, which signs in against `localhost:9667` and mints a fresh key at import time. A `401` here means that sign-in failed, so check that the Laminar frontend is up before looking at the key. A new eval file must import `projectApiKey` too — never hardcode a key, since it goes stale whenever the Laminar Postgres volume is recreated. |
| `No skills found in .claude/skills` | The eval was run from the wrong working directory. Run it from the workspace root. |
| `403` on `/o/*` calls from the evaluators | The BasicAuth verifier is missing from the bundle. Confirm `bundles/portal-ext.properties` carries `auth.verifier.BasicAuthHeaderAuthVerifier.urls.includes=/api/*,/xmlrpc/*,/o/*`, and rerun Configure the Bundle if it does not. |
| No LLM token or cost data on the spans | The agent SDK runs the `claude` CLI as a separate process, so auto-instrumentation sees nothing. `lmnr/evals/lib/agent-task.ts` handles this by wrapping `query` with `Laminar.wrapClaudeAgentQuery`. |

## Related Skills

- `stop-laminar-eval` — take the same stack back down when the run is finished.
- `workspace-init` — the Liferay setup this skill follows, with the adjustments above.
- `deploy-and-verify` — deploying client extensions to the bundle this skill starts.