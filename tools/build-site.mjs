// Builds the static invitation site: a general envelope page plus one per guest, each with its own
// Open Graph preview image so WhatsApp shows the sealed envelope (with the guest's name when present),
// and the invitation page at invitacion/. Every envelope's "VER INVITACIÓN" link is rewritten to a
// relative URL (carrying ?n=<guest> on guest pages), so the site works under any base URL.
//
// Usage: npm run build
//    or: node tools/build-site.mjs [envelope.html] [docs-dir] [base-url] ["Guest One,Guest Two"]
//
// Every argument is optional. Defaults: prototype/envelope.html, docs/, the GitHub Pages URL, and the
// guest list in tools/guests.json. The invitation source is always prototype/invitation.html. Real guest data must never be committed; pass it as the fourth
// argument or keep a local, git-ignored list instead.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaults = {
  source: join(root, "prototype", "envelope.html"),
  invitation: join(root, "prototype", "invitation.html"),
  docs: join(root, "docs"),
  base: "https://paalanis.github.io/tarjetaMore/",
  guestsFile: join(root, "tools", "guests.json"),
};

const [, , sourceArg, docsArg, baseArg, guestsArg] = process.argv;
const sourcePath = resolve(sourceArg || defaults.source);
const docs = resolve(docsArg || defaults.docs);
const baseRaw = baseArg || defaults.base;
const base = baseRaw.endsWith("/") ? baseRaw : `${baseRaw}/`;
const guests = (guestsArg !== undefined
  ? guestsArg.split(",")
  : JSON.parse(readFileSync(defaults.guestsFile, "utf8"))
).map((g) => String(g).trim()).filter(Boolean);

// The prototypes are authored for the artifact viewer; drop their title and viewer-only meta.
const artifactBody = (path) =>
  readFileSync(path, "utf8")
    .replace(/<title>[\s\S]*?<\/title>\s*/, "")
    .replace(/<meta name="claude:viewport-fit-sides"[^>]*>\s*/, "");

const body = artifactBody(sourcePath);
const invitationBody = artifactBody(defaults.invitation);

// The envelope's call to action, rewritten per page to a relative invitation link.
const ctaHref = /(<a\b[^>]*\bid="cta"[^>]*\bhref=")[^"]*(")/;
if (!ctaHref.test(body)) throw new Error(`No <a id="cta" href="..."> found in ${sourcePath}`);
const withInviteLink = (html, href) => html.replace(ctaHref, `$1${href}$2`);

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const slugify = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function pageHtml({ guest = "", title, description, pageUrl, imageUrl, content }) {
  const guestAttr = guest ? ` data-guest="${escapeHtml(guest)}"` : "";
  return `<!doctype html>
<html lang="es"${guestAttr}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${pageUrl}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${imageUrl}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<style>html, body { margin: 0; } [hidden] { display: none !important; }</style>
</head>
<body>
${content}
</body>
</html>
`;
}

// Preview-only adjustments: no tap hint, a larger envelope, and a drawn button under it.
// Animations are switched off rather than paused: a paused animated layer keeps whatever raster
// scale it had when paused, which made the JPEGs differ from build to build.
const previewCss = `
  html, body { margin: 0; }
  *, *::before, *::after { animation: none !important; }
  .sparkles i { opacity: 0.75; }
  .hint, .replay { display: none !important; }
  .scene--envelope { padding-top: 0; gap: 22px; }
  .to { font-size: 4.4rem; }
  .envelope { width: 440px; }
  .seal { font-size: 2.4rem; }
  .og-button {
    padding: 20px 48px;
    border-radius: 2px;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--font-caps);
    font-weight: 600;
    font-size: 30px;
    letter-spacing: 0.22em;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.55), 0 0 0 1px var(--silver-deep);
  }
`;

mkdirSync(join(docs, "og"), { recursive: true });
writeFileSync(join(docs, ".nojekyll"), "");
const ogWrapper = join(docs, "og", "_render.html");
writeFileSync(ogWrapper, `<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body>${body}<style>${previewCss}</style></body></html>`);

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });

async function renderPreview(guest, file) {
  const url = pathToFileURL(ogWrapper).href + (guest ? `?n=${encodeURIComponent(guest)}` : "");
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    const button = document.createElement("span");
    button.className = "og-button";
    button.textContent = "ABRIR INVITACIÓN";
    document.getElementById("envelope").after(button);
  });
  await page.screenshot({ path: file, type: "jpeg", quality: 88 });
}

try {
  const entries = [{ guest: "", slug: "" }, ...guests.map((guest) => ({ guest, slug: slugify(guest) }))];
  for (const { guest, slug } of entries) {
    const imageName = `${slug || "general"}.jpg`;
    await renderPreview(guest, join(docs, "og", imageName));
    const dir = slug ? join(docs, slug) : docs;
    mkdirSync(dir, { recursive: true });
    const pageUrl = slug ? `${base}${slug}/` : base;
    const inviteHref = slug ? `../invitacion/?n=${encodeURIComponent(guest)}` : "invitacion/";
    writeFileSync(join(dir, "index.html"), pageHtml({
      guest,
      title: guest ? `Para ${guest} · Mis XV de Morena` : "Mis XV · Morena",
      description: "Una invitación especial te espera.",
      pageUrl,
      imageUrl: `${base}og/${imageName}`,
      content: withInviteLink(body, inviteHref),
    }));
    console.log(pageUrl);
  }

  // The invitation page reads the guest from ?n= itself, so one page serves everyone.
  const invitationUrl = `${base}invitacion/`;
  mkdirSync(join(docs, "invitacion"), { recursive: true });
  writeFileSync(join(docs, "invitacion", "index.html"), pageHtml({
    title: "Invitación · Mis XV de Morena",
    description: "05 de diciembre de 2026 · Salón Palatium Magnus. Te espero para celebrar mis quince.",
    pageUrl: invitationUrl,
    imageUrl: `${base}og/general.jpg`,
    content: invitationBody,
  }));
  console.log(invitationUrl);
} finally {
  await browser.close();
  rmSync(ogWrapper, { force: true });
}
