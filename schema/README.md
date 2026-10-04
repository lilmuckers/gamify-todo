# Quest Log data format

All Quest Log state is plain JSON in a `data/` folder of a GitHub repository — this one, or any
repo of your own. Files are validated by the JSON Schemas here (draft 2020-12,
`additionalProperties: false` throughout).

| File | Schema |
|---|---|
| `data/<project-id>/project.json` | [`project.schema.json`](project.schema.json) |
| `data/<project-id>/<world-id>/world.json` | [`world.schema.json`](world.schema.json) |
| `data/<project-id>/<world-id>/<level-id>.json` | [`level.schema.json`](level.schema.json) |
| `data/settings.json` (optional) | [`settings.schema.json`](settings.schema.json) |
| `data/inbox.json` (optional) | [`inbox.schema.json`](inbox.schema.json) |

All of them reference the definitions in [`quest.schema.json`](quest.schema.json). They are published
at `https://tasks.patrick-mckinley.com/schema/`, and data files point there with `$schema`, so
editors autocomplete them wherever they live.

```
data/
  <project-id>/            one folder per unrelated project (house renovation, desk build, work launch…)
    project.json           goals + worldOrder
    <world-id>/            one folder per theme inside the project
      world.json           theme, goalIds, levelOrder
      <level-id>.json      one key deliverable: time-box, success criteria, items
```

Why one file per level: an edit (say, ticking off a task) rewrites one small file, so commits,
diffs, pull requests and concurrent edits stay small and rarely conflict.

## Rules beyond the schema

Checked by `npm run validate`, the app, and CI:

- Folder and file names equal the ids inside them; `world` is reserved as a level id.
- `worldOrder` / `levelOrder` only name worlds / levels that exist. Ones left out go after the
  listed ones, sorted by id (the app adds them on its next save), so a new world or level is just
  a new file and two pull requests adding them don't conflict.
- Ids are unique in scope; `dependsOn` stays within a level with no cycles.
- `levelRef`, `goalIds` and `unlocksAfter` point at things in the same project; a level can't depend on itself.
- Only `dependency` items have `subtasks`, never together with `levelRef`; step ids are unique within the
  dependency and their `dependsOn` stays among its steps, with no cycles.
- Every level has at least one criterion with `"mvp": true`.
- `startedAt`, `clearedAt`, `doneAt` (on items and steps) and `stats` are maintained by the app.
  Tools writing data by hand should set `doneAt` when they mark something `done` and remove it when
  they reopen it, so the weekly review can see what shipped.
- `someday: true` parks a level (no `startedAt` while parked; never on a cleared level).
- Money is optional and per project: `budgets` on the project turns it on (`currency`, an ISO 4217
  code, GBP when unset; `alerts`; `alertAt`, the heads-up percentage). Then `budget` and `spent` go
  on items and steps, and `budget` on levels and worlds. Amounts are plain numbers ≥ 0. A level or
  world without its own `budget` adds up what's inside it. Without `budgets` the app ignores them.

## Generating data with an LLM

[`skills/quest-log/SKILL.md`](../skills/quest-log/SKILL.md) (published at
`https://tasks.patrick-mckinley.com/skills/quest-log/SKILL.md`) is written for LLMs: the full field
reference, worked examples, how to change data safely, and how to read and commit through the
GitHub API with a personal access token or open a pull request for review in the Warp Zone.
Point your assistant at it, or install it as a skill.
