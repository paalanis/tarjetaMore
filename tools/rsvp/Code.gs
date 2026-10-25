// RSVP web app for the "Invitados XV Morena" sheet, used by docs/confirmar/.
//
// Deploy: open the sheet, Extensions > Apps Script, paste this file, then Deploy > New deployment >
// Web app, "Execute as: Me", "Who has access: Anyone". Put the /exec URL in CONFIG.rsvpEndpoint of
// prototype/confirm.html. After editing this file, redeploy (Manage deployments > Edit > New version)
// so the same URL serves the new code.
//
// Row 1 holds the headers, looked up by name: id, nombre, telefono, cantidadInvitados, Confirmado,
// fechaConfirmacion. `id` must equal the guest page slug (slugify in tools/build-site.mjs), e.g.
// "Familia Pérez" -> "familia-perez". The phone is never returned.
//
// GET  ?id=<slug>                      -> {ok, id, name, max, confirmed}
// POST {"id": "<slug>", "count": <n>}  -> same shape after saving; sent as text/plain to avoid a CORS
//                                         preflight, which Apps Script web apps do not answer.

var HEADERS = ["id", "nombre", "cantidadInvitados", "Confirmado", "fechaConfirmacion"];

function doGet(e) {
  var id = e && e.parameter ? String(e.parameter.id || "").trim() : "";
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

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return json_({ ok: false, error: "busy" });
  }
  try {
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
  } finally {
    lock.releaseLock();
  }
}

// Finds the row whose id matches (case-insensitive). Returns null when the id is unknown.
function findGuest_(id) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var values = sheet.getDataRange().getValues();
  var header = values[0].map(function (h) { return String(h).trim(); });
  var cols = {};
  HEADERS.forEach(function (name) {
    var index = header.indexOf(name);
    if (index === -1) throw new Error("Missing column: " + name);
    cols[name] = index;
  });
  var wanted = id.toLowerCase();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][cols.id]).trim().toLowerCase() !== wanted) continue;
    var confirmed = values[r][cols.Confirmado];
    return {
      sheet: sheet,
      row: r + 1,
      cols: cols,
      id: String(values[r][cols.id]).trim(),
      name: String(values[r][cols.nombre]).trim(),
      max: Number(values[r][cols.cantidadInvitados]) || 0,
      confirmed: confirmed === "" || confirmed === null ? null : Number(confirmed)
    };
  }
  return null;
}

function publicGuest_(guest) {
  return { ok: true, id: guest.id, name: guest.name, max: guest.max, confirmed: guest.confirmed };
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
