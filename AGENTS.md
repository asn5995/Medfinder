# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** MedFinder. A typed drug is identified with RxNorm, then rules either show an Indian equivalent with a US price and a 90-day landed cost, or name the rule that failed. A prescription photo or PDF can be read into fields the patient confirms. A saved medicine can be ordered from a ranked seller, with a refill date and an in-app reminder.
- **Primary user & core workflow:** A classmate or friend on a long-term prescription. See the living PRD in `docs/index.html`. The one workflow is prescription drug in, verified Indian equivalent and landed cost out.
- **Tech stack:** Static HTML and JavaScript, plus `server.js` for live supplier lookup and prescription reading. `prototype/catalog.js` holds rule data: blocked drugs, each ingredient's salt, and `singleSalt`. Its product prices are used only by Check rules. Results come only from the live search, and the page never shows a sample price. `prototype/match.js` is the only match decision. `prototype/refill.js`, `prototype/ranking.js`, and `prototype/clinic.js` are the refill, ranking, and record decisions. `lib/extractor.js` calls the model through a `complete` function tests can replace. `lib/chat.js` runs chat intake for `POST /chat` the same way, and `prototype/chat.js` holds its rules: the question order, and a detail is kept only when it is in the patient's own words. The chat model never decides a match, a price, or a seller. `prototype/index.html` is one chat screen. `prototype/chat-ui.js` draws it, and `prototype/lookup.js` calls RxNorm, then asks `server.js` for India e-commerce suppliers. The same prototype files are copied to `docs/prototype/` for GitHub Pages. PostHog pageviews and clicks are installed through `MEDFINDER_POSTHOG_KEY`. The OpenRouter key lives in `.env` and never in the page.

## 2. Commands
- **Install dependencies:** None. Node is required for the local server.
- **Run locally:** Copy `.env.example` to `.env` and set `OPENROUTER_API_KEY`. From the repo root: `node server.js`, then open `http://127.0.0.1:8787/prototype/`. Do not open the HTML file from the disk. A `file://` page cannot call RxNorm. The published copy at `https://building-with-ai-f26.github.io/as20593-medfinder/prototype/` calls the Render server set in `prototype/config.js`. Without that server it says so and shows no prices.
- **Run deterministic tests:** From the repo root, `node --test`. That runs the match rule checks plus prescription parsing, refill dates, and seller ranking. It does not call RxNorm or OpenRouter. In the app's About panel, **Check rules** runs the same match cases, including the strength miss, the succinate versus tartrate miss, the blocked drugs, and the live-row filters.
- **Run a live lookup:** With the key in `.env`, use Find equivalent. The page lists suppliers only when `match.js` accepts the row. The model cost for that response is shown when OpenRouter returns one. Prescription reading uses `OPENROUTER_EXTRACT_MODEL` and the same key. There is no compile step. GitHub Pages serves the `docs/` folder. The published prototype uses the Render server for supplier search and prescription reading.

## 3. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
7. **Update the public page when a feature ships.** The agent once shipped prescription upload and left the living PRD saying photo upload was not built. A change that reaches the published page has to update `docs/index.html` in the same change.

## 4. Shipping
- **Tests on every pull request:** `.github/workflows/test.yml` runs `npm audit --audit-level=high` and `node --test` on pull requests and on `main`.
- **Preview and production:** `render.yaml` describes a free Render web service named `as20593-medfinder`. The GitHub Pages copy of the app calls it at `https://as20593-medfinder.onrender.com`, which is set in `prototype/config.js`. Keep that name and that file the same. Merging to `main` deploys production. Pull-request previews are off, because they need a paid Render workspace. Anirudh creates the service in his own Render account. If Render asks for payment or a paid add-on, stop.
- **Cross-origin calls:** the server answers browser requests only from `https://building-with-ai-f26.github.io` and from `ALLOWED_ORIGINS`. Do not open it to every origin.
- **Local server:** `node server.js` listens on `127.0.0.1:8787`. On Render, where `RENDER=true`, the same process listens on `0.0.0.0` and the port Render sets. Listening only on `127.0.0.1` would make the deployed site unreachable.
- **Database:** `migrations/001_clinic.sql` is the schema. `node scripts/migrate.js` applies new files to `DATABASE_URL` and records them in `schema_migrations`. With no URL, it does nothing. With `MEDFINDER_DATABASE=production`, it refuses to change the database. The agent uses a development URL only. The browser keeps prescriptions and orders when the database is unset.
- **Rollback:** In the Render dashboard, open the service, then Deploys, and roll back to the previous successful deploy. Or revert the bad commit on `main` and push that revert. Do not force-push `main`. Do not roll back by deleting rows.
- **After a deploy:** Open the production URL, confirm the prototype loads, and confirm PostHog still records a pageview. The public `phc_` key is meant to be in the page. Session replay stays enabled.

## 5. Ask me first
Stop and ask Anirudh before any of these:
- Deleting data, or changing the production database. That includes running a migration against production and exporting or restoring a backup.
- Keys, secrets, and permissions. Do not create a Render or Supabase project, and do not paste a database URL, service-role key, or API key into the environment.
- Anything that costs money. That includes a paid Render or Supabase plan, a paid preview add-on, and raising or setting the OpenRouter spending cap.
- Merging to `main`. That merge is the production deploy.
