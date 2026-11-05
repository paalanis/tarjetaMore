// Guest list for sheet mode of tools/build-site.mjs (`npm run build:sheet`): reads the Apps Script URL from
// the CONFIG in prototype/confirm.html, fetches <rsvpEndpoint>?action=list (see tools/rsvp/Code.gs) and
// checks every row before the build writes a page. Every problem throws a SheetGuestsError whose message
// the build prints as is. Kept apart from the build so tests can run it without Playwright or docs/.
import { readFileSync } from "node:fs";

// Must stay identical to slugify_ in tools/rsvp/Code.gs: strip accents, lowercase, dashes for the rest.
export const slugify = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Folders the build writes itself, which a guest slug must not take over, plus `general`: the general page's
// preview is og/general.jpg, which a guest's og/<slug>.jpg would overwrite.
export const reservedSlugs = new Set(["og", "invitacion", "restricciones", "transferencia", "confirmar", "mensaje", "general"]);

export class SheetGuestsError extends Error {}

const fail = (message) => {
  throw new SheetGuestsError(message);
};

// The Apps Script URL: the RSVP_ENDPOINT environment variable when set, else CONFIG.rsvpEndpoint in confirmPath.
export function readEndpoint(confirmPath, env = process.env) {
  if (env.RSVP_ENDPOINT) return env.RSVP_ENDPOINT;
  const config = readFileSync(confirmPath, "utf8").match(/rsvpEndpoint:\s*"([^"]*)"/);
  if (!config || !config[1]) fail(`no rsvpEndpoint found in the CONFIG of ${confirmPath}`);
  return config[1];
}

// Spanish joining words kept lowercase inside a name ("Marcos Sebastianelli y Flia.", "José de la Peña").
// "del" is left out on purpose: in this list it starts surnames such as Del Piccolo.
const lowercaseWords = new Set(["y", "e", "de", "la", "las", "los"]);

// Names typed in capitals in the sheet read badly in the envelope's script font, so a name with no lowercase
// letter gets an initial capital per word (and after - or '). Names already using lowercase stay as written.
export function displayName(name) {
  if (/\p{Ll}/u.test(name)) return name;
  return name.toLocaleLowerCase("es").split(" ").map((word, i) =>
    i > 0 && lowercaseWords.has(word)
      ? word
      : word.replace(/(^|[-'])(\p{L})/gu, (m, sep, letter) => sep + letter.toLocaleUpperCase("es"))
  ).join(" ");
}

// Checks the {id, name} rows of a successful list response and returns them as {name, slug} pairs.
// The script already checks these; checking again keeps a bad response from writing odd folders.
// Ids are lowercased, since GitHub Pages URLs are case-sensitive.
export function validateGuests(rows) {
  if (!Array.isArray(rows)) fail("the sheet response has no guests list");
  const seen = new Set();
  return rows.map(({ id, name } = {}) => {
    const slug = String(id ?? "").trim().toLowerCase();
    const guest = String(name ?? "").trim();
    if (!guest) fail(`guest "${slug}" has no name`);
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) fail(`guest "${guest}" has an id unusable as a folder: "${slug}"`);
    if (reservedSlugs.has(slug)) fail(`guest "${guest}" uses the reserved id "${slug}"`);
    if (seen.has(slug)) fail(`the id "${slug}" is used by more than one guest`);
    seen.add(slug);
    return { name: displayName(guest), slug };
  });
}

// Fetches the guest list from endpoint as {name, slug} pairs. fetchImpl is replaceable for tests.
export async function fetchSheetGuests(endpoint, fetchImpl = fetch) {
  const url = new URL(endpoint);
  url.searchParams.set("action", "list");

  let data;
  try {
    const response = await fetchImpl(url);
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
  return validateGuests(data.guests);
}

// The whole sheet-mode lookup used by the build: endpoint from confirmPath (or env), then the checked list.
export async function sheetGuests({ confirmPath, env = process.env, fetchImpl = fetch }) {
  return fetchSheetGuests(readEndpoint(confirmPath, env), fetchImpl);
}
