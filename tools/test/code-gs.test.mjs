// tools/rsvp/Code.gs run in a vm context with SpreadsheetApp, LockService and ContentService stubbed over an
// in-memory grid, so the deployed script's behaviour is checked without Google. Guest data is fictional.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { slugify } from "../sheet-guests.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(join(root, "tools", "rsvp", "Code.gs"), "utf8");

const HEADER = ["id", "nombre", "telefono", "cantidadInvitados", "Confirmado", "fechaConfirmacion"];

// Loads Code.gs over a copy of rows. `busy` makes the script lock time out.
function loadScript(rows, { busy = false } = {}) {
  const grid = rows.map((row) => row.slice());
  let held = 0;
  const sheet = {
    getDataRange: () => ({ getValues: () => grid.map((row) => row.slice()) }),
    getRange: (row, col) => ({ setValue: (value) => { grid[row - 1][col - 1] = value; } }),
  };
  const context = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheets: () => [sheet] }), flush() {} },
    LockService: {
      getScriptLock: () => ({
        waitLock() {
          if (busy) throw new Error("Lock timeout");
          held++;
        },
        releaseLock() { held--; },
      }),
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (text) => ({ setMimeType: () => ({ text }) }),
    },
  });
  vm.runInContext(source, context, { filename: "Code.gs" });
  return {
    context,
    grid,
    held: () => held,
    get: (parameter) => JSON.parse(context.doGet({ parameter }).text),
    postRaw: (contents) => JSON.parse(context.doPost({ postData: { contents } }).text),
    post: (body) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(body) } }).text),
  };
}

const sampleRows = () => [
  HEADER,
  ["", "Familia Pérez", "5490000001", 4, "", ""],
  ["tia-ana", " Tía Ana Gómez ", "5490000002", 2, 1, "2026-10-01"],
  ["", "", "5490000003", 3, "", ""],
  ["", "José Núñez", "5490000004", 1, "", ""],
];

test("list fills empty ids from nombre and returns only {id, name} in sheet order", () => {
  const script = loadScript(sampleRows());
  const result = script.get({ action: "list" });
  assert.deepEqual(result, {
    ok: true,
    guests: [
      { id: "familia-perez", name: "Familia Pérez" },
      { id: "tia-ana", name: "Tía Ana Gómez" },
      { id: "jose-nunez", name: "José Núñez" },
    ],
  });
  assert.equal(script.grid[1][0], "familia-perez");
  assert.equal(script.grid[2][0], "tia-ana");
  assert.equal(script.grid[3][0], "", "a row without nombre is left alone");
  assert.equal(script.grid[4][0], "jose-nunez");
  assert.equal(script.held(), 0, "the lock is released");
});

test("list never returns telefono, cantidadInvitados or Confirmado", () => {
  const result = loadScript(sampleRows()).get({ action: "list" });
  for (const guest of result.guests) assert.deepEqual(Object.keys(guest).sort(), ["id", "name"]);
  const text = JSON.stringify(result);
  for (const leak of ["549000", "telefono", "cantidad", "Confirmado", "max", "confirmed", "2026-10-01"]) {
    assert.ok(!text.includes(leak), `list leaks ${leak}`);
  }
});

test("list lowercases typed ids without rewriting them, and ?id= answers with the lowercase id", () => {
  const rows = sampleRows();
  rows[2][0] = "Tia-ANA";
  const script = loadScript(rows);
  assert.deepEqual(script.get({ action: "list" }).guests[1], { id: "tia-ana", name: "Tía Ana Gómez" });
  assert.equal(script.grid[2][0], "Tia-ANA");
  assert.equal(script.get({ id: "TIA-ana" }).id, "tia-ana");
});

test("list with a duplicate id returns duplicate_id and leaves the sheet unchanged", () => {
  const rows = [
    HEADER,
    ["", "Familia Pérez", "5490000001", 2, "", ""],
    ["", "José Núñez", "5490000002", 1, "", ""],
    ["FAMILIA-PEREZ", "Otra Familia", "5490000003", 2, "", ""],
  ];
  const script = loadScript(rows);
  assert.deepEqual(script.get({ action: "list" }), { ok: false, error: "duplicate_id", ids: ["familia-perez"] });
  assert.deepEqual(script.grid, rows);
  assert.equal(script.held(), 0);
});

