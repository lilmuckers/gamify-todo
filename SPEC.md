# Quest Log: product and technical spec

Status: current as of 3 October 2026 (`main` at PR #84). This document describes what the app
**is and does today**, plus the agreed backlog (§16). Where it and the code disagree, the code
wins. Please fix this file.

Related docs: [`README.md`](README.md) (user-facing), [`CLAUDE.md`](CLAUDE.md) (working in the
repo), [`schema/README.md`](schema/README.md) (data format),
[`skills/quest-log/SKILL.md`](skills/quest-log/SKILL.md) (LLM data skill).

---

## 1. Purpose

Quest Log is a project tracker you play. It shows real projects as a retro, Mario-style
side-scrolling platformer, and its job is to **beat perfectionism**: ship the good-enough
version of each deliverable, then move on.

- **Owner:** Patrick McKinley (`lilmuckers`). Repo: `lilmuckers/gamify-todo`.
- **Live site:** `https://tasks.patrick-mckinley.com` (GitHub Pages, custom domain). Schemas and
  the skill are also published there.
- **Users:** the owner first, then household members and friends (non-developers too) who keep
  their own data repo. LLM assistants (Claude, ChatGPT) are first-class editors of the data.
- **Company:** FiftyPIFS ("fifty penguins in fuzzy socks"), the owner's company. Its logo (a
  pixel penguin in fuzzy socks) and wordmark make up the boot splash shown while the app loads.

### Design principles

1. **Flagpole = MVP.** A level clears when its MVP success criteria are ticked. Nothing else
   gates it, and once it clears, leftover items stop blocking.
2. **Scope cuts are always free and encouraged.** Dropping is a good status.
3. **Polishing a finished thing costs you.** That cost is the polish penalty.
4. **Plain data in git.** One small JSON file per level, schema-validated, readable and writable
   by humans, LLMs and CI. No backend database.
5. **Works everywhere:** read-only on Pages, editable with a token, offline on a phone, or as a
   local Docker editor.
6. **Original art, drawn in code.** No Nintendo assets.
7. **Private by default.** Analytics never carry user content, and the token only ever goes to
   `api.github.com`.
8. **Inclusive and playful.** There are 18 diverse heroes, each with their own voice, and
   reduced motion is respected everywhere.

---

## 2. Glossary

| Term | Game meaning | Real meaning |
|---|---|---|
| Project | A game cartridge / its own overworld | A self-contained effort ("Kitchen renovation"). Projects never reference each other. |
| Goal | Shown on the overworld | 1–5 key outcomes of a project |
| World | An island on the project map | A theme inside a project ("Kitchen", "Payments") |
| Level | A course in a world | ONE key deliverable with a time-box and success criteria |
| Item | Things in the course | Task, deliverable, blocker, dependency, risk, decision, stretch |
| Success criterion | A stair step up to the flagpole | An observable check. MVP = must-do; non-MVP = bonus |
| Sub-level | Underground bonus area via warp pipe | A dependency's own steps (`subtasks`) |
| Cheat code | e.g. `3-2` | World 3, level 2: a short label used on Today |
| Legal pad | Pad the hero holds up | Overlay with three pages: Today, Inbox, Weekly review |
| Warp Zone | Purple cartridge | Pull-request review |
| Someday shelf | — | Parked levels, off Today and the review |

---

## 3. Data model

All state lives under `data/` in a GitHub repo. It can be this repo or any repo the user
chooses. The data needs no app code.

```
data/settings.json                       optional, repo-wide (default hero)
data/inbox.json                          optional, captured ideas not yet placed
data/<project-id>/project.json           goals + worldOrder
data/<project-id>/<world-id>/world.json  theme, goalIds, unlocksAfter, levelOrder
data/<project-id>/<world-id>/<level-id>.json
```

There is one file per level, so ticking a task rewrites one small file. That keeps commits, diffs
and PRs small and makes conflicts rare.

The schemas are JSON Schema 2020-12 with `additionalProperties: false` throughout and a
description on every field and enum value. `schema/quest.schema.json` holds every `$def`. The
per-file schemas (`project`, `world`, `level`, `settings`, `inbox`) `$ref` it, and
`schema/index.json` is the manifest. Data files carry
`$schema: https://tasks.patrick-mckinley.com/schema/<kind>.schema.json`.

### 3.1 Entities

**Id:** `^[a-z0-9]+(-[a-z0-9]+)*$`, max 64 characters, derived from names and never renamed.

**Project:** `id`, `title` (≤120), `description?` (≤4000, markdown), `budgets?` (`{currency?,
alerts?, alertAt?}`: turns cash budgets on), `goals[]` (`{id, title, description?}`, 1–5),
`worldOrder[]`.

**World:** `id`, `name`, `description?`, `theme`, `goalIds[]`, `unlocksAfter?[]`, `budget?`,
`levelOrder[]`.

| Theme | Look | Use for |
|---|---|---|
| `grass` | Green hills | General (default) |
| `desert` | Sand, pyramids | Long slogs, infrastructure |
| `water` | Ocean | Research, discovery |
| `ice` | Snow | Cleanup, hardening, maintenance |
| `sky` | Clouds | Vision, design |
| `castle` | Lava castle | Launches, high stakes |

`unlocksAfter` draws the map's branches. It is purely visual: a locked world is still editable.

**Level:** `id`, `name`, `deliverable` (≤280, one sentence), `description?`, `timeboxDays`
(1–90), `startedAt?`, `clearedAt?`, `someday?`, `budget?`, `successCriteria[]` (1–20, at least one
with `mvp: true`), `items[]` (≤200), `stats?` (app-maintained).

**Criterion:** `{id, text (≤280), mvp, done}`, all required.

**Item:** `id`, `type`, `title`, `status`, `doneAt?`, `mvp?` (default true; ignored for
stretch), `dependsOn?[]` (same level; shown in the UI as **"Waits for"**), `levelRef?`
(dependency only: `"<world>/<level>"` in the same project), `subtasks?[]` (dependency only;
never together with `levelRef`), `budget?`, `spent?`, `link?`, `notes?`.

| Type | Sprite | Behaviour |
|---|---|---|
| `task` | `?` block | Completing it pops a coin |
| `deliverable` | Checkpoint flag | Milestone inside the level |
| `blocker` | Brick wall | Hero can't pass until done/dropped |
| `dependency` | Plain: pipe + piranha plant. `levelRef`: **cloud** the hero rides to that level. `subtasks`: **warp pipe** to a sub-level | See §5.4 |
| `risk` | Patrolling critter | `done` = mitigated/accepted |
| `decision` | Signpost | Hero waits until decided |
| `stretch` | Floating coins | Never blocks, never earns stars |

**Status:** `todo` | `doing` | `done` | `dropped`.

**Subtask:** like an item, except the type can't be `dependency` (no nesting), and `dependsOn`
stays among sibling steps. Steps can have `budget?` and `spent?` too.

**Money** (`Money` in the schema): a plain number, 0 to 1,000,000,000, in the project's currency,
in whole units with up to 2 decimals. All of it is optional; see §4.1 for how it rolls up.

