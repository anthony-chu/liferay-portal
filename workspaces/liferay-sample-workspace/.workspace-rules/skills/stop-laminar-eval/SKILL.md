---

description: Shut down the local eval stack — stop the Liferay server with Blade, then tear down the Laminar Docker Compose stack and its volumes. Use when the user asks to stop the eval environment, shut down Liferay and Laminar, or clean up after a run.
name: stop-laminar-eval

---

# Stop Laminar Eval

Take down what `run-laminar-eval` brought up, in reverse: the Liferay server first, then Laminar.

## When to Invoke

- The user asks to stop, shut down, or clean up the eval stack.
- The user is done with a run and wants the ports and memory back.

Both steps are no-ops when the target is already down, so the skill is safe to run against a partly stopped stack.

## Workflow

### Stop the Liferay Server

From the workspace root:

```bash
blade server stop
```

When no Tomcat JVM process is running, there is nothing to do — skip to Laminar. Otherwise, wait for the process to actually exit; the command can return before the JVM is gone. Confirm by checking that the process is absent and that port 8080 no longer answers:

```bash
curl --output /dev/null --silent --write-out '%{http_code}' http://localhost:8080
```

`bundles/` itself is left in place. `run-laminar-eval` clears `bundles/data` and `bundles/logs` on the next start.

### Tear Down Laminar

**Confirm with the user before running this — it destroys data.** `--volumes` deletes the stack's Postgres and ClickHouse volumes, so every recorded trace and eval run is gone for good. Offer plain `docker compose down` as the alternative when they want the history kept; it stops the containers and leaves the volumes.

```bash
cd lmnr && docker compose down --volumes
```

Losing the volumes costs history only, not the ability to run again: the Laminar workspace, project, and API key are recreated on the next run, because `lmnr-evals/lib/bootstrap.ts` mints them at import time.

Verify nothing is left running:

```bash
docker compose ps
```

## Related Skills

- `run-laminar-eval` — bring the same stack back up and run an eval against it.