# Quest Log

A project tracker you play. Each **project** (a house renovation, a furniture build, a work
launch — completely separate efforts) is its own Mario-style **overworld**; themes inside it are
**worlds**; each key deliverable is a **level**. Inside a level, project items become the course: tasks are `?` blocks,
blockers are brick walls, dependencies are pipes, risks are critters, decisions are signposts and
stretch goals are floating coins. A hero auto-walks to whatever is blocking you next.

Each level ends with a **staircase** up to the flagpole: one step per success criterion, in order.
Must-do steps are grey until ticked, then light up; bonus steps are pink and see-through. Click a
step to tick it (or untick it) and the hero hops up onto it. Tick the last must-do and he leaps
onto the pole at the height he's at, slides down and runs into the castle. In **play mode** (P or
a gamepad) you climb the stairs yourself: landing on a step ticks it, bonus steps can be jumped
over, and a must-do step can't be skipped. Reach the pole with one missing and it whacks you back
with a few words.

**Today** (the TODAY button or `t`; the first thing you see on phones) is a legal pad your hero
holds up over whatever you're looking at, with the day's plan scrawled on it: levels running out
of time, what's in progress and where the hero is waiting in every project, each with its level
code circled. Every line deep-links to its level or step; tick the box to mark it done. Any link
ending in `/~today` opens it over that screen.

