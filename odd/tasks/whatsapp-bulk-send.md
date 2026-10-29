# WhatsApp bulk send of the guest envelopes

Objective: one local script sends every family its envelope link by WhatsApp Web, unattended. Branch
`feat/whatsapp-invite-site`; delivery `exception-ok` (personal project, GitHub Pages from the branch);
tests with `npm test` (`node --test`).

## Specs

- S1 Families need not be saved as contacts. Pablo: "No tenemos toda la agenda guardada en el teléfono. La
  agenda, de la lista del Excel, hay algunos que están agendados y otros que no. ¿Cómo resolvemos este
  escenario? De la forma más automatizada posible. Se me ocurre un script, arranca el script y hace todo el
  trabajo solo." Chats open by number through `web.whatsapp.com/send?phone=`; phones such as `2613829997`
  become `5492613829997`.
- S2 The script presses Enter itself. Pablo: "la uno se puede automatizar? que enter lo haga solo?"
- S3 One fixed message, written in the sheet. Pablo: "el tema de mensaje no lo hacemos dedicado si no uno
  fijo a definir." and "El mensaje a definir lo podemos dejar a escribir en el excel, asi cuando me siente
  con Vale, la mama de More lo escribo." Each family's envelope link is added to it.
- S4 Random pauses. Pablo asked "uno a los 2 segundos, el siguiente a los 3, vuelva a un segundo, algo
  random como maximo 5 segundos"; after the ban-risk explanation he accepted the parent's proposal of 20 to
  60 seconds at random, with a rest of about 5 minutes every 20 messages ("si").
- S5 (parent safeguards, accepted with "Me gusta") test first with 2 families (`pablo-alanis`,
  `romina-gonzalez`); mark each send in the sheet so a rerun resumes without repeats; stop on anything
  unexpected.
- S6 (assumption, required by the public repo and endpoint) phones are only returned with a secret key
  kept in the script properties and in a local ignored file.

## Tasks

- [x] T1 `Code.gs`: secret-key actions `send-list` (message, id, name, phone, sent) and `mark-sent`; sheet
  column `Enviado` and tab `Mensaje`. S3, S5, S6. Route: inline.
- [x] T2 `tools/send-invites.mjs` (`npm run send`): phone normalization, message composition, pacing,
  WhatsApp Web through Playwright with a persistent Chrome profile, `--dry-run` and `--only`. S1-S5.
  Route: inline.
- [ ] T3 Pablo adds `Enviado`, the `Mensaje` tab and the key, redeploys, scans the QR and runs the test with
  2 families; then the full run. Route: inline (Pablo).

## Log

- L1 (2026-10-29) Pablo: "El tema es el siguiente. No tenemos toda la agenda guardada en el teléfono. La
  agenda, de la lista del Excel, hay algunos que están agendados y otros que no. ¿Cómo resolvemos este
  escenario? De la forma más automatizada posible. Se me ocurre un script, arranca el script y hace todo el
  trabajo solo."
- L2 Options given: assisted (Pablo presses Enter), fully automatic (ban risk on his personal number),
  official Business API (heavy). Pablo first picked the API by mistake ("no no"), then asked for Enter to be
  automatic. Sending number (personal or a spare one) is still open; it does not change the code.
- L3 Pablo: "Me gusta, el tema de mensaje no lo hacemos dedicado si no uno fijo a definir. podes armar que
  se envien uno a los 2 segundos, el siguiente a los 3, vuelva a un segundo, algo random como maximo 5
  segundos." Parent pushed back (1-5 s is a spam pattern; an unattended run costs nothing extra in time) and
  proposed 20-60 s; Pablo: "si. El mensaje a definir lo podemos dejar a escribir en el excel, asi cuando me
  siente con Vale, la mama de More lo escribo."
- L4 T1: RED 5 of 34 (send actions missing), GREEN 34/34. `telefono` and `Enviado` are mapped only for the
  send actions, so the RSVP page keeps working if `Enviado` is missing; a key shorter than 16 characters or
  unset refuses everything. Risk: item 2 (the key is the only thing between the public endpoint and the
  phones).
- L5 T2: written before its tests (no RED observed for T2); 45/45. Mutations all caught: 1-5 s pauses,
  resending sent families, loose phone length, no key check, short key accepted. The resend mutation first
  hung because main opened a real Chrome; main now takes `openBrowser` and the tests pass a guard that
  throws (the leftover test Chrome and its empty `~/.tarjetamore-whatsapp` profile were removed). Scratch
  smoke against a fake WhatsApp Web: login wait, text with accents/emoji/link sent and composer cleared,
  invalid number stops in under 10 s, an unsent message stops. Real WhatsApp Web selectors are unproven
  until T3's two-family run. Local `.send-key` created (ignored by git).