**LevelStats** (app-maintained; tools must not write it): `editsAfterClear`,
`itemsAddedAfterClear`, `itemEdits{ itemId | "dep/step": n }`, `timeboxExtendedDays`.

**Settings:** `{ hero? }` is the repo-wide default hero.

**Inbox:** `{ items: InboxItem[] }`, where each item is `{id, type, title, notes?, link?,
addedAt}`.

### 3.2 Rules beyond the schema

These are enforced by `shared/src/validate.ts`, `npm run validate`, the server, CI and `quest.py`:

- Folder and file names equal ids, and `world` is a reserved level id.
- `worldOrder` and `levelOrder` only name folders/files that exist. Ones left out go after the
  listed ones, sorted by id, and are written into the list on the next save. This keeps adding a
  world or level to a single new file, so parallel pull requests that add them never conflict.
- No other `.json` files under `data/` except `settings.json` and `inbox.json` at the root.
- Ids are unique in scope. `dependsOn` stays within its level (or within a dependency's steps),
  with no cycles.
- `levelRef`, `goalIds` and `unlocksAfter` resolve within the same project, and a level can't
  `levelRef` itself.
- `subtasks` only appear on dependencies, never together with `levelRef`.
- Each level has at least one MVP criterion.
- `doneAt` is present only on done items and steps. Tools set it when marking something done and
  remove it on reopen.
- `someday: true` means no `startedAt`, and is never set on a cleared level.
- Files are UTF-8, 2-space indent, with a trailing newline. The canonical format is
  `npm run format:data`.

### 3.3 Example data

`data/` ships five example projects (90 files): `customer-portal` (work launch),
`home-maintenance`, `bike-restoration`, `allotment` and `kitchen-renovation`. They power the
read-only Pages site, the demo and the tour.

---

## 4. Scoring and anti-perfectionism

Defined in `shared/src/scoring.ts`.

- **Timer** (from `startedAt`): phases `not-started` → `on-track` → `hurry` (< 25% left) →
  `overdue` → `cleared`.
- **Cleared:** every MVP criterion is done. `clearedAt` is stamped the first time.
- **Stars (max 3):** ★ cleared, ★ cleared within the *original* time-box, ★ no polish. Stretch
  goals never give stars.
- **XP:** `max(10, round(100 + 100 × fractionOfTimeLeft − 15 × polishPoints))`, only when
  cleared. The time bonus uses the original time-box, so extensions don't buy it back.
- **Coins:** 1 per done item, 3 per done stretch, 2 per done bonus criterion.
- **Polish points** = `editsAfterClear + itemsAddedAfterClear + Σ max(0, itemEdits − 3)`.
  Editing a cleared level, adding scope after clearing, or editing a done item more than 3 times
  costs points. A toast says "Perfectionism detected 🐢". **Scope cuts never count**: deleting
  items or criteria, dropping an item, or parking a level.
- **Nudges** (shown in the level panel): win; still polishing extras; time-box blown → names up
  to 3 optional items to drop; under 25% left; all critical items done → tick the criteria;
  more than 5 MVP criteria ("which 3 truly matter?"); more than 15 MVP items ("split it?").
- **Map state:** a level node is cleared, in-progress, open (first in its world or previous one
  cleared) or locked. Locks are soft, and locked levels stay enterable.
- **Suggest next:** finish started (non-someday) levels first, then the first uncleared level in
  an unlocked world.

### 4.1 Budgets and savings

Defined in `shared/src/budget.ts`. Each item, level, world and project has a `Cost`:

- **Budget:** its own `budget` if set, otherwise the sum of the budgets below it (a dependency's
  steps, a level's items, a world's levels, a project's worlds). An own budget smaller than the
  parts below it gets a warning ("The parts below plan…").
- **Spent:** its own `spent` (items and steps only) plus everything spent below it.
- **Left:** budget − spent. Going negative shows "Over budget by…" in the panel.
- **Saved:** banked when a thing **settles**: an item done or dropped, a level cleared, a world
  with every level cleared. Then it's budget − spent (negative if over). Until then it's the sum
  of what its settled children banked. Dropping a budgeted item banks all of it that wasn't
  spent, so scope cuts save money too. A cleared level banks its leftover allowance.
- **Not polish:** an `updateItem` or `updateLevel` that only changes `budget`/`spent` never
  counts towards the polish penalty, even after clearing, because receipts often arrive after the
  work is done. Values are compared, so a full-form save that only changed the cost is still free.
- Amounts are rounded to pennies and shown with `Intl.NumberFormat` ("£1,200", "£49.99").
- **Opt-in:** all of this is off unless the project has `budgets` (`budgetPrefs()`). Off, the
  panels, bubble and forms show no money, and form saves leave any cost data in the files alone,
  so turning it back on brings it back. `currency` defaults to GBP.
- **Alerts** (`budgetAlerts()`): after an `addItem`, `updateItem`, `updateLevel` or `updateWorld`
  in a project with `budgets.alerts` not `false`, the app compares the project before and after.
  Anything (item, step, level, world) that got worse shows in one toast: a **heads-up** once
  `alertAt`% (50–100, default 90) of its budget is spent while it's still open, and **over
  budget** once spent passes the budget. Things already at that level don't alert again, and
  undo never alerts. The money box turns gold past the heads-up point and red when over, with a
  matching note.

---

## 5. Screens and interactions

There is a desktop layout (Phaser game + side panel + HUD) and a mobile layout (DOM screens +
static level strip + bottom tab bar). Mobile is used automatically under 768px wide or on short
touch screens, and can be overridden in Settings or with `?mobile=on|off`.

### 5.1 Routing (hash-based, every screen shareable)

```
#/                                        project select
#/p/<project>                             project map (overworld)
#/p/<project>/<world>                     world map
#/p/<project>/<world>/<level>[/<item>]    level (item bubble open)
#/p/<project>/<world>/<level>/@<dep>[/<step>]   dependency sub-level
#/prs                                     Warp Zone (PR list)
#/pr/<n>[/<project>/<world>/<level>[/@<dep>][/<item>]]   PR review
…/~today  …/~inbox  …/~review             legal pad page held up over any screen
#/today, #/review                         short forms
```

Query flags: `?demo`, `?tour`, `?welcome`, `?mobile=`, `?jam` (for testing: one of every
jammable thing on the bedroom floor, and all of them go in the console) and `?jamzoom` (the
camera closes in on the console while a thing goes in; off by default while it's tried out).
Android share-target params are `share-title`, `share-text` and `share-url`.

### 5.2 Project select: the bedroom floor

A top-down bedroom with a carpet, a console at a jaunty angle, a controller, a TV on the wall,
and **cartridges** for each project. Each cartridge label shows totals. There are also a purple
**Warp Zone** cartridge (with its PR count) and a **Blank cartridge** (new project). The project
you last opened sits just right of the console. Picking a cartridge inserts it, the console boots
and the camera pans up to the TV.

- **Clutter**: socks, snack bags, crumbs, spills, pizza, comics, cassette, banana, rubber duck,
  donut, teddy, yo-yo and a pick-your-path fantasy gamebook, laid out randomly each visit.
  Hovering (or tapping) lifts an item and it mutters a quip.
- **Easter egg (#56):** each visit, one non-game thing is "jammable" ("…wonder if it fits?").
  Clicking it plays a bit of comedy per kind at the console, with pop-up sound words
  (the sock is dangled then stuffed in, the snack bag upended for crumbs, the can shaken until
  it fizzes out of the slot, the tape ejected once, the controller yanked back by its own cable,
  and so on). Then it squashes in and the console boots to a silly TV title screen. Each kind
  has five screen variants (its own, plus kart racer, shooter, fighter, falling blocks, RPG
  battle, platformer or quiz show), for example SOCK QUEST, PIZZA KART or QUACK QUIZ. The
  gamebook boots to its own dungeon map or an open page ("TURN TO 400"), or rolls for a quest.
  An SNES-style dialogue box then types the hero's reaction in their own voice: 18 heroes × every
  kind × 5 lines, with a mood emote and keyword highlight, and no line repeats twice running.
  Closing it ejects the thing. Esc, gamepad B or clicking away resets it.

### 5.3 Overworld and world maps

- **Overworld:** the project's goals plus its worlds as themed islands, laid out by
  `unlocksAfter` (`shared/src/worldmap.ts`). Each world sits one column right of its deepest
  prerequisite, with an edge per dependency.
- **World map:** the levels in `levelOrder` as nodes showing cleared/in-progress/open/locked
  state and stars.
- `[` / `]` step to the previous/next world or level, and Esc goes up.

### 5.4 Level

The layout comes from `shared/src/layout.ts` (tiles), which the scene, the play physics and the
mobile strip all share.

- Items go left → right by their longest `dependsOn` chain. Decoration is seeded per level, so
  it stays stable.
- The **hero auto-walks** to the first unfinished must-do item (the "next stop") and waits there.
- **Flagpole stairs (#55):** one step per success criterion, in order, before the pole. Must-do
  steps are grey until ticked, then lit. Bonus steps are pink and see-through. Labels sit in the
  dirt. Past 8 criteria the climb spreads out instead of getting taller. Clicking a step opens a
  **TICK! / UNTICK** bubble, and the hero hops onto it. Ticking the last must-do step sends him
  leaping onto the pole at his current height; he slides down as the flag rises and runs into
  the castle.
- **Money:** the level panel shows a 💰 box (spent of budget, a bar, what's left and saved) under
  the timer, and item rows carry a cost tag. The bubble adds a line such as "£35 OF £40 · £5 SAVED".
  World, project map and project list panels show the same roll-up. Budgets are set in the item,
  level and world forms. The project form's *Track cash budgets* tick turns them on, with the
  currency, alerts and heads-up percentage.
- **Item bubbles:** clicking an item opens a speech bubble with its details and actions:
  **DONE!**, **START**, **EDIT** and, for dependencies, **WARP IN** (warp pipe) / **HOP ON**
  (cloud) / **GOT IT!** (close) / **JUMP OVER** (skip) / **ADD STEPS** (turn a plain one into a
  warp pipe). The bubble auto-shows at the hero's stop, and deep links open it directly.
- **Warp pipe sub-level:** an underground level holding the dependency's steps, with an exit
  pipe. **GOT IT! WARP UP** (once the steps are clear) brings the hero back up with the
  dependency done. **WARP UP** just leaves.
- **Cloud:** the hero rides it to the referenced level. The cloud parks before that level's
  first item, labelled **BACK TO** the level he came from: **RIDE BACK** (or the panel's "Ride
  the cloud back" link, or down on it in play mode) floats him home on the dependency's own
  cloud, with its bubble open. It waits while you stay in that level (sub-levels included) and
  is gone once you go anywhere else, or reload.
- **Side panel (desktop):** level details, timer, score, nudges, items and criteria lists,
  quick-add (keeps focus so you can add item after item), and forms for items, criteria, the
  level, the world, goals and the project. The "Waits for" picker shows each candidate's status
  as a tag.
- **Undo:** most edits show an **UNDO** toast for 6 seconds (Ctrl/Cmd+Z works too). Only the
  latest toast can be used. An unsynced edit is retracted (no commit, no polish). A synced one is
  reversed with an inverse op: deleting an item restores it at its old position with its steps
  and the items that waited for it, and a reopened item gets its original `doneAt` back.

### 5.5 Play mode (#53, desktop only)

Press **P** (or the play button) to steer the hero with the keyboard or a gamepad (Gamepad API,
standard mapping) instead of letting him auto-walk.

- Pure physics live in `app/src/game/play/physics.ts` (Phaser-free, unit-tested). Keys are
  arrows/WASD to move, Space/Z to jump, X/Shift to run, Up to pick a bubble, Down to enter a
  pipe or cloud, **E/Y for look mode**, Esc/B to back out, and Start/Select to quit. Taps are
  latched, so quick presses aren't missed.
- Bumping a `?` block from below, stomping a critter or grabbing coins marks that item done.
  Unresolved walls are solid, and piranhas and critters knock you back.
- **Stairs:** landing on a step ticks it (once per landing). Bonus steps can be jumped over. An
  un-ticked must-do step walls off everything past it. Touching the pole with must-dos left
  **whacks** you back with a line (no damage, and never the same line twice running).
- **Look mode:** the bubble follows the nearest item ahead. While playing, bubbles are compact
  and their buttons only show when picking.
- **Held edits:** edits made while playing don't sync. When play ends (stopped, 2 minutes idle,
  level cleared, or leaving the level) a summary lists every change, all ticked. Commit sends the
  ticked ones and retracts the rest. The summary can't be dismissed. Held edits persist, so
  closing the tab mid-game warns you and shows the summary on the next load.
- Pipe arrivals finish their animation before play takes over (#74).
- In read-only views play mode animates but saves nothing.

### 5.6 The legal pad: Today, Inbox, Weekly review

The hero holds up a yellow legal pad over whatever screen you're on. It is written in a
handwriting font (Caveat), and its pages are Post-it index flags on the right edge. On phones it
is the first thing you see.

**Today** (`t`, TODAY button). Built by `shared/src/today.ts`:
1. This week's **focus** levels (from the review) first.
2. **Running out of time**: hurry/overdue levels with the MVP criteria left.
3. **In progress**: every `doing` item and step.
4. **Next up**: where the hero is waiting in each started or focus level, plus a suggested
   starting point for projects with nothing on the go.

Lists are sorted by focus, timer phase, time left, then project. Each line shows its level's
cheat code circled and deep-links to the item or step, and its checkbox marks it done. Someday
and cleared levels are excluded.

**Inbox** (`i`; `n` opens it ready to write). This is quick capture with no decision about where
things go.
- A scribble line jots an idea. Tap an idea to edit its basics, or cross it out.
- Multi-select with a highlighter, then place the selection based on the screen behind the pad:
  **New game** (project list), **New world** (project map), **New level** (world map), or **Add
  to this level / as steps**. Placing turns ideas into `todo` items with fresh ids in one commit
  (`inboxPlace`).
- **Android share target:** sharing text or a link to the installed PWA drops it in the inbox.
  iOS doesn't support this.
- The HUD INBOX button shows a count.

**Weekly review** (`w`, REVIEW button). Built by `shared/src/review.ts`. The REVIEW button (with
a badge) appears once the slot is due: Friday afternoon by default, or Monday morning, Sunday
evening or off in Settings. The review has four sections:
- **Shipped this week**: levels cleared and items/steps done in the last 7 days, with stars and
  XP. It uses `doneAt`, so it works offline and in read-only views.
- **Overdue**: one-tap scope cuts. *Drop the optional items* drops them all in one free commit.
  *Extend +1/3/7 days* adds `stats.timeboxExtendedDays`, but the star and bonus are still scored
  against the original time-box.
- **Gone quiet**: started levels with no activity for 14+ days. Options are keep, **someday
  shelf** (clears `startedAt`; real progress unparks it and restarts the clock) or drop the
  level.
- **Next week**: pick up to 3 focus levels, which lead Today.

**Review done** stamps it until the next slot. The schedule, last review time and focus levels
live in this browser's `localStorage`, not in the repo.

### 5.7 HUD

The HUD shows the QUEST LOG title, XP/coins/stars totals, the sync status pill, **TODAY**,
**INBOX** (count), **REVIEW** (when due), **AI SKILL**, ⚙ Settings, ⇪ Publish (Docker editor
only) and a "DEMO · NOT SAVED" badge in the demo. On desktop, floating game-nav buttons over the
canvas give ▲ up, ◀ ▶ prev/next and Play.

### 5.8 Mobile

- Bottom **tab bar**: Projects / Map / Next / Today / Inbox / Warp / Settings, pinned to the
  bottom edge and clear of the home indicator.
- DOM screens: project list, island maps, and a horizontally scrolling **level strip** image
  (stairs included) above the panel.
- Fields are ≥16px on touch (no iOS zoom). Overlays respect safe-area insets (notch, Dynamic
  Island).
- There is no play mode on phones.

### 5.9 Settings (⚙)

- **Your hero:** an 18-hero carousel. The choice is kept in this browser. When the data is
  editable it is also saved to `data/settings.json` as everyone's default.
- **GitHub** (builds with sign-in): **Sign in with GitHub**; once signed in, the repo in use,
  **Change repo** (the repo picker), **Sign out** and a link to revoke the App on GitHub. An
  expired sign-in shows **Sign in again** and the number of edits it is holding.
- **GitHub connection:** repo `owner/repo`, optional branch (blank = default branch) and a
  fine-grained token, with a read-only/editable status line. With sign-in available it folds
  into "Use a token instead".
- **New here?:** reopen the welcome screen, tour or set-up guide.
- **Display:** layout auto (by screen size) / full game view / compact.
- **Weekly review:** Fri / Mon / Sun / off.
- **Privacy:** analytics toggle.
- **Sync:** source, status, last synced, pending ops, conflicts (skipped queued edits),
  discard outbox.
- **Data issues:** validation problems in the loaded data.
- **Publish** (Docker): branch, ahead/behind, last commit.

### 5.10 Warp Zone: PR review

Open PRs that touch `data/` appear as **Warp Worlds** showing only the changed levels.

- New items glow green, changed items are marked `!` with a field-by-field diff, and removed
  items are ghosted (`reviewLevel` appends base-only entries).
- The panel shows browser-side schema validity, CI checks and mergeability.
- Actions: approve, comment, request changes, and merge (merge/squash/rebase). Merge is disabled
  when the data is invalid or the PR isn't mergeable.
- Available with a GitHub token (Pages) or with `GITHUB_TOKEN` (Docker).

### 5.11 Heroes

There are 18 heroes (`HeroId`): classic, bearded, redhead, mustard-jumper, denim-jacket, hoodie,
emo, goth, punk, rainbow-tee, trans-flag-hair, trans-pin, bi-bomber, drag-glam, nb-beanie,
hijab-skater, silver-locs and flannel. They cover mixed skin tones, genders and ages.

Each hero has:
- walk and jump sprites (`sprites/heroes.ts`; `poses()` derives the frames);
- 32×32 portraits, neutral and reacting (`sprites/portraits.ts`), composed from a shared head
  plus per-hero hair, clothes and accessories;
- their own voice in the tour lines and easter-egg lines.

Precedence: in read-only views the viewer's own choice wins over the repo default. §18 covers how
to add a hero: the art, the voice and every line they need.

---

## 6. Onboarding (#61)

A browser with no Quest Log keys in `localStorage` gets a **welcome screen** styled like a
console box and magazine ad. It offers three ways in:

1. **▶ Play the demo** (`?demo`): the example games, fully editable through `DemoSource` and an
   in-memory KV. Sync, undo and celebrations behave normally, but nothing is written anywhere,
   and edits vanish on reload.
2. **? Take the tour:** nine stops (eight on phones, which skip play mode), each with a
   spotlight on real on-screen elements and a dialogue box with the guide's portrait.
   - The guide is your hero, or a random one different from last time, speaking in its own
     voice. Lines are reworded for touch on phones.
   - Three desktop stops loop a small demo animation: jumping into a `?` block, the warp
     pipe/cloud, and climbing the stairs.
   - The tour is resumable after a reload, can be skipped, and can be restarted from Settings.
3. **★ Get started:** an instruction-manual-style set-up guide.
   - **Pages with sign-in:** sign in with GitHub and pick a repo (or make one from the template,
     or add one to the App) → pick a hero → first game (or copy the examples) → teach your AI
     the rules. "Use a token instead" switches to the token steps below.
   - **Pages without sign-in:** make a repo → create a fine-grained token scoped to that one
     repo, with a **TEST IT** check per permission → connect → pick a hero → first game (or copy
     the examples) → teach your AI the rules.
   - **Docker:** starts at "Your local repo" (branch, last commit, remote) and skips the GitHub
     steps.

Shared links on a first visit show a small "New here?" banner instead. `?welcome` or Settings
brings the welcome screen back. An empty repo is detected via `GET /commits?per_page=1` → 409.

---

## 7. Run modes

| Mode | Source | Edits | PR review |
|---|---|---|---|
| Read-only Pages | `StaticSource` (deployed `data/` + `data/index.json`) | – | – |
| Demo (`?demo`) | `DemoSource` (in-memory copy of the examples) | In memory only | – |
| Tour (`?tour`) | `StaticSource` | – | – |
| GitHub-connected | `GitHubSource` (pasted token, or a Sign in with GitHub session, in `localStorage`) | Atomic commits to the chosen branch via Git Data API; read-only without push rights | ✓ |
| Local editor (Docker) | `LocalApiSource` → `/api` | Server writes `data/` and commits; **Publish** pull-rebases and pushes | ✓ with `GITHUB_TOKEN` |
| Mobile PWA | Pages + any of the above | Offline queue | ✓ |

Builds come from `VITE_TARGET` (`pages` | `local`):

- **Pages** uses relative URLs, so it works at `/<repo>/` or a custom domain. It copies `data/`,
  `schema/` and `skills/` into `dist/`, writes `data/index.json`, and turns GA on.
- **Local** ships the examples under `examples/data/` with no GA, unless `VITE_GA_ID` is set.

`VITE_GH_REPO` defaults to the git remote and `VITE_GH_BRANCH` to `main`.

---

## 8. Sync, offline and conflicts

Implemented in `app/src/data/store.ts`.

- Every edit is an **op** (`shared/src/ops.ts`). It is applied optimistically to local state,
  appended to an **outbox**, and both are persisted in IndexedDB (`idb-keyval`), namespaced by
  source id.
- **Sync** (1.5 s debounce; also on reconnect, on focus and every 30 s):
  1. load the remote;
  2. replay the outbox on top of it;
  3. validate (refusing to commit edits that would make valid data invalid);
  4. compute `changedFiles`;
  5. make one commit with a generated message;
  6. on `ConflictError` (the branch moved), reload and retry, up to 3 times.
- Ops whose target vanished remotely are skipped and listed as conflicts in Settings → Sync.
- Status values: `loading`, `readonly`, `synced`, `pending`, `syncing`, `offline`, `error`.
- A lagging GitHub ref (an ancestor of the known head) is ignored, so a reload never rolls back
  to an older head.
- An unchanged sync result keeps object identity (`keepUnchanged`), so views skip re-rendering.
- Op kinds:
  - **Items:** `setItemStatus`, `addItem`, `updateItem`, `deleteItem`.
  - **Criteria:** `setCriterion`, `addCriterion`, `updateCriterion`, `deleteCriterion`.
  - **Levels:** `startLevel`, `updateLevel`, `extendTimebox`, `setSomeday`, `deleteLevel`,
    `moveLevel`, `addLevel`.
  - **Worlds:** `addWorld`, `updateWorld`, `deleteWorld`.
  - **Projects and goals:** `updateProject`, `addGoal`, `updateGoal`, `deleteGoal`,
    `addProject`, `deleteProject`.
  - **Settings:** `updateSettings`.
  - **Inbox:** `inboxAdd`, `inboxUpdate`, `inboxRemove`, `inboxPlace`.
- Item ops can target a dependency's subtasks with `parentId`.
- Commit messages read like `quest: done: Write docs (project/world/level)`, or `quest: N
  updates` followed by a bullet list.

---

## 9. Local editor server (Docker)

Fastify (`server/src/app.ts`), with the repo mounted at `/repo`.

| Endpoint | Purpose |
|---|---|
| `GET /api/game` | All `data/**/*.json` + content-hash version |
| `POST /api/commit` | `{changes, message, baseVersion}`. Data paths only. 409 if disk changed, 400 if invalid. Writes, then commits only those paths |
| `GET /api/status` | Branch, ahead/behind, remote, last commit, `canReviewPRs` |
| `POST /api/publish` | Fetch, pull `--rebase --autostash` if behind, push |
| `GET /api/prs`, `GET /api/prs/:n` | Data PRs; detail + base/head workspaces (needs `GITHUB_TOKEN`) |
| `POST /api/prs/:n/merge`, `/review` | Merge (then pull locally), review |

Security:
- The port is published on loopback only, and the `Host` header is checked against
  `ALLOWED_HOSTS` (DNS rebinding).
- Writes require the `X-Quest-Client: 1` header plus a same-origin `Origin` (CSRF).
- A mutex serialises writes and commits.
- `~/.ssh` and `~/.gitconfig` are mounted read-only. HTTPS pushes use `GITHUB_TOKEN` through a
  credential helper.

---

## 10. LLM skill and tooling

- `skills/quest-log/SKILL.md` is the full field reference, worked examples, safe-change rules and
  "how to reach GitHub" guidance, in this order of preference:
  1. the agent's own integration (connector, MCP, git/gh), with no token needed;
  2. `quest.py pull/push`;
  3. the raw REST API;
  4. output the files for the user to commit.
- Three rules come first, on every route: check for a newer skill before touching data, validate
  the whole data tree against the schema before anything is committed or handed over, and update
  from the base branch first (a new PR branches from the latest base; the base is merged into an
  existing PR before adding commits, never rebased or force-pushed).
- Further rules: never assume the repo (ask), and put requests with no clear home into
  `data/inbox.json` rather than guessing. "What should I do next?" mirrors Today.
- **Skill version.** SKILL.md carries a `**Skill version: N**` line and quest.py a matching
  `SKILL_VERSION`. `skills/quest-log/version.json` publishes the latest `version` (plus the skill,
  script and schema URLs). An assistant whose copy is older must load the published SKILL.md and
  quest.py and tell the user to reinstall. `npm run skill:version` bumps all three and records a
  fingerprint of SKILL.md + quest.py; `npm run skill:check` (CI and a test) fails if either file
  changed without a bump.
- `skills/quest-log/scripts/quest.py` is standard-library Python. Commands: `update-check`,
  `validate [--refresh]`, `changes`, `info`, `pull`, `status`, `push [--pr] [--allow-delete KEY]`,
  `schemas`. It applies the same
  rules as the TS validator (parity tests). `push` always validates (no opt-out); if the branch
  moved it validates the combined result and syncs the folder; if the branch has an open PR it
  merges the PR's base into it first (`POST /merges`) and stops on a conflict; `--pr` branches
  from the latest base. `changes` lists what a tree adds, changes and removes by id key
  (`level:p/w/l`, `item:p/w/l/i`, `inbox:i`…) against another tree or a git ref, and exits 5 on
  removals not named with `--allow-delete`; `push` applies the same guard against the branch it
  commits to, so a stale or hand-rewritten file can't silently delete other people's work.
- The in-app **AI SKILL** button explains this and downloads a zip of the skill, the script and
  the schemas (`app/src/ui/zip.ts`).
- The skill and schemas are published at `https://tasks.patrick-mckinley.com/skills/...` and
  `/schema/...`.

---

## 11. Analytics and privacy

- GA4 (`G-5D7YVR6VN6`) runs on the Pages build only. It is on by default and can be switched off
  in Settings. It is off by default under Global Privacy Control.
- Page views carry the screen type (`/level`, `/world`…), never ids.
- Events carry categories only (item type and status, dependency mode, hero, sync result,
  bucketed counts, undo kind, shortcut key, `junk_play {kind, variant}`, polish penalty and so
  on). All parameters go through an allow-list `sanitize` (`app/src/analytics.ts`).
- Never sent: titles, ids, notes, repo names, logins, tokens.
- Self-hosters should disable GA's history-based page changes.

## 12. Security

- **CSP** (meta tag injected at build): `default-src 'self'`; `connect-src` is self +
  `api.github.com` (+ the sign-in Worker's origin, + GA); fonts are same-origin only (never inlined); `object-src 'none'`;
  `form-action 'none'`.
- The token lives in `localStorage` and is only ever sent as an Authorization header to
  `api.github.com`. Users are told to scope it to one repo:
  - Contents: read & write
  - Pull requests: read & write
  - Checks: read
- On iOS, the installed PWA has its own storage, so the token must be connected again there.
- **Sign in with GitHub** (#30, #92; Pages builds with `VITE_AUTH_URL`,
  `VITE_GITHUB_APP_CLIENT_ID` and `VITE_GITHUB_APP_SLUG`):
  - A GitHub App user token. The redirect carries a random `state` and a PKCE S256 challenge;
    both the state and the verifier are kept in `sessionStorage` and checked on return.
  - `main.ts` strips `code`, `state` and the other callback parameters from the URL with
    `history.replaceState` before anything else runs. `<meta name="referrer"
    content="no-referrer">` keeps addresses out of Referers.
  - The code is swapped for tokens by the Worker (`worker/`), which holds the client secret.
    Tokens are stored as `{ token, refresh, expiresAt, refreshExpiresAt, kind }` under the same
    key as a pasted token (a bare string is still read as a PAT).
  - `GitHubClient` takes a token provider (`app/src/auth/session.ts`). It refreshes five minutes
    before expiry and once on a 401. One refresh runs at a time across requests, and across tabs
    under a `navigator.locks` lock, because GitHub rotates the refresh token. The rotated
    session is saved before it is used. There are no refresh attempts while offline.
  - A dead refresh token raises `SignInExpiredError`: the store keeps the outbox and asks the
    user to sign in again, then syncs it.
  - Repo discovery: `/user/installations` → each installation's repositories → `contents/data`,
    keeping repos with `data/settings.json`, `data/inbox.json` or a `data/<project>/project.json`.
  - After an install (`setup_action`), the returned code is not redeemed (it had no PKCE
    challenge); a normal sign-in starts instead.

## 13. PWA and performance

- `vite-plugin-pwa` (auto-update) provides the manifest, icons, Android share target and
  standalone display. Workbox precaches the app shell, and data/schema JSON is `NetworkFirst`
  with a 4 s timeout.
- The cached app expires after 3 hours while online (`app/src/pwa.ts`). `main.ts` registers the
  service worker and asks for a new build at boot, on focus, on reconnect and every 15 minutes
  once that age has passed. A new build reloads the page only when nobody would notice: during
  boot, or the next time the tab is hidden. Offline, the cached app keeps working as long as it
  needs to.
- A tab left open and visible re-pulls its data once its last sync is 3 hours old (the store
  already re-pulls on focus and reconnect).
- The boot splash is inline in `index.html`, so it paints before any script. It uses CSS-only
  animation (transform-based shine) and fades once the store has something to show.
- Performance work so far:
  - copy-on-write ops plus incremental `revalidate`: an edit went from 3.04 ms to 0.44 ms on 90
    files (#71);
  - the level stage updates in layers and in place: 17 vs 89 objects per status change (#72);
  - sync-only repaints (#68);
  - cached canvas data URLs;
  - debounced resize;
  - textures freed after use (#67).
- **Catch-up** (#21/#84) uses real frame times. When a hidden or throttled tab returns, every
  one-off tween, timer and camera effect is run to its end, so warps and route changes finish
  at once.
- Reduced motion is respected throughout: the splash, jumps, pole bend, easter egg and tour
  demos.

## 14. Tech stack and code layout

The stack is TypeScript (ES2022), npm workspaces (`shared`, `app`, `server`), Vite 7, Phaser
3.90, plain DOM, Fastify 5, simple-git, Ajv 8 (precompiled standalone validators),
json-schema-to-typescript, Vitest 3 and Node 22. The fonts are Press Start 2P and Caveat.

See `CLAUDE.md` for the file-by-file layout and the architectural rules.

## 15. Quality gates

- `npm run typecheck`, `npm test` (35 files, 364 tests at time of writing) and
  `npm run validate` (90 example files) must pass.
- CI (`validate.yml`) on every PR and push to main runs:
  - data validation;
  - a format check (advisory only);
  - `schema:check`, so the generated code stays current;
  - typecheck;
  - tests;
  - the Playwright end-to-end suite (`npm run e2e`).
- `pages.yml` validates, builds and deploys `main`.
- Test coverage includes:
  - the shared model: ops, undo, structural sharing, scoring, budgets, layout, worldmap, Today, review,
    diff, serialize, validation, the GitHub client, and skill/script parity;
  - the store's sync;
  - the server;
  - the router, nav, play physics, catch-up, analytics, onboarding/tour, heroes/portraits/lines
    coverage, and zip.
- Playwright end-to-end tests (`e2e/`, #38) drive real builds in Chromium through the core
  flows:
  - the read-only site, from the project floor to an item's bubble and its deep link;
  - the local editor against a fresh git repo: completing an item commits it, steps under a
    warp pipe send the hero back up with the dependency done, the hero picker writes
    `data/settings.json`, and logging a done item's cost commits it with no polish;
  - offline edits surviving a reload and committing once back online;
  - the phone layout;
  - the demo keeping nothing;
  - the `t`/`i`/`w` pads, and capturing an idea with `n` and placing it in a level.

---

## 16. Backlog (open GitHub issues)

**Game styles** (epic):
- **#76 Modularise the game mode.** Introduce a narrow `GameHost` and a `GameStyle` module
  (renderers per route, optional play mode, vocabulary, DOM sprite provider, CSS tokens, hero
  renderer).
  - Move the platformer to `app/src/styles/platformer/` with no behaviour change.
  - Make the shared domain genre-neutral **without migrating data**: themes become mood keys,
    and "coins" become bonus points.
  - Heroes keep one identity and are themed per style.
- Candidate styles that depend on #76:
  - #77 top-down dungeon
  - #78 turn-based RPG
  - #79 dig and collect (Boulder Dash)
  - #80 scrolling shooter
  - #81 road racer
  - #82 maze chase
  - #83 fantasy beat-'em-up

**Onboarding and access:**
- #62 Move the demo data to a public repo (`quest-log-demo`). Read it anonymously: tree via
  API, files via `raw.githubusercontent.com`, ETags. Keep a bundled fallback, and make it a
  template repo.
- #30 Sign in with GitHub: a GitHub App plus a tiny token-exchange Worker, a template repo and a
  repo picker, with the PAT kept as a fallback.
- #36 Plan with AI in-app: export a prompt, paste back JSON, validate, preview the diff, apply.

**Play and delight:**
- #57 Secret cartridge: about 15% of visits hide a seeded sandbox level (`#/sandbox/<seed>`)
  under the clutter. It never touches data.
- #24 Hero idle/victory animations.
- #23 A livelier world map.
- #22 Faster long walks.
- #20 Sound effects (off by default).

**Productivity:**
- #19 Search/filter (`/`)
- #26 A "good enough" moment
- #27 WIP-limit warning
- #28 Streaks and history
- #29 World-level time-box
- #31 Better conflict resolution
- #32 Archive finished projects
- #33 Due dates and a calendar feed
- #34 Repeating items
- #35 Lazy-load levels for large repos
- #37 `quest.py review` scope-cut suggestions

**Quality:**
- #39 Accessibility: screen-reader announcements, keyboard play, reduced motion
- #40 Light theme
- #41 Document the hero sprite format

---

## 17. History (merged PRs, condensed)

- **#1–#3** Core Quest Log: schema, ops, store, Pages/GitHub/Docker modes, Warp Zone. Then
  project folders, own-repo support, the LLM skill and the console project select.
- **#4–#8** World map branches by `unlocksAfter`; item bubbles with Done, auto-shown at the hero,
  with deep links; success criteria on the flagpole; the in-app AI skill guide.
- **#9–#14** Five example projects; `quest.py` and the schema manifest; clearer desktop nav;
  dependencies as warp pipes and clouds; selectable heroes with a repo default.
- **#42** Google Analytics with an opt-out.
- **#43–#48** Today on a legal pad held over any screen; "Waits for" naming and status tags.
- **#49–#51** Inbox page, undo toasts, quick-add focus fix; skill update (own GitHub access
  first, inbox fallback); pad tabs as sticky flags; cloud-ride and stale-reload fixes.
- **#52–#54** Bedroom clutter quips; play mode with held edits and look mode; twelve more heroes.
- **#58–#60** Weekly review and the someday shelf; flagpole stairs; the console easter egg;
  redrawn portraits.
- **#63–#66** Onboarding (welcome, demo, tour, set-up guide); phone fixes (tour, safe areas, no
  zoom); more clutter, TV screens and hero lines.
- **#67–#72** Performance and cleanup: leaks, sync-only repaints, shared helpers, empty-repo
  detection, copy-on-write ops, in-place level stage.
- **#73–#75, #84** FiftyPIFS boot splash; play mode keeps pipe arrivals; last game beside the
  console; animation catch-up after hidden tabs.

---

## 18. Adding a hero

A hero is one identity that shows up in many places, as art and as a voice. Every hero needs
**all** of the pieces below. The typecheck and the tests fail until each one is there, so a
half-added hero can't ship.

### 18.1 Where a hero appears

| Place | What's shown | Source |
|---|---|---|
| Level scene | Walks, jumps, rides clouds, warps, climbs the stairs; steered in play mode | Sprite frames |
| Overworld and world maps | Stands and walks between nodes | Sprite frames |
| Tour demos | Bumps a `?` block, dives into a pipe, climbs the stairs | Sprite frames |
| HUD and mobile tab bar | Small icon by the title, and on the Next tab | Standing frame |
| Mobile level strip | Stands at the next stop | Standing frame |
| Settings → Your hero | Carousel, walking in place, with label and description | Frames + `label` + `description` |
| Welcome screen | A random cast of three on the box cover (standing or jumping) | Frames |
| Set-up guide | The hero gives tips in the margin | Standing frame |
| Legal pad (Today, Inbox, Review) | The hero's hands hold the pad | Skin colour, slot `3` |
| Tour dialogue box | Portrait + emote + the hero's tour lines | Portraits + tour lines |
| Console easter egg | Portrait + emote + the hero's reaction | Portraits + junk lines |
| `data/settings.json`, analytics | The hero id (`hero_select`, the `hero` user property) | `HeroId` |

The bedroom clutter quips and the flagpole "whack" lines are shared by every hero, so a new
hero needs nothing there.

### 18.2 The art

All art is original pixel art written as **character maps**: arrays of strings, one character
per pixel, with `.` for transparent. The characters are either a hero's own colour slots (the
digits) or shared `PALETTE` letters (`app/src/sprites/pixels.ts`), such as `k` (outline
`#1a1c2c`), `w` (white), `q` (mouth pink), `l` (pale lens) and `u` (highlight yellow).
Don't add new palette letters for one hero. Use the colour slots instead.

**Colour slots** (`HeroDef.colors` in `app/src/sprites/heroes.ts`), ten hex colours per hero:

| Slot | Role | Slot | Role |
|---|---|---|---|
| `1` | Hair | `6` | Top accent |
| `2` | Hair shade | `7` | Bottoms |
| `3` | Skin (also tints the hands holding the legal pad) | `8` | Bottoms shade |
| `4` | Skin shade | `9` | Shoes |
| `5` | Top | `0` | Shoe accent |

**Sprite frames: 16×16, three of them.** `stand`, `walk` and `jump` each have exactly 16 rows of
16 characters. Keep to 16×16. The small size is the retro look, and `heroes.test.ts` enforces
it.

- Draw on the **common body** so heroes line up: the head in rows 1–8, the top in rows 9–11
  with the arms in rows 10–11, the bottoms in row 12, the legs in row 13, the shoes in row 14,
  and the soles in row 15. Outline everything in `k`. Eyes are `k` pupils with `w` where needed,
  and the mouth is `qq`.
- Usually you draw only `stand` and wrap it in `poses([...])`. That derives `walk` (arms swing,
  legs stride) and `jump` (arms up, legs tucked), copying leg and shoe colours so stripes and
  checks carry over.
- Draw the three frames by hand only when the body breaks the template. `drag-glam`'s gown is
  the example.
- `classic` is the exception: its frames live in `pixels.ts` as the original hero.
- Give the hero one or two **signature details** that read at 16px: a hat, glasses, a beanie
  stripe, a pin, a mohawk. Mixed skin tones, genders, ages and styles are the point of the
  roster.

**Portraits: 32×32, two expressions** (`neutral` and `reacting`), in
`app/src/sprites/portraits.ts`. This is the one deliberate exception to "everything is 16px".
You don't draw a portrait pixel by pixel. You add a `BUILD[id]` entry whose `draw(p, f)` builds
it from shared parts:

- `body(p, top)` gives the shared hand-shaped head, ears, neck and shoulders, lit from the top
  left with a diagonal jaw shadow. Pass the clothing slot for the shoulders.
- `face(p, f, { browY, lashes, lips })` draws the brows, eyes (lid, white, iris, pupil), nose and
  mouth for the expression. In `reacting`, one brow shoots up, the other goes down and in, the
  eyes widen and the mouth opens. Raise `browY` when glasses sit high.
- Hair helpers: `dome` (cropped, with a ragged fringe), `longBack` (falls behind the shoulders),
  `curls` (2×2 clusters), `lock` (a strand down the side of the face). Hair is a pixel proud of
  the skull, with clean strand lines and no dither.
- Extras: `glasses(p, round)`, `neckline(p, slot)`, plus `rect`/`stamp`/`each` for clothes,
  patterns and accessories that **match the sprite**: the same hat, the same colours, the same
  signature detail.
- Role symbols (`@` skin, `%` shade, `#` hair, `=` hair shade, `~` brow, `&` iris, `^` mouth)
  map to the hero's slots by default. Override them with `roles` when a hero needs it; for
  example, `classic` uses palette letters.
- `build()` adds the 1px `k` outline round the silhouette. The test checks that the outline is
  there, that the two faces differ, that the shoulders fill the bottom row, and that only the
  hero's slots and palette letters are used.

**Metadata.** Give the hero a `label` (2–3 words: "Hijab skater", "Beard & glasses") and a
`description` (one line: hair, top, bottoms, shoes, plus the signature detail). Use the same
description wording in the schema.

### 18.3 The voice

Every hero speaks in **first person**, in a voice that comes from their **style and
personality**. That means their clothes, hobbies and attitude. A voice **never** comes from
background, ethnicity, religion, gender, sexuality or an accent. Pride-themed heroes are cheerful
or calm or theatrical, not "about" their identity. In the tour, **the joke never hides the
instruction**.

The current voices, as a guide to staying distinct (a new hero should sound like none of them):

| Hero | Voice | Typical words |
|---|---|---|
| classic | Upbeat platform hero, all exclamation | "Wahoo!", power-up, 1-UP, let's go |
| bearded | Dry, deadpan, weary sarcasm | "Well.", "Thrilling.", "I checked." |
| redhead | Breezy and easy-going, likes a bit of chaos | "Honestly", "Lovely", "no stress" |
| mustard-jumper | Precise rule-follower, reads the manual | "To be clear", spec, FAQ, warranty |
| denim-jacket | Art-school; everything is a piece | installation, medium, canvas, sketchbook |
| hoodie | Speedrunner and gamer | any%, frame perfect, GG, splits, binds |
| emo | Gloomy and self-deprecating, secretly enjoying it | "Same.", "(I care.)", "Tell no one." |
| goth | Grand, morbid, poetic | abyss, tomb, epitaph, behold, ascend |
| punk | Loud, anti-rules, caps | "Oi!", "No rules!", "Watch me." |
| rainbow-tee | Warm cheerleader | "You've got this!", "main character era" |
| trans-flag-hair | Gentle and tender, kind to objects | "little sock", "be brave", "live your dream" |
| trans-pin | Calm, understated, reassuring | "Take your time", "quietly impressive" |
| bi-bomber | Cool and confident | "First try. Obviously.", "Clean. Smooth." |
| drag-glam | Theatrical diva | "Darling", iconic, serving, scandalous |
| nb-beanie | Philosophical, questioning | "Is anything?", "Let's sit with that." |
| hijab-skater | Skater tricks and stoke | kickflip, ollie, drop in, stick the landing |
| silver-locs | Warm elder gardener | "love", "dear", "In my day", "Mind my knees" |
| flannel | Practical DIY maker, terse | gasket, truck, "If it works, it works" |

**Line format** (shared by the tour and the easter egg; parsed by `parseLine` in
`app/src/ui/dialogue.ts`):

- A **mood mark** first: `+` happy, `=` meh, `!` shocked, `-` sad. Meh and shocked lines show
  the `reacting` portrait; happy and sad lines show `neutral`. The mood also picks the emote in
  the portrait's corner. Choose marks that suit the voice: mostly `=` for bearded, mostly `+`
  for rainbow-tee.
- Exactly **one `*keyword*`**, which is highlighted in the box.
- No other `*`, `{` or `}` except the placeholders below.
- Plain British English, short sentences, typed out in a dialogue box, so keep them punchy.

### 18.4 Lines needed, place by place

**1. Tour lines** in `app/src/ui/onboarding/tour-lines.ts`, `TOUR_LINES[id]`: **2 variants ×
9 stops = 18 lines.** A repeat tour swaps to the other variant, so both must stand alone. Each
line must teach that stop's `CORE` point, and its keyword must be the concept for that stop:

| Stop | Must get across (`CORE`) | Keyword must match |
|---|---|---|
| `bedroom` | Each cartridge is a project: hover to read it, click to play. | `cartridge` |
| `project` | The map is one project: islands are worlds (phases), the path is their order. | `map` |
| `world` | Each stop is a level: one milestone with a time-box. | `level` |
| `level` | Tasks are ? blocks: click to read, DONE completes it, the hero walks on. | `? block` |
| `deps` | Dependencies: a warp pipe has steps below, a cloud waits on another level. | `warp pipe` |
| `flag` | The stairs to the flagpole are success criteria: tick the must-dos to clear; good enough. | `flagpole` |
| `pad` | Today shows what is late and next; the Inbox holds ideas (T, I, N). | `Today` |
| `play` | PLAY (or P) lets you steer the hero; bumping blocks finishes tasks. | `play` |
| `ai` | The AI skill lets ChatGPT or Claude update your quests; then demo or get started. | `AI skill` |

Further rules for tour lines:
- **≤ 140 characters** after the marks come off (`MAX_TOUR_LINE`), so the box never scrolls.
- **Write for desktop.** `forTouch()` rewrites lines for phones: "Hover to read it" → "Read
  it", "click" → "tap", "Point at" → "Pick", and the "T, I and N" key phrases → "Tabs at the
  bottom". Use those phrasings so the rewrite reads naturally, and check that no "hover",
  "click" or key names are left afterwards (the test checks this).
- `play` is skipped on phones, so don't refer back to it from another stop.

**2. Easter-egg lines** in `app/src/game/junk-lines.ts`, `LINES[id]`: **5 lines × 14 kinds +
3+ fallbacks = 73+ lines.** Each line is the hero's reaction to seeing a thing jammed in the
console:

| Kind | The thing | Kind | The thing |
|---|---|---|---|
| `sock` | A sock | `cassette` | A tape (`{label}` = its scrawled title) |
| `snack` | A snack bag (`{label}` = its brand) | `banana` | A banana |
| `soda` | A fizzy can | `duck` | A rubber duck |
| `juice` | A juice carton (drips in) | `donut` | A donut |
| `pizza` | A pizza slice | `teddy` | A teddy bear |
| `comic` | A comic (`{label}` = its sound word) | `yoyo` | A yo-yo |
| `controller` | The controller itself | `gamebook` | A pick-your-path fantasy gamebook (`{label}` = its title) |
| | | `any` | Fallback for kinds added later (3+ lines, generic) |

Further rules for easter-egg lines:
- Five **different** lines per kind, because the picker never repeats a line twice running.
- `{label}` only in `snack`, `comic`, `cassette` and `gamebook` lines.
- `{game}` is the title on the TV, which is one of five screens per kind (its own, plus genres
  like kart racer, shooter, fighter, falling blocks, RPG battle, platformer, quiz show). Use it
  in about one line per kind, and make the line work whichever genre came up.
- Mix the moods. A hero reacting to juice flooding the console can be shocked or sad, even if
  they're usually upbeat.

**3. Nothing else.** The clutter hover quips (`app/src/game/quips.ts`) and flagpole whack lines
are hero-neutral.

### 18.5 Checklist

1. **Schema:** add the id and a one-line look description to `$defs.HeroId` in
   `schema/quest.schema.json` (`Settings.hero` refers to it). Then run `npm run schema:gen`.
   `quest.py` reads the bundled schema, so it picks up the new value with no code change.
2. **Model:** add the id to `HERO_IDS` in `shared/src/model.ts`. Order sets the Settings
   carousel; put new heroes at the end.
3. **Sprites:** add a `HEROES[id]` entry (label, description, colours, frames) in
   `app/src/sprites/heroes.ts`.
4. **Portraits:** add a `BUILD[id]` entry in `app/src/sprites/portraits.ts`.
5. **Tour lines:** add `TOUR_LINES[id]` (18 lines).
6. **Easter-egg lines:** add `LINES[id]` (73+ lines).
7. **Docs:** add the id to the settings table in `skills/quest-log/SKILL.md`, update the hero
   count in `README.md` and in §5.11 here, and add a row to the voice table in §18.3.
8. **Check:** `npm run typecheck` (the `Record<HeroId, …>` maps fail on a missing entry),
   `npm test` (`heroes`, `portraits`, `junk-lines` and `tour` tests), `npm run schema:check`.
   Then look at the hero in the app: Settings carousel, a level (walk, jump, play mode), the
   tour (`?welcome` → Take the tour, after picking the hero), the console egg on the bedroom
   floor, and a phone-width window. Check that the sprite reads against every world theme and
   that the portrait matches it.
9. **Don't commit** the `data/settings.json` change the app makes when you pick the hero to test
   it (see "quest: settings: hero = goth", which was reverted).