Turn the pad's page to the **Inbox** (the INBOX button, `i`, or `n` to start writing) to jot ideas
down without deciding where they go. Later, tick a few and put them somewhere from wherever you
are: **New game** from the project list, **New world** from a project map, **New level** from a
world map, or **Add to this level** on a level. On Android, sharing a link or text to the
installed app drops it straight in the inbox (iOS doesn't let web apps receive shares). Ideas live
in `data/inbox.json` until they're placed.

Once a week (Friday afternoon by default; Monday morning, Sunday evening or off in **⚙ Settings**)
a **REVIEW** button appears in the top bar. The **Weekly review** (`w`, or `#/review`) is the
pad's third page:

- **Shipped this week**: levels cleared and items done in the last 7 days, with stars and XP.
- **Overdue**: levels past their time-box, with one-tap scope cuts. *Drop the optional items*
  drops them all in one commit, free. *Extend +1/3/7 days* quiets the clock, but the in-time star
  and time bonus are still scored against the original time-box.
- **Gone quiet**: started levels with no activity for 14+ days: keep, put on the **someday**
  shelf (off Today and the review; the clock restarts when you pick it up again) or drop the level.
- **Next week**: pick up to 3 focus levels; they go to the top of Today.

**Review done** stamps it until the next one is due. The schedule, the last review and the focus
levels are kept in your browser. Items record when they were finished (`doneAt`), so the review
works offline and in read-only views too.

Most edits show an **UNDO** toast for a few seconds (Ctrl/Cmd+Z works too); edits that haven't
synced yet are simply taken back, with no commit.

Dependencies can go further. One that needs another level becomes a **cloud** the hero rides
there, and a cloud waits at the start of that level to ride back. One you have to chase yourself can get **steps** of its own: a **warp pipe** down to an
underground sub-level holding them. Clear the steps and the hero comes back up the pipe with
the dependency done. Every dependency's bubble offers *Warp in* / *Hop on* (visit), *Got it!*
(close) and *Jump over* (skip). Plain ones stay a pipe with a plant.

**Budgets** are optional and off by default: tick *Track cash budgets* when you edit a project to
turn them on for it. Then give a task, a dependency or one of its steps a cash budget, and log
what it actually cost as receipts come in (logging a cost never counts as polish). Levels and
worlds can have an allowance of their own, or just add up what's inside. The panel shows what's
spent, what's left and what you've **saved**: savings are banked when an item is done or dropped,
when a level clears, and when a world is finished. Dropping a budgeted item banks all of it, so
cutting scope saves money too. As you log costs, an alert pops up when something reaches 90% of
its budget (you can change that, or turn alerts off) or goes over. Pick the currency in the same
place (GBP by default).

Pick your **hero** from eighteen characters in **⚙ Settings**. The choice is kept in your browser
(next to the token). When the data is editable it is also saved to `data/settings.json` as the
default for everyone; in read-only views your own choice wins over that default.

The game is built to beat perfectionism:

- **Flagpole = MVP.** A level clears when its MVP success criteria (the must-do steps) are ticked. Nothing else gates it,
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
| Demo (`?demo`) | GitHub Pages | Everything editable, kept in memory only: nothing is saved anywhere | – |
| Signed in | GitHub Pages + **Sign in with GitHub** | Commits straight to your repo via the GitHub API | ✓ |
| GitHub-connected | GitHub Pages + a pasted token in your browser | Commits straight to `main` via the GitHub API | ✓ |
| Local editor | Docker | Writes `data/` and commits in your checkout; **Publish** pushes | ✓ with `GITHUB_TOKEN` |
| Mobile | Pages, installed as a PWA | Compact touch UI, works offline, syncs when back online | ✓ |

Sign in with GitHub needs one small server-side step, a token-exchange Worker that lives in
[`worker/`](worker/README.md). Builds without its settings (forks, local builds) show the
token flow only. See [Sign in with GitHub](#sign-in-with-github).

All state lives in [`data/`](data) as JSON, one file per project, world and level, validated by the
JSON Schemas in [`schema/`](schema):

```
data/<project>/project.json
data/<project>/<world>/world.json
data/<project>/<world>/<level>.json
```

Ticking off a task rewrites one small level file, so commits and pull requests stay minimal.

### First visit: the welcome screen

A browser that has never used Quest Log gets a welcome screen styled like a console box, with three
ways in:

- **▶ Play the demo**: the example games, fully editable. Edits behave as if they save (sync status,
  undo, celebrations) but live in memory only and vanish on reload. The URL carries `?demo`, so a
  demo link stays a demo.
- **? Take the tour**: nine stops through the example data with a spotlight and a dialogue box.
  - The guide is your hero. If you've never picked one, it's a random hero, never the same as last
    time, and every line is in that guide's own voice.
  - The tour picks up where it left off after a reload, and can be restarted from Settings.
- **★ Get started**: a set-up guide styled like an instruction manual (in the Docker editor it skips the GitHub steps and starts from the repo it is running on):
  1. sign in with GitHub and pick your repo (or make one from the template);
  2. pick a hero;
  3. start a first game;
  4. (optionally) teach your AI the rules.

  **Use a token instead** on the first page swaps step 1 for the token route: make a repo, create
  a fine-grained token scoped to it (with a **TEST IT** check of each permission), and connect.
  Builds without sign-in always use that route.

Opening a shared link on a first visit shows that screen with a small "New here?" banner instead.
Add `?welcome` to any URL (or use **⚙ Settings → New here?**) to see the welcome screen again.

### Sign in with GitHub

**⚙ Settings → Sign in with GitHub** (or the first page of Get started) sends you to GitHub, where
you authorise the Quest Log GitHub App and choose which repos it may use. Back in the app:

- It finds your Quest Log repos among them (a `data/` folder with `settings.json`, `inbox.json` or
  a project). One repo connects straight away; with several you pick one, remembered on that
  device. A second device finds the same repos by signing in.
- No Quest Log repo yet? A checklist shows the next steps on GitHub: **Create my quest repo**
  (from [`quest-log-template`](https://github.com/lilmuckers/quest-log-template)), then **Install
  Quest Log** on it (or add it, if Quest Log is already installed). Both open in a new tab. The
  checklist asks GitHub every few seconds while it's showing, and at once when you come back to
  the tab, then offers the repo as soon as it appears. Any other repo Quest Log can see can be
  used straight away too (its first save starts the quest log), except an empty one.
- Sign-in tokens last 8 hours and renew themselves in the background, and they only reach the repos
  you chose. They're kept in that browser's `localStorage`, like a pasted token. If the renewal
  ever runs out, the app asks you to sign in again and keeps your unsynced edits until you do.
- **Sign out** forgets the token and repo choice on that device. To cut Quest Log off everywhere,
  revoke it under GitHub → Settings → Applications → Authorized GitHub Apps.

The sign-in uses PKCE and a one-time `state`, and the callback's `?code=` is removed from the
address before anything else runs. AI assistants still use a fine-grained token (see the AI skill
dialog).

Building your own copy with sign-in: create the GitHub App and deploy the Worker
([`worker/README.md`](worker/README.md)), then set the repo variables `QUEST_AUTH_URL` (the Worker's
origin), `QUEST_APP_CLIENT_ID` and `QUEST_APP_SLUG`. `pages.yml` passes them to the build as
`VITE_AUTH_URL`, `VITE_GITHUB_APP_CLIENT_ID` and `VITE_GITHUB_APP_SLUG`, and the Worker's origin is
added to the CSP's `connect-src`. For local development, set the same `VITE_` variables when
running `npm run dev` (against `wrangler dev` on `http://localhost:8787`, say).

### Use your own repo with a token (no fork or clone needed)

You don't need write access to this repo. Create any GitHub repo (with a README so it has a first
commit), open the site, go to **⚙ Settings**, and enter `owner/repo` (and optionally a branch) plus
a fine-grained token for that repo. The app reads and writes `data/` in your repo and reviews its
PRs. A token without push rights gives a read-only view.

### GitHub Pages

1. In the repo settings, set **Pages → Source** to **GitHub Actions**.
2. Push to `main`. [`pages.yml`](.github/workflows/pages.yml) validates the data and deploys
   `https://<owner>.github.io/<repo>/`, or your custom domain if one is set. The build uses relative
   URLs, so it works at either without changes.

Anyone can view it. To edit from the site (or from your phone), open **⚙ Settings** and paste a
fine-grained personal access token limited to this repository with **Contents: read & write**,
**Pull requests: read & write** and **Checks: read**. The token is kept in that browser's
`localStorage`, and the app only ever sends it to `api.github.com`. The page runs under a strict
Content-Security-Policy that allows only GitHub's API, the sign-in Worker and Google Analytics
(below). Anything that
can run script on the page (including the Google Analytics script), or anyone with access to that
browser profile, can read it, so keep the token scoped to this one repo.

### Analytics and privacy

The Pages site uses Google Analytics 4 to see which screens and features get used. It is on by
default and can be switched off in **⚙ Settings → Privacy**. It is also off by default for
browsers that send Global Privacy Control. Docker/local builds include no analytics unless you
build with `VITE_GA_ID`; set `VITE_GA_ID=` (empty) to build the site without it.

What is sent: screen types (`/level`, `/world`…, never the ids in the URL), and actions as
categories: item type and status, dependency mode, hero, sync result and counts in buckets. No
project, world, level or item titles or ids, notes, repo names, logins or tokens. The allow-list
is in [`app/src/analytics.ts`](app/src/analytics.ts).

If you run your own copy with your own GA property, in the web stream's **Enhanced
measurement** settings turn off **"Page changes based on browser history events"** (the app
sends its own id-free page views; history-based ones would include ids from the URL). Consider
turning off **Outbound clicks** too, since item links are your own content.

### Mobile / offline

Open the Pages site on your phone and use **Add to Home Screen**. The compact UI shows up
automatically on small screens (switch in Settings). Edits are applied instantly and queued in
IndexedDB; the queue is replayed onto the latest remote data when the connection returns (on
reconnect, when the app regains focus, and every 30 s). If a queued edit targets something that was
deleted remotely it is skipped and listed under Settings → Sync.

On iOS, an installed app has its own storage separate from Safari, so sign in (or connect the
token) once inside the installed app.

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

## Links

Every screen has a shareable URL, and a level link can open an item's bubble directly:

```
#/                                       project select
#/p/<project>                            project map
#/p/<project>/<world>                    world map
#/p/<project>/<world>/<level>/<item>     level, with that item's bubble open
#/prs, #/pr/<n>/<project>/<world>/<level>/<item>   pull request review
#/review (or …/~review after any link)   weekly review; …/~today and …/~inbox likewise
```

## Reviewing pull requests: the Warp Zone

Open pull requests that touch `data/` appear in the **Warp Zone** (the purple cartridge on the project select screen).
Each is a **Warp World** showing only the changed levels: new items glow green, changed items are
marked `!` with a field-by-field diff, removed items are ghosted. The review panel shows schema
validity (checked in the browser), CI status and mergeability, and lets you approve, comment,
request changes or merge (merge is disabled if the data is invalid or the PR isn't mergeable).

[`validate.yml`](.github/workflows/validate.yml) runs on every PR, so data written by hand or by an
LLM is checked before you look at it.

## Writing data with other tools and LLMs

[`skills/quest-log/SKILL.md`](skills/quest-log/SKILL.md) (also served at
`https://tasks.patrick-mckinley.com/skills/quest-log/SKILL.md`) tells an LLM exactly how to plan
projects into this structure and how to read, commit, or open a PR through the GitHub API with a
personal access token. A test keeps its examples valid.

The skill includes [`scripts/quest.py`](skills/quest-log/scripts/quest.py), a standard-library
Python helper (no installs) that validates data with the same rules as the app and pulls/pushes it
through the GitHub API (`update-check`, `validate`, `changes`, `info`, `pull`, `status`,
`push [--pr]`). `push` refuses to remove anything that isn't named with `--allow-delete`. It works in Claude,
ChatGPT's code interpreter (validation only: no internet there), CI and a terminal. The **AI SKILL**
button in the app downloads the skill as a zip with the script and schemas bundled. All schemas are
listed in the static manifest [`schema/index.json`](schema/index.json), published with the site.

The skill is versioned. [`skills/quest-log/version.json`](skills/quest-log/version.json) is
published with the site, and assistants compare it with their copy before touching data: an
outdated copy loads the latest skill and asks you to reinstall. After editing `SKILL.md` or
`quest.py`, run `npm run skill:version` (CI fails until you do).


[`schema/quest.schema.json`](schema/quest.schema.json) is the contract: JSON Schema 2020-12,
`additionalProperties: false` throughout, a description on every field and enum value. Data files
reference it with `$schema`, so VS Code autocompletes them.
[`schema/README.md`](schema/README.md) explains the model. Rules JSON Schema can't express (paths
match ids, order lists match files, unique ids, references, dependency cycles, at least one MVP
criterion) are checked by `npm run validate`.

## Development

```bash
npm install
npm run dev                  # Pages-mode app at http://localhost:5173/
npm run dev:server           # API on :8787 against this checkout (commits here!)
VITE_TARGET=local npm run dev   # local-editor app, proxies /api to :8787
npm test                     # vitest: shared model, store sync, server, GitHub client
npm run typecheck
npm run e2e                  # Playwright: builds the app, then drives it in Chromium (see e2e/)
npm run validate             # schema + semantic validation of data/
npm run format:data          # rewrite data/ in the canonical format the app writes
npm run schema:gen           # regenerate types + validators after editing the schema
```

Layout:

```
schema/   JSON Schemas (quest + per-file project/world/level) and a guide
skills/   SKILL.md for LLMs working with the data
shared/   Generated types and Ajv validators, ops log + replay, scoring, level layout,
          PR diffing, GitHub client — used by app and server
app/      Vite + Phaser 3 front end (desktop game view, mobile view, PWA)
server/   Fastify API for the Docker editor (git commit/push, PR proxy)
data/     The quests: one folder per project (ships with five example projects)
```

Edits are **ops** (`setItemStatus`, `addItem`, …) rather than whole-file writes. That makes offline
queueing, rebasing onto newer remote data, polish-penalty tracking and readable commit messages all
fall out of one mechanism (`shared/src/ops.ts`, `app/src/data/store.ts`).

Art is original pixel art drawn in code (`app/src/sprites/pixels.ts`); no Nintendo assets are used.
