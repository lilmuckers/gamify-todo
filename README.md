# Quest Log

A project tracker you play. Your project is a Mario-style **overworld**; themes are **worlds**; each
key deliverable is a **level**. Inside a level, project items become the course: tasks are `?` blocks,
blockers are brick walls, dependencies are pipes, risks are critters, decisions are signposts and
stretch goals are floating coins. A hero auto-walks to whatever is blocking you next.

The game is built to beat perfectionism:

- **Flagpole = MVP.** A level clears when its MVP success criteria are ticked. Nothing else gates it,
  and once cleared, leftover items stop blocking.
- **Time-box clock.** Each level has a budget in days. Under 25% left, it nags you to ship or cut scope;
  overdue, it names optional items to drop.
- **Time bonus XP.** Finishing early earns more XP.
- **Polish penalty.** Editing a cleared level, adding scope after clearing, or fiddling with a done
  item more than 3 times costs XP and a star ("Perfectionism detected 🐢"). Dropping scope is free.
- **Stars.** ★ cleared, ★ within the time-box, ★ no polishing. Stretch goals give coins, never stars.

## Ways to run it

| Mode | Where | Edits | PR review |
|---|---|---|---|
| Read-only | GitHub Pages | – | – |
| GitHub-connected | GitHub Pages + token in your browser | Commits straight to `main` via the GitHub API | ✓ |
| Local editor | Docker | Writes `data/` and commits in your checkout; **Publish** pushes | ✓ with `GITHUB_TOKEN` |
| Mobile | Pages, installed as a PWA | Compact touch UI, works offline, syncs when back online | ✓ |

All state lives in [`data/`](data) as JSON, validated by the JSON Schema in [`schema/`](schema).

### GitHub Pages

1. In the repo settings, set **Pages → Source** to **GitHub Actions**.
2. Push to `main`. [`pages.yml`](.github/workflows/pages.yml) validates the data and deploys
   `https://<owner>.github.io/<repo>/`, or your custom domain if one is set. The build uses relative
   URLs, so it works at either without changes.

Anyone can view it. To edit from the site (or from your phone), open **⚙ Settings** and paste a
fine-grained personal access token limited to this repository with **Contents: read & write**,
**Pull requests: read & write** and **Checks: read**. The token is kept in that browser's
`localStorage`, is only ever sent to `api.github.com`, and the page runs under a strict
Content-Security-Policy that blocks other destinations. Anything that can run script on the page, or
anyone with access to that browser profile, can read it, so keep the token scoped to this one repo.

### Mobile / offline

Open the Pages site on your phone and use **Add to Home Screen**. The compact UI shows up
automatically on small screens (switch in Settings). Edits are applied instantly and queued in
IndexedDB; the queue is replayed onto the latest remote data when the connection returns (on
reconnect, when the app regains focus, and every 30 s). If a queued edit targets something that was
deleted remotely it is skipped and listed under Settings → Sync.

On iOS, an installed app has its own storage separate from Safari, so connect the token once inside
the installed app.

### Local editor (Docker)

```bash
cp .env.example .env   # optional: add GITHUB_TOKEN for PR review and HTTPS pushes
docker compose up --build
```

Open http://localhost:8080. The repo is mounted at `/repo`; every save writes the changed
`data/*.json` files and commits them (only those paths) with a message like
`quest: done: Write docs (foundations/level-view)`. **⇪ Publish** pulls with rebase and pushes.
Your `~/.ssh` and `~/.gitconfig` are mounted read-only for SSH remotes and commit identity.

The API can commit, push and merge, so it only listens on `127.0.0.1`, rejects unknown `Host`
headers (DNS rebinding) and requires a custom header plus same-origin `Origin` on every write
(CSRF). To use it from another device on your network, publish the port on your LAN address and add
that host to `ALLOWED_HOSTS` in `docker-compose.yml`. Service workers need HTTPS off-localhost, so
for a phone the Pages PWA is the better route.

## Reviewing pull requests: the Warp Zone

Open pull requests that touch `data/` appear in the **Warp Zone** (the purple pipe on the overworld).
Each is a **Warp World** showing only the changed levels: new items glow green, changed items are
marked `!` with a field-by-field diff, removed items are ghosted. The review panel shows schema
validity (checked in the browser), CI status and mergeability, and lets you approve, comment,
request changes or merge (merge is disabled if the data is invalid or the PR isn't mergeable).

[`validate.yml`](.github/workflows/validate.yml) runs on every PR, so data written by hand or by an
LLM is checked before you look at it.

## Writing data with other tools

[`schema/quest.schema.json`](schema/quest.schema.json) is the contract: JSON Schema 2020-12,
`additionalProperties: false` throughout, a description on every field and enum value. Data files
reference it with `$schema`, so VS Code autocompletes them.
[`schema/README.md`](schema/README.md) explains the model and includes a copy-paste prompt for
ChatGPT/Claude. Rules JSON Schema can't express (unique ids, references, dependency cycles, at least
one MVP criterion) are checked by `npm run validate`.

## Development

```bash
npm install
npm run dev                  # Pages-mode app at http://localhost:5173/
npm run dev:server           # API on :8787 against this checkout (commits here!)
VITE_TARGET=local npm run dev   # local-editor app, proxies /api to :8787
npm test                     # vitest: shared model, store sync, server, GitHub client
npm run typecheck
npm run validate             # schema + semantic validation of data/
npm run format:data          # rewrite data/ in the canonical format the app writes
npm run schema:gen           # regenerate types + validators after editing the schema
```

Layout:

```
schema/   JSON Schema, authoring guide, examples
shared/   Generated types and Ajv validators, ops log + replay, scoring, level layout,
          PR diffing, GitHub client — used by app and server
app/      Vite + Phaser 3 front end (desktop game view, mobile view, PWA)
server/   Fastify API for the Docker editor (git commit/push, PR proxy)
data/     The quest itself
```

Edits are **ops** (`setItemStatus`, `addItem`, …) rather than whole-file writes. That makes offline
queueing, rebasing onto newer remote data, polish-penalty tracking and readable commit messages all
fall out of one mechanism (`shared/src/ops.ts`, `app/src/data/store.ts`).

Art is original pixel art drawn in code (`app/src/sprites/pixels.ts`); no Nintendo assets are used.
