// RSVP web app for the "Invitados XV Morena" sheet, used by docs/confirmar/ and by `npm run build:sheet`.
//
// Deploy: open the sheet, Extensions > Apps Script, paste this file, then Deploy > New deployment >
// Web app, "Execute as: Me", "Who has access: Anyone". Put the /exec URL in CONFIG.rsvpEndpoint of
// prototype/confirm.html. After editing this file, deploy it as a new version of the existing deployment
// (Implementar > Gestionar implementaciones > edit (pencil) > Versión: Nueva versión > Implementar) so the
// same /exec URL serves the new code. A brand-new deployment would get a different URL.
//
// Row 1 holds the headers, looked up by name: id, nombre, telefono, cantidadInvitados, Confirmado,
// fechaConfirmacion, celiacos, vegetarianos, veganos, otraRestriccion. A row's id is the guest page slug, always answered in lowercase and looked up
// case-insensitively. When the `id` cell is empty it is computed from `nombre` with the same slugify as
// tools/sheet-guests.mjs, e.g. "Familia Pérez" -> "familia-perez", and a successful list action writes it
// back into the cell. Rows with an empty `nombre` are ignored. The phone is never returned. Tests:
// tools/test/code-gs.test.mjs (`npm test`).
//
// GET  ?id=<slug>                      -> {ok, id, name, max, confirmed, celiac, vegetarian, vegan, otherDiet,
//                                         message}; message is "" until the optional `mensaje` column exists.
// GET  ?action=list                    -> {ok, guests: [{id, name}]} in sheet order, for the site build;
//                                         {ok: false, error: "duplicate_id", ids} when two rows share an id
//                                         and {ok: false, error: "empty_id", rows} when a nombre slugifies
//                                         to nothing.
// POST {"id": "<slug>", "count": <n>, "celiac": <n>, "vegetarian": <n>, "vegan": <n>, "otherDiet": "<text>"}
//                                      -> same shape as GET ?id= after saving; sent as text/plain to avoid a
//                                         CORS preflight, which Apps Script web apps do not answer. The
//                                         dietary counts add up to at most count (one special menu per
//                                         person) and otherDiet is at most 200 characters,
//                                         else {ok: false, error: "invalid_diet"}. Missing dietary fields
//                                         count as 0 and "" (pages cached before they existed).
// POST {"action": "message", "id": "<slug>", "message": "<text>"}
//                                      -> {ok, id, message} after writing `mensaje` and `fechaMensaje`
//                                         (docs/mensaje/); 1-300 characters, else {ok: false, error:
//                                         "invalid_message"}. Needs no key.
// POST {"action": "send-list", "key": "<SEND_KEY>"}
//                                      -> {ok, message, guests: [{id, name, phone, sent}]} for
//                                         tools/send-invites.mjs; message is cell A1 of the `Mensaje` tab and
//                                         sent is whether the `Enviado` cell has a value.
// POST {"action": "mark-sent", "key": "<SEND_KEY>", "id": "<slug>"}
//                                      -> {ok, id} after writing the date into `Enviado`.
//                                         A wrong key gives {ok: false, error: "forbidden"}. Set the key in
//                                         Project Settings > Script Properties as SEND_KEY.

var HEADERS = [
  "id", "nombre", "cantidadInvitados", "Confirmado", "fechaConfirmacion",
  "celiacos", "vegetarianos", "veganos", "otraRestriccion"
];
// Dietary counts: request/response field -> sheet column.
var DIET_COUNTS = { celiac: "celiacos", vegetarian: "vegetarianos", vegan: "veganos" };
var OTHER_DIET_MAX = 200;
// Columns only the bulk-send actions need; mapped when present, never required by readSheet_.
var SEND_HEADERS = ["telefono", "Enviado"];
var SEND_KEY_MIN = 16;
// Columns for the message to Morena (docs/mensaje/), also optional.
var MESSAGE_HEADERS = ["mensaje", "fechaMensaje"];
var MESSAGE_MAX = 300;

