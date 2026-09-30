# Quest Log data format

Quest Log tracks a project as a platformer game. All state lives in plain JSON files validated by
[`quest.schema.json`](quest.schema.json) (JSON Schema draft 2020-12).

Published schema URL: `https://lilmuckers.github.io/gamify-todo/schema/quest.schema.json`

## Files

| File | Schema definition | Holds |
|---|---|---|
| `data/game.json` | `#/$defs/Overworld` | Project title, key goals, order of worlds |
| `data/worlds/<world-id>.json` | `#/$defs/World` | One themed world and its levels |

Every world file must be listed in `game.json` → `worldOrder`, and the file name must equal the world `id`.

## Hierarchy

```
Overworld (data/game.json)        key project goals
└── World (data/worlds/<id>.json) one theme/topic, e.g. "Payments"
    └── Level                     ONE key deliverable, with a time-box
        ├── successCriteria[]     checks; MVP ones raise the flagpole
        └── items[]               tasks, blockers, dependencies, risks…
```

## Item types

| `type` | Means | In the game |
|---|---|---|
| `task` | Work you do | `?` block — done pops a coin |
| `deliverable` | Intermediate output / milestone inside the level | Checkpoint flag |
| `blocker` | Something stopping progress | Brick wall — hero cannot pass |
| `dependency` | Something needed from elsewhere (`levelRef` or `link`) | Pipe with a plant while unmet |
| `risk` | Might go wrong; `done` = mitigated/accepted | Patrolling critter |
| `decision` | Open question needing an answer | Signpost — hero waits |
| `stretch` | Nice-to-have polish | Floating coins — never blocks, never earns stars |

`status` is one of `todo`, `doing`, `done`, `dropped`. Dropping is encouraged: cutting scope is how you
ship.

## Good-enough rules

- A level is **cleared** when every criterion with `"mvp": true` has `"done": true`. Nothing else gates it.
- Once cleared, leftover items stop blocking. Stars: ★ cleared, ★ within `timeboxDays`, ★ no polishing
  after clearing.
- Keep MVP criteria to the 1–3 checks that make the deliverable useful. Put everything else in
  non-MVP criteria or `stretch` items.

## Rules the schema can't express (checked by `npm run validate`)

- Ids are unique within scope (worlds globally; levels per world; items and criteria per level).
- `dependsOn` only names items in the same level, with no cycles.
- `levelRef` (`"<world-id>/<level-id>"`), `goalIds` and `unlocksAfter` point at things that exist.
- Every level has at least one MVP criterion.

## Fields the app maintains

Omit these when generating new data: `startedAt`, `clearedAt`, `stats`. The app sets them as you play.

## Generating data with an LLM

Paste this prompt into ChatGPT, Claude or similar, followed by your project notes:

```text
You write JSON for "Quest Log", a project tracker shown as a Mario-style platformer.
Follow the JSON Schema at https://lilmuckers.github.io/gamify-todo/schema/quest.schema.json
exactly (draft 2020-12, additionalProperties false everywhere).

Output one file per code block, labelled with its path:
- data/game.json            (an Overworld: title, goals, worldOrder)
- data/worlds/<id>.json     (one World per theme, containing its levels)

Rules:
- Ids are lowercase kebab-case, unique in scope, and world file names equal world ids.
- Each level is ONE deliverable with timeboxDays (1-90) and 1-3 MVP successCriteria (mvp: true).
  Extra quality bars go in non-MVP criteria or "stretch" items.
- Item types: task, deliverable, blocker, dependency, risk, decision, stretch.
  New items have status "todo". Use dependsOn (same-level item ids, no cycles) for ordering and
  levelRef "<world-id>/<level-id>" for dependencies on other levels.
- Do not include startedAt, clearedAt or stats.
- Prefer small levels (under ~10 items). Bias hard towards "good enough to ship".

My project:
<describe your project, goals and known work here>
```

Validate the result locally with `npm run validate`, or open a pull request: it shows up in the
app's Warp Zone for review, and CI validates it.

## Example

See [`examples/game.json`](examples/game.json) and [`examples/world.json`](examples/world.json).

A minimal world:

```json
{
  "$schema": "../../schema/quest.schema.json",
  "id": "onboarding",
  "name": "Onboarding",
  "theme": "grass",
  "goalIds": ["ship-v1"],
  "levels": [
    {
      "id": "signup",
      "name": "Sign-up flow",
      "deliverable": "New users can create an account",
      "timeboxDays": 5,
      "successCriteria": [
        { "id": "can-signup", "text": "A new user can sign up and log in", "mvp": true, "done": false },
        { "id": "social-login", "text": "Google login works", "mvp": false, "done": false }
      ],
      "items": [
        { "id": "form", "type": "task", "title": "Build sign-up form", "status": "todo" },
        { "id": "email-provider", "type": "decision", "title": "Pick email provider", "status": "todo" },
        { "id": "verify-email", "type": "task", "title": "Send verification email", "status": "todo", "dependsOn": ["email-provider"] },
        { "id": "spam-signups", "type": "risk", "title": "Bot sign-ups", "status": "todo", "mvp": false },
        { "id": "confetti", "type": "stretch", "title": "Confetti on success", "status": "todo" }
      ]
    }
  ]
}
```
