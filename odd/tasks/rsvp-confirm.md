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
- [ ] T4 Pablo links the Canva "Confirmar" button to `https://paalanis.github.io/tarjetaMore/confirmar/`.

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

## Next step

- T4: Pablo links the Canva "Confirmar" button to `https://paalanis.github.io/tarjetaMore/confirmar/`.
- Before sending: build the real guest pages with names whose slugs match the sheet `id` column, and test on
  a real phone through WhatsApp (in-app browser storage).
