---

description: Shut down the local eval stack — stop the Liferay server with Blade, then tear down the Langfuse Docker Compose stack and its volumes. Use when the user asks to stop the Langfuse eval environment, shut down Liferay and Langfuse, or clean up after a run.
name: stop-langfuse-eval

---

# Stop Langfuse Eval

Take down what `run-langfuse-eval` brought up, in reverse: the Liferay server first, then Langfuse.

## When to Invoke

- The user asks to stop, shut down, or clean up the Langfuse eval stack.
- The user is done with a run and wants the ports and memory back.

Both steps are no-ops when the target is already down, so the skill is safe to run against a partly stopped stack.

## Workflow

### Stop the Liferay Server

From the workspace root:

```bash
blade server stop
```

When no Tomcat JVM process is running, there is nothing to do — skip to Langfuse. Otherwise, wait for the process to actually exit; the command can return before the JVM is gone. Confirm by checking that the process is absent and that port 8080 no longer answers:

```bash
curl --output /dev/null --silent --write-out '%{http_code}' http://localhost:8080
```

`bundles/` itself is left in place. `run-langfuse-eval` clears `bundles/data` and `bundles/logs` on the next start.

**Check for a Laminar run first.** The Langfuse and Laminar stacks are separate Compose projects and neither one owns the bundle — they share the single Liferay server on port 8080. Stopping it will break an `lmnr-evals/` run that is still in flight. When both stacks are up, confirm with the user before this step, or skip straight to the Langfuse teardown and leave Liferay running.

### Tear Down Langfuse

**Confirm with the user before running this — it destroys data.** `--volumes` deletes the stack's Postgres, ClickHouse, Redis, and MinIO volumes, so every recorded trace and experiment run is gone for good. Offer plain `docker compose down` as the alternative when they want the history kept; it stops the containers and leaves the volumes.

```bash
cd langfuse && docker compose down --volumes
```

Losing the volumes costs history only, not the ability to run again — but for a different reason than on the Laminar side. Laminar mints a fresh API key per run in `lmnr-evals/lib/bootstrap.ts`. Langfuse instead has the credentials pinned in two places that must agree: `LANGFUSE_INIT_PROJECT_PUBLIC_KEY` / `LANGFUSE_INIT_PROJECT_SECRET_KEY` in `langfuse/docker-compose.yml`, and the hardcoded pair in `langfuse-evals/lib/langfuse.ts`. Because both are fixed values, the next `up` reseeds the identical keys and the evals keep working.

That pinning has a corollary worth remembering: the `LANGFUSE_INIT_*` variables seed the database **only on a fresh Postgres volume**. If the keys in the compose file are ever changed, a plain `docker compose down` will not pick them up — the old volume keeps the old keys, and the evals fail with `401` until the volume is dropped. Tearing down with `--volumes` is the fix in that case, not a risk.

Verify nothing is left running:

```bash
docker compose ps
```

The stack runs as Compose project `langfuse`, so its volumes carry a doubled prefix — `langfuse_langfuse_postgres_data` and siblings. Check with `docker volume ls | grep langfuse` when confirming a `--volumes` teardown actually removed them.

## Related Skills

- `run-langfuse-eval` — bring the same stack back up and run an eval against it.
- `stop-laminar-eval` — the equivalent teardown for the Laminar stack and the `lmnr-evals/` files.