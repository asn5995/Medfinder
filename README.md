# MedFinder

> **One-line pitch:** A classmate on a long-term prescription can confirm the medicine, see a verified Indian equivalent and a landed cost, and keep the next refill on a calendar.

- **Builder:** Anirudh (`asn5995`)
- **Course:** NYU Stern, Building with AI, Fall 2026
- **Product page:** [asn5995.github.io/Medfinder](https://asn5995.github.io/Medfinder/)
- **Prototype:** runs locally with `node server.js`. GitHub Pages publishes `docs/` and has no API key.

## What exists today

The app is static HTML and JavaScript, plus one Node server. There is no account system and no compile step. Confirmed prescriptions and orders stay in the browser. `migrations/` is ready for a separate development database and production database, and nothing is written there until a development URL is set.

A typed drug is identified with RxNorm. `prototype/match.js` then accepts or rejects a row only when the ingredient, salt, strength, form, and release agree. `prototype/catalog.js` is the sample table used when the server has no key or no live page comes back. `server.js` asks OpenRouter for public India pharmacy listings and a US price. The key stays in `.env`.

Patients, orders, and sellers were not stored before this change. The page did not read a prescription photo, schedule a refill, or rank a seller. Those three pieces are now local records in the browser, with the decisions in plain JavaScript files the tests can run without a network call.

GitHub Pages deploys from the `docs/` folder on `main`. The prototype files are copied to `docs/prototype/`. PostHog records pageviews and clicks. The published prototype cannot read a prescription or list live suppliers, because it has no key.

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

On the prototype page, **Check rules** runs the same match cases in the browser.

There is no separate build. `node --check` is enough to confirm a JavaScript file parses, and `node --test` is the suite to run before review.

## Try the features

1. **Prescription upload.** Choose a JPG, PNG, WEBP, GIF, or PDF and click **Read prescription**. Edit the medicine, strength, frequency, and quantity, then **Save prescription**. A blurry file, a file that is not a prescription, a missing key, or a stopped server leaves a message and an empty form instead of saving a guessed drug. **Enter by hand** does the same confirm step without a model call. Without a key, the reader says `OPENROUTER_API_KEY` is missing.
2. **Refill calendar.** Save a medicine, set the supply length and the reminder lead, and place an order. The refill date is the order date plus the supply length. The reminder date is that refill date minus the lead time. **Load sample orders** shows an atorvastatin refill already inside the reminder window and a fulfilled metformin order. Open **Reminders** for the in-app notice, and move the calendar to the refill month.
3. **Seller rating.** **Mark fulfilled** on an order, then save one rating of 1 to 5 stars and an optional comment. A second rating on that order is refused. Sellers are listed by ranking score. **Let ranking assign this order** draws a seller with probability proportional to that score, so a higher rank receives more of those orders.

Sample orders replace the prescriptions and orders saved in this browser. **Clear this browser's saved data** removes them. The demo seller history stays.

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
- The ranked sellers are the demo list, plus ratings from this browser. A live supplier row from Find equivalent is not automatically added to that list.
- Uploaded files are limited to about 8 MB and to JPEG, PNG, WEBP, GIF, and PDF.

## Course map

| File / folder | Purpose |
| --- | --- |
| [`docs/index.html`](./docs/index.html) | Public pitch, living PRD, and weekly build log. |
| [`prototype/`](./prototype/) | Local app. Copied to `docs/prototype/` for GitHub Pages. |
| [`server.js`](./server.js) | Local server for supplier search and prescription reading. |
| [`tests/`](./tests/) | `node --test`, plus the Build 4 note. |
| [`AGENTS.md`](./AGENTS.md) | Commands and agent rules. |

[Icerynk](https://www.icerynk.com/c/fa26-tech-gb-2160-dm2-f2/content) holds the assignment instructions and submissions.
