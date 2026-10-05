---
name: quest-log
description: Read, create and update Quest Log project data (a gamified project tracker) stored as JSON files in any GitHub repository the user chooses — usually their own data repo, not the Quest Log app repo. First check the published skill version and reload the skill if it is newer. Use your own GitHub integration if you have one (ChatGPT's GitHub connector or Codex, Claude's GitHub integration, Claude Code with git), otherwise the bundled quest.py or the GitHub REST API with a personal access token. Every change must pass schema validation with quest.py before it is committed, pushed or handed over, and branches are updated from the base branch before a pull request is opened or added to. Use when asked to plan a project into worlds/levels/tasks, add or update projects, worlds, levels or tasks, mark work done, capture a quick idea or to-do (into the inbox when it's unclear where it belongs), say what to work on next, or open a pull request with Quest Log changes.
---

# Quest Log data skill

Quest Log shows projects as a Mario-style platformer. All state is plain JSON files in a GitHub
repository. Any repo works: the user does not need a copy of the Quest Log code, only a `data/`
folder. The web app (https://tasks.patrick-mckinley.com) reads and writes those files.

Follow this document exactly. Files that break the rules are rejected by the app and by CI.

**Skill version: 3**

Four rules apply to every request, whatever route you use. Each has its own section below.

1. **Check for a newer skill first** (§0). If the published skill is newer than this copy, load
   the new one and follow it instead of this document.
2. **Validation is a blocking gate** ("Schema validation"). No commit, push, pull request or
   hand-over of files until the whole data tree passes validation against the current schema.
3. **Update from the base branch first.** Base a new pull request on the latest base branch, and
   bring the base branch into an existing pull request before you add commits to it ("Branches
   and pull requests").
4. **Add, don't rewrite; never remove what you weren't asked to** ("Parallel changes"). Add new
   things as new files where you can, patch the latest copy of a file rather than replacing it,
   and check that your change removes nothing the user didn't ask to remove.

This skill ships with a helper, `scripts/quest.py` (see "The helper script"). Its main job is
**validation**. It can also check for skill updates, and pull and push through the GitHub API,
but only use pull/push when you have no better way to reach GitHub (see "How to reach GitHub").

## 0. Before anything else: is this skill up to date?

The skill changes as the app changes: new fields, new rules, new steps. An old copy writes data
the app rejects. So at the **start of every conversation or task that uses this skill**, before
you read or change any data, compare this copy's version (the **Skill version** line above) with
the published one:

- **With Python and internet:** `python3 scripts/quest.py update-check`. Exit 0 = up to date,
  3 = outdated, 4 = the site couldn't be reached.
- **Otherwise:** fetch **https://tasks.patrick-mckinley.com/skills/quest-log/version.json** with
  any tool you have (web fetch, browsing, `curl`, code execution). If that host is blocked but you
  can read GitHub, read `skills/quest-log/version.json` on the `main` branch of
  `lilmuckers/gamify-todo` instead. Its `version` field is the latest version.

If the published `version` is **higher** than this copy's, this copy is out of date. You **must**
update before doing anything else:

1. Fetch the latest `SKILL.md` (the `skill` URL in `version.json`), read **all** of it, and follow
   it in place of this document for the rest of the conversation.
2. Use the latest `quest.py` (the `script` URL), e.g. `curl -sfo quest.py <script URL>`, rather
   than the bundled one, and validate with `--refresh` so you get the latest schemas.
3. Tell the user, once: *"Your Quest Log skill is out of date (version N, latest M). I'm using
   the latest version for this chat. To update it for good, download the skill again from the
   app's AI SKILL button and reinstall it."*

If you can't fetch the latest `SKILL.md`, don't carry on silently with the old one: tell the
user the skill is out of date, and ask them to reinstall it before you write anything.

If you can't check at all (no internet, no GitHub access), say so in one line (*"I couldn't
check for a newer Quest Log skill, so I'm using version N"*) and carry on. Validation still
protects the data.

## Schema validation (mandatory)

Validation is a **blocking gate**, not a quality check you do if there's time. Every data file
must match the JSON Schema (§3) **and** the cross-file rules (§2, §7). The app and CI reject
anything that doesn't, so invalid data is never "nearly done": it's broken.

**The gate:** before **any** GitHub write (a commit, a push, creating a branch with data on it,
opening or updating a pull request) and before you give the user files to commit, validate the
**whole data tree** as it will be after your change. Only go on when it passes.

```bash
python3 scripts/quest.py validate --refresh DIR      # DIR contains data/
```

The order is always:

```
read the current schema (§3) and the latest files
        ↓
make the change
        ↓
validate the whole tree  ←──────────┐
        ↓                          │
passed? ── no ──→ fix every issue ─┘
        │
       yes
        ↓
commit → push / open or update the pull request → tell the user
```

- **Pass** means exit code 0 and a line starting `✓ N data file(s) valid`. Anything else is a
  fail: exit 1 lists every issue as `file/path: message`.
- **Use the current schema, never your memory.** `--refresh` downloads the schemas that every
  file's `$schema` points at (and checks for a newer skill). Without internet it warns and uses
  the bundled copies; that's fine.
- **Look up closed values; never guess them.** Before you write a value that the schema limits
  (an `enum` such as `type`, `status`, `theme` or `hero`, a `const`, a `pattern` such as ids or
  dates, a `minimum`/`maximum`, a `maxLength`), check the allowed values in the current schema.
  Don't copy them from examples, other files or memory, and never invent a plausible one.
- **Never assume generated JSON is valid.** However simple the change, run the validator.
- **Validate the whole tree**, not just the files you touched. Many rules span files
  (`worldOrder`, `levelOrder`, `levelRef`, `goalIds`, `unlocksAfter`, `dependsOn` and cycles,
  ids that match file and folder names), so a change can break a file you never opened.
- **Validate the result after updating from the base branch** (see "Branches and pull
  requests"), not only your own copy. Someone else's change plus yours can be invalid even when
  each is valid alone.
- **On a fail:** don't commit, push, or open or update the pull request. Fix every issue, then
  run the **full** validation again. Repeat until it passes. Never commit "to fix later", never
  commit part of a change to get round an issue, and never edit the schema files to make data
  pass.
- **CI is a second check, not the first.** Never push to see whether CI passes.
- **Data that was already invalid before you started:** run `validate` once before editing, so
  you know. If it fails, tell the user what's wrong and ask before fixing it; don't commit on top
  of a broken tree.
- **Done means validated.** "Pull request opened" is not success; "validated changes are in a
  pull request" is. Never tell the user a branch or pull request is ready until validation has
  passed on exactly what you committed. Report it in one line, e.g. *"Validated: ✓ 14 data files
  valid."*
- **`quest.py push`** validates by itself and refuses to commit invalid data, both your copy and
  your copy combined with the latest branch. It has no way to skip this.

**If you can't run Python**, validate by hand instead, and say that you did: fetch
https://tasks.patrick-mckinley.com/schema/quest.schema.json and check every file you wrote or
changed field by field against it (required fields, types, enums, patterns, lengths, **no extra
fields**), then go through every box in the checklist in §7. Tell the user: *"I couldn't run the
validator, so I checked by hand. The app will flag anything I missed."* If they have CI (§8), a
pull request is the safer route.

## How to reach GitHub

Use the first of these that you have. Whichever you use, the files and rules in this document are
the same, you still validate with `quest.py` before committing ("Schema validation"), and you
still update from the base branch first ("Branches and pull requests").

1. **Your own GitHub integration.** For example: ChatGPT's GitHub connector or Codex, Claude's
   GitHub integration or a GitHub MCP server, Claude Code or another agent with `git`/`gh` and a
   clone. Use it to read the data, commit and open pull requests, the same way you would for any
   repo. It handles authentication, so **don't ask the user for a token**. Use `quest.py` to
   validate: run `python3 scripts/quest.py validate --refresh DIR` on a checkout, or on a folder
   where you've written **every** file under `data/` as it will be after your change (`DIR`
   contains `data/`), and fix every issue before committing.
2. **`quest.py pull` / `push`** with a token, when you can run Python **and** reach
   `api.github.com` but have no integration. See "The helper script".
3. **The GitHub REST API directly** (§6), when you can make HTTP requests but can't run Python.
   Check the rules in §7 by hand.
4. **No access at all:** write the files, validate them if you can run Python, and give them to
   the user to commit (§6.6).

Tell the user which route you're using when it isn't obvious, e.g. *"Committing through the
GitHub connector to alice/quests@main"*.

## Where the data lives: any repo

The data repo is **whichever GitHub repository the user chooses**. Usually that's a repo of their
own (for example `alice/quests`), separate from the Quest Log app's code repo
(`lilmuckers/gamify-todo`). Users point the app at it under ⚙ Settings → Repository, and you
work on the same repo.

- **Never assume the repo.** If the user hasn't said, ask: *"Which GitHub repo (`owner/repo`) and
  branch hold your Quest Log data?"* Branch is optional; blank means the repo's default branch.
- **Everything in this skill works the same against that repo.** Creating, updating or deleting
  projects, worlds and levels, adding or changing tasks and other items, ticking criteria, and
  opening pull requests all use the same files and API calls. Only `<owner>/<repo>` and the
  branch change.
- **No app code is needed in the data repo**, only the `data/` folder, plus the optional CI from
  §8. Don't copy the Quest Log source, workflows or settings into it.
- **A new data repo** just needs one commit, such as a README created on GitHub. If it has no
  `data/` folder yet, create `data/<project-id>/project.json` and go from there.
- **One repo is one set of projects.** The app shows one repo at a time, and different repos are
  independent. To move a project to another repo, copy its whole `data/<project-id>/` folder
  there (and delete it from the old one if it's a move).
- **Check access before writing.** With an integration, check it can write to that repo (or
  open a pull request instead). With a token, `GET https://api.github.com/repos/<owner>/<repo>`
  returns `permissions.push`. If that's false, the token can only read: tell the user, and
  either ask for a token with write access to that repo or output the files instead (§6.6).
  Opening a pull request (§6.3) also needs push access, because it creates a branch in the repo.
- **Say where you're writing.** Before committing, tell the user the repo and branch, e.g.
  *"Committing to alice/quests@main"*.

## Branches and pull requests: update from the base branch first

The **base branch** is the branch the data lives on: the repo's default branch (usually `main`)
unless the user named another. The app, the user on their phone and other assistants commit to it
all the time, so the copy you read earlier goes stale fast. Never build on a stale copy.

**Before opening a pull request:**

1. Fetch the base branch's latest commit **right before** you create the pull request branch, not
   the copy you read at the start of the chat.
2. Create the pull request branch from that commit, and make your changes to the latest files.
3. Validate the whole tree ("Schema validation"), then commit, push and open the pull request
   against the base branch.

**Before adding commits to an existing pull request** (the user asks for more changes, a
reviewer asks for a fix, or you're adding to a pull request you opened earlier):

1. Fetch the latest base branch and the latest pull request branch.
2. If the base branch has commits the pull request branch doesn't, **merge the base branch into
   the pull request branch first**. Always a merge: never rebase, amend or force-push a branch
   that's already pushed.
3. If the merge conflicts, keep the base branch's version and re-apply the pull request's change
   on top of it. If you can't tell what the pull request meant, stop and ask the user.
4. Validate the merged tree, make your change, validate again, then commit and push.

Do this **every** time, even if you updated a few minutes ago. The same goes for committing
straight to the base branch: read the latest commit just before you write, and redo your change
on top of it if it moved.

| Route | Opening a pull request | Adding to a pull request |
|---|---|---|
| `git` | `git fetch origin` then `git switch -c quest/<name> origin/<base>` | `git fetch origin`, `git switch <pr-branch>`, `git pull`, `git merge origin/<base>`, then validate |
| Your GitHub integration | Read the base branch's head sha just before, and create the branch from it | Use its "update branch" action (GitHub's *Update branch* button, `PUT /pulls/<n>/update-branch`, or a GitHub MCP `update_pull_request_branch` tool) with a merge, then re-read the files from the pull request branch |
| `quest.py` | `pull`, edit, `push --pr TITLE`: it branches from the latest base and validates your change on top of it | `pull --branch <pr-branch>`, edit, `push`: it merges the base into the branch first and stops on a conflict |
| REST API | §6.3 | §6.4 |

## Parallel changes: add, don't rewrite

Several pull requests (from you, other assistants and the app) are often open at once. The data
is laid out so that **adding** things rarely clashes, as long as you follow these rules.

**Add new things as new files.** A new project, world or level is a new file, and nothing else
has to change:

- A new world's `world.json` or a new level's `<level-id>.json` does **not** need adding to
  `worldOrder` / `levelOrder`. Worlds and levels left out of those lists go after the listed ones,
  sorted by id, and the app writes them into the list next time it saves.
- Only edit `worldOrder` / `levelOrder` when the order matters (several new levels that must be
  played in sequence in an existing world, or the user asks to reorder). That edits a shared
  file, so two pull requests doing it at once will conflict.
- Planning a **new** world or project is always conflict-free: its own `world.json` lists its
  own levels.

**Patch the latest copy; never replace a file from memory.** When you change an existing file
(adding an item to a level, ticking a criterion, capturing an idea in `data/inbox.json`):

- Read that file from the latest base branch (or pull request branch) **immediately** before you
  write it, not from earlier in the chat.
- Change only the keys and array entries you mean to: append an item, set one `status`. Keep
  everything else byte-for-byte, including other people's items.
- Never write a whole file from your memory of it, from an example, or from an earlier snapshot.
  That's how other people's work gets deleted without anyone noticing.

**Never remove anything the user didn't ask you to remove.** Before you commit, compare your
tree with the branch you're committing on:

```bash
python3 scripts/quest.py changes --git origin/main .     # a git checkout, against the base branch
python3 scripts/quest.py changes BASE_DIR DIR             # two folders that each contain data/
```

It lists every project, goal, world, level, criterion, item, step and inbox idea that is
**added**, **changed** or **removed**, by key (`level:p/w/l`, `item:p/w/l/i`, `inbox:i`, …). Read
the list. Every removal must be one the user asked for (deleting a level, cutting an item,
placing an inbox idea). If something else is removed, your copy was stale: update from the base
branch and redo only your change. `changes` exits 5 if anything is removed that you didn't name
with `--allow-delete KEY` (a world or level also covers what's inside it). `quest.py push` runs
the same check against the branch it commits to and refuses unnamed removals.

**Some edits still touch the same lines,** so two pull requests can conflict: both adding items
to the same level, both capturing inbox ideas, or both editing the same item. When you resolve
such a conflict (see "Branches and pull requests"), **keep both sides**: every item, idea and
list entry from both, then validate. Only drop something if the user asked for that.

## 1. Concepts

| Level of the tree | Game meaning | Real meaning |
|---|---|---|
| **Project** | A separate game/map | A completely unrelated effort: "House renovation", "Desk build", "Work launch". Projects never reference each other. |
| **World** | An island on the project's map | One theme or area inside the project: "Kitchen", "Payments". |
| **Level** | One course in a world | ONE key deliverable, with a time-box and success criteria. |
| **Item** | Things in the course | Tasks, blockers, dependencies, risks, decisions, milestones, stretch goals. |

Inside a level, items are laid out left to right by `dependsOn` (shown in the app as **"Waits
for"**): an item that waits for others comes after them. The hero walks to the first unfinished
must-do item and waits there.

A level is **cleared** when every success criterion marked `"mvp": true` is `"done": true`.
Nothing else gates it. The whole point is "good enough, then move on": keep MVP criteria to the
1–3 checks that truly matter, and put polish into non-MVP criteria or `stretch` items.

**Money is optional, and off unless the project turns it on** with `"budgets": {}` in
`project.json` (optionally `currency`, `alerts`, `alertAt`). Without it the app shows no money at
all, so only add costs to projects that have it, and add it when the user asks to track spending.
Items and dependency steps can carry a cash `budget` (what it should cost)
and `spent` (what it has cost so far). Levels and worlds can have a `budget` of their own; without
one, theirs is the sum of what's inside. Amounts are plain numbers in the project's currency
(`budgets.currency`, GBP when unset). The app alerts as costs are logged: a heads-up at `alertAt`%
of a budget (90 by default) and an alert when it goes over. The app banks **savings** (budget minus spent) when an item is done or dropped,
a level clears, or a world's levels are all cleared. Dropping a budgeted item banks all of it.

## 2. Folder layout

```
data/
  settings.json                ← Settings (optional, repo-wide)
  inbox.json                   ← Inbox (optional): captured ideas not yet placed
  <project-id>/
    project.json               ← Project
    <world-id>/
      world.json               ← World
      <level-id>.json          ← Level (one file per level)
```

Example:

```
data/house-renovation/project.json
data/house-renovation/kitchen/world.json
data/house-renovation/kitchen/demolition.json
data/house-renovation/kitchen/cabinets.json
data/desk-build/project.json
data/desk-build/frame/world.json
data/desk-build/frame/cut-legs.json
```

Rules:

- Every id is lowercase kebab-case: `^[a-z0-9]+(-[a-z0-9]+)*$`, max 64 chars. Derive ids from names
  (`"Kitchen cabinets"` → `kitchen-cabinets`). Never rename an existing id.
- Folder/file names **equal** the `id` inside the file.
- `project.json` → `worldOrder` sets the map order. Every id in it must have a world folder;
  worlds left out go last, by id.
- `world.json` → `levelOrder` sets the play order. Every id in it must have a level file;
  levels left out go last, by id.
- A level id may not be `world` (that name is the world file).
- The only files directly in `data/` are the optional `settings.json` and `inbox.json`. No other `.json` files anywhere under `data/`.
- Files are UTF-8 JSON, 2-space indent, trailing newline.

## 3. Schemas

Put the matching `$schema` URL at the top of every file:

| File | `$schema` |
|---|---|
| `project.json` | `https://tasks.patrick-mckinley.com/schema/project.schema.json` |
| `world.json` | `https://tasks.patrick-mckinley.com/schema/world.schema.json` |
| `<level-id>.json` | `https://tasks.patrick-mckinley.com/schema/level.schema.json` |
| `data/settings.json` | `https://tasks.patrick-mckinley.com/schema/settings.schema.json` |
| `data/inbox.json` | `https://tasks.patrick-mckinley.com/schema/inbox.schema.json` |

Full definitions (JSON Schema 2020-12, `additionalProperties: false` everywhere — **no extra
fields**): https://tasks.patrick-mckinley.com/schema/quest.schema.json. Fetch it if unsure.

Every published schema is listed in a static manifest,
**https://tasks.patrick-mckinley.com/schema/index.json** (`baseUrl` + each `file`). The skill
package also bundles copies under `schemas/`, so validation works offline.

### Project (`data/<project-id>/project.json`)

| Field | Required | Type | Notes |
|---|---|---|---|
| `id` | ✓ | id | = folder name |
| `title` | ✓ | string ≤120 | |
| `description` | | string ≤4000 | |
| `budgets` | | `{currency?, alerts?, alertAt?}` | turns on cash budgets (off when missing; `{}` = on with defaults). `currency`: ISO 4217 code, default `GBP`. `alerts`: `false` turns off alerts. `alertAt`: 50–100, % of a budget spent that gives a heads-up, default 90. |
| `goals` | ✓ | `{id, title, description?}[]` | 1–5 key outcomes |
| `worldOrder` | ✓ | id[] | world folders, in map order. Only names existing worlds; ones left out go last. |

### World (`data/<project-id>/<world-id>/world.json`)

| Field | Required | Type | Notes |
|---|---|---|---|
| `id` | ✓ | id | = folder name |
| `name` | ✓ | string ≤120 | |
| `description` | | string | |
| `theme` | ✓ | `grass` \| `desert` \| `water` \| `ice` \| `sky` \| `castle` | grass = general, desert = long slog/infra, water = research, ice = cleanup, sky = vision/design, castle = launch/high stakes |
| `goalIds` | ✓ | id[] | goal ids from this project's `project.json` |
| `unlocksAfter` | | id[] | other worlds in this project to finish first. Draws the map: each world branches from the worlds it unlocks after (visual only; never blocks editing). Worlds without it start the map. |
| `budget` | | number ≥0 | cash for the whole world. Omit to add up its levels' budgets. |
| `levelOrder` | ✓ | id[] | level files, in play order. Only names existing levels; ones left out go last. |

### Level (`data/<project-id>/<world-id>/<level-id>.json`)

| Field | Required | Type | Notes |
|---|---|---|---|
| `id` | ✓ | id | = file name without `.json` |
| `name` | ✓ | string ≤120 | |
| `deliverable` | ✓ | string ≤280 | one sentence: what exists when cleared |
| `description` | | string | |
| `timeboxDays` | ✓ | integer 1–90 | time budget, counted from `startedAt` |
| `startedAt` | | ISO date-time | see §5 |
| `clearedAt` | | ISO date-time | see §5 |
| `someday` | | boolean | `true` = parked on the someday shelf (see "weekly review" below). Omit otherwise. |
| `budget` | | number ≥0 | cash for the whole level. Omit to add up its items' budgets. |
| `successCriteria` | ✓ | Criterion[] (1–20) | at least one with `mvp: true` |
| `items` | ✓ | Item[] (≤200) | may be empty |
| `stats` | | object | **app-maintained; never write or change it** |

Criterion: `{ "id", "text" (≤280, observable/testable), "mvp": boolean, "done": boolean }` — all
four required — plus optional `"doneAt"` (ISO date-time: when it was ticked; only on done criteria).

Item:

| Field | Required | Notes |
|---|---|---|
| `id` | ✓ | unique within the level |
| `type` | ✓ | see below |
| `title` | ✓ | ≤120, imperative for tasks |
| `status` | ✓ | `todo` \| `doing` \| `done` \| `dropped` |
| `doneAt` | | ISO date-time: when it was marked `done` (see §5). Only on done items. |
| `mvp` | | default `true` (on the critical path). Set `false` for optional items. Omit for `stretch`. |
| `dependsOn` | | ids of items **in the same level** that come first; no cycles |
| `levelRef` | | dependency items only: `"<world-id>/<level-id>"` in the **same project**, not the item's own level |
| `subtasks` | | dependency items only: the steps to get it (see below). Not together with `levelRef`. |
| `budget` | | number ≥0: expected cost, e.g. `49.99`. On a dependency with steps it replaces the sum of theirs. |
| `spent` | | number ≥0: cash spent on it so far. Fine to set after it's `done` (receipts come late). |
| `link` | | URL to a ticket/doc/PR |
| `notes` | | free text / markdown |

Item types: `task` (work you do), `deliverable` (milestone inside the level), `blocker` (something
stopping progress), `dependency` (needed from elsewhere), `risk` (might go wrong; `done` =
mitigated/accepted), `decision` (open question), `stretch` (nice-to-have; never blocks, never
earns stars). `dropped` is a good status: cutting scope is encouraged.

**Dependencies come in three shapes.** Pick the one that matches what the user has to do:

| Shape | When | Fields | In the app |
|---|---|---|---|
| Wait for it | someone else delivers it | neither | a pipe with a plant |
| Another level | it's the output of a level in this project | `levelRef` | a cloud that carries the hero there |
| Chase it | the user has to take steps to get it | `subtasks` | a warp pipe down to a bonus sub-level |

`subtasks` is an array of steps shaped like items: `id` (unique among that dependency's steps),
`type` (any type **except** `dependency`; sub-levels don't nest), `title`, `status`, and optional
`doneAt`, `mvp`, `dependsOn` (ids of **sibling steps**), `budget`, `spent`, `link`, `notes`. Keep it to the few steps that
matter. When every must-do step is `done` or `dropped`, the dependency itself is ready to mark
`done`: do that in the same change when the user says it's sorted.

```json
{ "id": "permit", "type": "dependency", "title": "Skip permit from the council", "status": "todo",
  "subtasks": [
    { "id": "apply-online", "type": "task", "title": "Apply on the council website", "status": "done" },
    { "id": "pay-fee", "type": "task", "title": "Pay the fee", "status": "todo", "dependsOn": ["apply-online"] }
  ] }
```

### Inbox (`data/inbox.json`, optional)

Ideas captured before anyone has decided where they belong. Only basic fields; they become real
items when placed in a level.

```json
{ "$schema": "https://tasks.patrick-mckinley.com/schema/inbox.schema.json",
  "items": [ { "id": "buy-tiles", "type": "task", "title": "Buy tiles", "link": "https://…", "addedAt": "2026-10-01T09:00:00Z" } ] }
```

| Field | Required | Notes |
|---|---|---|
| `id` | ✓ | unique within the inbox |
| `type` | ✓ | any item type |
| `title` | ✓ | ≤120 |
| `notes`, `link`, `addedAt` | | as for items; `addedAt` is when it was captured |

To **capture**, append to `items` (create the file if missing). To **place** an idea, add it to a
level's `items` as a normal item (`"status": "todo"`, a fresh id unique in that level) **and** remove
it from `data/inbox.json` in the same commit. Delete the file when `items` is empty.

### Settings (`data/settings.json`, optional)

Repo-wide display settings; omit the file to use the defaults. Only change it when the user asks.

| Field | Notes |
|---|---|
| `hero` | default player character: one of `classic`, `bearded`, `redhead`, `mustard-jumper`, `denim-jacket`, `hoodie`, `emo`, `goth`, `punk`, `rainbow-tee`, `trans-flag-hair`, `trans-pin`, `bi-bomber`, `drag-glam`, `nb-beanie`, `hijab-skater`, `silver-locs` or `flannel` (the schema describes each). Viewers in read-only mode can pick their own in the app. |

```json
{ "$schema": "https://tasks.patrick-mckinley.com/schema/settings.schema.json", "hero": "bearded" }
```

## 4. Example files

`data/desk-build/project.json`
```json
{
  "$schema": "https://tasks.patrick-mckinley.com/schema/project.schema.json",
  "id": "desk-build",
  "title": "Standing desk build",
  "budgets": { "currency": "GBP" },
  "goals": [
    { "id": "usable-desk", "title": "A sturdy desk I work at daily" }
  ],
  "worldOrder": ["frame"]
}
```

`data/desk-build/frame/world.json`
```json
{
  "$schema": "https://tasks.patrick-mckinley.com/schema/world.schema.json",
  "id": "frame",
  "name": "Frame",
  "theme": "desert",
  "goalIds": ["usable-desk"],
  "levelOrder": ["cut-legs"]
}
```

`data/desk-build/frame/cut-legs.json`
```json
{
  "$schema": "https://tasks.patrick-mckinley.com/schema/level.schema.json",
  "id": "cut-legs",
  "name": "Cut the legs",
  "deliverable": "Four legs cut to height and sanded",
  "timeboxDays": 3,
  "successCriteria": [
    { "id": "four-legs", "text": "Four legs within 1 mm of each other", "mvp": true, "done": false },
    { "id": "rounded", "text": "Edges rounded over", "mvp": false, "done": false }
  ],
  "items": [
    { "id": "buy-timber", "type": "task", "title": "Buy 70x70 timber", "status": "todo", "budget": 45 },
    { "id": "saw-choice", "type": "decision", "title": "Hand saw or borrow mitre saw?", "status": "todo" },
    { "id": "cut", "type": "task", "title": "Cut four legs", "status": "todo", "dependsOn": ["buy-timber", "saw-choice"] },
    { "id": "wonky-cuts", "type": "risk", "title": "Uneven cuts", "status": "todo", "mvp": false },
    { "id": "chamfer", "type": "stretch", "title": "Chamfer the feet", "status": "todo" }
  ]
}
```

## 5. Changing data correctly

Always read the current files first (from the latest branch, just before writing), change the
minimum, and keep the rest byte-for-byte. See "Parallel changes".

| To… | Do this |
|---|---|
| Add a project | Create `data/<p>/project.json` with `worldOrder: []` and at least one goal. |
| Add a world | Create `data/<p>/<w>/world.json` (with its own levels in `levelOrder`). Leave `project.json` alone: it goes at the end of the map. Add it to `worldOrder` only to put it somewhere else. |
| Add a level | Create `data/<p>/<w>/<l>.json`. Leave `world.json` alone: it goes after the listed levels, by id. Add it to `levelOrder` only when its position matters. |
| Add an item | Append to `items` in the level file with a new unique id and `"status": "todo"`. |
| Start work | Set item `status` to `doing`. If the level has no `startedAt`, set it to the current UTC time. |
| Finish work | Set item `status` to `done` and `doneAt` to the current UTC time (or `status` `dropped` to cut it, no `doneAt`). |
| Reopen work | Set `status` back to `todo`/`doing` and remove `doneAt`. |
| Add a step to a dependency | Append to that item's `subtasks` (create the array if missing) with a new id unique among its steps. Never on an item with `levelRef`. |
| Finish a step | Set the step's `status` inside `subtasks` (and `doneAt` when it's `done`, as for items). The dependency's own `status` is separate. |
| Track money in a project | Add `"budgets": {}` to `project.json` (with `"currency": "EUR"` etc. if not GBP). Remove it to hide money again; leave the costs in place. |
| Set a budget | Set `budget` (a plain number, no currency symbol) on the item, step, level or world, in a project with `budgets`. Remove the key to go back to adding up what's inside. |
| Log a cost | Set (or raise) `spent` on the item or step it was for. Don't change `status` or `doneAt`. |
| Park a level (someday) | Set `"someday": true` and remove `startedAt`. Never on a cleared level. Bring it back by removing `someday` (and set `startedAt` to now if work is starting). |
| Tick a criterion | Set `done: true` and `doneAt` to the current UTC time (un-ticking removes `doneAt`). If now **every** MVP criterion is done and `clearedAt` is missing, set `clearedAt` to now. If an MVP criterion is un-ticked, remove `clearedAt`. |
| Delete a level | Only when asked. Delete the file **and** remove it from `levelOrder`; remove any `levelRef` pointing at it. Name it with `--allow-delete level:<p>/<w>/<l>`. |
| Delete a step | Remove it from `subtasks` and from its siblings' `dependsOn`; drop the `subtasks` key if it's now empty. |
| Delete a world | Only when asked. Delete the folder's files **and** remove it from `worldOrder` and from other worlds' `unlocksAfter`. Name it with `--allow-delete world:<p>/<w>`. |
| Capture an idea (inbox) | Append `{ id, type, title, notes?, link?, addedAt }` to `items` in `data/inbox.json` (create the file with its `$schema` if missing). `id` unique within the inbox; `addedAt` = now (UTC). |
| Place an inbox idea | Add it to the target level's `items` as a normal item (`"status": "todo"`, fresh id unique in that level, keep `type`, `title`, `notes`, `link`) **and** remove it from `data/inbox.json`, in the **same commit** (`--allow-delete inbox:<id>`). Delete `data/inbox.json` if `items` is now empty. |

Never write `stats`. Never touch other projects when working on one. Never delete or drop
anything the user didn't ask you to.

### When it's not clear where something goes: use the inbox

The inbox exists so nothing gets lost while the user decides where it belongs. **Don't guess and
don't invent structure to hold one item.** Put it in `data/inbox.json` instead when:

- the request doesn't say which project, world or level, and nothing existing is an obvious fit
  (e.g. *"remind me to ring the plumber"* with no plumbing level anywhere);
- it could fit several places equally well;
- it's a quick capture (*"note that…"*, *"add to my list…"*, a pasted link) rather than planning;
- it would need a new project or world that the user hasn't asked for.

Keep the basics the user gave you: a short imperative `title`, the `type` that fits (`task` if
unsure), any detail in `notes`, a URL in `link`. Then tell them: *"I've put 'Ring the plumber'
in your Inbox; open the Inbox page in the app to drop it into a level, or tell me where it goes."*

If there's **one** clear match (a level whose deliverable obviously covers it), add it there
instead and say where you put it. If the user later tells you where an inbox idea belongs, place
it (table above). The app's Inbox page can also turn selected ideas into a new game, world or
level.

### Answering "what should I do next?"

Read the data and answer the way the app's **Today** page does, across all projects:

1. **Running out:** levels with a `startedAt`, not cleared, where `startedAt + timeboxDays` is
   past (overdue) or less than 25% of the time-box remains.
2. **Doing:** items (and dependency steps) with `"status": "doing"` in uncleared levels.
3. **Next up:** in each started, uncleared level, the first must-do item that isn't done or
   dropped, in `dependsOn` order (items with no `dependsOn` first, then file order). If that item
   is a dependency with `subtasks`, name its first open step. For projects with nothing started,
   suggest the first uncleared level of the first world.

Nudge towards finishing what's started and cutting scope (`dropped` is a fine answer).
Skip levels with `"someday": true` everywhere above.

### Running a weekly review

When asked for a weekly review (the app's **Review** page does the same):

1. **Shipped this week:** levels whose `clearedAt` is in the last 7 days, and items/steps whose
   `status` is `done` with a `doneAt` in the last 7 days. Celebrate these first.
2. **Overdue:** started, uncleared levels past `startedAt + timeboxDays`. Offer scope cuts: drop
   the optional items still open (`mvp: false` or `stretch`, not done/dropped) by setting their
   `status` to `dropped`, all in **one commit**; or extend the time-box. The app records an
   extension in `stats.timeboxExtendedDays` and still scores the in-time star against the
   original time-box; since `stats` is app-maintained, suggest the user extends it in the app
   (Review page) rather than editing `timeboxDays` yourself.
3. **Gone quiet:** started, uncleared levels with no activity (latest of `startedAt`, `clearedAt`,
   any `doneAt`) for 14+ days. Offer: keep going, park it (someday), or delete the level.
4. **Next week:** suggest at most 3 levels to focus on. (The app keeps the chosen focus in the
   browser, not in `data/`.)

### Linking the user to things

The app has a link for every screen. Base URL `https://tasks.patrick-mckinley.com/` (or wherever
the user runs it), then:

| Link | Opens |
|---|---|
| `#/p/<project>` | the project map |
| `#/p/<project>/<world>` | a world |
| `#/p/<project>/<world>/<level>` | a level; add `/<item>` to open that item's bubble |
| `#/p/<project>/<world>/<level>/@<dependency>/<step>` | a step inside a dependency |
| `#/~today`, `#/~inbox`, `#/~review` | the Today, Inbox or Weekly review page (add `/~today`, `/~inbox` or `/~review` to any link to hold it up over that screen) |

When the user is reading the app from another repo, it shows that repo only after they've
connected it in ⚙ Settings.

When planning a new project: 2–5 worlds, 1–6 levels per world, under ~10 items per level,
`timeboxDays` realistic but tight, 1–3 MVP criteria per level. Bias hard towards shippable.

## The helper script: `scripts/quest.py`

Standard-library Python 3.8+, no installs. It runs the same checks as the app. **Always use it to
validate.** Use its `pull`/`push` only when you have no GitHub integration of your own (see "How to
reach GitHub"); it's better than hand-written API calls.

```bash
python3 scripts/quest.py update-check                 # 0 = up to date, 3 = newer skill published (§0), 4 = couldn't check
python3 scripts/quest.py validate --refresh DIR       # DIR contains data/; exit 1 lists every issue
python3 scripts/quest.py changes --git origin/main .  # added / changed / removed by id; exit 5 = unnamed removals
python3 scripts/quest.py info --repo OWNER/REPO       # default branch, can_push
python3 scripts/quest.py pull --repo OWNER/REPO [--branch B] --dir quest-data
python3 scripts/quest.py status --dir quest-data      # what changed since pull
python3 scripts/quest.py push --dir quest-data -m "quest: done: Fit units (kitchen/fit/units)"
python3 scripts/quest.py push --dir quest-data -m "..." --pr "Plan the garden project"   # PR instead
python3 scripts/quest.py push --dir quest-data -m "quest: delete level ..." --allow-delete level:p/w/l
```

With your own integration: get the files however your integration does (a clone, a checkout, or
writing **all** of `data/` into a folder as `DIR/data/...`), then `validate --refresh DIR` before
you commit.

Without one: `update-check` → `pull` → edit the JSON files under `quest-data/data/` →
`validate --refresh quest-data` → `push`. `push` makes **one** commit with only the files you
changed, and:

- validates your copy first and refuses invalid data (there is no way to skip this);
- refuses to remove anything that's on the branch unless you name it with `--allow-delete KEY`;
- if the branch has an **open pull request**, merges its base branch into it before committing,
  and stops if they conflict;
- if the branch moved since your pull, validates your changes **combined with** the latest
  files, then commits on top and brings your folder up to date. If someone changed the same files
  it stops and tells you to `pull --force` and re-apply your edits;
- with `--pr`, branches from the base branch's latest commit, not the one you pulled.

The token comes from `GITHUB_TOKEN` (or `GH_TOKEN`); the script never prints it.

Schemas load from the bundled `schemas/` folder, else the cached download, else the manifest
above. `python3 scripts/quest.py schemas` shows which.

Where you are running matters:

| Environment | What to do |
|---|---|
| Claude Code, Codex, a terminal with `git`/`gh` | `update-check`, then clone or use the checkout, `git fetch` and update from the base branch, edit, `validate --refresh`, commit and push (or open a PR) with git. `quest.py pull`/`push` also works if there's no clone. |
| An agent with a GitHub connector/integration (ChatGPT, Claude) | Check `version.json` (§0). Read the latest data and commit through the integration. Run `validate` in code execution on the whole data tree you're about to commit. |
| Claude.ai / Claude apps with code execution, no integration | `update-check` and `validate` always. `pull`/`push` only if the sandbox can reach `api.github.com`; if you get a network error, validate and output the files (§6.6). |
| ChatGPT code interpreter, no integration | No internet in the interpreter: check `version.json` by browsing if you can (§0), unzip the skill, run `validate` on the files you wrote, then output them (§6.6). |

## 6. Talking to GitHub without an integration

Skip this section if you have your own GitHub integration (see "How to reach GitHub").

### Access token

The user supplies a **fine-grained personal access token** limited to their data repo (the one
from "Where the data lives", not necessarily the Quest Log app repo), with:

- **Contents: read & write** (read/write files)
- **Pull requests: read & write** (only if opening PRs)

Handle it as a secret: keep it in an environment variable such as `GITHUB_TOKEN`, send it only in
the `Authorization` header to `https://api.github.com`, never print it, log it, put it in a URL,
commit it, or send it anywhere else. If you have no way to make HTTP requests, don't ask for the
token: output the files instead (§6.6).

All requests below use:

```
Authorization: Bearer $GITHUB_TOKEN
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

Let `R = https://api.github.com/repos/<owner>/<repo>`, where `<owner>/<repo>` is the user's
data repo. Every step below works the same for any repo the token can access.

### 6.1 Read the data

1. `GET R` → `default_branch` (use it unless the user named a branch) and `permissions.push`
   (false = read-only). If `GET R/commits?per_page=1` answers 409, the repo has no commits: ask
   the user to add a README on GitHub first. Don't go by `size`: it can read 0 on a fresh repo
   that does have a commit. A 404 means a wrong `owner/repo` or a token without access to it.
2. `GET R/git/ref/heads/<branch>` → `object.sha` = **HEAD**.
3. `GET R/git/trees/<HEAD>?recursive=1` → keep `type: "blob"` entries whose `path` starts with
   `data/` and ends with `.json`.
4. For each: `GET R/git/blobs/<sha>` with header `Accept: application/vnd.github.raw+json` → file
   text.

### 6.2 Write: one atomic commit (preferred)

Commit all changed files at once so the data is never half-updated. Send only the files you
changed (`base_tree` keeps the rest), and build each one from the copy you read at **HEAD** in
6.1, just before this, with only your edit applied.

1. `GET R/git/commits/<HEAD>` → `tree.sha` = **BASE_TREE**.
2. `POST R/git/trees`
   ```json
   {
     "base_tree": "<BASE_TREE>",
     "tree": [
       { "path": "data/desk-build/frame/cut-legs.json", "mode": "100644", "type": "blob", "content": "<full file text>" },
       { "path": "data/desk-build/frame/old-level.json", "mode": "100644", "type": "blob", "sha": null }
     ]
   }
   ```
   `"sha": null` deletes a file. → response `sha` = **NEW_TREE**.
3. `POST R/git/commits` `{ "message": "quest: <what changed>", "tree": "<NEW_TREE>", "parents": ["<HEAD>"] }`
   → **NEW_COMMIT**.
4. `PATCH R/git/refs/heads/<branch>` `{ "sha": "<NEW_COMMIT>", "force": false }`.
   HTTP 422 means someone else committed first: go back to 6.1, re-apply your change to the fresh
   files, and retry. Never use `"force": true`.

Commit messages: `quest: <verb> <thing> (<project>/<world>/<level>)`, e.g.
`quest: done: Buy 70x70 timber (desk-build/frame/cut-legs)`.

### 6.3 Propose changes as a pull request (for review)

Use this when the user wants to review before it lands. Open PRs that touch `data/` appear in
the app's **Warp Zone**, where they can be explored, validated and merged.

1. **Update first:** `GET R/git/ref/heads/<base>` → **HEAD**, fetched now, just before branching.
   If it differs from the commit you read the data at, read the changed files again (6.1) and
   redo your change on top of them.
2. Validate the whole tree as it will be on the new branch ("Schema validation").
3. `POST R/git/refs` `{ "ref": "refs/heads/quest/<short-name>", "sha": "<HEAD>" }`.
4. Do 6.2 against branch `quest/<short-name>` (parent = HEAD from step 1).
5. `POST R/pulls` `{ "title": "...", "head": "quest/<short-name>", "base": "<base>", "body": "What changed and why" }`.

### 6.4 Add commits to an existing pull request

Always bring the base branch in first.

1. `GET R/pulls/<number>` → `head.ref` (the pull request branch) and `base.ref` (the base).
2. `GET R/compare/<head.ref>...<base.ref>` → if `ahead_by` is more than 0, the base has commits
   the pull request branch doesn't. Then:
   `POST R/merges` `{ "base": "<head.ref>", "head": "<base.ref>", "commit_message": "Merge <base.ref> into <head.ref>" }`.
   - **201**: merged. **204**: already up to date.
   - **409**: conflict. Read both versions of the conflicting files (6.1 on each branch), keep
     the base's version with the pull request's change re-applied on top, validate, and commit
     that as a merge with 6.2: `base_tree` = the base branch's tree, `parents` = `[<PR head>,
     <base head>]`, ref = the pull request branch. If you can't tell what the pull request
     meant, stop and ask the user.
3. Read the data from the pull request branch again (6.1), make your change, validate the whole
   tree, and commit with 6.2 to `<head.ref>`. Never force-push.

### 6.5 curl example

```bash
R=https://api.github.com/repos/OWNER/REPO   # the user's data repo
H=(-H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")
HEAD=$(curl -s "${H[@]}" "$R/git/ref/heads/main" | jq -r .object.sha)
BASE_TREE=$(curl -s "${H[@]}" "$R/git/commits/$HEAD" | jq -r .tree.sha)
TREE=$(jq -n --arg base "$BASE_TREE" --rawfile c cut-legs.json \
  '{base_tree:$base, tree:[{path:"data/desk-build/frame/cut-legs.json", mode:"100644", type:"blob", content:$c}]}' \
  | curl -s "${H[@]}" -X POST "$R/git/trees" -d @- | jq -r .sha)
COMMIT=$(jq -n --arg t "$TREE" --arg p "$HEAD" '{message:"quest: update cut-legs (desk-build/frame/cut-legs)", tree:$t, parents:[$p]}' \
  | curl -s "${H[@]}" -X POST "$R/git/commits" -d @- | jq -r .sha)
curl -s "${H[@]}" -X PATCH "$R/git/refs/heads/main" -d "{\"sha\":\"$COMMIT\",\"force\":false}"
```

### 6.6 No API access

If you can run Python, first run `python3 scripts/quest.py validate --refresh DIR` on the whole
data tree with your changes and fix every issue; otherwise check by hand (§7) and say so. Then output each file as its own fenced `json` block preceded by its path, e.g.
`data/desk-build/frame/cut-legs.json`, containing the **complete** file. Also list files to
delete. The user can commit them or paste them into a pull request.

## 7. Before you commit: checklist

Every time, whatever the route:

- [ ] You checked for a newer skill at the start (§0), and are following the latest one.
- [ ] You updated from the base branch just before: a new pull request branches from its latest
      commit, and an existing pull request has the base branch merged in ("Branches and pull
      requests").
- [ ] `python3 scripts/quest.py validate --refresh DIR` passed (`✓ … valid`, exit 0) on the
      **whole** data tree as it will be after your commit, and you told the user.
- [ ] Every value the schema limits (enums, patterns, ranges) was checked against the current
      schema, not remembered.
- [ ] Your change removes nothing the user didn't ask to remove (`quest.py changes`), and you
      added new worlds and levels as new files without rewriting shared ones.

`validate` checks all of the following for you. Without Python, check every box by hand against
https://tasks.patrick-mckinley.com/schema/quest.schema.json, and tell the user you did:

- [ ] Every file is under `data/<project>/…` with the right name, and its `id` matches.
- [ ] `worldOrder` / `levelOrder` only name worlds / levels that exist (leaving new ones out is fine).
- [ ] Every file has the correct `$schema` and no fields beyond the tables above.
- [ ] Ids are kebab-case and unique in scope (items and criteria within a level).
- [ ] Every level has ≥1 criterion with `"mvp": true`.
- [ ] `dependsOn` only names items in the same level, with no cycles.
- [ ] `levelRef` and `goalIds` / `unlocksAfter` point at things in the same project.
- [ ] `subtasks` only on dependencies without `levelRef`; no dependency steps; step `dependsOn` names sibling steps.
- [ ] Inbox ideas have only `id`, `type`, `title`, `notes`, `link`, `addedAt`, with unique ids; a placed idea is removed from `data/inbox.json` in the same commit.
- [ ] `budget` / `spent` are plain non-negative numbers (`49.99`, not `"£49.99"`); costs only in projects with `budgets`, whose `currency` is a 3-letter code like `EUR`.
- [ ] `stats` untouched; timestamps are UTC ISO 8601 (`2026-10-01T09:00:00Z`).

## 8. Optional: CI in the user's own repo

To have GitHub check every change, the user can add `.github/workflows/quest.yml`:

```yaml
name: Quest data
on: [push, pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: curl -sfo quest.py https://tasks.patrick-mckinley.com/skills/quest-log/scripts/quest.py
      - run: python3 quest.py validate .
      - name: What this pull request removes
        if: github.event_name == 'pull_request'
        run: |
          git fetch --depth=1 origin "${{ github.base_ref }}"
          python3 quest.py changes --git "origin/${{ github.base_ref }}" . --warn
```

It downloads the schemas through the manifest and runs the same schema, folder and
cross-reference checks as the app. On pull requests it also lists everything the change adds,
changes and removes, so a reviewer can spot an accidental deletion.
