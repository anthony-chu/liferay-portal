---

description: Shut down the local eval stack through the harness tasks in `lmnr.gradle` — remove the Liferay and PostgreSQL containers, and optionally stop Laminar. Use when the user asks to stop the eval environment, shut down Liferay and Laminar, or clean up after a run.
name: stop-laminar-eval

---

# Stop Laminar Eval

Take down what `run-laminar-eval` brought up: the Liferay and PostgreSQL containers, and Laminar only when the user asks for it. `runEval` already tears its Liferay down after each run, so this is for a run kept with `-Plmnr.eval.keep=true`, a build that failed during setup, or stopping Laminar.

## When to Invoke

- The user asks to stop, shut down, or clean up the eval stack.
- The user is done with a run and wants the ports and memory back.

Every step does nothing when its target is already down, so the skill is safe to run against a partly stopped stack.

## Workflow

### Stop the Liferay Server

Removing the Liferay containers counts as a restart under the workspace's restart policy: say so before running it. From the workspace root:

```bash
./gradlew --init-script lmnr.gradle tearDownEval
```

The task runs `docker compose down --volumes database liferay`, so the environment and its data are gone; the next `run-laminar-eval` builds a new one.

It then deletes what the run generated: the client extensions the agent wrote under `client-extensions`, `bundles` when the run created it, and `build/docker`. Read what the agent built first if it matters.

To pause instead, keeping the containers and data to resume later, run `docker compose --file docker-compose.yaml --file docker-compose-lmnr.yaml stop` in the workspace root, then `docker compose --file docker-compose.yaml --file docker-compose-lmnr.yaml start`. That pauses Laminar too; name `database liferay` after `stop` to pause only Liferay. `liferay` may need more than Compose's default 10 seconds to stop cleanly: `docker compose stop --timeout 60`.

### Stop Laminar

Leave Laminar running unless the user asks to stop it; the next run reuses it. Laminar's lifecycle is separate from the eval's, so stopping it needs no eval and leaves Liferay alone:

```bash
./gradlew --init-script lmnr.gradle stopLaminar
```

`stopLaminar` runs `docker compose down` for every service except `database` and `liferay`. It stops the containers and keeps the volumes, so every recorded trace and eval run survives.

### Delete Laminar's Data

Only when the user explicitly asks to wipe the history. **Confirm before running it — it destroys data.** From the workspace root:

```bash
docker compose --file docker-compose.yaml --file docker-compose-lmnr.yaml down --volumes app-server clickhouse frontend init postgres quickwit
```

`--volumes` deletes Laminar's Postgres, ClickHouse, and Quickwit volumes and its secrets, so every recorded trace and eval run is gone for good. The next run still works: `lmnr/evals/lib/bootstrap.ts` recreates the Laminar workspace, project, and API key at import time.

### Verify

```bash
docker compose --file docker-compose.yaml --file docker-compose-lmnr.yaml ps
```

No Laminar service listed means Laminar is down.

## Related Skills

- `run-laminar-eval` — bring the stack back up and run an eval against it.