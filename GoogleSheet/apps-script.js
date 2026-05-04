// ══════════════════════════════════════════════════════════════════
// WORKOUT TRACKER — Google Apps Script Backend  (version 2)
// ══════════════════════════════════════════════════════════════════
//
// OPSÆTNING:
// 1. Opret et nyt Google Sheet (eller brug et eksisterende)
// 2. Gå til Udvidelser → Apps Script
// 3. Indsæt HELE denne fil
// 4. Gem hemmelig nøgle: Projektindstillinger → Script Properties
//    → Tilføj egenskab: SECRET_TOKEN = <dit eget hemmelige kodeord>
// 5. Klik Deploy → Ny implementering → Web-app
//    Kør som:  Mig selv
//    Adgang:   Alle (kun du kender URL'en)
// 6. Kopiér Web-app-URL og indsæt i PWA-appen under Indstillinger
//
// SHEET-STRUKTUR:
//   "Exercises" — øvelses-stamdata
//   "Log"       — træningslog-poster
//
// IMPORTER EKSISTERENDE DATA:
//   Kald doPost med { action: "importExercises", secret: "...", rows: [...] }
//   og  { action: "importLog",       secret: "...", rows: [...] }
//   Se seed-data.json for de korrekte dataformater.
// ══════════════════════════════════════════════════════════════════

// Secret is read from Script Properties (recommended) with a fallback default.
// Set it via: Apps Script editor → Project Settings → Script Properties → add key "SECRET_TOKEN"
const SECRET_TOKEN = (function() {
  try {
    return PropertiesService.getScriptProperties().getProperty('SECRET_TOKEN') || 'WorkoutTracker6500!';
  } catch(_) {
    return 'WorkoutTracker6500!'; // Fallback (used only in local testing without Properties access)
  }
})();

// ── Sheet-navne ──────────────────────────────────────────────────
const SHEET_EXERCISES = 'Exercises';
const SHEET_LOG       = 'Log';

// ── Kolonneoverskrifter ──────────────────────────────────────────
const EXERCISE_HEADERS = [
  'EntryID', 'ID', 'Date', 'Type', 'Category', 'Day',
  'Exercise', 'LastWeight', 'TodayWeight', 'LastReps', 'TodayReps',
  'Set', 'Completed', 'LastCompletedDate', 'Description', 'RPE'
];

const LOG_HEADERS = [
  'EntryID', 'Date', 'Type', 'Exercise', 'Day',
  'LastWeight', 'TodayWeight', 'LastReps', 'TodayReps',
  'DateOnly', 'TimeOnly', 'Set'
];

// ════════════════════════════════════════════════════════════════
//  CORS-hjælper
// ════════════════════════════════════════════════════════════════
function _response(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _err(msg) {
  return _response({ status: 'error', message: msg });
}

function _ok(extra) {
  return _response(Object.assign({ status: 'ok' }, extra || {}));
}

// ════════════════════════════════════════════════════════════════
//  Sheet-hjælpere
// ════════════════════════════════════════════════════════════════

/** Hent eller opret et sheet med de givne headers */
function _getOrCreateSheet(ss, name, headers, headerStyle) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    const hdrRange = sheet.getRange(1, 1, 1, headers.length);
    hdrRange.setFontWeight('bold').setFrozenRows(1);
    if (headerStyle) headerStyle(hdrRange);
  }
  return sheet;
}

/** Returnér alle rækker som array af objekter */
function _sheetToObjects(sheet, headers) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return data
    .filter(row => row.some(v => v !== '' && v !== null))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
}

/** Lav et unikt ID */
function _uid() {
  return Utilities.getUuid();
}

/** Omdan en dato-streng til dato-objekter */
function _parseDate(val) {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  return new Date(val);
}

