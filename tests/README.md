# Verification: Tests, Evals & User Feedback

Automated checks, from the repo root:

```bash
node --test
```

Node's built-in test runner is enough. There is no install and no compile step. The files in `tests/` cover the existing match rules, prescription parsing with the model mocked, refill and reminder dates, and seller ranking. They do not call RxNorm or OpenRouter.

On the prototype page, **Check rules** runs the same match cases in the browser.

Review agent changes and verify that the product works throughout the course. Use automated tests for application behavior when useful, model evals for output quality, and manual checks for the user experience. A test shows what it checked; record its limits.

## Build 4: choose one track

**Track A — Domain quality**

Define 3–4 rules for good output. Evaluate 10 cases: 5 normal, 3 messy, and 2 adversarial. Compare results before and after improvements, and ask one outside target user to review the result.

**Track B — User friction**

Watch 3–5 outside users try the product without coaching. Review PostHog replays, identify the top three friction points, and document fixes with before/after evidence. The app can still run locally.

Both tracks update PRD v4 and the build log on `docs/index.html`. Follow [Icerynk Build 4](https://www.icerynk.com/c/fa26-tech-gb-2160-dm2-f2/content/build-4-test-py-tests-model-evals) for the rubric. You do not need to complete both tracks.