- L6 Independent verifier (item 2) on `44eb37d`: no blockers; 6,406 adversarial requests without the exact key
  gave 0 leaks and 0 writes; 832 paired baseline/HEAD cases of the RSVP actions were identical. Advisories: a
  POST carrying any `action` field goes to the send actions (the page never sends one); no constant-time
  compare or rate limit (negligible with a random 32-character key); any non-empty `Enviado` counts as sent;
  `send-list` does not reject duplicate or empty ids (the build's list action does). Parent spot check:
  `npm test` 45/45. Verifier scratch removed.
- L7 Native review (`fae4f22..b68d4ec`, T1+T2): medium, granted by Pablo, lenses risk, resilience and
  reliability, approved, acknowledged (authority burned). Advisory follow-ups, none blocking: if the message
  goes out but `mark-sent` fails, the run stops and a rerun would send that family again (no retry of the
  mark); the outgoing-message count proves display, not delivery; a generic `role="dialog"` could stop the run
  on an unrelated WhatsApp dialog (a safe false stop); `send-list` duplicate/empty ids as above.
- L8 T3 first real run (`--only pablo-alanis,romina-gonzalez`): QR scanned, then "pablo-alanis: WhatsApp did
  not open the chat for 5492613829997 (number not on WhatsApp?)"; nothing sent or marked. Cause: the
  "Iniciando chat…" popup that WhatsApp Web shows while opening a `send?phone=` link matched the generic
  popup selector (the L7 advisory). Fix: only a popup whose text matches /válido|valid/i counts as a bad
  number. Scratch fake WhatsApp now shows that popup and adds the composer only after it: the old code fails
  with Pablo's exact message, the fix passes 6/6; `npm test` 45/45.
- L9 Second real run: the chat opened, then "pablo-alanis: the message did not show as sent"; Pablo: "no no
  me llego" (nothing arrived, nothing marked), so Enter did not send in the real WhatsApp Web. Changes, with
  the cause still unproven: check the link was typed into the box; Enter, then the visible send button if
  the box still has text; success means the box emptied and the family link shows in `#main` (no longer
  `div.message-out`); on a SendError, the footer-only screenshot and a box/button summary (no phone, no
  message text) are saved to a temp folder whose path is printed. Playwright 1.49 has no
  `filter({ visible })` (silently ignored), so the button is picked by a loop over visible matches. Scratch
  fake (starting-chat popup, delayed composer, hidden decoy button): Enter path, button fallback, nothing
  sends, no prefill, invalid number and diagnostics content all pass 7/7; `npm test` 45/45.
- L10 Real run after the fixes: `--only pablo-alanis` sent and marked; Pablo confirmed through the link. Then
  with Pablo's message `{link} Te invito a mi fiestita!!` and the sheet cleaned, `--only
  pablo-alanis,romina-gonzalez` sent both (34 s pause between them) and marked `Enviado`; a dry run now lists
  only the other 4 families. Pending: the full `npm run send` when Pablo decides.
- L11 (2026-10-29) Pablo: "Hay un tema con la vista previa, no alcanza a  cargarla". Reproduced on WhatsApp
  Web without sending: the preview card (`compose-box-link-preview`, thumbnail `img` inside
  `link-preview-container`) shows 7-8 s after the chat opens, but `sendOne` sent after a fixed 6 s. Fix: poll
  with `page.evaluate` until the preview image has loaded (45 s limit; on timeout the run stops and nothing
  is sent). `page.waitForFunction` was tried first and fails at once on WhatsApp ("EvalError ... 'unsafe-eval'"
  from its Content Security Policy); the fake chat now carries the same CSP. Fake smoke 10/10 (new: preview
  present at send time, no preview stops with nothing sent); before the fix the no-preview case fails.
  Real no-send check: preview image loaded after 7 s. `npm test` 52/52.
- L12 Native review of `084427d..3135bd4` (medium, granted by Pablo, lens reliability): approved and
  acknowledged. Advisory acted on: the typed-text check ran right after the box appeared, with no wait, so a
  late prefill would stop the run; it now runs after the preview wait (the preview only shows once the text is
  in). New fake case "text typed in 2 s after the box": the previous code throws, the fix sends; fake smoke
  11/11, `npm test` 52/52. Advisories left: the fake smoke lives in the session scratch, not in the repo;
  evaluate errors during the preview wait count as "not loaded" (a safe stop after 45 s).
