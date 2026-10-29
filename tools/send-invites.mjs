// Sends every family its envelope link through WhatsApp Web, unattended: `npm run send`.
//
// The guest list, phones and the message come from the sheet through the key-protected `send-list` action
// of tools/rsvp/Code.gs (the message is cell A1 of the `Mensaje` tab; "{link}" in it is replaced by the
// family's envelope URL, otherwise the URL is added at the end). Each sent family gets a date in `Enviado`
// through `mark-sent`, so a rerun skips it. Families need not be saved as contacts: chats are opened by
// number. Between messages the script waits 20-60 s at random, and 5 minutes after every 20 messages.
//
// The key is the SEND_KEY environment variable, else the first line of `.send-key` at the repo root
// (ignored by git). WhatsApp Web runs in Chrome with its own profile outside the repo, so the QR code is
// scanned only on the first run.
//
//   npm run send -- --dry-run                       list what would be sent; no browser, no writes
//   npm run send -- --only pablo-alanis,romina-gonzalez   send to these ids only (still skips sent ones)
//
// Anything unexpected (an invalid phone in the sheet, a chat that does not open, a message that does not
// show as sent) stops the run; families already sent stay marked.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readEndpoint } from "./sheet-guests.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SITE_BASE = "https://paalanis.github.io/tarjetaMore/";
export const WHATSAPP_URL = "https://web.whatsapp.com";
const REST_EVERY = 20;

// WhatsApp Web markup, in one place because it changes now and then.
const SELECTORS = {
  loggedIn: "#side",
  composer: 'footer div[contenteditable="true"]',
  popup: '[data-animate-modal-popup="true"], div[role="dialog"]',
  outgoing: "div.message-out",
};

export class SendError extends Error {}

const fail = (message) => {
  throw new SendError(message);
};

// An Argentine mobile number as WhatsApp wants it (549 + area + number, 13 digits), or "" when the cell
// cannot be read safely, e.g. the old "15" local form.
export function normalizePhone(raw) {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("549") && digits.length === 13) return digits;
  if (digits.startsWith("54") && digits.length === 12) return "549" + digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits.length === 10 ? "549" + digits : "";
}

export const envelopeUrl = (id) => SITE_BASE + id + "/";

export function composeMessage(message, link) {
  return message.includes("{link}") ? message.split("{link}").join(link) : message + "\n\n" + link;
}

// Milliseconds to wait after the nth message sent in this run (n starts at 1).
export function pauseAfter(n, random = Math.random) {
  if (n % REST_EVERY === 0) return 5 * 60_000 + Math.round(random() * 60_000);
  return 20_000 + Math.round(random() * 40_000);
}

export function readKey(env = process.env, keyPath = join(root, ".send-key")) {
  if (env.SEND_KEY) return env.SEND_KEY.trim();
  try {
    return readFileSync(keyPath, "utf8").split(/\r?\n/)[0].trim();
  } catch {
    return "";
  }
}

// The families to send to, in sheet order, each with its WhatsApp number and text. Fails before anything is
// sent when the message is empty, an --only id is unknown, or a pending family has an unusable phone.
export function plan(list, { only = [] } = {}) {
  if (!list.message) fail('the message is empty: write it in cell A1 of the "Mensaje" tab');
  const ids = new Set(list.guests.map((g) => g.id));
  const unknown = only.filter((id) => !ids.has(id));
  if (unknown.length) fail(`unknown id(s) in --only: ${unknown.join(", ")}`);
  const pending = list.guests.filter((g) => !g.sent && (!only.length || only.includes(g.id)));
  const bad = pending.filter((g) => !normalizePhone(g.phone));
  if (bad.length) {
    fail("fix these phones in the sheet (area code + number, e.g. 2613829997):\n" +
      bad.map((g) => `  ${g.id}: "${g.phone}"`).join("\n"));
  }
  return pending.map((g) => ({
    id: g.id,
    name: g.name,
    phone: normalizePhone(g.phone),
    text: composeMessage(list.message, envelopeUrl(g.id)),
  }));
}

async function call(endpoint, body, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    fail(`could not reach the sheet script: ${err.message}`);
  }
  if (!response.ok) fail(`the sheet script answered HTTP ${response.status}`);
  const data = await response.json().catch(() => fail("the sheet script did not answer JSON"));
  if (data && data.ok) return data;
  const error = data && data.error;
  if (error === "forbidden") fail("the key does not match SEND_KEY in the script properties");
  if (error === "no_message_sheet") fail('the sheet has no "Mensaje" tab');
  if (error === "missing_column") fail(`the sheet has no "${data.column}" column`);
  fail(`the sheet script answered ${error || "an unexpected response"}`);
}

