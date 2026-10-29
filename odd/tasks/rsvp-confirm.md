# RSVP confirm page with per-family limit

## Objective

The Canva "Confirmar" button opens our own `/confirmar/` page. It knows the family (saved by their envelope),
lets them pick how many will attend (0 up to their `cantidadInvitados`), records the answer in a Google Sheet
and then opens WhatsApp to the RSVP number with the answer.

## Problem and why

Canva is one page for everyone and cannot know who opened it, so it cannot enforce each family's maximum.
Only the per-guest envelope knows the guest. Both the envelope and `/confirmar/` live on
`paalanis.github.io`, so the envelope can leave the guest id in `localStorage` for the confirm page.
The local `Invitados.xlsx` cannot be written by a web page; the list now lives in a Google Sheet that a
small Apps Script web app reads and writes.

## Scope

- Google Sheet "Invitados XV Morena" in Pablo's Drive (id `1XUA3Paouqc7eyLIyhXANVN_BZJ3EyBQZXGFGgCvZKLw`),
  columns `id, nombre, telefono, cantidadInvitados, Confirmado, fechaConfirmacion`. `id` is the guest page
  slug (same `slugify` as `tools/build-site.mjs`).
- `tools/rsvp/Code.gs`: Apps Script bound to the sheet. `doGet?id=` returns name, max and current answer
  (never the phone); `doPost` with a text/plain JSON body `{id, count}` validates `0 <= count <= max` and
  writes `Confirmado` and `fechaConfirmacion`. Pablo pastes and deploys it, then sends the web app URL.
- Envelope guest pages store their guest id in `localStorage`.
- New `prototype/confirm.html` built to `docs/confirmar/`.
- Fallback when the page does not know the guest: ask them to open the invitation from their WhatsApp link
  (default chosen because it exposes no guest data; Pablo can change it).

## Constraints

