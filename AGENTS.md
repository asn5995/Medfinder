# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** MedFinder. A typed drug is identified with RxNorm, then rules either show an Indian equivalent with a US price and a 90-day landed cost, or name the rule that failed.
- **Primary user & core workflow:** A classmate or friend on a long-term prescription. See the living PRD in `docs/index.html`. The one workflow is prescription drug in, verified Indian equivalent and landed cost out.
- **Tech stack:** Static HTML and JavaScript. `prototype/catalog.js` is the drug table. `prototype/match.js` is the only match decision. `prototype/index.html` calls `https://rxnav.nlm.nih.gov/REST/drugs.json` and renders the result. The same three files are copied to `docs/prototype/` for GitHub Pages. PostHog pageviews and clicks are wired on the product page and the prototype; paste the public `phc_` key into `MEDFINDER_POSTHOG_KEY` on both pages. No secret is required for RxNorm. Photo upload is still a later step.

## 2. Commands
- **Install dependencies:** None.
- **Run locally:** Do not open the HTML file from the disk. A `file://` page cannot call RxNorm. From the repo root: `python3 -m http.server 8765`, then open `http://127.0.0.1:8765/prototype/`. The published copy is `https://asn5995.github.io/Medfinder/prototype/`.
- **Run deterministic tests:** On that page, click **Check rules**. Ten cases should pass, including the strength miss, the succinate versus tartrate miss, and the blocked drugs. Those cases do not call RxNorm.
- **Run model evals:** Not used. RxNorm identifies the name. `match.js` decides the match.

## 3. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
