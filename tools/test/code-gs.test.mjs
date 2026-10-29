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

const HEADER = [
  "id", "nombre", "telefono", "cantidadInvitados", "Confirmado", "fechaConfirmacion",
  "celiacos", "vegetarianos", "veganos", "otraRestriccion",
];
const NO_DIET = { celiac: null, vegetarian: null, vegan: null, otherDiet: "" };

// Loads Code.gs over a copy of rows. `busy` makes the script lock time out; `properties` are the script
// properties; `message` is cell A1 of the "Mensaje" tab, which is absent when message is undefined.
function loadScript(rows, { busy = false, properties = {}, message } = {}) {
  const grid = rows.map((row) => row.slice());
  let held = 0;
  const sheet = {
    getDataRange: () => ({ getValues: () => grid.map((row) => row.slice()) }),
    getRange: (row, col) => ({ setValue: (value) => { grid[row - 1][col - 1] = value; } }),
  };
  const messageSheet = { getRange: (a1) => ({ getValue: () => (a1 === "A1" ? message : "") }) };
  const spreadsheet = {
    getSheets: () => (message === undefined ? [sheet] : [sheet, messageSheet]),
    getSheetByName: (name) => (name === "Mensaje" && message !== undefined ? messageSheet : null),
  };
  const context = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush() {} },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (key) => (key in properties ? properties[key] : null) }),
    },
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
  ["", "Familia Pérez", "5490000001", 4, "", "", "", "", "", ""],
  ["tia-ana", " Tía Ana Gómez ", "5490000002", 2, 1, "2026-10-01", 1, 0, 0, "Sin lactosa"],
  ["", "", "5490000003", 3, "", "", "", "", "", ""],
  ["", "José Núñez", "5490000004", 1, "", "", "", "", "", ""],
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
  for (const leak of ["549000", "telefono", "cantidad", "Confirmado", "max", "confirmed", "2026-10-01", "lactosa"]) {
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
    ["", "Familia Pérez", "5490000001", 2, "", "", "", "", "", ""],
    ["", "José Núñez", "5490000002", 1, "", "", "", "", "", ""],
    ["FAMILIA-PEREZ", "Otra Familia", "5490000003", 2, "", "", "", "", "", ""],
  ];
  const script = loadScript(rows);
  assert.deepEqual(script.get({ action: "list" }), { ok: false, error: "duplicate_id", ids: ["familia-perez"] });
  assert.deepEqual(script.grid, rows);
  assert.equal(script.held(), 0);
});

test("list with a nombre that slugifies to nothing returns empty_id and leaves the sheet unchanged", () => {
  const rows = [
    HEADER,
    ["", "Familia Pérez", "5490000001", 2, "", "", "", "", "", ""],
    ["", "!!!", "5490000002", 2, "", "", "", "", "", ""],
  ];
  const script = loadScript(rows);
  assert.deepEqual(script.get({ action: "list" }), { ok: false, error: "empty_id", rows: [3] });
  assert.deepEqual(script.grid, rows);
});

test("doGet ?id= finds rows case-insensitively, including rows whose id cell is still empty", () => {
  const script = loadScript(sampleRows());
  assert.deepEqual(script.get({ id: "Familia-Perez" }),
    { ok: true, id: "familia-perez", name: "Familia Pérez", max: 4, confirmed: null, ...NO_DIET });
  assert.deepEqual(script.get({ id: " tia-ana " }), {
    ok: true, id: "tia-ana", name: "Tía Ana Gómez", max: 2, confirmed: 1,
    celiac: 1, vegetarian: 0, vegan: 0, otherDiet: "Sin lactosa",
  });
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
    { ok: true, id: "familia-perez", name: "Familia Pérez", max: 4, confirmed: 4,
      celiac: 0, vegetarian: 0, vegan: 0, otherDiet: "" });
  assert.deepEqual(script.post({ id: "tia-ana", count: 0 }),
    { ok: true, id: "tia-ana", name: "Tía Ana Gómez", max: 2, confirmed: 0,
      celiac: 0, vegetarian: 0, vegan: 0, otherDiet: "" });
  assert.equal(script.grid[1][4], 4);
  assert.equal(Object.prototype.toString.call(script.grid[1][5]), "[object Date]");
  assert.equal(script.grid[2][4], 0);
  assert.deepEqual(script.grid[2].slice(6), [0, 0, 0, ""], "a body without dietary fields clears them");
  assert.deepEqual(script.grid[4], sampleRows()[4]);
  assert.equal(script.held(), 0);
});

test("doPost saves dietary counts and the other-restriction text on the guest's row", () => {
  const script = loadScript(sampleRows());
  const body = { id: "familia-perez", count: 3, celiac: 1, vegetarian: 3, vegan: 0, otherDiet: "  Alergia   al maní " };
  assert.deepEqual(script.post(body), {
    ok: true, id: "familia-perez", name: "Familia Pérez", max: 4, confirmed: 3,
    celiac: 1, vegetarian: 3, vegan: 0, otherDiet: "Alergia al maní",
  });
  assert.deepEqual(script.grid[1].slice(6), [1, 3, 0, "Alergia al maní"]);
  assert.deepEqual(script.get({ id: "familia-perez" }).otherDiet, "Alergia al maní");
  assert.deepEqual(script.grid[2], sampleRows()[2]);
});