// ════════════════════════════════════════════════════════════════
//  doGet — læs data
// ════════════════════════════════════════════════════════════════
function doGet(e) {
  try {
    const params  = (e && e.parameter) ? e.parameter : {};
    const action  = params.action  || '';
    const secret  = params.secret  || '';

    // Ping / health-check (ingen auth nødvendig)
    if (!action) {
      return _ok({ message: 'WorkoutTracker API kører ✓' });
    }

    // Auth-tjek
    if (!secret || secret !== SECRET_TOKEN) {
      return _err('Ugyldig nøgle');
    }

    // ── list exercises ───────────────────────────────────────────
    if (action === 'listExercises') {
      const sheet = ss.getSheetByName(SHEET_EXERCISES);
      if (!sheet) return _ok({ exercises: [] });
      const rows = _sheetToObjects(sheet, EXERCISE_HEADERS);
      const exercises = rows.map(r => ({
        entryId:           String(r.EntryID || ''),
        id:                r.ID !== '' ? Number(r.ID) : null,
        date:              r.Date ? String(r.Date) : '',
        type:              String(r.Type      || ''),
        category:          String(r.Category  || ''),
        day:               String(r.Day       || ''),
        exercise:          String(r.Exercise  || ''),
        lastWeight:        r.LastWeight  !== '' ? Number(r.LastWeight)  : 0,
        todayWeight:       r.TodayWeight !== '' ? Number(r.TodayWeight) : 0,
        lastReps:          r.LastReps    !== '' ? Number(r.LastReps)    : 0,
        todayReps:         r.TodayReps   !== '' ? Number(r.TodayReps)   : 0,
        set:               r.Set         !== '' ? Number(r.Set)         : 3,
        completed:         String(r.Completed || 'no'),
        lastCompletedDate: r.LastCompletedDate ? String(r.LastCompletedDate) : '',
        description:       String(r.Description || ''),
        rpe:               r.RPE !== '' ? Number(r.RPE) : null,
        synced:            true
      }));
      return _ok({ exercises });
    }

    // ── list log ─────────────────────────────────────────────────
    if (action === 'listLog') {
      const sheet = ss.getSheetByName(SHEET_LOG);
      if (!sheet) return _ok({ entries: [] });
      const rows = _sheetToObjects(sheet, LOG_HEADERS);
      const entries = rows.map(r => ({
        entryId:     String(r.EntryID || ''),
        date:        r.Date     ? String(r.Date)     : '',
        type:        String(r.Type     || ''),
        exercise:    String(r.Exercise || ''),
        day:         String(r.Day      || ''),
        lastWeight:  r.LastWeight  !== '' ? Number(r.LastWeight)  : 0,
        todayWeight: r.TodayWeight !== '' ? Number(r.TodayWeight) : 0,
        lastReps:    r.LastReps    !== '' ? Number(r.LastReps)    : 0,
        todayReps:   r.TodayReps   !== '' ? Number(r.TodayReps)   : 0,
        dateOnly:    r.DateOnly  ? String(r.DateOnly)  : '',
        timeOnly:    r.TimeOnly  ? String(r.TimeOnly)  : '',
        set:         r.Set !== '' ? Number(r.Set) : null,
        synced:      true
      }));
      // Nyeste først
      entries.sort((a, b) => {
        const da = a.dateOnly || a.date;
        const db = b.dateOnly || b.date;
        return db > da ? 1 : db < da ? -1 : 0;
      });
      return _ok({ entries });
    }

  } catch (err) {
    return _err(err.toString());
  }

  return _ok({ message: 'WorkoutTracker API kører ✓' });
}

