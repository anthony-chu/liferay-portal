# Eval Deployables

The numbered directories hold the deployables for the event site eval set under `lmnr/evals`.
Each is the end state of an eval, captured as a client extension so the state can be rebuilt
rather than recreated by hand. The numbering is dependency order, one project per directory.

| Directory | Produced By | Creates |
| --- | --- | --- |
| `00-event-registration-batch` | `create-event-registration.eval.ts` | The `Event` and `Registration` objects, their picklists and relationship, and seed data — four events and three registrations |
| `01-devcon-site-initializer` | `create-site.eval.ts` | Site **DEVCON** at `/web/devcon`: Home, Upcoming Events and Register, built from the DEVCON fragment collection |
| `02-devcon-theme-css` | `theme-check.eval.ts` | A `themeCSS` and `themeFavicon` client extension |
| `03-devcon-themed-site-initializer` | `theme-check.eval.ts` | Site **DEVCON Themed** at `/web/devcon-themed` — `01` plus a style book, a master page and layout set settings |

Two evals produce two projects each, so the directory numbers do not map one to one onto
eval numbers. What each eval needs is below.

## Deploy Order

| Setting Up | Deploy |
| --- | --- |
| `create-event-registration.eval.ts` | nothing |
| `create-site.eval.ts` | `00` |
| `theme-check.eval.ts` | `00`, `01` |
| The state after `theme-check` | `00` through `03` |

`deploy-evals.sh` walks the directories in order, copies each into the running workspace,
builds and deploys it, and waits for the portal to catch up:

```bash
./deploy-evals.sh --through 01      # the starting state for theme-check
./deploy-evals.sh --through 03      # the state after theme-check
```

It targets `${EVAL_WORKSPACE}`, which defaults to the workspace these directories sit in and
has to be the workspace whose bundle is running — a deploy lands in its own workspace's
bundle, not in whichever portal answers on the port. Pointed elsewhere, it copies each
directory across first; pointed here, it builds them in place.

Deploying further than an eval needs does no harm. `01` and `03` build separate sites under
different external reference codes, so both can be present at once.

By hand it is `blade gw clean deploy` from each directory, in numeric order. Use `clean`:
Gradle's up to date check is content based, so an unchanged source prints `BUILD SUCCESSFUL`,
rewrites nothing, and the file install watcher never sees a changed zip. Wait for `00` to
publish its objects before deploying an initializer — both deploys only drop a zip and the
portal picks them up asynchronously, so an initializer can otherwise provision a site whose
pages reference objects that do not exist yet.

## Two Things That Bite

**Point Gradle at this directory.** `liferay.workspace.client-extension.dir=lmnr/client-extensions`
has to be set in `gradle.properties`, or the workspace builds its default `client-extensions`
instead and the deploy quietly applies to the wrong projects. See
`lmnr/.claude/skills/run-laminar-eval`.

**Build the theme client extension before deploying it.** `02-devcon-theme-css` declares
`clayURL` and `mainURL` pointing at `css/clay.css` and `css/main.css`, which the Liferay
design pack generates from the SCSS under `src/css`. Those files are build output and are not
committed, so a deploy without a build registers a client extension whose stylesheets 404.

**Deploying a theme client extension does not apply it.** Liferay attaches one through a
`ClientExtensionEntryRel`, and nothing in a site initializer writes that row. The extension
registers and stays inert until someone selects it in Site Administration → Design → Theme,
and that selection is lost on every reprovision. Everything visible in the theming comes from
the style book, the master page and fragment CSS, all of which apply on their own. See
`.agents/skills/theme-and-design/SKILL.md` → "Apply to Site".

## Reprovisioning

A site initializer runs once, at site creation. To reapply a change, delete the site and
redeploy — removing the installed zip first, because the file install watcher retriggers on a
changed artifact rather than on a Gradle run:

```bash
curl \
	--request DELETE \
	--silent \
	--url "http://localhost:${PORT}/o/headless-admin-site/v1.0/sites/<site-erc>" \
	--user "test@liferay.com:test"

rm -f bundles/osgi/client-extensions/<name>.zip

cd lmnr/client-extensions/<name> && blade gw clean deploy
```

Objects are company scoped and survive site deletion, so `00`'s data persists across a
reprovision of `01` or `03`.
