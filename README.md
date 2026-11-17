# Royal Victory H.C. Dames 1

A small team app for one women's hockey team. Players write a post-match review, read the coach's feedback, and open the season's tactics slides and PDFs. The coach reads the reviews, writes feedback to one player or the whole team, and uploads files.

It stands on its own. It does not use the Dragons app or any other project.

## How it works

- **Front end:** Vite and TypeScript, no framework. Installable to the home screen (PWA). Hosted free on GitHub Pages.
- **Back end:** one free Supabase project. All data is private behind row level security. This repository is public, so it holds code only, never player data.
- **Sign in, with no email:** the coach gives each person a one-time code. On first use the player creates her login, which is a passkey (Face ID or fingerprint). After that she opens the app with it. A new phone needs a new code from the coach. Sign in runs in the `auth` edge function (WebAuthn, SimpleWebAuthn). It mints a normal Supabase session, so the database rules do the rest.
- **Privacy rules (enforced in the database, tested in CI):**
  - A player reads only her own reviews and her own feedback, plus team feedback and published files.
  - Kind words about teammates and the anonymous note to the coach are readable by the coach only. The anonymous note stores a date and nothing else.
  - Sign in tables are closed to the app. Only the edge function reaches them.

## Layout

```
src/                 the app
supabase/migrations/ the database, applied only by the deploy workflow
supabase/functions/  the sign in function
scripts/             migrate, seed the coach, configure the project
tests/unit           pure logic
tests/rls            two players against the real migrations (in-process Postgres)
tests/e2e            the main flows in a browser with a virtual passkey device
.github/workflows/   ci and deploy, and a weekly keepalive ping
```

## Running things

```bash
npm ci
npm test            # unit and row level security tests
npm run build
```

The browser test needs a local Supabase stack (Docker), so it runs in CI. See `.github/workflows/ci.yml`.

## Deploy

Pushing to `main` runs the tests, then applies the migrations (`supabase db push`, project scoped database password only), seeds the coach code, and publishes to GitHub Pages. Schema is never changed by hand.

**The sign in function** (`supabase/functions/auth`) is deployed with the Supabase deploy tool on this project, not by the Action, so no account wide token is ever stored in GitHub. After changing it, redeploy it that way (`verify_jwt` off, files `index.ts` and `lib.ts`). Its defaults already point at the Pages address.

GitHub settings it relies on:

| Kind | Name | What |
| --- | --- | --- |
| secret | `SUPABASE_DB_PASSWORD` | this project's database password (this project only) |
| secret | `COACH_FIRST_CODE` | the coach's first one-time code (10 characters) |
| variable | `SUPABASE_PROJECT_REF` | the project reference |
| variable | `SUPABASE_ANON_KEY` | the project's publishable key (public by design) |
| variable | `COACH_NAME` | the coach's first name |

## Notes

- Passkeys belong to the web address. If the site ever moves to a different address, everyone needs a new code.
- A free Supabase project pauses after a week without activity. `keepalive.yml` pings it every Monday and Thursday.