- Guest-facing copy is in Spanish; code, comments and docs are in English.
- Real guest data (names, phones, counts) is never committed; the repo is public.
- RSVP WhatsApp number: `5492615133030` (Morena's mother).
- Delivery strategy: `exception-ok` (personal project published from the feature branch through GitHub
  Pages). Forecast: about 450 authored lines.

## Tasks

- [x] T1 Create the Google Sheet with the guest list and an `id` column. Route: inline (Drive connector).
- [x] T2 Write `tools/rsvp/Code.gs`, the envelope guest-id storage and the `/confirmar/` page, and build
  `docs/`. Route: delegated writer (writer trigger: 3+ non-trivial files). Commit `a628291`.
- [x] T3 Pablo deploys the Apps Script and sends the web app URL; set it in the confirm page CONFIG,
  publish, and run an end-to-end check against the sheet. Route: inline. Commit `f77ad0c`, pushed.
- [x] T4 Pablo links the Canva "Confirmar" button to `https://paalanis.github.io/tarjetaMore/confirmar/`.
- [x] T5 Build the guest envelopes from the sheet (Pablo asked so he only edits the sheet). `Code.gs` gets a
  `doGet?action=list` that returns only `{id, name}` per row (names are already public through the built
  guest pages), fills an empty `id` from `nombre` with the same slugify as the build, and matches lookups on
  that id; `tools/build-site.mjs` gets a sheet mode (`npm run build:sheet`) that fetches the list and uses
  the sheet `id` as the page slug. Route: delegated writer (writer trigger: 2+ non-trivial files). Commit `e2bd3a9`.
- [x] T6 Pablo redeploys the script as a new version of the same deployment (same `/exec` URL); build the
  real envelopes from the sheet, publish, and check one family end to end. Route: inline. Commits
  `fe0c839`, `1852df4`, pushed.
- [x] T7 Close the T3-T6 review follow-ups (Pablo asked): `?action=list` validates every row before writing
  ids back; ids are lowercased in the list and the build; `general` (the general og image name) is a reserved
  slug; committed `node --test` tests for sheet mode (real CONFIG parsing, error handling, slug checks) and
  for `Code.gs` (stubbed Apps Script services) including slugify parity with the build. Route: delegated
  writer (writer trigger: 2+ non-trivial files). Commit `8a68158`. Pablo redeploys the script afterwards.
- [ ] T8 Dietary needs in the confirm step (2026-10-29). Pablo: "Necesito agregar en el paso de
  confirmaciones el detalle de si la gente es celíaca o tiene algún tipo de impedimento alimenticio. Hay que
  confirmar cuántas de las 5 personas, por ejemplo, que tienen permitido ingresar al evento o están
  invitados al evento, van a ser celíacos." He chose per-type counters: "Celíacos", "Vegetarianos",
  "Veganos" (each 0 up to the people attending) plus "Otra restricción (opcional)" free text. Sheet gets
  columns `celiacos, vegetarianos, veganos, otraRestriccion`; GET returns `celiac, vegetarian, vegan,
  otherDiet`; POST accepts them (missing means 0 / empty, for pages cached before the change) and rejects
  out-of-range values with `invalid_diet`; the WhatsApp text lists them. Route: inline (no writer reason).
  Pablo adds the four columns, then redeploys Code.gs as a new version.

## Acceptance criteria

- Opening a guest envelope, then `/confirmar/`, shows that family's name and a stepper limited to their max.
- Confirming writes `Confirmado` and `fechaConfirmacion` on the right row and then opens WhatsApp with the
  count; the script rejects counts above the max or unknown ids.
- Without a stored guest the page shows the "open your link" message; no guest data is ever shipped in the
  public pages beyond the guest's own id.
- `npm run build` stays deterministic; 360-430px with no horizontal scroll and no console errors.

## Progress

- T1 done: sheet created from the two rows in `Invitados.xlsx` (test data).
- The repo folder is synced by Google Drive, so the sheet shortcut `Invitados XV Morena.gsheet` appeared in
  it; `*.gsheet` is now ignored.
- T2 done (`a628291`): `npm run build` twice gives the same diff and leaves no changes; og JPEGs unchanged;
  `node --check` on a copy of `Code.gs` passes; Playwright smoke (mocked endpoint) at 360, 390 and 430px
  passed 68/68 checks: no-id message, stepper bounds 0..max, POST body `{"id":"marta","count":2}` as
  text/plain then a `wa.me/5492615133030` URL with "Confirmo 2 de 3", failure fallback with a WhatsApp link,
  no horizontal scroll, no page errors. `docs/marta/` stores `marta` in `xvMorenaGuestId`; `docs/` leaves it
  unchanged. Extra behaviour: Code.gs answers `busy` when its lock times out, and a failed GET shows a
  "No pudimos cargar tu invitación" WhatsApp fallback. Parent spot check: rebuild leaves the tree clean.
- Native review (range `d5c1ea3..HEAD`, T2 plus docs): medium, granted, approved, acknowledged (authority
  burned). Advisory follow-ups: one shared `localStorage` key means a phone that opened several envelopes
  confirms for the last one; ids are guessable slugs with no token, so anyone can read or overwrite a row;
  `confirmar/` must not be linked from Canva before the endpoint is set; no repeatable test of the server
  checks in `Code.gs`.
- Open risk for T3: WhatsApp's in-app browser may keep storage apart from the browser that opens Canva;
  check on a real phone.

- T3 done (`f77ad0c`, pushed): endpoint set in `prototype/confirm.html` CONFIG and rebuilt. Live checks: GET
  `?id=pablo-alanis` returns name and max 5 with no phone; unknown id gives `not_found`; POST counts 9 and -1
  give `invalid_count`. Real Chrome against the real endpoint (local server): confirm 2 opened
  "Confirmo 2 de 5 lugares… — Pablo Alanis" and the sheet read back `confirmed: 2`; a second run started at 2,
  went to 0, sent the "no vamos a poder asistir" text and the sheet read back `0`. Live site: `/confirmar/`
  200, `/marta/` stores `marta`, then `/confirmar/` calls the script from github.io and shows the
  open-your-link message (Marta is not in the sheet), no page errors.
- The test row `pablo-alanis` was left with `Confirmado = 0` and a date; Pablo clears it before sending.

- T5 done (`e2bd3a9`): `npm run build` leaves docs/ unchanged; sheet mode against a mock built
  `familia-perez/` and `romina-gonzalez/` with accented names and og images (then removed); duplicate_id and a
  down server exit 1 with a clear message and write nothing; `node --check` on Code.gs passes; a stubbed
  Code.gs harness passed 6/6 (ids filled from nombre, no phone/max/answer in the list, duplicate_id and
  empty_id, lookup by filled id, POST bounds, lock released, slugify matches the build). Extra: ids that
  clash with build folders are refused. Neither mode deletes stale guest folders (`marta/` stays).
  Parent spot check: `npm run build` leaves the tree clean. Native assess (base `5142e84`, committed): medium,
  `under_budget` (265 lines), so no review yet; the slice stays pending.

- T6 done: after Pablo published the new version, `?action=list` returned 6 families with only id and name.
  Pablo had typed 1-6 in `id`; on the parent's advice he cleared them so the script filled name slugs.
  `npm run build:sheet` first failed: the endpoint regex in `tools/build-site.mjs` had lost its backslash
  (`s*` for `\s*`), missed by T5 tests that used `RSVP_ENDPOINT`; fixed in `fe0c839`. `tools/guests.json`
  is now `[]` and `marta/` plus its og image were removed (Pablo agreed). Built and published 6 envelopes
  (`1852df4`); all six return 200, `/marta/` 404, og images 200; the og image for marcos-sebastianelli reads
  "Para Marcos Sebastianelli". Live: `/julieta-gil/` stores its id, then `/confirmar/` shows "Hola, Julieta
  Gil" with a stepper capped at 4, no page errors (nothing submitted).
- Native review (range `5142e84..HEAD`, T3-T6): medium, granted, approved, acknowledged (authority burned).
  Advisory follow-ups: `?action=list` writes ids before checking duplicates, so a failed list still changes
  the sheet; a family whose id is `general` would overwrite the general og image; hand-typed ids keep
  uppercase; no committed test for sheet mode or slugify drift. None affects the current 6 families.
- T7 done (`8a68158`): sheet logic moved to `tools/sheet-guests.mjs`; `npm test` (`node --test`, 25 tests).
  RED before the fixes: 6 of 25 failed for the intended reasons (uppercase id kept, ids written on
  duplicate_id/empty_id, `general` accepted, mixed-case slug and message). GREEN after: 25/25. `npm run build`
  leaves docs/ unchanged; `node --check` on Code.gs passes. About 530 lines, mostly tests (over the advisory
  400). Parent spot check: `npm test` 25/25 and a clean rebuild. Pablo must redeploy Code.gs (new version).
- Native review (range `62897c0..HEAD`, T7): medium, granted, approved, acknowledged (authority burned).
  Advisory follow-ups: `npm test` relies on `node --test` glob expansion (Node 21+; no engines field);
  a null row in the list throws a TypeError instead of a clean message; the closed-port test can flake and
  one assert runs inside a server handler.

- Pablo redeployed `tools/rsvp/Code.gs` (T7); live list returns the 6 lowercase ids and `?id=PABLO-ALANIS`
  finds the row.
- Pablo linked the Canva "Confirmar" button (T4) and ran the full phone flow (WhatsApp, envelope, Canva,
  Confirmar); the sheet read back `confirmed: 3` for `pablo-alanis`. WhatsApp previews were missing on his
  phone because of WhatsApp's own link preview setting (not even google.com showed one); fixed on his side.

- T8 code done: RED 5 of 28 failed for the missing dietary fields; GREEN 28/28 after `Code.gs` (an extra
  case pins that ordinary text starting with a digit is not prefixed, after a lost backslash turned
  `[=+\-@]` into a range). `node --check` on Code.gs passes; `npm run build` is deterministic (the
  regenerated `docs/og/general.jpg` differed only from the Chrome/fonts version and was restored).
  Playwright smoke with a mocked endpoint at 360/390/430px, 42/42: steppers capped at the people attending
  and clamped when the count drops, previous answers prefilled, POST body with the four fields, count 0
  hides the menu and sends zeros, WhatsApp text "Menú especial: 1 celíaco, 1 vegetariano. Otra
  restricción: alergia al maní" (plural "2 celíacos, 1 vegano"), no menu keeps the old text, no
  horizontal scroll, no page errors.
- Deploy order matters: the new script requires the four columns (it answers "Missing column" for every
  request without them), and the old script ignores the new fields. So: add the columns, redeploy, then push.

## Next step

- T8: Pablo adds `celiacos, vegetarianos, veganos, otraRestriccion` to row 1 of the sheet, redeploys
  `Code.gs` as a new version, then the page is pushed and checked live.
- Pablo clears his test answer (`pablo-alanis`, `Confirmado = 3`) before sending.
- Bulk send (new feature, not started): parent recommended a semi-automatic "Enviar" column in the sheet
  with a per-family `wa.me` link (prefilled message with the family's envelope link; Pablo taps send), tested
  first on `pablo-alanis` and `romina-gonzalez`. The fully automatic WhatsApp Web route was described with
  its ban risk. Pablo has not chosen yet; the message text is also pending.
- Rerun `npm run build:sheet` after any change to the families in the sheet.