function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  if (params.action === "list") return json_(listGuests_());
  var id = String(params.id || "").trim();
  if (!id) return json_({ ok: false, error: "not_found" });
  var guest = findGuest_(id);
  return json_(guest ? publicGuest_(guest) : { ok: false, error: "not_found" });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: "bad_request" });
  }
  if (body && body.action === "message") return json_(saveMessage_(body));
  if (body && body.action !== undefined) return json_(sendAction_(body));
  var id = body && typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return json_({ ok: false, error: "bad_request" });

  return withLock_(function () {
    var guest = findGuest_(id);
    if (!guest) return json_({ ok: false, error: "not_found" });
    var count = body.count;
    if (typeof count !== "number" || Math.floor(count) !== count || count < 0 || count > guest.max) {
      return json_({ ok: false, error: "invalid_count" });
    }
    var diet = readDiet_(body, count);
    if (!diet) return json_({ ok: false, error: "invalid_diet" });
    guest.sheet.getRange(guest.row, guest.cols.Confirmado + 1).setValue(count);
    guest.sheet.getRange(guest.row, guest.cols.fechaConfirmacion + 1).setValue(new Date());
    Object.keys(DIET_COUNTS).forEach(function (field) {
      guest.sheet.getRange(guest.row, guest.cols[DIET_COUNTS[field]] + 1).setValue(diet[field]);
    });
    guest.sheet.getRange(guest.row, guest.cols.otraRestriccion + 1).setValue(plainCell_(diet.otherDiet));
    SpreadsheetApp.flush();
    guest.confirmed = count;
    guest.diet = diet;
    return json_(publicGuest_(guest));
  }, function () {
    return json_({ ok: false, error: "busy" });
  });
}

// The dietary answer in a POST body, or null when a value is invalid. Each count is a whole number and all
// of them together are at most count: one special menu per person; otherDiet is trimmed with inner
// whitespace collapsed.
function readDiet_(body, count) {
  var diet = {};
  var fields = Object.keys(DIET_COUNTS);
  var total = 0;
  for (var i = 0; i < fields.length; i++) {
    var n = body[fields[i]] === undefined ? 0 : body[fields[i]];
    if (typeof n !== "number" || Math.floor(n) !== n || n < 0) return null;
    diet[fields[i]] = n;
    total += n;
  }
  if (total > count) return null;
  var other = body.otherDiet === undefined ? "" : body.otherDiet;
  if (typeof other !== "string") return null;
  other = other.replace(/\s+/g, " ").trim();
  if (other.length > OTHER_DIET_MAX) return null;
  diet.otherDiet = other;
  return diet;
}

// The family's message for Morena from docs/mensaje/: 1 to 300 characters after trimming (line breaks
// kept); the latest one replaces the previous one. Public like the RSVP save, so it needs no key.
function saveMessage_(body) {
  var id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return { ok: false, error: "bad_request" };
  var message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > MESSAGE_MAX) return { ok: false, error: "invalid_message" };
  return withLock_(function () {
    var guest = findGuest_(id);
    if (!guest) return { ok: false, error: "not_found" };
    var missing = missingColumn_(guest, MESSAGE_HEADERS);
    if (missing) return { ok: false, error: "missing_column", column: missing };
    guest.sheet.getRange(guest.row, guest.cols.mensaje + 1).setValue(plainCell_(message));
    guest.sheet.getRange(guest.row, guest.cols.fechaMensaje + 1).setValue(new Date());
    SpreadsheetApp.flush();
    return { ok: true, id: guest.id, message: message };
  }, function () {
    return { ok: false, error: "busy" };
  });
}

// Bulk send (tools/send-invites.mjs): the only actions that return phones, so they need the SEND_KEY
// script property (at least 16 characters). Read only by these actions: the `Enviado` column and cell A1
// of the `Mensaje` tab, so the RSVP page keeps working without them.
function sendAction_(body) {
  var key = PropertiesService.getScriptProperties().getProperty("SEND_KEY");
  if (!key || key.length < SEND_KEY_MIN || body.key !== key) return { ok: false, error: "forbidden" };
  if (body.action === "send-list") return sendList_();
  if (body.action === "mark-sent") return markSent_(body.id);
  return { ok: false, error: "bad_request" };
}

function sendList_() {
  var messageSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Mensaje");
  if (!messageSheet) return { ok: false, error: "no_message_sheet" };
  var data = readSheet_();
  var missing = missingColumn_(data, SEND_HEADERS);
  if (missing) return { ok: false, error: "missing_column", column: missing };
  var guests = [];
  for (var r = 1; r < data.values.length; r++) {
    var row = data.values[r];
    var name = String(row[data.cols.nombre]).trim();
    if (!name) continue;
    guests.push({
      id: effectiveId_(row, data.cols),
      name: name,
      phone: String(row[data.cols.telefono]).trim(),
      sent: String(row[data.cols.Enviado]).trim() !== ""
    });
  }
  return { ok: true, message: String(messageSheet.getRange("A1").getValue()).trim(), guests: guests };
}

function markSent_(id) {
  if (typeof id !== "string" || !id.trim()) return { ok: false, error: "bad_request" };
  return withLock_(function () {
    var guest = findGuest_(id.trim());
    if (!guest) return { ok: false, error: "not_found" };
    var missing = missingColumn_(guest, SEND_HEADERS);
    if (missing) return { ok: false, error: "missing_column", column: missing };
    guest.sheet.getRange(guest.row, guest.cols.Enviado + 1).setValue(new Date());
    SpreadsheetApp.flush();
    return { ok: true, id: guest.id };
  }, function () {
    return { ok: false, error: "busy" };
  });
}

