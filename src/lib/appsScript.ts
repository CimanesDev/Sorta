// The Google Apps Script the researcher pastes into their Google Sheet (Extensions → Apps Script).
// It accepts the full set of tabs from this website and rewrites them. The token stops anyone else
// who learns the web-app URL from writing to the sheet.
export function appsScript(token: string) {
  return `// Sorta → Google Sheets. Paste this whole file into Extensions → Apps Script, then
// Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
const TOKEN = ${JSON.stringify(token)};

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: "Bad request" });
  }
  if (data.token !== TOKEN) return reply({ ok: false, error: "Wrong token" });

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    data.tabs.forEach(function (t, i) {
      const sh = ss.getSheetByName(t.name) || ss.insertSheet(t.name);
      sh.clear();
      const values = [t.header].concat(t.rows);
      sh.getRange(1, 1, values.length, t.header.length).setValues(values);
      sh.getRange(1, 1, 1, t.header.length)
        .setFontWeight("bold").setBackground(t.color || "#1d1e20").setFontColor("#ffffff");
      sh.setFrozenRows(1);
      if (t.color) sh.setTabColor(t.color);
      if (t.widths) t.widths.forEach(function (w, c) { sh.setColumnWidth(c + 1, w); });
      if (t.rows.length) {
        sh.getRange(2, 1, t.rows.length, t.header.length).setVerticalAlignment("top").setWrap(true);
        if (t.catCol >= 0 && t.rowColors) {
          sh.getRange(2, t.catCol + 1, t.rows.length, 1)
            .setBackgrounds(t.rowColors.map(function (c) { return [c || null]; }))
            .setFontWeight("bold");
        }
      }
      sh.activate();
      ss.moveActiveSheet(i + 1);
    });
    const keep = data.tabs.map(function (t) { return t.name; });
    ss.getSheets().forEach(function (sh) {
      if (keep.indexOf(sh.getName()) < 0 && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
    });
    ss.getSheets()[0].activate();
  } finally {
    lock.releaseLock();
  }
  return reply({ ok: true, url: ss.getUrl() });
}

function doGet() {
  return reply({ ok: true, app: "sorta" });
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
`;
}
