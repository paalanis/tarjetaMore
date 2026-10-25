// Sheet mode of tools/build-site.mjs: the endpoint comes from the real prototype/confirm.html, and every bad
// response stops the build with a clear message. No test hits the real Apps Script or writes into docs/:
// fetch is faked or points at a local server, and the one build run uses a temporary docs folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SheetGuestsError, fetchSheetGuests, readEndpoint, sheetGuests, validateGuests } from "../sheet-guests.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const confirmPath = join(root, "prototype", "confirm.html");

// The rsvpEndpoint string of the real CONFIG, found by plain string search rather than the module's regex.
function configEndpoint() {
  const text = readFileSync(confirmPath, "utf8");
  const marker = 'rsvpEndpoint: "';
  const start = text.indexOf(marker) + marker.length;
  assert.ok(start >= marker.length, "confirm.html has an rsvpEndpoint entry");
  return text.slice(start, text.indexOf('"', start));
}

// A fetch stand-in that records the URLs it is asked for and answers with body as JSON.
function fakeFetch(body, status = 200) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status });
  };
  return Object.assign(impl, { calls });
}

const listOf = (...guests) => ({ ok: true, guests });

async function rejectsWith(promise, pattern) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof SheetGuestsError, `expected a SheetGuestsError, got ${err}`);
    assert.match(err.message, pattern);
    return true;
  });
}

// Starts a local HTTP server answering every request with handler(req, res); resolves to its base URL.
async function localServer(handler) {
  const server = createServer(handler);
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return { server, url: `http://127.0.0.1:${server.address().port}/exec` };
}

test("the endpoint is read from the real confirm.html CONFIG", () => {
  const expected = configEndpoint();
  assert.match(expected, /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/);
  assert.equal(readEndpoint(confirmPath, {}), expected);
});

test("RSVP_ENDPOINT overrides the CONFIG endpoint", () => {
  assert.equal(readEndpoint(confirmPath, { RSVP_ENDPOINT: "http://127.0.0.1:1/exec" }), "http://127.0.0.1:1/exec");
});