// The first of names missing from data.cols, or "" when all are there.
function missingColumn_(data, names) {
  for (var i = 0; i < names.length; i++) {
    if (data.cols[names[i]] === undefined) return names[i];
  }
  return "";
}

// Lists every guest as {id, name} only: these names are already public through the built guest pages.
// Every row is checked first; only when the whole list is valid do empty `id` cells get their computed id
// written back, so the sheet shows the slug each page uses and an error response never changes the sheet.
function listGuests_() {
  return withLock_(function () {
    var data = readSheet_();
    var guests = [];
    var seen = {};
    var duplicates = [];
    var emptyRows = [];
    var writes = [];
    for (var r = 1; r < data.values.length; r++) {
      var row = data.values[r];
      var name = String(row[data.cols.nombre]).trim();
      if (!name) continue;
      var id = effectiveId_(row, data.cols);
      if (!id) {
        emptyRows.push(r + 1);
        continue;
      }
      if (String(row[data.cols.id]).trim() === "") writes.push({ row: r + 1, id: id });
      if (seen[id] && duplicates.indexOf(id) === -1) duplicates.push(id);
      seen[id] = true;
      guests.push({ id: id, name: name });
    }
    if (duplicates.length) return { ok: false, error: "duplicate_id", ids: duplicates };
    if (emptyRows.length) return { ok: false, error: "empty_id", rows: emptyRows };
    writes.forEach(function (w) {
      data.sheet.getRange(w.row, data.cols.id + 1).setValue(w.id);
    });
    SpreadsheetApp.flush();
    return { ok: true, guests: guests };
  }, function () {
    return { ok: false, error: "busy" };
  });
}

// Finds the row whose effective id matches (case-insensitive). Returns null when the id is unknown.
function findGuest_(id) {
  var data = readSheet_();
  var wanted = id.toLowerCase();
  for (var r = 1; r < data.values.length; r++) {
    var row = data.values[r];
    if (!String(row[data.cols.nombre]).trim()) continue;
    var rowId = effectiveId_(row, data.cols);
    if (!rowId || rowId !== wanted) continue;
    var confirmed = row[data.cols.Confirmado];
    var diet = {};
    Object.keys(DIET_COUNTS).forEach(function (field) {
      diet[field] = countCell_(row[data.cols[DIET_COUNTS[field]]]);
    });
    diet.otherDiet = String(row[data.cols.otraRestriccion]).trim();
    return {
      sheet: data.sheet,
      row: r + 1,
      cols: data.cols,
      id: rowId,
      name: String(row[data.cols.nombre]).trim(),
      max: Number(row[data.cols.cantidadInvitados]) || 0,
      confirmed: countCell_(confirmed),
      diet: diet,
      message: data.cols.mensaje === undefined ? "" : String(row[data.cols.mensaje]).trim()
    };
  }
  return null;
}

// A leading = + - @ would make the sheet read a guest's text as a formula; the apostrophe keeps it text.
function plainCell_(text) {
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

// A count cell as a number, or null while it is empty.
function countCell_(value) {
  return value === "" || value === null ? null : Number(value);
}

// Reads the first sheet and maps each required header to its column index.
function readSheet_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var values = sheet.getDataRange().getValues();
  var header = values[0].map(function (h) { return String(h).trim(); });
  var cols = {};
  HEADERS.forEach(function (name) {
    var index = header.indexOf(name);
    if (index === -1) throw new Error("Missing column: " + name);
    cols[name] = index;
  });
  SEND_HEADERS.concat(MESSAGE_HEADERS).forEach(function (name) {
    if (header.indexOf(name) !== -1) cols[name] = header.indexOf(name);
  });
  return { sheet: sheet, values: values, cols: cols };
}

// The trimmed, lowercased `id` cell, or the slug of `nombre` when the cell is empty. Lowercase because the
// id is a GitHub Pages folder and those URLs are case-sensitive; the cell itself is never rewritten.
function effectiveId_(row, cols) {
  var id = String(row[cols.id]).trim().toLowerCase();
  return id || slugify_(String(row[cols.nombre]).trim());
}

// Must stay identical to slugify in tools/sheet-guests.mjs (npm test checks it): strip accents, lowercase,
// dashes for the rest.
function slugify_(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Runs fn under the script lock so concurrent saves and id write-backs do not interleave.
function withLock_(fn, onBusy) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return onBusy();
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function publicGuest_(guest) {
  return {
    ok: true, id: guest.id, name: guest.name, max: guest.max, confirmed: guest.confirmed,
    celiac: guest.diet.celiac, vegetarian: guest.diet.vegetarian, vegan: guest.diet.vegan,
    otherDiet: guest.diet.otherDiet, message: guest.message
  };
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
