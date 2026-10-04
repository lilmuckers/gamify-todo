# Token exchange Worker

The one server-side step of **Sign in with GitHub** (#30). After GitHub redirects back to Quest Log
with a `code`, the app swaps it for a user token. GitHub's token endpoint needs the App's client
secret and sends no CORS headers, so the browser can't call it. It calls this Worker instead.

The Worker stores nothing and logs nothing. Tokens only ever appear in the response to the caller.
The exchange logic itself is in [`shared/src/oauth.ts`](../shared/src/oauth.ts), so the Docker
server can use the same code.

## API

Both routes take JSON, need an `Origin` from `ALLOWED_ORIGINS`, and reply with
`Cache-Control: no-store`.

| Route | Body | 200 reply |
|---|---|---|
| `POST /exchange` | `{ "code": "…", "code_verifier": "…" }` (PKCE verifier required: 43–128 of `A-Z a-z 0-9 - . _ ~`) | token set |
| `POST /refresh` | `{ "refresh_token": "…" }` | token set (GitHub rotates the refresh token too) |

Token set: `{ "access_token", "refresh_token", "expires_in", "refresh_token_expires_in" }`. The
last three are `null` if the App has token expiry turned off.

| Status | `error` | Meaning |
|---|---|---|
| 400 | `invalid_request` | Not a small JSON object with the right string fields |
| 400 | `bad_verification_code` | The code is wrong, used or expired: sign in again |
| 401 | `bad_refresh_token` | The refresh token is wrong or expired: sign in again (keep the outbox) |
| 403 | `forbidden_origin` | `Origin` isn't allowed (no CORS headers are sent) |
| 404 / 405 | `not_found` / `method_not_allowed` | Wrong path or method |
| 429 | `rate_limited` | Over 10 requests a minute from one IP. Wait for `Retry-After` (60 s) |
| 500 | `server_misconfigured` | Client ID or secret missing or wrong |
| 502 | `upstream_error` or GitHub's code | GitHub was down or answered something unexpected |

## Deploying

You need a Cloudflare account (the free plan is plenty) and Node 22. Wrangler runs through `npx`,
so it isn't a dependency of the repo.

### 1. Create the GitHub App

GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**:

| Field | Value |
|---|---|
| Homepage URL | `https://tasks.patrick-mckinley.com` |
| Callback URL | `https://tasks.patrick-mckinley.com/` (add `http://localhost:5173/` for dev) |
| Expire user authorization tokens | On (8-hour tokens plus a refresh token) |
| Request user authorization (OAuth) during installation | On |
| Webhook → Active | Off |
| Repository permissions | Contents: Read & write · Pull requests: Read & write · Checks: Read · Metadata: Read |
| Where can it be installed | Any account |

Then copy the **Client ID** and generate a **client secret**. No private key is needed.

### 2. Configure and deploy

```bash
cd worker
npx wrangler@4 login
npx wrangler@4 secret put GITHUB_CLIENT_SECRET --env=""
npx wrangler@4 deploy --env="" --var GITHUB_CLIENT_ID:Iv23…   # or let CI deploy (step 3)
```

Production is served only at **`https://auth.patrick-mckinley.com`** (`routes` in
`wrangler.toml`; `workers_dev = false`). The `patrick-mckinley.com` zone is on Cloudflare, so the
first deploy creates the `auth` DNS record and its certificate. Don't add an `auth` record by
hand, because the deploy refuses to replace one. The API token needs access to that zone (see
step 3).

The app's CSP `connect-src` (`csp()` in `app/vite.config.ts`) has to include that origin.

If the zone ever leaves Cloudflare, delete `routes`, set `workers_dev = true` and redeploy. The
Worker then lives at `https://quest-log-auth.<subdomain>.workers.dev`.

### 3. Auto-deploy from GitHub

[`.github/workflows/worker.yml`](../.github/workflows/worker.yml) typechecks, tests and deploys
the Worker whenever a merge to `main` touches `worker/` or `shared/src/oauth.ts`. You can also
run it by hand from the Actions tab ("Deploy Worker"). Until the settings below exist, it skips
the deploy with a notice, so `main` stays green.

1. Cloudflare → **My Profile → API Tokens → Create Token**, from the "Edit Cloudflare Workers"
   template. Under **Zone Resources**, include `patrick-mckinley.com`, because the deploy manages
   the `auth` custom domain there. If the first deploy fails with an authentication error on the
   custom domain, add **Zone → DNS → Edit** for that zone to the token.
2. In the GitHub repo, go to **Settings → Secrets and variables → Actions** and add:
   - secret `CLOUDFLARE_API_TOKEN`: the token from step 1;
   - variable `CLOUDFLARE_ACCOUNT_ID`: shown on the Workers overview page;
   - variable `QUEST_APP_CLIENT_ID`: the App's Client ID. The workflow passes it with
     `--var`, so `GITHUB_CLIENT_ID` can stay blank in `wrangler.toml`.
     (GitHub reserves the `GITHUB_` prefix for repo variables and secrets, hence `QUEST_`.)
3. Set the client secret once by hand (step 2 above). The workflow never sees it, and deploys
   keep it.
4. Run "Deploy Worker" from the Actions tab for the first deploy.

### 4. Lock it down

- `[observability] enabled = false` keeps Workers Logs off. Leave it that way, and don't run
  `wrangler tail` against production.
- Rate limiting is built in: 10 requests a minute per client IP (`[[ratelimits]]` in
  `wrangler.toml`), counted after the origin check, so preflights don't use it up. It fails
  open if the limiter is down, because it's a speed bump, not the security boundary. Now that the
  zone is on Cloudflare, a WAF rate-limiting rule on `auth.patrick-mckinley.com` can be added on
  top, but it isn't needed.
- CORS only stops browsers: scripts can send any `Origin`. That's why `/exchange` insists on
  PKCE, so a leaked `code` is useless without the verifier from the browser that started the
  sign-in.
- A stolen **refresh token** can still be swapped here by anyone, because the Worker holds the
  secret. That's inherent to a browser-only app. Keep tokens out of URLs and logs, and treat an
  XSS bug as serious. To cut everyone off, revoke the App's tokens or rotate the client secret.
- Never commit the secret. `.dev.vars` (local secrets) is git-ignored.
- The deploy workflow pins Wrangler to an exact version, because that step holds the Cloudflare
  API token. Bump it on purpose.

## Local development

```bash
cd worker
echo 'GITHUB_CLIENT_SECRET=…' > .dev.vars
npx wrangler@4 dev --env dev     # http://localhost:8787, allows http://localhost:5173
```

`[env.dev]` also deploys as a separate `quest-log-auth-dev` Worker at
`https://quest-log-auth-dev.<subdomain>.workers.dev` (never the custom domain), with its own secret
(`npx wrangler@4 secret put GITHUB_CLIENT_SECRET --env dev`), so you can try sign-in from
`localhost` without loosening production.

Tests run with the rest: `npm test` (`worker/test/`, `shared/test/oauth.test.ts`) and
`npm run typecheck`.