export const fetchSendList = (endpoint, key, fetchImpl = fetch) =>
  call(endpoint, { action: "send-list", key }, fetchImpl);

export const markSent = (endpoint, key, id, fetchImpl = fetch) =>
  call(endpoint, { action: "mark-sent", key, id }, fetchImpl);

// Opens the chat with the text typed in, sends it with Enter and waits until it shows as an outgoing
// message. Throws SendError when the number is not on WhatsApp or the page does not behave as expected.
export async function sendOne(page, item, { whatsappUrl = WHATSAPP_URL } = {}) {
  await page.goto(`${whatsappUrl}/send?phone=${item.phone}&text=${encodeURIComponent(item.text)}`);
  const composer = page.locator(SELECTORS.composer).last();
  const opened = await Promise.race([
    composer.waitFor({ timeout: 60_000 }).then(() => "chat"),
    page.locator(SELECTORS.popup).first().waitFor({ timeout: 60_000 }).then(() => "popup"),
  ]).catch(() => "timeout");
  if (opened === "popup") fail(`${item.id}: WhatsApp did not open the chat for ${item.phone} (number not on WhatsApp?)`);
  if (opened === "timeout") fail(`${item.id}: the chat did not open within a minute`);
  // Let the link preview load so it goes out with the message.
  await page.waitForTimeout(6_000);
  const before = await page.locator(SELECTORS.outgoing).count();
  await composer.click();
  await composer.press("Enter");
  await page.waitForFunction(
    ([selector, count]) => document.querySelectorAll(selector).length > count,
    [SELECTORS.outgoing, before],
    { timeout: 30_000 },
  ).catch(() => fail(`${item.id}: the message did not show as sent; check that chat before running again`));
}

export async function waitForLogin(page, { whatsappUrl = WHATSAPP_URL, log = console.log } = {}) {
  await page.goto(whatsappUrl);
  log("Waiting for WhatsApp Web (scan the QR code with your phone if it shows one)…");
  await page.locator(SELECTORS.loggedIn).waitFor({ timeout: 5 * 60_000 })
    .catch(() => fail("WhatsApp Web did not log in within 5 minutes"));
}

function parseArgs(argv) {
  const args = { dryRun: false, only: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--only") args.only = String(argv[++i] || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    else fail(`unknown option ${argv[i]} (use --dry-run or --only id1,id2)`);
  }
  if (argv.includes("--only") && !args.only.length) fail("--only needs ids, e.g. --only pablo-alanis,romina-gonzalez");
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Chrome with its own profile outside the repo, kept between runs so the QR code is scanned once.
async function openChrome() {
  const { chromium } = await import("playwright");
  return chromium.launchPersistentContext(join(homedir(), ".tarjetamore-whatsapp"), {
    channel: "chrome",
    headless: false,
    viewport: null,
  });
}

export async function main(
  argv = process.argv.slice(2),
  { env = process.env, log = console.log, fetchImpl = fetch, keyPath, openBrowser = openChrome } = {},
) {
  const args = parseArgs(argv);
  const endpoint = readEndpoint(join(root, "prototype", "confirm.html"), env);
  const key = readKey(env, keyPath);
  if (!key) fail("no key: put it in .send-key at the repo root or in SEND_KEY");
  const items = plan(await fetchSendList(endpoint, key, fetchImpl), args);
  if (!items.length) {
    log("Nothing to send: every family in the selection is already marked in Enviado.");
    return;
  }
  if (args.dryRun) {
    for (const item of items) log(`--- ${item.id} -> +${item.phone}\n${item.text}`);
    log(`\n${items.length} message(s) would be sent. Nothing was sent or written.`);
    return;
  }

  const context = await openBrowser();
  try {
    const page = context.pages()[0] || (await context.newPage());
    await waitForLogin(page, { log });
    log(`Sending ${items.length} message(s) in 10 seconds. Press Ctrl+C to cancel.`);
    await sleep(10_000);
    for (let i = 0; i < items.length; i++) {
      await sendOne(page, items[i]);
      await markSent(endpoint, key, items[i].id, fetchImpl);
      log(`Sent ${i + 1}/${items.length}: ${items[i].name}`);
      if (i + 1 < items.length) {
        const ms = pauseAfter(i + 1);
        log(`  next one in ${Math.round(ms / 1000)} s`);
        await sleep(ms);
      }
    }
    log("Done: every message was sent and marked in Enviado.");
  } finally {
    await context.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof SendError ? `send-invites: ${err.message}` : err);
    process.exit(1);
  });
}