// ════════════════════════════════════════════════════════════════
//  doPost — skriv data
// ════════════════════════════════════════════════════════════════
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // Auth-tjek
    // Auth-tjek
    if (!data.secret || data.secret !== SECRET_TOKEN) {
      return _err('Ugyldig nøgle');
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // ════════════════════════════════════════════════════════════
    //  EXERCISES
    // ════════════════════════════════════════════════════════════

    // ── updateExercise ───────────────────────────────────────────
    // Opdatér ét felt (typisk TodayWeight, TodayReps, Completed)
    // body: { action, secret, entryId, fields: { TodayWeight, TodayReps, Completed, ... } }
    if (data.action === 'updateExercise') {
      const sheet = _getOrCreateSheet(ss, SHEET_EXERCISES, EXERCISE_HEADERS,
        r => r.setBackground('#1a2a38').setFontColor('#4ec9f7'));

      const entryId = String(data.entryId || '');
      const fields  = data.fields || {};
      if (!entryId) throw new Error('entryId mangler');

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return _err('Ingen øvelser fundet');

      const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === entryId) {
          const rowNum = i + 2;
          EXERCISE_HEADERS.forEach((h, col) => {
            if (Object.prototype.hasOwnProperty.call(fields, h)) {
              sheet.getRange(rowNum, col + 1).setValue(fields[h]);
            }
          });
          return _ok({ updated: entryId });
        }
      }
      return _err('Øvelse ikke fundet: ' + entryId);
    }

    // ── newExercise ──────────────────────────────────────────────
    // Opret ny øvelse
    // body: { action, secret, exercise: { Type, Category, Day, Exercise, ... } }
    if (data.action === 'newExercise') {
      const sheet = _getOrCreateSheet(ss, SHEET_EXERCISES, EXERCISE_HEADERS,
        r => r.setBackground('#1a2a38').setFontColor('#4ec9f7'));

      const ex      = data.exercise || {};
      const entryId = ex.entryId || _uid();
      const now     = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

      const row = [
        entryId,
        ex.id               || '',
        ex.date             || now,
        ex.type             || '',
        ex.category         || '',
        String(ex.day       || ''),
        ex.exercise         || '',
        ex.lastWeight       !== undefined ? ex.lastWeight  : 0,
        ex.todayWeight      !== undefined ? ex.todayWeight : 0,
        ex.lastReps         !== undefined ? ex.lastReps    : 0,
        ex.todayReps        !== undefined ? ex.todayReps   : 0,
        ex.set              !== undefined ? ex.set         : 3,
        ex.completed        || 'no',
        ex.lastCompletedDate|| now,
        ex.description      || '',
        ex.rpe              !== undefined ? ex.rpe         : ''
      ];
      sheet.appendRow(row);
      return _ok({ entryId });
    }

    // ── deleteExercise ───────────────────────────────────────────
    if (data.action === 'deleteExercise') {
      const sheet   = ss.getSheetByName(SHEET_EXERCISES);
      const entryId = String(data.entryId || '');
      if (!sheet || !entryId) return _err('entryId mangler');

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return _err('Ingen rækker');
      const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = ids.length - 1; i >= 0; i--) {
        if (String(ids[i][0]) === entryId) {
          sheet.deleteRow(i + 2);
          return _ok({ deleted: entryId });
        }
      }
      return _err('Øvelse ikke fundet: ' + entryId);
    }

    // ── newDay ───────────────────────────────────────────────────
    // Nulstil alle afsluttede øvelser: LastWeight=TodayWeight, LastReps=TodayReps, Completed='no'
    if (data.action === 'newDay') {
      const sheet = ss.getSheetByName(SHEET_EXERCISES);
      if (!sheet || sheet.getLastRow() < 2) return _ok({ reset: 0 });

      const lastRow = sheet.getLastRow();
      const allData = sheet.getRange(2, 1, lastRow - 1, EXERCISE_HEADERS.length).getValues();

      const colCompleted   = EXERCISE_HEADERS.indexOf('Completed');
      const colLastWeight  = EXERCISE_HEADERS.indexOf('LastWeight');
      const colTodayWeight = EXERCISE_HEADERS.indexOf('TodayWeight');
      const colLastReps    = EXERCISE_HEADERS.indexOf('LastReps');
      const colTodayReps   = EXERCISE_HEADERS.indexOf('TodayReps');

      let resetCount = 0;
      allData.forEach((row, i) => {
        if (String(row[colCompleted]) === 'yes') {
          const rowNum = i + 2;
          sheet.getRange(rowNum, colLastWeight  + 1).setValue(row[colTodayWeight]);
          sheet.getRange(rowNum, colLastReps    + 1).setValue(row[colTodayReps]);
          sheet.getRange(rowNum, colCompleted   + 1).setValue('no');
          resetCount++;
        }
      });
      return _ok({ reset: resetCount });
    }

    // ── markCompleted ────────────────────────────────────────────
    // Marker én øvelse som afsluttet og gem dagens vægt/reps i Log
    // body: { action, secret, entryId, todayWeight, todayReps, logEntry: { ... } }
    if (data.action === 'markCompleted') {
      const sheet   = _getOrCreateSheet(ss, SHEET_EXERCISES, EXERCISE_HEADERS,
        r => r.setBackground('#1a2a38').setFontColor('#4ec9f7'));
      const entryId = String(data.entryId || '');
      if (!entryId) throw new Error('entryId mangler');

      const lastRow = sheet.getLastRow();
      const ids     = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      const today   = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

      for (let i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === entryId) {
          const rowNum = i + 2;
          if (data.todayWeight !== undefined) {
            sheet.getRange(rowNum, EXERCISE_HEADERS.indexOf('TodayWeight') + 1).setValue(data.todayWeight);
          }
          if (data.todayReps !== undefined) {
            sheet.getRange(rowNum, EXERCISE_HEADERS.indexOf('TodayReps') + 1).setValue(data.todayReps);
          }
          sheet.getRange(rowNum, EXERCISE_HEADERS.indexOf('Completed')        + 1).setValue('yes');
          sheet.getRange(rowNum, EXERCISE_HEADERS.indexOf('LastCompletedDate')+ 1).setValue(today);
          break;
        }
      }

      // Skriv til Log
      if (data.logEntry) {
        _appendLogEntry(ss, data.logEntry);
      }
      return _ok({ marked: entryId });
    }

    // ════════════════════════════════════════════════════════════
    //  LOG
    // ════════════════════════════════════════════════════════════

    // ── logWorkout ───────────────────────────────────────────────
    // Tilføj én log-post (bruges hvis PWA logger manuelt)
    if (data.action === 'logWorkout') {
      const entryId = _appendLogEntry(ss, data.entry || data);
      return _ok({ entryId });
    }

    // ── deleteLog ────────────────────────────────────────────────
    if (data.action === 'deleteLog') {
      const sheet   = ss.getSheetByName(SHEET_LOG);
      const entryId = String(data.entryId || '');
      if (!sheet || !entryId) return _err('entryId mangler');

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return _err('Ingen log-poster');
      const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = ids.length - 1; i >= 0; i--) {
        if (String(ids[i][0]) === entryId) {
          sheet.deleteRow(i + 2);
          return _ok({ deleted: entryId });
        }
      }
      return _err('Log-post ikke fundet: ' + entryId);
    }

    // ════════════════════════════════════════════════════════════
    //  IMPORT (bulk-indlæsning fra xlsx-data)
    // ════════════════════════════════════════════════════════════

    // ── importExercises ──────────────────────────────────────────
    // body: { action, secret, rows: [ { Exercise, Type, Category, Day, ... }, ... ] }
    if (data.action === 'importExercises') {
      const sheet = _getOrCreateSheet(ss, SHEET_EXERCISES, EXERCISE_HEADERS,
        r => r.setBackground('#1a2a38').setFontColor('#4ec9f7'));

      const rows   = data.rows || [];
      const today  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      let imported = 0;

      rows.forEach(ex => {
        const entryId = ex.entryId || ex.__PowerAppsId__ || ex.EntryID || _uid();
        sheet.appendRow([
          entryId,
          ex.ID               !== undefined ? ex.ID               : '',
          ex.Date             || today,
          ex.Type             || ex.type      || '',
          ex.Category         || ex.category  || '',
          String(ex.Day !== undefined ? ex.Day : ex.day !== undefined ? ex.day : ''),
          ex.Exercise         || ex.exercise  || '',
          ex.LastWeight       !== undefined ? ex.LastWeight       : ex.lastWeight       !== undefined ? ex.lastWeight       : 0,
          ex.TodayWeight      !== undefined ? ex.TodayWeight      : ex.todayWeight      !== undefined ? ex.todayWeight      : 0,
          ex.LastReps         !== undefined ? ex.LastReps         : ex.lastReps         !== undefined ? ex.lastReps         : 0,
          ex.TodayReps        !== undefined ? ex.TodayReps        : ex.todayReps        !== undefined ? ex.todayReps        : 0,
          ex.Set              !== undefined ? ex.Set              : ex.set              !== undefined ? ex.set              : 3,
          ex.Completed        || ex.completed  || 'no',
          ex.LastCompletedDate|| ex.lastCompletedDate || today,
          ex.Description      || ex.description      || '',
          ex.RPE              !== undefined ? ex.RPE : ex.rpe !== undefined ? ex.rpe : ''
        ]);
        imported++;
      });
      return _ok({ imported });
    }

    // ── importLog ────────────────────────────────────────────────
    // body: { action, secret, rows: [ { Date, Type, Exercise, Day, ... }, ... ] }
    if (data.action === 'importLog') {
      const sheet = _getOrCreateSheet(ss, SHEET_LOG, LOG_HEADERS,
        r => r.setBackground('#0f1923').setFontColor('#4ec9f7'));

      const rows   = data.rows || [];
      let imported = 0;

      rows.forEach(entry => {
        const entryId = entry.entryId || entry.__PowerAppsId__ || entry.EntryID || _uid();
        sheet.appendRow([
          entryId,
          entry.Date        || entry.date        || '',
          entry.Type        || entry.type        || '',
          entry.Exercise    || entry.exercise    || '',
          String(entry.Day !== undefined ? entry.Day : entry.day !== undefined ? entry.day : ''),
          entry.LastWeight  !== undefined ? entry.LastWeight  : entry.lastWeight  !== undefined ? entry.lastWeight  : 0,
          entry.TodayWeight !== undefined ? entry.TodayWeight : entry.todayWeight !== undefined ? entry.todayWeight : 0,
          entry.LastReps    !== undefined ? entry.LastReps    : entry.lastReps    !== undefined ? entry.lastReps    : 0,
          entry.TodayReps   !== undefined ? entry.TodayReps   : entry.todayReps   !== undefined ? entry.todayReps   : 0,
          entry.DateOnly    || entry.dateOnly    || '',
          entry.TimeOnly    || entry.timeOnly    || '',
          entry.Set         !== undefined ? entry.Set : entry.set !== undefined ? entry.set : ''
        ]);
        imported++;
      });
      return _ok({ imported });
    }

    return _err('Ukendt action: ' + (data.action || ''));

  } catch (err) {
    return _err(err.toString());
  }
}

