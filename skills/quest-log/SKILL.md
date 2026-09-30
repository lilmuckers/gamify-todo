---
name: quest-log
description: Read, create and update Quest Log project data (a gamified project tracker) stored as JSON files in a GitHub repository, using the GitHub REST API with a personal access token. Use when asked to plan a project into worlds/levels/tasks, add or update tasks, mark work done, or open a pull request with Quest Log changes.
---

# Quest Log data skill

Quest Log shows projects as a Mario-style platformer. All state is plain JSON files in a GitHub
repository. Any repo works: the user does not need a copy of the Quest Log code, only a `data/`
folder. The web app (https://tasks.patrick-mckinley.com) reads and writes those files.

Follow this document exactly. Files that break the rules are rejected by the app and by CI.

## 1. Concepts

| Level of the tree | Game meaning | Real meaning |
|---|---|---|
| **Project** | A separate game/map | A completely unrelated effort: "House renovation", "Desk build", "Work launch". Projects never reference each other. |
| **World** | An island on the project's map | One theme or area inside the project: "Kitchen", "Payments". |
| **Level** | One course in a world | ONE key deliverable, with a time-box and success criteria. |
| **Item** | Things in the course | Tasks, blockers, dependencies, risks, decisions, milestones, stretch goals. |

A level is **cleared** when every success criterion marked `"mvp": true` is `"done": true`.
Nothing else gates it. The whole point is "good enough, then move on": keep MVP criteria to the
1–3 checks that truly matter, and put polish into non-MVP criteria or `stretch` items.

## 2. Folder layout

```
data/
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
- `project.json` → `worldOrder` lists **exactly** the world folders in that project.
- `world.json` → `levelOrder` lists **exactly** the level files in that folder.
- A level id may not be `world` (that name is the world file).
- No other `.json` files anywhere under `data/`.
- Files are UTF-8 JSON, 2-space indent, trailing newline.

## 3. Schemas

Put the matching `$schema` URL at the top of every file:

| File | `$schema` |
|---|---|
| `project.json` | `https://tasks.patrick-mckinley.com/schema/project.schema.json` |
| `world.json` | `https://tasks.patrick-mckinley.com/schema/world.schema.json` |
| `<level-id>.json` | `https://tasks.patrick-mckinley.com/schema/level.schema.json` |

Full definitions (JSON Schema 2020-12, `additionalProperties: false` everywhere — **no extra
fields**): https://tasks.patrick-mckinley.com/schema/quest.schema.json. Fetch it if unsure.

### Project (`data/<project-id>/project.json`)

| Field | Required | Type | Notes |
|---|---|---|---|
| `id` | ✓ | id | = folder name |
| `title` | ✓ | string ≤120 | |
| `description` | | string ≤4000 | |
| `goals` | ✓ | `{id, title, description?}[]` | 1–5 key outcomes |
| `worldOrder` | ✓ | id[] | world folders, in map order |

### World (`data/<project-id>/<world-id>/world.json`)

| Field | Required | Type | Notes |
|---|---|---|---|
| `id` | ✓ | id | = folder name |
| `name` | ✓ | string ≤120 | |
| `description` | | string | |
| `theme` | ✓ | `grass` \| `desert` \| `water` \| `ice` \| `sky` \| `castle` | grass = general, desert = long slog/infra, water = research, ice = cleanup, sky = vision/design, castle = launch/high stakes |
| `goalIds` | ✓ | id[] | goal ids from this project's `project.json` |
| `unlocksAfter` | | id[] | other worlds in this project to finish first (visual only) |
| `levelOrder` | ✓ | id[] | level files, in play order |

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
| `successCriteria` | ✓ | Criterion[] (1–20) | at least one with `mvp: true` |
| `items` | ✓ | Item[] (≤200) | may be empty |
| `stats` | | object | **app-maintained; never write or change it** |

Criterion: `{ "id", "text" (≤280, observable/testable), "mvp": boolean, "done": boolean }` — all
four required.

Item:

| Field | Required | Notes |
|---|---|---|
| `id` | ✓ | unique within the level |
| `type` | ✓ | see below |
| `title` | ✓ | ≤120, imperative for tasks |
| `status` | ✓ | `todo` \| `doing` \| `done` \| `dropped` |
| `mvp` | | default `true` (on the critical path). Set `false` for optional items. Omit for `stretch`. |
| `dependsOn` | | ids of items **in the same level** that come first; no cycles |
| `levelRef` | | dependency items only: `"<world-id>/<level-id>"` in the **same project** |
| `link` | | URL to a ticket/doc/PR |
| `notes` | | free text / markdown |

Item types: `task` (work you do), `deliverable` (milestone inside the level), `blocker` (something
stopping progress), `dependency` (needed from elsewhere), `risk` (might go wrong; `done` =
mitigated/accepted), `decision` (open question), `stretch` (nice-to-have; never blocks, never
earns stars). `dropped` is a good status: cutting scope is encouraged.

## 4. Example files

`data/desk-build/project.json`
```json
{
  "$schema": "https://tasks.patrick-mckinley.com/schema/project.schema.json",
  "id": "desk-build",
  "title": "Standing desk build",
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
    { "id": "buy-timber", "type": "task", "title": "Buy 70x70 timber", "status": "todo" },
    { "id": "saw-choice", "type": "decision", "title": "Hand saw or borrow mitre saw?", "status": "todo" },
    { "id": "cut", "type": "task", "title": "Cut four legs", "status": "todo", "dependsOn": ["buy-timber", "saw-choice"] },
    { "id": "wonky-cuts", "type": "risk", "title": "Uneven cuts", "status": "todo", "mvp": false },
    { "id": "chamfer", "type": "stretch", "title": "Chamfer the feet", "status": "todo" }
  ]
}
```

## 5. Changing data correctly

Always read the current files first, change the minimum, and keep the rest byte-for-byte.

| To… | Do this |
|---|---|
| Add a project | Create `data/<p>/project.json` with `worldOrder: []` and at least one goal. |
| Add a world | Create `data/<p>/<w>/world.json` (`levelOrder: []`) **and** append `<w>` to `worldOrder` in `project.json`. |
| Add a level | Create `data/<p>/<w>/<l>.json` **and** append `<l>` to `levelOrder` in `world.json`. |
| Add an item | Append to `items` in the level file with a new unique id and `"status": "todo"`. |
| Start work | Set item `status` to `doing`. If the level has no `startedAt`, set it to the current UTC time. |
| Finish work | Set item `status` to `done` (or `dropped` to cut it). |
| Tick a criterion | Set `done: true`. If now **every** MVP criterion is done and `clearedAt` is missing, set `clearedAt` to now. If an MVP criterion is un-ticked, remove `clearedAt`. |
| Delete a level | Delete the file **and** remove it from `levelOrder`; remove any `levelRef` pointing at it. |
| Delete a world | Delete the folder's files **and** remove it from `worldOrder` and from other worlds' `unlocksAfter`. |

Never write `stats`. Never touch other projects when working on one.

When planning a new project: 2–5 worlds, 1–6 levels per world, under ~10 items per level,
`timeboxDays` realistic but tight, 1–3 MVP criteria per level. Bias hard towards shippable.

## 6. Talking to GitHub

### Access token

The user supplies a **fine-grained personal access token** limited to the one data repo, with:

- **Contents: read & write** (read/write files)
- **Pull requests: read & write** (only if opening PRs)

Handle it as a secret: keep it in an environment variable such as `GITHUB_TOKEN`, send it only in
the `Authorization` header to `https://api.github.com`, never print it, log it, put it in a URL,
commit it, or send it anywhere else. If you have no way to make HTTP requests, don't ask for the
token: output the files instead (§6.5).

All requests below use:

```
Authorization: Bearer $GITHUB_TOKEN
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

Let `R = https://api.github.com/repos/<owner>/<repo>`.

### 6.1 Read the data

1. `GET R` → `default_branch` (use it unless the user named a branch). `size: 0` means the repo
   has no commits: ask the user to add a README on GitHub first.
2. `GET R/git/ref/heads/<branch>` → `object.sha` = **HEAD**.
3. `GET R/git/trees/<HEAD>?recursive=1` → keep `type: "blob"` entries whose `path` starts with
   `data/` and ends with `.json`.
4. For each: `GET R/git/blobs/<sha>` with header `Accept: application/vnd.github.raw+json` → file
   text.

### 6.2 Write: one atomic commit (preferred)

Commit all changed files at once so the data is never half-updated.

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

1. `POST R/git/refs` `{ "ref": "refs/heads/quest/<short-name>", "sha": "<HEAD>" }`.
2. Do 6.2 against branch `quest/<short-name>` (parent = HEAD from step 1).
3. `POST R/pulls` `{ "title": "...", "head": "quest/<short-name>", "base": "<default branch>", "body": "What changed and why" }`.

### 6.4 curl example

```bash
R=https://api.github.com/repos/OWNER/REPO
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

### 6.5 No API access

Output each file as its own fenced `json` block preceded by its path, e.g.
`data/desk-build/frame/cut-legs.json`, containing the **complete** file. Also list files to
delete. The user can commit them or paste them into a pull request.

## 7. Before you commit: checklist

- [ ] Every file is under `data/<project>/…` with the right name, and its `id` matches.
- [ ] `worldOrder` / `levelOrder` list exactly the worlds / levels that exist.
- [ ] Every file has the correct `$schema` and no fields beyond the tables above.
- [ ] Ids are kebab-case and unique in scope (items and criteria within a level).
- [ ] Every level has ≥1 criterion with `"mvp": true`.
- [ ] `dependsOn` only names items in the same level, with no cycles.
- [ ] `levelRef` and `goalIds` / `unlocksAfter` point at things in the same project.
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
      - run: |
          for k in quest project world level; do
            curl -sfo "$k.schema.json" "https://tasks.patrick-mckinley.com/schema/$k.schema.json"
          done
          validate() { npx -y -p ajv-cli@5 -p ajv-formats@3 ajv validate --spec=draft2020 -c ajv-formats -r quest.schema.json -s "$1" -d "$2"; }
          shopt -s nullglob
          for f in data/*/project.json; do validate project.schema.json "$f"; done
          for f in data/*/*/world.json; do validate world.schema.json "$f"; done
          for f in data/*/*/*.json; do [ "$(basename "$f")" = world.json ] || validate level.schema.json "$f"; done
```

This checks each file against the schema; the app additionally checks the folder and
cross-reference rules from §2 and §7 when it loads or reviews the data.
