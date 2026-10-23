# Own invitation page

## Objective

Replace the Canva invitation (https://morena0512.my.canva.site/) with our own page, so Pablo can change it
freely. Restyle the envelope to the same black-and-silver look, and point the envelope's "VER INVITACIÓN"
button at the new page.

## Problem and why

Pablo has no access to the Canva account, so the invitation cannot be edited. The envelope (wine, blush
and gold) also does not match the invitation's black-and-silver disco style, which Pablo chose to keep.

## Scope

- Move the site generator from the session scratchpad into the repo (`tools/`), with a `package.json`.
- Restyle `prototype/envelope.html` to black, silver and a gold crown accent.
- New `prototype/invitation.html` that replicates the Canva content and sections in the same style.
- The build writes `docs/invitacion/index.html` and links the envelope to it.
- Rebuild `docs/` (pages and og images) and publish through the existing GitHub Pages branch.

## Content replicated from Canva (2026-10-23)

1. Hero: "MORENA", a gold crown, "Mis quince años" (script), disco-ball mood.
2. Countdown: "El día más esperado de mi vida está llegando..." with días / horas / minutos / segundos.
3. ¿Cuándo?: 05 de diciembre del 2026. The time is not given (placeholder).
4. ¿Dónde?: Salón Palatium Magnus, "VER MAPA" -> https://maps.app.goo.gl/2pEdAkhitZjTjDFA8?g_st=ac
5. Dress code: Formal - Elegante, "VER RESTRICCIONES". The text is unknown (placeholder).
6. Regalo: "Tu presencia es mi mejor regalo, sin embargo si pensabas hacer un obsequio, podés enviarlo al
   siguiente alias.", "DATOS PARA TRANSFERENCIA". The alias is unknown (placeholder).
7. Confirmá tu asistencia: antes del 15 de noviembre 2026, "Confirmar" -> wa.me/5492615133030 with
   "Hola! Quiero confirmar mi asistencia al cumpleaños de 15 💕".
8. "Sumá un mensaje bonito" box.
9. Closing: "Morena" in script with the crown.

## Constraints

- Do not reuse Canva media (disco-ball and sparkle videos, crown image). They are Canva library assets.
  Recreate the effects with CSS, canvas or inline SVG.
- `Invitados.xlsx` is never committed.
- Guest-facing copy is in Spanish; code, comments and docs are in English.
- Delivery strategy: `exception-ok`. This is a personal project published straight from the feature branch
  through GitHub Pages, with no pull requests planned. The forecast is about 900 authored lines, mostly the
  new invitation page.

## Tasks

- [x] T1 Move the generator into `tools/` (build-site and og rendering) with a `package.json`; the output
  does not change. Route: delegated writer (writer trigger: 2+ non-trivial files across T1-T3). Evidence:
  `761040d`; the build output was byte-identical to the scratchpad output.
- [x] T2 Restyle the envelope to black and silver; regenerate the og images. Route: delegated writer.
  Evidence: `e833eb8`; the parent checked the opened-card screenshot.
- [x] T3 Build `prototype/invitation.html` and the `docs/invitacion/` output; the envelope links to it.
  Route: delegated writer. Evidence: `82a7e0c`. A Playwright smoke test at 390px found no console
  errors and no overflow; the countdown ticks and the panels open and close. The parent checked the
  full-page screenshot, and a parent rebuild left `docs/` unchanged. Fonts: Cinzel, Great Vibes, Montserrat.
- [ ] T4 Publish (push) and check HTTP 200 for every page and image. Route: inline (git/curl).
- [ ] T5 Pablo provides the missing data: event time, dress-code restrictions and transfer alias. Pending
  on Pablo. Resolved: the RSVP number 5492615133030 belongs to Morena's mother and is the final one;
  Pablo's 5492613829997 is used while testing.

## Acceptance criteria

- `node tools/build-site.mjs` regenerates `docs/` deterministically.
- The envelope and the invitation share the black-and-silver palette and work at 360-430px phone widths.
- Every Canva section is present. Countdown, map, RSVP and the restriction/transfer panels work; unknown
  data is shown as clearly marked placeholders.
- No Canva-hosted asset is referenced.

## Progress

- T1-T3 done by the delegated writer and committed. Placeholders live in the `CONFIG` object of
  `prototype/invitation.html`: time (21:00 assumed for the countdown), restrictions, alias and account
  holder.

## Next step

- T4: native review, then push and run the 200 checks.
