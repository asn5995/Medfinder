# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** MedFinder. A typed drug is identified with RxNorm, then rules either show an Indian equivalent with a US price and a 90-day landed cost, or name the rule that failed.
- **Primary user & core workflow:** A classmate or friend on a long-term prescription. See the living PRD in `docs/index.html`. The one workflow is prescription drug in, verified Indian equivalent and landed cost out.
- **Tech stack:** Static HTML and JavaScript, plus `server.js` for live supplier lookup. `prototype/catalog.js` is the sample drug table. `prototype/match.js` is the only match decision. `prototype/index.html` calls RxNorm, then asks `server.js` for India e-commerce suppliers. The same prototype files are copied to `docs/prototype/` for GitHub Pages. PostHog pageviews and clicks are installed through `MEDFINDER_POSTHOG_KEY`. The OpenRouter key lives in `.env` and never in the page. Photo upload is still a later step.

## 2. Commands
- **Install dependencies:** None. Node is required for the local server.
- **Run locally:** Copy `.env.example` to `.env` and set `OPENROUTER_API_KEY`. From the repo root: `node server.js`, then open `http://127.0.0.1:8787/prototype/`. Do not open the HTML file from the disk. A `file://` page cannot call RxNorm. The published copy at `https://asn5995.github.io/Medfinder/prototype/` has no key, so it keeps the sample catalog.
- **Run deterministic tests:** On that page, click **Check rules**. The cases should pass, including the strength miss, the succinate versus tartrate miss, the blocked drugs, and the live-row filters. Those cases do not call RxNorm or OpenRouter.
- **Run a live lookup:** With the key in `.env`, use Find equivalent. The page lists suppliers only when `match.js` accepts the row. The model cost for that response is shown when OpenRouter returns one.

## 3. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
