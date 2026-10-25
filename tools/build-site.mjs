// Builds the static invitation site: a general envelope page plus one per guest, each with its own
// Open Graph preview image so WhatsApp shows the sealed envelope (with the guest's name when present),
// the invitation page at invitacion/, and the info pages the Canva invitation's buttons link to:
// restricciones/ (dress code restrictions), transferencia/ (gift alias with a copy button) and confirmar/
// (RSVP saved to a Google Sheet, see tools/rsvp/Code.gs). Guest pages carry their slug in data-guest-id,
// which the envelope stores so confirmar/ knows the family. Every
// envelope's "VER INVITACIÓN" link is rewritten to the Canva invitation, without ?n= since Canva cannot
// read it. invitacion/ is still built but no page links to it any more.
//
// Usage: npm run build
//    or: npm run build:sheet
//    or: node tools/build-site.mjs [--sheet] [envelope.html] [docs-dir] [base-url] ["Guest One,Guest Two"]
//
// Every argument is optional. Defaults: prototype/envelope.html, docs/, the GitHub Pages URL, and the
// guest list in tools/guests.json. The other sources are always prototype/invitation.html,
// prototype/restrictions.html, prototype/transfer.html and prototype/confirm.html. Real guest data must never be committed; pass
// it as the fourth argument or keep a local, git-ignored list instead.
//
// Sheet mode (--sheet, used by build:sheet) takes the guests from the Google Sheet instead: it fetches
// <rsvpEndpoint>?action=list, where rsvpEndpoint is read from the CONFIG in prototype/confirm.html so the
// URL lives in one place, and builds one page per row with the sheet `id` as the slug (used as is) and
// `nombre` as the displayed name. Any error from the script (such as duplicate_id) or the network stops
// the build before a page is written. The RSVP_ENDPOINT environment variable overrides the URL, which is
// how sheet mode is tested against a local mock server. Neither mode deletes pages: a family removed from
// the sheet keeps a stale docs/<slug>/ until it is deleted by hand.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaults = {
  source: join(root, "prototype", "envelope.html"),
  invitation: join(root, "prototype", "invitation.html"),
  restrictions: join(root, "prototype", "restrictions.html"),
  transfer: join(root, "prototype", "transfer.html"),
  confirm: join(root, "prototype", "confirm.html"),
  docs: join(root, "docs"),
  base: "https://paalanis.github.io/tarjetaMore/",
  guestsFile: join(root, "tools", "guests.json"),
  canvaInvitation: "https://more-0512.my.canva.site/",
};

const args = process.argv.slice(2);
const sheetMode = args.includes("--sheet");
const [sourceArg, docsArg, baseArg, guestsArg] = args.filter((a) => a !== "--sheet");
const sourcePath = resolve(sourceArg || defaults.source);
const docs = resolve(docsArg || defaults.docs);
const baseRaw = baseArg || defaults.base;
const base = baseRaw.endsWith("/") ? baseRaw : `${baseRaw}/`;

const slugify = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const fail = (message) => {
  console.error(`build-site: ${message}`);
  process.exit(1);
};

// Folders the build writes itself, which a guest slug must not take over.
const reservedDirs = new Set(["og", "invitacion", "restricciones", "transferencia", "confirmar"]);

// Fetches the guest list from the Apps Script (see tools/rsvp/Code.gs) as {name, slug} pairs.
async function sheetGuests() {
  let endpoint = process.env.RSVP_ENDPOINT;
  if (!endpoint) {
    const config = readFileSync(defaults.confirm, "utf8").match(/rsvpEndpoint:\s*"([^"]*)"/);
    endpoint = config ? config[1] : "";
  }
  if (!endpoint) fail(`no rsvpEndpoint found in the CONFIG of ${defaults.confirm}`);
  const url = new URL(endpoint);
  url.searchParams.set("action", "list");

  let data;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
  } catch (err) {
    fail(`could not read the guest list from ${url}: ${err.cause?.message || err.message}`);
  }
  if (!data || data.ok !== true) {
    const error = data?.error || "unknown_error";
    const detail = error === "duplicate_id" ? `; repeated ids: ${(data.ids || []).join(", ")}`
      : error === "empty_id" ? `; sheet rows: ${(data.rows || []).join(", ")}`
      : "";
    fail(`the sheet returned ${error}${detail}. Fix the sheet and build again.`);
  }
  if (!Array.isArray(data.guests)) fail("the sheet response has no guests list");

  // The script already checks these; checking again keeps a bad response from writing odd folders.
  const seen = new Set();
  return data.guests.map(({ id, name }) => {
    const slug = String(id ?? "").trim();
    const guest = String(name ?? "").trim();
    if (!guest) fail(`guest "${slug}" has no name`);
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) fail(`guest "${guest}" has an id unusable as a folder: "${slug}"`);
    if (reservedDirs.has(slug.toLowerCase())) fail(`guest "${guest}" uses the reserved id "${slug}"`);
    if (seen.has(slug.toLowerCase())) fail(`the id "${slug}" is used by more than one guest`);
    seen.add(slug.toLowerCase());
    return { name: guest, slug };
  });
}