test("list with a nombre that slugifies to nothing returns empty_id and leaves the sheet unchanged", () => {
  const rows = [
    HEADER,
    ["", "Familia Pérez", "5490000001", 2, "", ""],
    ["", "!!!", "5490000002", 2, "", ""],
  ];
  const script = loadScript(rows);
  assert.deepEqual(script.get({ action: "list" }), { ok: false, error: "empty_id", rows: [3] });
  assert.deepEqual(script.grid, rows);
});

test("doGet ?id= finds rows case-insensitively, including rows whose id cell is still empty", () => {
  const script = loadScript(sampleRows());
  assert.deepEqual(script.get({ id: "Familia-Perez" }),
    { ok: true, id: "familia-perez", name: "Familia Pérez", max: 4, confirmed: null });
  assert.deepEqual(script.get({ id: " tia-ana " }), { ok: true, id: "tia-ana", name: "Tía Ana Gómez", max: 2, confirmed: 1 });
  assert.deepEqual(script.get({ id: "nadie" }), { ok: false, error: "not_found" });
  assert.deepEqual(script.get({}), { ok: false, error: "not_found" });
  assert.deepEqual(script.grid, sampleRows(), "lookups never write");
});

test("doPost rejects counts outside 0..max, unknown ids and bad bodies without writing", () => {
  const script = loadScript(sampleRows());
  for (const count of [5, -1, 1.5, "2", null]) {
    assert.deepEqual(script.post({ id: "familia-perez", count }), { ok: false, error: "invalid_count" }, String(count));
  }
  assert.deepEqual(script.post({ id: "nadie", count: 1 }), { ok: false, error: "not_found" });
  assert.deepEqual(script.postRaw("not json"), { ok: false, error: "bad_request" });
  assert.deepEqual(script.post({ count: 1 }), { ok: false, error: "bad_request" });
  assert.deepEqual(script.post({ id: 7, count: 1 }), { ok: false, error: "bad_request" });
  assert.deepEqual(script.post(null), { ok: false, error: "bad_request" });
  assert.deepEqual(script.grid, sampleRows());
  assert.equal(script.held(), 0);
});

test("doPost saves a valid count and the confirmation date on the guest's row only", () => {
  const script = loadScript(sampleRows());
  assert.deepEqual(script.post({ id: "FAMILIA-PEREZ", count: 4 }),
    { ok: true, id: "familia-perez", name: "Familia Pérez", max: 4, confirmed: 4 });
  assert.deepEqual(script.post({ id: "tia-ana", count: 0 }),
    { ok: true, id: "tia-ana", name: "Tía Ana Gómez", max: 2, confirmed: 0 });
  assert.equal(script.grid[1][4], 4);
  assert.equal(Object.prototype.toString.call(script.grid[1][5]), "[object Date]");
  assert.equal(script.grid[2][4], 0);
  assert.deepEqual(script.grid[4], sampleRows()[4]);
  assert.equal(script.held(), 0);
});

test("a lock timeout answers busy", () => {
  const script = loadScript(sampleRows(), { busy: true });
  assert.deepEqual(script.get({ action: "list" }), { ok: false, error: "busy" });
  assert.deepEqual(script.post({ id: "familia-perez", count: 1 }), { ok: false, error: "busy" });
  assert.deepEqual(script.grid, sampleRows());
});

test("Code.gs slugify_ gives the same slugs as the build's slugify", () => {
  const { context } = loadScript(sampleRows());
  const names = [
    "Familia Pérez", "  Ñoño & Cía. ", "Abuela María José", "ÜBER-Gruß", "Tío Raúl (y Sra.)", "Familia D'Angelo",
    "Lucía_Martín", "  ", "!!!", "Çağrı Øster", "Ana  --  Inés", "Señora Pilar Ibáñez Güemes",
  ];
  for (const name of names) assert.equal(context.slugify_(name), slugify(name), JSON.stringify(name));
  assert.equal(slugify("Señora Pilar Ibáñez Güemes"), "senora-pilar-ibanez-guemes");
});
