# MedFinder

> **One-line pitch:** A classmate on a long-term prescription can confirm the medicine, see a verified Indian equivalent and a landed cost, and keep the next refill on a calendar.

- **Builder:** Anirudh (`asn5995`)
- **Course:** NYU Stern, Building with AI, Fall 2026
- **Product page:** [building-with-ai-f26.github.io/as20593-medfinder](https://building-with-ai-f26.github.io/as20593-medfinder/)
- **App:** runs locally with `node server.js`. GitHub Pages publishes `docs/` and has no API key, so its chat offers the sample medicines only.

## What exists today

The app is one chat screen: a short header, a warning line that stays visible, the conversation, and a message box with an attach button. The assistant asks one question at a time, in plain English. A summary is confirmed before any search or save. Results are compact cards with details hidden until tapped. Saved medicines, refill reminders, and seller ratings are in the **My meds** panel. The **About** panel links to the product page, the PRD, and the build log, and keeps **Check rules**.

It is static HTML and JavaScript, plus one Node server. There is no account system and no compile step. Confirmed prescriptions and orders stay in the browser. `migrations/` is ready for a separate development database and production database, and nothing is written there until a development URL is set.

A typed drug is identified with RxNorm. `prototype/match.js` then accepts or rejects a row only when the ingredient, salt, strength, form, and release agree. `prototype/catalog.js` is the sample table used when the server has no key or no live page comes back. `server.js` asks OpenRouter for public India pharmacy listings and a US price. The key stays in `.env`.

Saved prescriptions, orders, and seller ratings are local records in the browser, with the decisions in plain JavaScript files the tests can run without a network call.

GitHub Pages deploys from the `docs/` folder on `main`. The prototype files are copied to `docs/prototype/`. PostHog records pageviews and clicks. GitHub Pages cannot run the server, so `prototype/config.js` sends the published page's chat, prescription, supplier, and record requests to the Render service at `https://as20593-medfinder.onrender.com`. A page served by `node server.js`, locally or on Render, calls its own server. If the server cannot be reached, the page says so, offers **Try again**, and offers the sample medicines.

## Public server (Render)

`render.yaml` describes the service. It runs on the free plan with the same `node server.js`, and its name sets the address in `prototype/config.js`. To create it, sign in at dashboard.render.com with GitHub, choose **New → Blueprint**, and pick this repo. Paste `OPENROUTER_API_KEY` into Render's environment settings, not into the repo. Leave the database fields blank. Every push to `main` redeploys it.

- The server answers browser requests only from `https://building-with-ai-f26.github.io`, plus any origins in `ALLOWED_ORIGINS`.
- `GET /health` returns `{ ok, ready }`, where `ready` says whether the key is set. The page calls it first, which also wakes a sleeping free-plan server. That can take about a minute.
- Set a monthly limit on the OpenRouter key. Anyone with the public link can use the chat, within the per-visitor limits.
- To test the cross-origin path locally, start the server with `ALLOWED_ORIGINS=http://127.0.0.1:8791`, serve the repo as static files on port 8791, and open `/docs/prototype/?api=http://127.0.0.1:8787`. A page that is not local ignores `?api=`.

## Local setup

Node is the only dependency. From the repo root:

```bash
cp .env.example .env
node server.js
```

Open [http://127.0.0.1:8787/prototype/](http://127.0.0.1:8787/prototype/). Do not open the HTML file from the disk. A `file://` page cannot call RxNorm.

Set `OPENROUTER_API_KEY` in `.env` before using live supplier search or prescription reading. Restart the server after changing `.env`.

## Environment

| Variable | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | OpenRouter key for supplier search and prescription reading. Never commit it. |
| `OPENROUTER_MODEL` | Supplier search model. Default `perplexity/sonar`. |
| `OPENROUTER_EXTRACT_MODEL` | Prescription photo and PDF model. Default `google/gemini-2.5-flash`. It needs to accept images and PDFs. |
| `OPENROUTER_CHAT_MODEL` | Chat intake model for `POST /chat`. Default `google/gemini-2.5-flash`. |

## Chat intake (`POST /chat`)

The server route behind the chat screen. The page sends the conversation, the details so far, and the last question asked. The model pulls details out of the patient's words and writes one short reply. Before the page uses anything, `lib/chat.js` checks it:

- Only `name`, `strength`, `form`, `release`, `frequency`, `quantity`, and `supplyDays` are kept, in the same formats `match.js` reads. Other keys are dropped.
- A detail is kept only when it appears in the patient's own messages. "My cholesterol pill" never becomes atorvastatin. Assistant messages cannot supply a detail.
- A reply that mentions a price, seller, pharmacy, link, a match, advice, or a strength the app does not have is replaced with a fixed question.
- A medical advice question gets a fixed refusal. Common phrasings are caught by code before the model is called.
- Short answers to the question just asked, such as "20 mg", "tablet", or "no", are read by code with no model call.

`prototype/chat.js` holds those rules and the question order: name, strength, form, release. Frequency, quantity, and supply length are kept when mentioned but never asked for before a search. When release is missing, the page can call `suggestRelease` with the RxNorm names. If RxNorm lists only one version at that strength and form, the summary shows it as a suggestion for the patient to confirm. Otherwise the patient is asked.

`/chat` allows 60 requests per visitor in 10 minutes, separate from the shared limit of 20 on `/extract`, `/listings`, and `/records`.

`.env.example` lists the names only. The server reads `.env` at startup and does not send the key to the browser. The page does not store the uploaded file. The server forwards it to OpenRouter for that one request.

Refill length and reminder lead time are not environment variables. They default to 60 days and 20 days, and each medicine or order can change them on the page.

## Tests

```bash
node --test
```

That runs every file in `tests/`. It includes the 15 match-rule cases, prescription parsing with the model replaced by a fake `complete` function, the chat intake checks in `tests/chat.test.js`, refill and reminder dates, and seller ranking. Nothing in that command calls RxNorm or OpenRouter.

In the app's **About** panel, **Check rules** runs the same match cases in the browser. `?checks=1` opens it and runs them.

There is no separate build. `node --check` is enough to confirm a JavaScript file parses, and `node --test` is the suite to run before review.

## Try the features

1. **Chat.** Type "Lipitor", then "20 mg", then tap **Tablet**. RxNorm lists only the regular version, so the summary suggests it. Tap **Search**. Or type it all at once: "Toprol XL 50mg tablets once a day". Correct anything in your own words, such as "actually it's 25 mg". **Change something** and **Start over** are on every summary.
2. **Prescription upload.** Tap the paperclip and choose a JPG, PNG, WEBP, GIF, or PDF. The bot shows what it read and asks only about what is missing. A prescription with several medicines is handled one at a time. A blurry file, a file that is not a prescription, a missing key, or a stopped server gives a message, not a guessed drug.
3. **Refill reminder.** After a search, tap **Save & set a refill reminder**. Pick the supply length (60 days by default) and a seller, or let the ranking pick. The summary shows the refill date and a reminder 20 days before it. Say "remind me 10 days before" to change that, then tap **Save**. The reminder shows at the top of the chat and in **My meds** once it is due.
4. **Seller rating.** In **My meds**, tap **Mark fulfilled** on an order, then tap 1 to 5 stars. A second rating on that order is refused. **Let the ranking pick** draws a seller with probability proportional to its ranking score.
5. **Things the bot refuses.** Ask "Can I take it with grapefruit juice?" and it gives a fixed refusal. Say "my cholesterol pill" and it asks for the name instead of guessing.

**Load sample orders** in **My meds** replaces what this browser has saved. **Clear this browser's saved data** removes it. The demo seller history stays.

## Seller ranking

A new seller with one 5-star rating should not jump ahead of a seller with a longer record. Each seller gets a smoothed rating and a smoothed fulfillment rate, then one score.

```
ratingAverage = (C × m + sum of stars) / (C + n)
```

`C` is 8 prior ratings and `m` is 3.5 stars. `n` is the number of real ratings, and the sum is those stars. A brand-new seller therefore sits at 3.5. One 5-star rating moves that seller only to `(8 × 3.5 + 5) / 9`, about 3.67, not to 5.

```
reliability = (R × p + fulfilled orders) / (R + assigned orders)
```

`R` is 6 prior orders and `p` is 0.8. Fulfilled orders are capped at the assigned count. A seller with no orders stays at 80 percent.

```
rankingScore = 0.7 × (ratingAverage / 5) + 0.3 × reliability
```

The page sorts sellers by `rankingScore`, highest first. The percentage on each card is that seller's score divided by the total of the scores. **Let ranking assign this order** draws one seller with that probability. Stars outside 1 to 5 are ignored. The six sellers in `prototype/sellers.js` are fictional demo history, not live pharmacy reviews. With that seed, the order is Apollo Pharmacy, Netmeds, PharmEasy, NewChem, CityMed, then MedPlus. NewChem's single 5-star review is not enough to pass the longer records. CityMed, with no reviews, stays above MedPlus, whose reviews and fulfillment are weaker than the prior.

Ratings saved in this browser are added on top of that seed for the seller on the order.

## Reminders

The notice is in the page: "It's time to place another order…", or a line that the refill date has passed. Dismiss hides that notice in this browser. Placing a newer order for the same medicine and strength replaces the older refill, so the old reminder stops.

Email and push are not set up. There is no mail provider, no patient inbox, and no push subscription. A daily job can call the same `reminders` function in `prototype/clinic.js` and send each notice's `message`. Email needs an address on the patient and a provider such as SMTP or Resend. Push needs a service worker, a browser subscription, and VAPID keys. Those values would go in `.env` when a provider is chosen. They are not read today.

## Assumptions

- One demo patient is stored in this browser under `medfinder-clinic-v1`. There is no login.
- An order is a planning record. The app does not take payment or ship medicine. The patient marks an order fulfilled.
- A maintenance medicine is treated as ongoing. The next refill is `supplyDays` after the order date, not after the fulfilled date. The default is 60 days. The quantity text is not turned into a day count, because the directions are free text. Set the supply length to the number of days the fill covers.
- The reminder lead must be a whole number of days shorter than the supply. The default is 20.
- The same medicine name and strength share one active refill. A different strength is tracked on its own.
- Controlled substances and insulin stay blocked. `match.js` refuses those orders.
- After a live search, the order's seller is one of the listings the search found and verified. After a sample result, it is one of the demo sellers, ranked by their demo history plus ratings from this browser. A live seller's ratings count in the ranking only when its name matches a demo seller.
- Uploaded files are limited to about 8 MB and to JPEG, PNG, WEBP, GIF, and PDF.

## Course map

| File / folder | Purpose |
| --- | --- |
| [`docs/index.html`](./docs/index.html) | Public pitch, living PRD, and weekly build log. |
| [`prototype/`](./prototype/) | Local app. Copied to `docs/prototype/` for GitHub Pages. `chat-ui.js` draws the chat, `chat.js` holds the intake rules, `lookup.js` runs RxNorm and the supplier search. |
| [`lib/chat.js`](./lib/chat.js) | Server side of the chat: the prompt, the model call, and the checks on its output. |
| [`server.js`](./server.js) | Local server for supplier search and prescription reading. |
| [`tests/`](./tests/) | `node --test`, plus the Build 4 note. |
| [`AGENTS.md`](./AGENTS.md) | Commands and agent rules. |

[Icerynk](https://www.icerynk.com/c/fa26-tech-gb-2160-dm2-f2/content) holds the assignment instructions and submissions.