// ════════════════════════════════════════════════════════════════
//  Intern hjælpefunktion: tilføj log-post
// ════════════════════════════════════════════════════════════════
function _appendLogEntry(ss, entry) {
  const sheet = _getOrCreateSheet(ss, SHEET_LOG, LOG_HEADERS,
    r => r.setBackground('#0f1923').setFontColor('#4ec9f7'));

  const tz       = Session.getScriptTimeZone();
  const now      = new Date();
  const entryId  = entry.entryId || _uid();

  let rawDate = entry.date || entry.Date;
  let dateObj = rawDate ? _parseDate(rawDate) : now;

  const formattedDate  = Utilities.formatDate(dateObj, tz, 'dd-MM-yyyy HH:mm');
  const dateOnly       = entry.dateOnly  || entry.DateOnly  || Utilities.formatDate(dateObj, tz, 'yyyy-MM-dd');
  const timeOnly       = entry.timeOnly  || entry.TimeOnly  || Utilities.formatDate(now,     tz, 'HH:mm');

  sheet.appendRow([
    entryId,
    formattedDate,
    entry.type        || entry.Type        || '',
    entry.exercise    || entry.Exercise    || '',
    String(entry.day  !== undefined ? entry.day  : entry.Day  !== undefined ? entry.Day  : ''),
    entry.lastWeight  !== undefined ? entry.lastWeight  : entry.LastWeight  !== undefined ? entry.LastWeight  : 0,
    entry.todayWeight !== undefined ? entry.todayWeight : entry.TodayWeight !== undefined ? entry.TodayWeight : 0,
    entry.lastReps    !== undefined ? entry.lastReps    : entry.LastReps    !== undefined ? entry.LastReps    : 0,
    entry.todayReps   !== undefined ? entry.todayReps   : entry.TodayReps   !== undefined ? entry.TodayReps   : 0,
    dateOnly,
    timeOnly,
    entry.set         !== undefined ? entry.set         : entry.Set         !== undefined ? entry.Set         : ''
  ]);

  return entryId;
}

