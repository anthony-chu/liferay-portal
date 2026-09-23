# Eval Deployables

The numbered directories hold the deployables for the event site eval set under
`lmnr-evals/`. Each one is the end state of a single eval, captured as client extensions so
the state can be rebuilt rather than recreated by hand. Everything else in
`client-extensions/` is unrelated Liferay sample code.

| Directory | Eval | Produces |
| --- | --- | --- |
| `01-create-event-registration` | `create-event-registration.eval.ts` | The `Event` and `Registration` objects, their picklists and relationship, and seed data — four events and three registrations |
| `02-create-site` | `create-site.eval.ts` | Site **DEVCON** at `/web/devcon`: Home, Upcoming Events and Register, built from the DEVCON fragment collection |
| `03-theme-site` | `theme-check.eval.ts` | Site **DEVCON Themed** at `/web/devcon-themed`, plus a `themeCSS` and `themeFavicon` client extension |

## Deploy Order

The numbering is the dependency order. An eval's starting state is everything numbered below
it, so deploy in sequence and stop before the eval under test:

| Setting Up | Deploy |
| --- | --- |
| Eval 1 | nothing |
| Eval 2 | `01` |
| Eval 3 | `01`, then `02` |
| The state after eval 3 | `01`, then `03` |

`deploy-evals.sh` does the whole sequence — it copies the projects into the running
workspace, builds and deploys each one, and waits for the objects to publish before moving on:

```bash
./deploy-evals.sh 01 02          # the starting state for eval 3
./deploy-evals.sh 01 03          # the state after eval 3
```

It defaults to `${EVAL_WORKSPACE}`, which has to be the workspace whose bundle is actually
running: a deploy lands in its own workspace's bundle, not in whichever portal answers on the
port.

By hand it is `blade gw clean deploy` from each project directory, in the order above. Use
`clean`, because Gradle's up to date check is content based — an unchanged source prints
`BUILD SUCCESSFUL`, rewrites nothing, and the file install watcher never sees a changed zip.
Wait for `01` to finish before deploying `02` or `03`: both deploys only drop a zip and the
portal picks them up asynchronously, so an initializer can otherwise run before the objects
its pages reference exist.

The last row skips `02` on purpose. `03`'s initializer is a superset of `02`'s — the same
pages and fragments plus a style book, a master page and layout set settings — and the two
build their sites under different external reference codes, so deploying both leaves two
sites rather than one themed site.

## Two Things That Bite

**Build the theme client extension before deploying it.** `devcon-theme-css` declares
`clayURL` and `mainURL` pointing at `css/clay.css` and `css/main.css`, which the Liferay
design pack generates from the SCSS under `src/css`. Those files are build output and are not
committed, so a deploy without a build registers a client extension whose stylesheets 404.

**Deploying a theme client extension does not apply it.** Liferay attaches one through a
`ClientExtensionEntryRel`, and nothing in a site initializer writes that row. The extension
registers and stays inert until someone selects it in Site Administration → Design → Theme,
and that selection is lost on every reprovision. Everything visible in the theming comes from
the style book, the master page and fragment CSS, all of which apply on their own. See
`.agents/skills/theme-and-design/SKILL.md` → "Apply to Site" before spending time on this.

## Reprovisioning

A site initializer runs once, at site creation. To reapply a change, delete the site and
redeploy the client extension — and remove the installed zip first, because the file install
watcher retriggers on a changed artifact rather than on a Gradle run:

```bash
curl \
	--request DELETE \
	--silent \
	--url "http://localhost:${PORT}/o/headless-admin-site/v1.0/sites/<site-erc>" \
	--user "test@liferay.com:test"

rm -f bundles/osgi/client-extensions/<name>.zip

cd client-extensions/<path> && blade gw clean deploy
```

Objects are company scoped and survive site deletion, so `01`'s data persists across a
reprovision of `02` or `03`.
