# Security review

MedFinder is an AI app with no sign-in. Saved prescriptions, orders, and ratings are still kept in the browser. The repo now also has a database schema for those text fields. No Supabase project exists yet, so the live site does not save rows on a server. Prescription photos and PDFs are not stored.

Checked on November 22, 2026, from this branch, before any Render or Supabase account was connected.

## What was checked

- The repo and the live GitHub Pages site were searched for `sb_secret_`, `service_role`, `sk-or-`, `sk-ant-`, `sk-proj_`, and `sk_live_`.
- `POST /extract` was called 30 times in a row from one visitor.
- `GET /.env` and `GET /prototype/../.env` were requested from the local server.
- A blocked drug was sent to `POST /listings`.
- A file body was sent to `POST /records`.
- `migrations/001_clinic.sql` was read for row security and for grants to the public `anon` role.
- `npm audit --audit-level=high` was run. The app has no third-party packages.
- PostHog's `phc_` key is public on purpose and was not treated as a secret.

## What the checks found

- No secret prefix appeared in the repo or in the live pages at `https://asn5995.github.io/Medfinder/` and `https://asn5995.github.io/Medfinder/prototype/`. The OpenRouter key is read from the server environment.
- The first 20 calls to `/extract` reached the reader. Calls 21 through 30 returned HTTP 429 with "Too many requests. Wait and try again." The limit is 20 requests per visitor each 10 minutes, shared by `/extract`, `/listings`, and `/records`.
- `GET /.env` and the path that climbs out of `prototype/` both returned 404. The body did not contain the OpenRouter key name.
- `Adderall` on `/listings` returned `blocked` and the model function was not called.
- `/records` stored a confirmed medicine name and rejected a body that included file bytes. Nothing in the schema is a file column.
- The migration enables row security on every saved table and revokes all grants from `anon` and `authenticated`. It creates no allow policy. The service role stays on the server. A failed database write does not return the key.
- `npm audit` reported 0 vulnerabilities.

## Five attacks

1. **Read the environment file through the site.** `GET /.env` and `GET /prototype/../.env` on the local server. Both came back 404, and the response did not contain a key.
2. **Send something that is not a prescription, and send a file to the database.** The reader returned `unreadable` and an empty medicine list. `POST /records` with `dataBase64` returned 400 and `files_not_stored`. The saved list stayed at one text record. A separate check still rejects an upload over the body limit with `file_too_large`.
3. **Ask the paid lookup for a blocked drug.** `POST /listings` for Adderall returned `blocked`. The injected model function was called zero times.
4. **Call the AI route 30 times.** Twenty calls were accepted. The next ten returned 429. The reader ran 20 times, not 30.
5. **Insert and delete with the public database key.** This was not run against a live database. There is no Supabase project and no public key to paste into the browser console. The committed SQL is what would reject that client: row security is on, and `anon` has no grants and no policy. Creating the project and running this console test is waiting on approval.

## What was fixed in this change

- Paid and database routes now return 429 before a visitor reaches 30 calls.
- The static server already hid dotfiles. The check above confirms `.env` is not readable.
- Confirmed text can be stored later, and file bytes are refused.
- The production migrate command refuses to change the production database.
- The server listens on `0.0.0.0` only when Render starts it. Local development stays on `127.0.0.1`.

## Chat intake (added November 27, 2026)

- `POST /chat` calls the model from the server only, with the same `OPENROUTER_API_KEY`. The key never reaches the page.
- The route has its own limit: 60 requests per visitor in 10 minutes. It does not use up the shared limit of 20.
- The model's JSON is checked in `lib/chat.js` before the page uses it. Unknown keys are dropped. A detail must appear in the patient's own messages, and assistant or system messages cannot supply one. The page cannot send a system message. History is trimmed to the last 12 messages of 600 characters each.
- A reply that mentions a price, a seller, a link, a match, advice, or a strength the app does not have is replaced with a fixed question. Medical advice questions get a fixed refusal, and common phrasings never reach the model.
- Checked with `node --test` (fake model) and a live run on November 27: a bad model id and a missing key both returned a message, not a crash.

## Still open

- The public-key insert and delete has not been tried on a real database. Do that after the development project exists, and only against development.
- The OpenRouter monthly spending cap is not set. That setting is in the OpenRouter account.
- Render and Supabase are described in the repo and are not connected. Until they are, GitHub Pages cannot run the rate limit, because it does not run `server.js`.
- The in-memory limit clears when the process restarts, and it is not shared by more than one instance.
- Supabase's free plan has no automatic backup. A manual export of production is required before the first production migration. That export has not been made, because production does not exist yet.
- No file bucket exists. If one is added later, it stays private and files are shared with expiring links.
