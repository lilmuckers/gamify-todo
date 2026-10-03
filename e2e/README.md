# End-to-end tests

Playwright drives the built app in Chromium through the core flows: browsing the
read-only site, editing with the local editor, working offline, the phone
layout, the demo, and the Today / Inbox / weekly review pad.

```bash
npx playwright install chromium   # once
npm run e2e                       # builds both targets, then runs every project
npx playwright test --project local e2e/local/offline.spec.ts   # one file, after a build
```

`npm run e2e:build` makes two builds with `VITE_E2E=1` (which exposes the game as
`window.__questGame`) and analytics off:

| Project  | Serves                                   | Specs        |
|----------|------------------------------------------|--------------|
| `pages`  | `app/dist-e2e-pages` via `vite preview`  | `pages/`     |
| `mobile` | the same, on a phone viewport            | `mobile/`    |
| `local`  | `app/dist-e2e-local` from `serve-local.ts` | `local/`   |

`serve-local.ts` starts the editor's server in front of a fresh git repo in
`e2e/.tmp/repo`, seeded from `data/` each run, so local tests can read the files
and commits the app writes (`repo.ts`). They share that repo, so tests run one at
a time and each edits different items.

The game is a canvas. Tests wait on the game's own state instead of sleeping:
`settled()` waits until no tween, timer or camera effect that ends is still
running, and `clickItem()` / `clickLocator()` click things where the scenes say
they are. Assertions favour the DOM side panel where it shows the same thing.

To use a Chromium that's already installed (say, a different version than
Playwright expects), set `E2E_CHROMIUM` to its path.
