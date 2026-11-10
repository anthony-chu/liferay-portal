---

description: Shut down the local eval stack through the harness in `lmnr/env` — remove the Liferay and PostgreSQL containers, and optionally stop Laminar. Use when the user asks to stop the eval environment, shut down Liferay and Laminar, or clean up after a run.
name: stop-laminar-eval

---

# Stop Laminar Eval

Take down what `run-laminar-eval` brought up: the Liferay and PostgreSQL containers, and Laminar only when the user asks for it.

## When to Invoke

- The user asks to stop, shut down, or clean up the eval stack.
- The user is done with a run and wants the ports and memory back.

Every step is a no-op when its target is already down, so the skill is safe to run against a partly stopped stack.

## Workflow

### Stop the Liferay Server

Removing the Liferay containers counts as a restart under the workspace's restart policy: say so before running it. From the workspace root:

```bash
lmnr/env/tear_down.sh [<eval>]
```

With `<eval>`, the eval's own `lmnr/evals/<eval>/env/tear_down.sh` runs when it has one. Otherwise, and without `<eval>`, the script runs `docker compose down --volumes` for the workspace's `liferay` and `database`, so the environment and its data are gone; the next `run-laminar-eval` builds a new one.

It then deletes what the run generated: the client extensions the agent wrote under `client-extensions`, `bundles` when the run created it, and `build/docker`. Read what the agent built first if it matters.

To pause instead, keeping the containers and data to resume later, run `docker compose stop` in the workspace root (and in `lmnr/compose` for Laminar), then `docker compose start`. `liferay` may need more than Compose's default 10 seconds to stop cleanly: `docker compose stop --timeout 60`.

### Stop Laminar

Leave Laminar running unless the user asks to stop it; the next run reuses it. To stop it as well:

```bash
lmnr/env/tear_down.sh [<eval>] --laminar
```

This adds `docker compose down` in `lmnr/compose`. It stops the containers and keeps the volumes, so every recorded trace and eval run survives.

### Delete Laminar's Data

Only when the user explicitly asks to wipe the history. **Confirm before running it — it destroys data.** From the workspace root:

```bash
cd lmnr/compose && docker compose down --volumes
```

`--volumes` deletes the stack's Postgres and ClickHouse volumes, so every recorded trace and eval run is gone for good. The next run still works: `lmnr/evals/lib/bootstrap.ts` recreates the Laminar workspace, project, and API key at import time.

### Verify

```bash
cd lmnr/compose && docker compose ps
```

No containers listed means Laminar is down.

## Related Skills

- `run-laminar-eval` — bring the stack back up and run an eval against it.