test("a CONFIG without an endpoint fails clearly", () => {
  const dir = mkdtempSync(join(tmpdir(), "sheet-guests-"));
  try {
    const path = join(dir, "confirm.html");
    writeFileSync(path, 'var CONFIG = { rsvpEndpoint: "" };');
    assert.throws(() => readEndpoint(path, {}), /no rsvpEndpoint found in the CONFIG of/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sheetGuests asks the CONFIG endpoint for ?action=list and returns {name, slug}", async () => {
  const fetchImpl = fakeFetch(listOf({ id: "familia-perez", name: "Familia Pérez" }, { id: "tia_ana", name: " Tía Ana " }));
  const guests = await sheetGuests({ confirmPath, env: {}, fetchImpl });
  assert.deepEqual(guests, [{ name: "Familia Pérez", slug: "familia-perez" }, { name: "Tía Ana", slug: "tia_ana" }]);
  assert.deepEqual(fetchImpl.calls, [`${configEndpoint()}?action=list`]);
});

test("ok:false responses stop with the script's error", async () => {
  await rejectsWith(fetchSheetGuests("http://x.test/exec", fakeFetch({ ok: false, error: "busy" })),
    /^the sheet returned busy\. Fix the sheet and build again\.$/);
  await rejectsWith(fetchSheetGuests("http://x.test/exec", fakeFetch({ ok: false })), /the sheet returned unknown_error/);
  await rejectsWith(fetchSheetGuests("http://x.test/exec", fakeFetch(null)), /the sheet returned unknown_error/);
});

test("duplicate_id and empty_id name the ids and rows to fix", async () => {
  await rejectsWith(fetchSheetGuests("http://x.test/exec",
    fakeFetch({ ok: false, error: "duplicate_id", ids: ["familia-perez", "tia-ana"] })),
  /the sheet returned duplicate_id; repeated ids: familia-perez, tia-ana\./);
  await rejectsWith(fetchSheetGuests("http://x.test/exec", fakeFetch({ ok: false, error: "empty_id", rows: [3, 7] })),
    /the sheet returned empty_id; sheet rows: 3, 7\./);
});

test("HTTP and network errors stop with the URL and the cause", async () => {
  await rejectsWith(fetchSheetGuests("http://x.test/exec", fakeFetch({}, 500)),
    /could not read the guest list from http:\/\/x\.test\/exec\?action=list: HTTP 500/);
  const offline = async () => {
    throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:9") });
  };
  await rejectsWith(fetchSheetGuests("http://x.test/exec", offline), /: connect ECONNREFUSED 127\.0\.0\.1:9$/);
  await rejectsWith(fetchSheetGuests("http://x.test/exec", async () => new Response("<html>login</html>")),
    /could not read the guest list from/);
});

test("the real fetch reads a local server, and a closed port is a network error", async () => {
  const { server, url } = await localServer((req, res) => {
    assert.equal(new URL(req.url, "http://h").searchParams.get("action"), "list");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(listOf({ id: "familia-perez", name: "Familia Pérez" })));
  });
  try {
    assert.deepEqual(await fetchSheetGuests(url), [{ name: "Familia Pérez", slug: "familia-perez" }]);
  } finally {
    await new Promise((done) => server.close(done));
  }
  await rejectsWith(fetchSheetGuests(url), /could not read the guest list from http:\/\/127\.0\.0\.1:\d+\/exec\?action=list: /);
});

test("a response without a guests list fails", async () => {
  await rejectsWith(fetchSheetGuests("http://x.test/exec", fakeFetch({ ok: true })), /the sheet response has no guests list/);
});

test("ids unusable as a folder fail", () => {
  for (const id of ["", "  ", "-x", "_x", "a b", "../x", "a/b", "ñandu", "x.y"]) {
    assert.throws(() => validateGuests([{ id, name: "Familia Pérez" }]), /has an id unusable as a folder/, JSON.stringify(id));
  }
});

test("reserved ids fail, including general (the general og image name)", () => {
  for (const id of ["og", "invitacion", "restricciones", "transferencia", "confirmar", "general", "General", " CONFIRMAR "]) {
    assert.throws(() => validateGuests([{ id, name: "Familia Pérez" }]), /uses the reserved id/, id);
  }
});

test("uppercase ids are lowercased", () => {
  assert.deepEqual(validateGuests([{ id: " Familia-PEREZ ", name: "Familia Pérez" }]),
    [{ name: "Familia Pérez", slug: "familia-perez" }]);
});

test("ids that lowercase to the same slug are duplicates", () => {
  assert.throws(() => validateGuests([{ id: "familia-perez", name: "A" }, { id: "Familia-Perez", name: "B" }]),
    /the id "familia-perez" is used by more than one guest/);
});

test("a guest without a name fails", () => {
  assert.throws(() => validateGuests([{ id: "familia-perez", name: "  " }]), /guest "familia-perez" has no name/);
});

test("build-site --sheet stops before writing anything when the sheet reports an error", async () => {
  const { server, url } = await localServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "duplicate_id", ids: ["familia-perez"] }));
  });
  const docs = mkdtempSync(join(tmpdir(), "sheet-build-"));
  try {
    const child = spawn(process.execPath,
      [join(root, "tools", "build-site.mjs"), "--sheet", join(root, "prototype", "envelope.html"), docs],
      { env: { ...process.env, RSVP_ENDPOINT: url } });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const code = await new Promise((done) => child.on("close", done));
    assert.equal(code, 1);
    assert.match(stderr, /build-site: the sheet returned duplicate_id; repeated ids: familia-perez\./);
    assert.deepEqual(readdirSync(docs), []);
  } finally {
    await new Promise((done) => server.close(done));
    rmSync(docs, { recursive: true, force: true });
  }
});