test("doPost stores other-restriction text that looks like a formula as plain text", () => {
  const script = loadScript(sampleRows());
  for (const text of ["=IMPORTXML(\"x\")", "+1", "-2", "@a"]) {
    assert.equal(script.post({ id: "familia-perez", count: 1, otherDiet: text }).ok, true, text);
    assert.equal(script.grid[1][9], "'" + text, text);
  }
  for (const text of ["1 sin sal", "Alergia a la nuez", "3 kosher"]) {
    assert.equal(script.post({ id: "familia-perez", count: 1, otherDiet: text }).ok, true, text);
    assert.equal(script.grid[1][9], text, "ordinary text is stored as typed");
  }
});

test("doPost rejects dietary values outside 0..count or a bad text without writing", () => {
  const script = loadScript(sampleRows());
  const bad = [
    { celiac: 3 }, { vegetarian: -1 }, { vegan: 1.5 }, { celiac: "1" }, { vegan: null },
    { otherDiet: 7 }, { otherDiet: "x".repeat(201) },
  ];
  for (const extra of bad) {
    assert.deepEqual(script.post({ id: "familia-perez", count: 2, ...extra }), { ok: false, error: "invalid_diet" },
      JSON.stringify(extra));
  }
  assert.deepEqual(script.post({ id: "tia-ana", count: 0, celiac: 1 }), { ok: false, error: "invalid_diet" });
  assert.deepEqual(script.post({ id: "familia-perez", count: 9, celiac: 0 }), { ok: false, error: "invalid_count" });
  assert.deepEqual(script.grid, sampleRows());
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

// Bulk send: the sheet gains an `Enviado` column, read only by the key-protected send actions.
const KEY = "k".repeat(24);
const sendRows = () => [
  [...HEADER, "Enviado"],
  ["", "Familia Pérez", " 261 382-9997 ", 4, "", "", "", "", "", "", ""],
  ["tia-ana", "Tía Ana Gómez", "5492610000002", 2, 1, "2026-10-01", 1, 0, 0, "", "2026-10-28"],
  ["", "", "5490000003", 3, "", "", "", "", "", "", ""],
];
const sendScript = (opts = {}) =>
  loadScript(sendRows(), { properties: { SEND_KEY: KEY }, message: "Hola, te invitamos a los XV de Morena", ...opts });

test("send-list returns the message and every guest with phone and sent flag, given the key", () => {
  const script = sendScript();
  assert.deepEqual(script.post({ action: "send-list", key: KEY }), {
    ok: true,
    message: "Hola, te invitamos a los XV de Morena",
    guests: [
      { id: "familia-perez", name: "Familia Pérez", phone: "261 382-9997", sent: false },
      { id: "tia-ana", name: "Tía Ana Gómez", phone: "5492610000002", sent: true },
    ],
  });
  assert.deepEqual(script.grid, sendRows(), "send-list never writes");
  assert.equal(script.held(), 0);
});

test("send actions refuse a wrong, missing or unset key without revealing phones", () => {
  const bodies = [
    { action: "send-list", key: "wrong" }, { action: "send-list" }, { action: "send-list", key: 5 },
    { action: "mark-sent", key: "wrong", id: "familia-perez" },
  ];
  for (const body of bodies) {
    const script = sendScript();
    assert.deepEqual(script.post(body), { ok: false, error: "forbidden" }, JSON.stringify(body));
    assert.deepEqual(script.grid, sendRows());
  }
  for (const properties of [{}, { SEND_KEY: "" }, { SEND_KEY: "short" }]) {
    const script = sendScript({ properties });
    const key = properties.SEND_KEY;
    assert.deepEqual(script.post({ action: "send-list", key }), { ok: false, error: "forbidden" }, JSON.stringify(properties));
  }
});

test("send-list reports a missing Mensaje tab and returns an empty message as is", () => {
  assert.deepEqual(sendScript({ message: undefined }).post({ action: "send-list", key: KEY }),
    { ok: false, error: "no_message_sheet" });
  assert.equal(sendScript({ message: "  " }).post({ action: "send-list", key: KEY }).message, "");
});

test("send-list reports a missing Enviado column, while the RSVP actions keep working without it", () => {
  const script = loadScript(sampleRows(), { properties: { SEND_KEY: KEY }, message: "Hola" });
  assert.deepEqual(script.post({ action: "send-list", key: KEY }), { ok: false, error: "missing_column", column: "Enviado" });
  assert.equal(script.get({ id: "tia-ana" }).ok, true);
  assert.equal(script.post({ id: "tia-ana", count: 1 }).ok, true);
});

test("mark-sent stamps Enviado on the guest's row only, and rejects unknown ids", () => {
  const script = sendScript();
  assert.deepEqual(script.post({ action: "mark-sent", key: KEY, id: "FAMILIA-PEREZ" }), { ok: true, id: "familia-perez" });
  assert.equal(Object.prototype.toString.call(script.grid[1][10]), "[object Date]");
  assert.deepEqual(script.grid[1].slice(0, 10), sendRows()[1].slice(0, 10), "only Enviado changes");
  assert.deepEqual(script.post({ action: "mark-sent", key: KEY, id: "nadie" }), { ok: false, error: "not_found" });
  assert.deepEqual(script.post({ action: "mark-sent", key: KEY }), { ok: false, error: "bad_request" });
  assert.deepEqual(script.grid.slice(2), sendRows().slice(2));
  assert.equal(script.held(), 0);
});

test("an unknown action is a bad request", () => {
  assert.deepEqual(sendScript().post({ action: "drop", key: KEY }), { ok: false, error: "bad_request" });
});
