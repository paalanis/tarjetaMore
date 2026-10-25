// RSVP web app for the "Invitados XV Morena" sheet, used by docs/confirmar/ and by `npm run build:sheet`.
//
// Deploy: open the sheet, Extensions > Apps Script, paste this file, then Deploy > New deployment >
// Web app, "Execute as: Me", "Who has access: Anyone". Put the /exec URL in CONFIG.rsvpEndpoint of
// prototype/confirm.html. After editing this file, deploy it as a new version of the existing deployment
// (Implementar > Gestionar implementaciones > edit (pencil) > Versión: Nueva versión > Implementar) so the
// same /exec URL serves the new code. A brand-new deployment would get a different URL.
//
// Row 1 holds the headers, looked up by name: id, nombre, telefono, cantidadInvitados, Confirmado,
// fechaConfirmacion. A row's id is the guest page slug. When the `id` cell is empty it is computed from
// `nombre` with the same slugify as tools/build-site.mjs, e.g. "Familia Pérez" -> "familia-perez", and the
// list action writes it back into the cell. Rows with an empty `nombre` are ignored. The phone is never
// returned.
//
// GET  ?id=<slug>                      -> {ok, id, name, max, confirmed}
// GET  ?action=list                    -> {ok, guests: [{id, name}]} in sheet order, for the site build;
//                                         {ok: false, error: "duplicate_id", ids} when two rows share an id
//                                         and {ok: false, error: "empty_id", rows} when a nombre slugifies
//                                         to nothing.
// POST {"id": "<slug>", "count": <n>}  -> same shape as GET ?id= after saving; sent as text/plain to avoid a
//                                         CORS preflight, which Apps Script web apps do not answer.

var HEADERS = ["id", "nombre", "cantidadInvitados", "Confirmado", "fechaConfirmacion"];

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
  var id = body && typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return json_({ ok: false, error: "bad_request" });

  return withLock_(function () {
    var guest = findGuest_(id);
    if (!guest) return json_({ ok: false, error: "not_found" });
    var count = body.count;
    if (typeof count !== "number" || Math.floor(count) !== count || count < 0 || count > guest.max) {
      return json_({ ok: false, error: "invalid_count" });
    }
    guest.sheet.getRange(guest.row, guest.cols.Confirmado + 1).setValue(count);
    guest.sheet.getRange(guest.row, guest.cols.fechaConfirmacion + 1).setValue(new Date());
    SpreadsheetApp.flush();
    guest.confirmed = count;
    return json_(publicGuest_(guest));
  }, function () {
    return json_({ ok: false, error: "busy" });
  });
}

// Lists every guest as {id, name} only: these names are already public through the built guest pages.
// Empty `id` cells get their computed id written back, so the sheet shows the slug each page uses.
function listGuests_() {
  return withLock_(function () {
    var data = readSheet_();
    var guests = [];
    var seen = {};
    var duplicates = [];
    var emptyRows = [];
    for (var r = 1; r < data.values.length; r++) {
      var row = data.values[r];
      var name = String(row[data.cols.nombre]).trim();
      if (!name) continue;
      var id = effectiveId_(row, data.cols);
      if (!id) {
        emptyRows.push(r + 1);
        continue;
      }
      if (String(row[data.cols.id]).trim() === "") {
        data.sheet.getRange(r + 1, data.cols.id + 1).setValue(id);
      }
      var key = id.toLowerCase();
      if (seen[key] && duplicates.indexOf(key) === -1) duplicates.push(key);
      seen[key] = true;
      guests.push({ id: id, name: name });
    }
    SpreadsheetApp.flush();
    if (duplicates.length) return { ok: false, error: "duplicate_id", ids: duplicates };
    if (emptyRows.length) return { ok: false, error: "empty_id", rows: emptyRows };
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
    if (!rowId || rowId.toLowerCase() !== wanted) continue;
    var confirmed = row[data.cols.Confirmado];
    return {
      sheet: data.sheet,
      row: r + 1,
      cols: data.cols,
      id: rowId,
      name: String(row[data.cols.nombre]).trim(),
      max: Number(row[data.cols.cantidadInvitados]) || 0,
      confirmed: confirmed === "" || confirmed === null ? null : Number(confirmed)
    };
  }
  return null;
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
  return { sheet: sheet, values: values, cols: cols };
}

// The trimmed `id` cell, or the slug of `nombre` when the cell is empty.
function effectiveId_(row, cols) {
  var id = String(row[cols.id]).trim();
  return id || slugify_(String(row[cols.nombre]).trim());
}

// Must stay identical to slugify in tools/build-site.mjs: strip accents, lowercase, dashes for the rest.
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
  return { ok: true, id: guest.id, name: guest.name, max: guest.max, confirmed: guest.confirmed };
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
