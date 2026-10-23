// Builds the static invitation site: a general page plus one page per guest, each with its own
// Open Graph preview image so WhatsApp shows the sealed envelope (with the guest's name when present).
//
// Usage: npm run build
//    or: node tools/build-site.mjs [envelope.html] [docs-dir] [base-url] ["Guest One,Guest Two"]
//
// Every argument is optional. Defaults: prototype/envelope.html, docs/, the GitHub Pages URL, and the
// guest list in tools/guests.json. Real guest data must never be committed; pass it as the fourth
// argument or keep a local, git-ignored list instead.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaults = {
  source: join(root, "prototype", "envelope.html"),
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

const source = readFileSync(sourcePath, "utf8");
// The prototype is authored for the artifact viewer; drop its title and viewer-only meta.
const body = source
  .replace(/<title>[\s\S]*?<\/title>\s*/, "")
  .replace(/<meta name="claude:viewport-fit-sides"[^>]*>\s*/, "");

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const slugify = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function pageHtml({ guest, pageUrl, imageUrl }) {
  const title = guest ? `Para ${guest} · Mis XV de Morena` : "Mis XV · Morena";
  const description = "Una invitación especial te espera.";
  const guestAttr = guest ? ` data-guest="${escapeHtml(guest)}"` : "";
  return `<!doctype html>
<html lang="es"${guestAttr}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:url" content="${pageUrl}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${imageUrl}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<style>html, body { margin: 0; } [hidden] { display: none !important; }</style>
</head>
<body>
${body}
</body>
</html>
`;
}

// Preview-only adjustments: no tap hint, a larger envelope, and a drawn button under it.
const previewCss = `
  html, body { margin: 0; }
  .hint, .replay { display: none !important; }
  .scene--envelope { padding-top: 0; gap: 22px; }
  .to { font-size: 4.4rem; }
  .envelope { width: 440px; }
  .seal { font-size: 2.4rem; }
  .og-button {
    padding: 20px 48px;
    border-radius: 2px;
    background: var(--gold);
    color: var(--wine);
    font-family: var(--font-caps);
    font-weight: 600;
    font-size: 30px;
    letter-spacing: 0.22em;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
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
    document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 0; });
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
    writeFileSync(join(dir, "index.html"), pageHtml({ guest, pageUrl, imageUrl: `${base}og/${imageName}` }));
    console.log(pageUrl);
  }
} finally {
  await browser.close();
  rmSync(ogWrapper, { force: true });
}
