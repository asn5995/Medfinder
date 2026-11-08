# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** MedFinder, a local page that takes a typed drug and either shows a verified sample equivalent sold in India with a 90-day landed cost, or names the rule that failed.
- **Primary user & core workflow:** A classmate or friend on a long-term prescription. See the living PRD in `docs/index.html`. The one workflow is prescription drug in, verified Indian equivalent and landed cost out.
- **Tech stack:** Static HTML and JavaScript in `prototype/`. No install, no server, and no API key. The match is decided by rules in `prototype/match.js`. Photo upload through OpenRouter is the next increment, not this prototype.

## 2. Commands
- **Install dependencies:** None.
- **Run locally:** Open `prototype/index.html` in a browser. From the repo root in PowerShell: `start "" "prototype\index.html"`
- **Run deterministic tests:** On that page, click **Check rules**. Ten cases should pass, including the strength miss, the succinate versus tartrate miss, and the blocked drugs.
- **Run model evals:** Not used. This prototype does not call a model.

## 3. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