// Guests as {name, slug} pairs: from the sheet, the fourth argument, or tools/guests.json.
const guests = sheetMode
  ? await sheetGuests()
  : (guestsArg !== undefined
    ? guestsArg.split(",")
    : JSON.parse(readFileSync(defaults.guestsFile, "utf8"))
  ).map((g) => String(g).trim()).filter(Boolean).map((name) => ({ name, slug: slugify(name) }));

// The prototypes are authored for the artifact viewer; drop their title and viewer-only meta.
const artifactBody = (path) =>
  readFileSync(path, "utf8")
    .replace(/<title>[\s\S]*?<\/title>\s*/, "")
    .replace(/<meta name="claude:viewport-fit-sides"[^>]*>\s*/, "");

const body = artifactBody(sourcePath);
const invitationBody = artifactBody(defaults.invitation);

// The envelope's call to action, rewritten on every page to the Canva invitation.
const ctaHref = /(<a\b[^>]*\bid="cta"[^>]*\bhref=")[^"]*(")/;
if (!ctaHref.test(body)) throw new Error(`No <a id="cta" href="..."> found in ${sourcePath}`);
const withInviteLink = (html, href) => html.replace(ctaHref, `$1${href}$2`);

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function pageHtml({ guest = "", guestId = "", title, description, pageUrl, imageUrl, content }) {
  const guestAttr = (guest ? ` data-guest="${escapeHtml(guest)}"` : "") +
    (guestId ? ` data-guest-id="${escapeHtml(guestId)}"` : "");
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
  const entries = [{ guest: "", slug: "" }, ...guests.map(({ name, slug }) => ({ guest: name, slug }))];
  for (const { guest, slug } of entries) {
    const imageName = `${slug || "general"}.jpg`;
    await renderPreview(guest, join(docs, "og", imageName));
    const dir = slug ? join(docs, slug) : docs;
    mkdirSync(dir, { recursive: true });
    const pageUrl = slug ? `${base}${slug}/` : base;
    writeFileSync(join(dir, "index.html"), pageHtml({
      guest,
      guestId: slug,
      title: guest ? `Para ${guest} · Mis XV de Morena` : "Mis XV · Morena",
      description: "Una invitación especial te espera.",
      pageUrl,
      imageUrl: `${base}og/${imageName}`,
      content: withInviteLink(body, defaults.canvaInvitation),
    }));
    console.log(pageUrl);
  }

  // The own invitation page, kept as a fallback to the Canva one: it is built but no envelope links to it.
  // It reads the guest from ?n= itself, so one page serves everyone.
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

  // Info pages for the Canva invitation's buttons, which can only open a URL.
  const infoPages = [
    {
      dir: "restricciones",
      source: defaults.restrictions,
      title: "Dress code · Mis XV de Morena",
      description: "Dress code Formal - Elegante y sus restricciones para la fiesta de Morena.",
    },
    {
      dir: "transferencia",
      source: defaults.transfer,
      title: "Regalo · Mis XV de Morena",
      description: "Datos para transferencia: alias y titular de la cuenta, con un botón para copiar el alias.",
    },
    {
      dir: "confirmar",
      source: defaults.confirm,
      title: "Confirmar asistencia · Mis XV de Morena",
      description: "Confirmá cuántos van a asistir a los XV de Morena.",
    },
  ];
  for (const { dir, source, title, description } of infoPages) {
    const pageUrl = `${base}${dir}/`;
    mkdirSync(join(docs, dir), { recursive: true });
    writeFileSync(join(docs, dir, "index.html"), pageHtml({
      title,
      description,
      pageUrl,
      imageUrl: `${base}og/general.jpg`,
      content: artifactBody(source),
    }));
    console.log(pageUrl);
  }
} finally {
  await browser.close();
  rmSync(ogWrapper, { force: true });
}