// ════════════════════════════════════════════════════════════════
//  Hjælpefunktioner til manuel kørsel fra Apps Script editor
// ════════════════════════════════════════════════════════════════

/**
 * Kør denne funktion manuelt i Apps Script editoren
 * for at initialisere begge sheets med korrekte headers.
 */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  _getOrCreateSheet(ss, SHEET_EXERCISES, EXERCISE_HEADERS,
    r => r.setBackground('#1a2a38').setFontColor('#4ec9f7'));
  _getOrCreateSheet(ss, SHEET_LOG, LOG_HEADERS,
    r => r.setBackground('#0f1923').setFontColor('#4ec9f7'));
  SpreadsheetApp.getUi().alert('Sheets opsat ✅');
}

/**
 * Testfunktion — kald fra editoren for at tjekke at scriptet virker.
 * Returnerer antal øvelser og log-poster i loggen.
 */
function testApi() {
  const ss          = SpreadsheetApp.getActiveSpreadsheet();
  const exSheet     = ss.getSheetByName(SHEET_EXERCISES);
  const logSheet    = ss.getSheetByName(SHEET_LOG);
  const exCount     = exSheet  ? Math.max(0, exSheet.getLastRow()  - 1) : 0;
  const logCount    = logSheet ? Math.max(0, logSheet.getLastRow() - 1) : 0;
  Logger.log('Exercises: ' + exCount + '  |  Log: ' + logCount);
  SpreadsheetApp.getUi().alert('Exercises: ' + exCount + '\nLog: ' + logCount);
}
