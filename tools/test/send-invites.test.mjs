// tools/send-invites.mjs without WhatsApp: the sheet script is a fake fetch, and only --dry-run reaches main,
// so no browser starts and nothing is sent. Guest data is fictional.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SendError, composeMessage, envelopeUrl, fetchSendList, main, markSent, normalizePhone, pauseAfter, plan, readKey,
} from "../send-invites.mjs";

const KEY = "k".repeat(24);
// Passed as openBrowser so a regression that would start Chrome fails at once instead of hanging.
const noBrowser = async () => { throw new Error("the browser must not start in this test"); };
const ENDPOINT = "https://script.test/exec";

// A fetch stand-in that records each POST body and answers with reply(body) as JSON.
function fakeFetch(reply) {
  const calls = [];
  const impl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url: String(url), method: options.method, type: options.headers["Content-Type"], body });
    return { ok: true, status: 200, json: async () => reply(body) };
  };
  return { impl, calls };
}

const list = () => ({
  ok: true,
  message: "Hola, te invitamos a los XV de Morena",
  guests: [
    { id: "familia-perez", name: "Familia Pérez", phone: "261 382-9997", sent: false },
    { id: "tia-ana", name: "Tía Ana", phone: "5492610000002", sent: true },
    { id: "jose-nunez", name: "José Núñez", phone: "+54 261 511-1111", sent: false },
  ],
});

test("normalizePhone turns Argentine mobiles into 549 + 10 digits and refuses unclear ones", () => {
  const cases = {
    "2613829997": "5492613829997",
    "261 382-9997": "5492613829997",
    "0261 3829997": "5492613829997",
    "+54 9 261 382 9997": "5492613829997",
    "542613829997": "5492613829997",
    "005492613829997": "5492613829997",
    "11 2345 6789": "5491123456789",
    "261 15 3829997": "",
    "3829997": "",
    "": "",
    "abc": "",
  };
  for (const [raw, expected] of Object.entries(cases)) assert.equal(normalizePhone(raw), expected, raw);
  assert.equal(normalizePhone(2613829997), "5492613829997", "a number cell");
  assert.equal(normalizePhone(null), "");
});

test("composeMessage replaces {link} or adds the link after a blank line", () => {
  const link = envelopeUrl("familia-perez");
  assert.equal(link, "https://paalanis.github.io/tarjetaMore/familia-perez/");
  assert.equal(composeMessage("Hola!", link), "Hola!\n\n" + link);
  assert.equal(composeMessage("Mirá {link} y {link}", link), `Mirá ${link} y ${link}`);
});

test("pauseAfter waits 20-60 s, and 5-6 minutes after every 20th message", () => {
  assert.equal(pauseAfter(1, () => 0), 20_000);
  assert.equal(pauseAfter(1, () => 1), 60_000);
  assert.equal(pauseAfter(19, () => 0.5), 40_000);
  assert.equal(pauseAfter(20, () => 0), 300_000);
  assert.equal(pauseAfter(40, () => 1), 360_000);
  for (let n = 1; n < 60; n++) {
    const ms = pauseAfter(n);
    if (n % 20) assert.ok(ms >= 20_000 && ms <= 60_000, `${n}: ${ms}`);
    else assert.ok(ms >= 300_000 && ms <= 360_000, `${n}: ${ms}`);
  }
});

test("plan keeps unsent families in sheet order with their number and text", () => {
  assert.deepEqual(plan(list()), [
    {
      id: "familia-perez", name: "Familia Pérez", phone: "5492613829997",
      link: "https://paalanis.github.io/tarjetaMore/familia-perez/",
      text: "Hola, te invitamos a los XV de Morena\n\nhttps://paalanis.github.io/tarjetaMore/familia-perez/",
    },
    {
      id: "jose-nunez", name: "José Núñez", phone: "5492615111111",
      link: "https://paalanis.github.io/tarjetaMore/jose-nunez/",
      text: "Hola, te invitamos a los XV de Morena\n\nhttps://paalanis.github.io/tarjetaMore/jose-nunez/",
    },
  ]);
  assert.deepEqual(plan(list(), { only: ["jose-nunez", "tia-ana"] }).map((i) => i.id), ["jose-nunez"],
    "--only still skips families already sent");
});

test("plan stops before sending on an empty message, an unknown --only id or a bad pending phone", () => {
  assert.throws(() => plan({ ...list(), message: "" }), (e) => e instanceof SendError && /Mensaje/.test(e.message));
  assert.throws(() => plan(list(), { only: ["nadie"] }), /unknown id\(s\) in --only: nadie/);
  const bad = list();
  bad.guests[2].phone = "261 15 5111111";
  assert.throws(() => plan(bad), /jose-nunez: "261 15 5111111"/);
  bad.guests[2].sent = true;
  assert.equal(plan(bad).length, 1, "a bad phone on a family already sent does not block");
});

