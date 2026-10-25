# Canva invitation with hosted info pages

## Objective

Go back to the Canva invitation (https://morena0512.my.canva.site/) now that Pablo has edit access, and
host two small pages that the Canva buttons "VER RESTRICCIONES" and "DATOS PARA TRANSFERENCIA" link to.

## Problem and why

The own invitation page existed only because the Canva design could not be edited. With access, Canva keeps
every effect (disco ball, sparkles, animations) for free. Canva website buttons can only open a link or jump
to another page of the design, so they cannot open a panel or copy the alias. Hosted pages fix both.

## Scope

- New pages `docs/restricciones/` and `docs/transferencia/` in the black-and-silver style, reusing the
  content of the panels in `prototype/invitation.html` (restrictions text, alias, account holder, "Copiar
  alias"), each with a "Volver a la invitación" link to the Canva site.
- Every envelope's "VER INVITACIÓN" link points at the Canva site (no `?n=`; Canva cannot read it).
- `docs/invitacion/` stays built but is no longer linked from the envelope.

## Constraints

- Guest-facing copy is in Spanish; code, comments and docs are in English.
- Missing data stays as clearly marked placeholders until Pablo provides it (time, restrictions, alias,
  account holder).
- Delivery strategy: `exception-ok` (personal project published from the feature branch through GitHub
  Pages). Forecast: about 300 authored lines.

## Tasks

- [x] T1 Build the two info pages and their `docs/` output. Route: delegated writer (writer trigger: new
  page source plus build script changes, 2+ non-trivial files). Commit `f6ac5bf`.
- [x] T2 Point every envelope CTA at the Canva site and rebuild `docs/`. Route: same delegated writer.
  Commit `0a275ec`. The built `href` has no `?n=`; see T2a for the runtime one.
- [x] T2a Stop the envelope script from appending `?n=<guest>` to the CTA at runtime on guest pages
  (`prototype/envelope.html`, "Carry the name over to the invitation page" block). Found while verifying
  T2: `docs/marta/` resolves the link to `https://morena0512.my.canva.site/?n=Marta`. Outside the T1/T2
  edit surface, so not changed. Route: inline (one small edit plus rebuild). Done: the block was removed
  and the prototype CTA default now points at Canva; `docs/marta/` keeps `href="https://morena0512.my.canva.site/"`
  and no longer contains the `searchParams.set("n"` code; a second build leaves `git status` clean.
- [x] T3 Publish (push) and check HTTP 200 for the new pages. Route: inline. Pushed `14e0c8d` with Pablo's
  go-ahead; 200 for `/`, `/marta/`, `/restricciones/`, `/transferencia/`, `/invitacion/` and both og JPGs;
  live `/marta/` CTA is the Canva URL with no runtime `?n=` code.
- [ ] T4 Pablo links the Canva buttons to the two pages and fills the missing data (alias and account holder). Pending on Pablo.

## Acceptance criteria

- `npm run build` regenerates `docs/` deterministically, including both new pages.
- Both pages work at 360-430px with no horizontal scroll and no console errors; "Copiar alias" copies the
  alias and shows feedback.
- The envelope CTA on the general and guest pages is `https://morena0512.my.canva.site/`.

## Progress

- Feature document created.
- T1 done (`f6ac5bf`): `prototype/restrictions.html` and `prototype/transfer.html` (each with its own
  small CONFIG), built to `docs/restricciones/` and `docs/transferencia/` with the general og image. The og
  JPEGs were re-rendered in the same commit: byte-stable between builds but different from the committed
  ones, with no envelope change (likely a font or browser update).
- T2 done (`0a275ec`): every envelope `#cta` is `https://morena0512.my.canva.site/`, same tab;
  `docs/invitacion/` is still built and unlinked.
- Evidence: `npm run build` succeeds and writes both pages; a second build leaves `git status` clean;
  `grep -c morena0512.my.canva.site` gives 1 for `docs/index.html` and `docs/marta/index.html`, with no
  `invitacion/` href left; a Playwright smoke run over both pages at 360, 390 and 430px, with and without
  reduced motion, shows no console errors, `scrollWidth` equal to the viewport, the back link pointing at
  the Canva site in the same tab, and "Copiar alias" showing "¡Alias copiado!" (clipboard API and the
  forced fallback path).
- T2a done (`fbb78a0`).
- Native review (T1-T2a range): medium, granted, approved, acknowledged. Advisory follow-ups: "Copiar alias"
  still copies the placeholder text until the real alias is set; no automated assertion for the CTA href;
  og render drift between machines.
- Restrictions content set by Pablo: "Dress code" / "No utilizar color" / "Rosa, Plateado, Lila y Champagne",
  with four crossed-out color dots; "Formal - Elegante" removed from this page (it stays in the Canva section).
  Checked at 360 and 430px: no console errors, no horizontal scroll; parent checked the screenshot.
- Pablo asked to drop the crown and the "Mis XV · Morena" script title from both pages; removed with their
  CSS, the crown symbol and the Great Vibes font. Checked at 360 and 430px: no console errors, no horizontal
  scroll; parent checked both screenshots.
- Still placeholders: alias and account holder.

## Next step

- T4 on Pablo: link the Canva buttons and send the alias and account holder.