test("readKey prefers SEND_KEY, else the first line of the key file, else empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "send-key-"));
  try {
    const file = join(dir, ".send-key");
    writeFileSync(file, ` ${KEY} \r\nignored\n`);
    assert.equal(readKey({ SEND_KEY: " env-key " }, file), "env-key");
    assert.equal(readKey({}, file), KEY);
    assert.equal(readKey({}, join(dir, "missing")), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("send-list and mark-sent are text/plain POSTs that carry the key", async () => {
  const fake = fakeFetch((body) => (body.action === "send-list" ? list() : { ok: true, id: body.id }));
  assert.deepEqual(await fetchSendList(ENDPOINT, KEY, fake.impl), list());
  assert.deepEqual(await markSent(ENDPOINT, KEY, "familia-perez", fake.impl), { ok: true, id: "familia-perez" });
  assert.deepEqual(fake.calls, [
    { url: ENDPOINT, method: "POST", type: "text/plain;charset=utf-8", body: { action: "send-list", key: KEY } },
    { url: ENDPOINT, method: "POST", type: "text/plain;charset=utf-8", body: { action: "mark-sent", key: KEY, id: "familia-perez" } },
  ]);
});

test("sheet script errors become clear messages", async () => {
  const expectations = [
    [{ ok: false, error: "forbidden" }, /key does not match SEND_KEY/],
    [{ ok: false, error: "no_message_sheet" }, /no "Mensaje" tab/],
    [{ ok: false, error: "missing_column", column: "Enviado" }, /no "Enviado" column/],
    [{ ok: false, error: "busy" }, /answered busy/],
  ];
  for (const [reply, pattern] of expectations) {
    await assert.rejects(fetchSendList(ENDPOINT, KEY, fakeFetch(() => reply).impl), pattern);
  }
  const down = async () => { throw new Error("ECONNREFUSED"); };
  await assert.rejects(fetchSendList(ENDPOINT, KEY, down), /could not reach the sheet script: ECONNREFUSED/);
  const http500 = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(fetchSendList(ENDPOINT, KEY, http500), /HTTP 500/);
});

test("--dry-run prints every pending message and never marks anything", async () => {
  const fake = fakeFetch(() => list());
  const lines = [];
  await main(["--dry-run"], { env: { RSVP_ENDPOINT: ENDPOINT, SEND_KEY: KEY }, log: (l) => lines.push(l), fetchImpl: fake.impl, openBrowser: noBrowser });
  const out = lines.join("\n");
  assert.match(out, /--- familia-perez -> \+5492613829997\nHola, te invitamos a los XV de Morena\n\nhttps:\/\/paalanis\.github\.io\/tarjetaMore\/familia-perez\//);
  assert.match(out, /--- jose-nunez -> \+5492615111111/);
  assert.doesNotMatch(out, /tia-ana/);
  assert.match(out, /2 message\(s\) would be sent\. Nothing was sent or written\./);
  assert.deepEqual(fake.calls.map((c) => c.body.action), ["send-list"]);
});

test("main refuses bad options and a missing key before calling the sheet", async () => {
  const fake = fakeFetch(() => list());
  const opts = { env: { RSVP_ENDPOINT: ENDPOINT, SEND_KEY: KEY }, log: () => {}, fetchImpl: fake.impl, openBrowser: noBrowser };
  await assert.rejects(main(["--fast"], opts), /unknown option --fast/);
  await assert.rejects(main(["--only"], opts), /--only needs ids/);
  const noKey = { ...opts, env: { RSVP_ENDPOINT: ENDPOINT }, keyPath: join(tmpdir(), "no-such-dir-send-key", ".send-key") };
  await assert.rejects(main(["--dry-run"], noKey), /no key/);
  assert.equal(fake.calls.length, 0);
});

test("main with nothing pending says so and opens no browser", async () => {
  const done = list();
  done.guests.forEach((g) => { g.sent = true; });
  const lines = [];
  await main([], { env: { RSVP_ENDPOINT: ENDPOINT, SEND_KEY: KEY }, log: (l) => lines.push(l), fetchImpl: fakeFetch(() => done).impl, openBrowser: noBrowser });
  assert.deepEqual(lines, ["Nothing to send: every family in the selection is already marked in Enviado."]);
});
