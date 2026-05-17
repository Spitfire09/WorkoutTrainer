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
  'Set', 'Completed', 'LastCompletedDate', 'Description', 'RPE', 'MuscleGroup'
];

const LOG_HEADERS = [
  'EntryID', 'Date', 'Type', 'Exercise', 'Day',
  'LastWeight', 'TodayWeight', 'LastReps', 'TodayReps',
  'DateOnly', 'TimeOnly', 'Set', 'SetNumber', 'MuscleGroup'
];


const ACTIONS = {
  LIST_EXERCISES: 'listExercises',
  LIST_LOG: 'listLog',
  UPDATE_EXERCISE: 'updateExercise',
  NEW_EXERCISE: 'newExercise',
  DELETE_EXERCISE: 'deleteExercise',
  NEW_DAY: 'newDay',
  MARK_COMPLETED: 'markCompleted',
  LOG_WORKOUT: 'logWorkout',
  DELETE_LOG: 'deleteLog',
  IMPORT_EXERCISES: 'importExercises',
  IMPORT_LOG: 'importLog'
};

const EXERCISE_COLS = {
  COMPLETED: 'Completed',
  LAST_WEIGHT: 'LastWeight',
  TODAY_WEIGHT: 'TodayWeight',
  LAST_REPS: 'LastReps',
  TODAY_REPS: 'TodayReps',
  LAST_COMPLETED_DATE: 'LastCompletedDate'
};

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
  } else {
    // Tilføj manglende kolonner til eksisterende sheets
    _ensureSheetColumns(sheet, headers);
  }
  return sheet;
}

/** Sikr at alle påkrævede kolonner findes i det eksisterende sheet.
 *  Manglende kolonner tilføjes i slutningen. */
function _ensureSheetColumns(sheet, headers) {
  const lastCol = sheet.getLastColumn();
  const existing = lastCol >= 1
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim())
    : [];
  const existingSet = new Set(existing.filter(Boolean));
  headers.forEach(h => {
    if (!existingSet.has(h)) {
      const newCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, newCol).setValue(h).setFontWeight('bold');
      existingSet.add(h);
    }
  });
}

/** Returnér alle rækker som array af objekter, baseret på faktiske kolonneoverskrifter */
function _sheetToObjects(sheet, headers) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // Læs de faktiske kolonneoverskrifter fra række 1 for robust kolonnekortlægning
  const lastCol = Math.max(sheet.getLastColumn(), headers.length);
  const actualHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(h => String(h).trim());

  // Byg map: kolonnenavn → 0-baseret indeks
  const colIndex = {};
  actualHeaders.forEach((h, i) => { if (h) colIndex[h] = i; });

  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return data
    .filter(row => row.some(v => v !== '' && v !== null))
    .map(row => {
      const obj = {};
      headers.forEach(h => {
        obj[h] = colIndex[h] !== undefined ? row[colIndex[h]] : '';
      });
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

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // ── list exercises ───────────────────────────────────────────
    if (action === ACTIONS.LIST_EXERCISES) {
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
        muscleGroup:       String(r.MuscleGroup || ''),
        synced:            true
      }));
      return _ok({ exercises });
    }

    // ── list log ─────────────────────────────────────────────────
    if (action === ACTIONS.LIST_LOG) {
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
        set:         r.Set       !== '' ? Number(r.Set)       : null,
        setNumber:   r.SetNumber !== '' ? Number(r.SetNumber) : null,
        muscleGroup: String(r.MuscleGroup || ''),
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
    if (data.action === ACTIONS.UPDATE_EXERCISE) {
      const sheet = _getOrCreateSheet(ss, SHEET_EXERCISES, EXERCISE_HEADERS,
        r => r.setBackground('#1a2a38').setFontColor('#4ec9f7'));

      const entryId = String(data.entryId || '');
      const fields  = data.fields || {};
      if (!entryId) throw new Error('entryId mangler');

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return _err('Ingen øvelser fundet');

      // Dynamisk kolonnekortlægning baseret på faktiske overskrifter
      const lastCol = Math.max(sheet.getLastColumn(), 1);
      const actualHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
        .map(h => String(h).trim());
      const colMap = {}; // kolonnenavn → 1-baseret kolonnenummer
      actualHeaders.forEach((h, i) => { if (h) colMap[h] = i + 1; });

      const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === entryId) {
          const rowNum = i + 2;
          Object.keys(fields).forEach(h => {
            if (colMap[h]) {
              sheet.getRange(rowNum, colMap[h]).setValue(fields[h]);
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
    if (data.action === ACTIONS.NEW_EXERCISE) {
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
        ex.rpe              !== undefined ? ex.rpe         : '',
        ex.muscleGroup      || ex.MuscleGroup || ''
      ];
      sheet.appendRow(row);
      return _ok({ entryId });
    }

    // ── deleteExercise ───────────────────────────────────────────
    if (data.action === ACTIONS.DELETE_EXERCISE) {
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
    if (data.action === ACTIONS.NEW_DAY) {
      const sheet = ss.getSheetByName(SHEET_EXERCISES);
      if (!sheet || sheet.getLastRow() < 2) return _ok({ reset: 0 });

      const lastRow = sheet.getLastRow();

      // Dynamisk kolonnekortlægning baseret på faktiske overskrifter
      const lastCol = Math.max(sheet.getLastColumn(), 1);
      const actualHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
        .map(h => String(h).trim());
      const colMap = {}; // kolonnenavn → 0-baseret indeks
      actualHeaders.forEach((h, i) => { if (h) colMap[h] = i; });

      const colCompleted   = colMap[EXERCISE_COLS.COMPLETED];
      const colLastWeight  = colMap[EXERCISE_COLS.LAST_WEIGHT];
      const colTodayWeight = colMap[EXERCISE_COLS.TODAY_WEIGHT];
      const colLastReps    = colMap[EXERCISE_COLS.LAST_REPS];
      const colTodayReps   = colMap[EXERCISE_COLS.TODAY_REPS];

      if (colCompleted === undefined) return _ok({ reset: 0 });

      const allData = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

      let resetCount = 0;
      allData.forEach((row, i) => {
        if (String(row[colCompleted]) === 'yes') {
          const rowNum = i + 2;
          if (colLastWeight  !== undefined && colTodayWeight !== undefined) sheet.getRange(rowNum, colLastWeight  + 1).setValue(row[colTodayWeight]);
          if (colLastReps    !== undefined && colTodayReps   !== undefined) sheet.getRange(rowNum, colLastReps    + 1).setValue(row[colTodayReps]);
          sheet.getRange(rowNum, colCompleted + 1).setValue('no');
          resetCount++;
        }
      });
      return _ok({ reset: resetCount });
    }

    // ── markCompleted ────────────────────────────────────────────
    // Marker én øvelse som afsluttet og gem dagens vægt/reps i Log
    // body: { action, secret, entryId, todayWeight, todayReps, logEntry: { ... } }
    if (data.action === ACTIONS.MARK_COMPLETED) {
      const sheet   = _getOrCreateSheet(ss, SHEET_EXERCISES, EXERCISE_HEADERS,
        r => r.setBackground('#1a2a38').setFontColor('#4ec9f7'));
      const entryId = String(data.entryId || '');
      if (!entryId) throw new Error('entryId mangler');

      const lastRow = sheet.getLastRow();
      const ids     = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      const today   = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

      // Dynamisk kolonnekortlægning baseret på faktiske overskrifter
      const lastCol = Math.max(sheet.getLastColumn(), 1);
      const actualHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
        .map(h => String(h).trim());
      const colMap = {}; // kolonnenavn → 1-baseret kolonnenummer
      actualHeaders.forEach((h, i) => { if (h) colMap[h] = i + 1; });

      for (let i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === entryId) {
          const rowNum = i + 2;
          if (data.todayWeight !== undefined && colMap[EXERCISE_COLS.TODAY_WEIGHT]) {
            sheet.getRange(rowNum, colMap[EXERCISE_COLS.TODAY_WEIGHT]).setValue(data.todayWeight);
          }
          if (data.todayReps !== undefined && colMap[EXERCISE_COLS.TODAY_REPS]) {
            sheet.getRange(rowNum, colMap[EXERCISE_COLS.TODAY_REPS]).setValue(data.todayReps);
          }
          if (colMap[EXERCISE_COLS.COMPLETED])        sheet.getRange(rowNum, colMap[EXERCISE_COLS.COMPLETED]).setValue('yes');
          if (colMap[EXERCISE_COLS.LAST_COMPLETED_DATE]) sheet.getRange(rowNum, colMap[EXERCISE_COLS.LAST_COMPLETED_DATE]).setValue(today);
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
    if (data.action === ACTIONS.LOG_WORKOUT) {
      const entryId = _appendLogEntry(ss, data.entry || data);
      return _ok({ entryId });
    }

    // ── deleteLog ────────────────────────────────────────────────
    if (data.action === ACTIONS.DELETE_LOG) {
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
    if (data.action === ACTIONS.IMPORT_EXERCISES) {
      const sheet = _getOrCreateSheet(ss, SHEET_EXERCISES, EXERCISE_HEADERS,
        r => r.setBackground('#1a2a38').setFontColor('#4ec9f7'));

      const rows   = data.rows || [];
      const today  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      let imported = 0;
      let skipped  = 0;

      // Build a set of existing entryIds to avoid duplicates
      const existingIds = new Set();
      const lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(r => {
          if (r[0]) existingIds.add(String(r[0]));
        });
      }

      rows.forEach(ex => {
        const entryId = ex.entryId || ex.__PowerAppsId__ || ex.EntryID || _uid();
        if (existingIds.has(String(entryId))) { skipped++; return; }
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
          ex.RPE              !== undefined ? ex.RPE : ex.rpe !== undefined ? ex.rpe : '',
          ex.MuscleGroup      || ex.muscleGroup || ''
        ]);
        existingIds.add(String(entryId));
        imported++;
      });
      return _ok({ imported, skipped });
    }

    // ── importLog ────────────────────────────────────────────────
    // body: { action, secret, rows: [ { Date, Type, Exercise, Day, ... }, ... ] }
    if (data.action === ACTIONS.IMPORT_LOG) {
      const sheet = _getOrCreateSheet(ss, SHEET_LOG, LOG_HEADERS,
        r => r.setBackground('#0f1923').setFontColor('#4ec9f7'));

      const rows   = data.rows || [];
      let imported = 0;
      let skipped  = 0;

      // Build a set of existing entryIds to avoid duplicates
      const existingIds = new Set();
      const lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(r => {
          if (r[0]) existingIds.add(String(r[0]));
        });
      }

      rows.forEach(entry => {
        const entryId = entry.entryId || entry.__PowerAppsId__ || entry.EntryID || _uid();
        if (existingIds.has(String(entryId))) { skipped++; return; }
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
          entry.Set         !== undefined ? entry.Set         : entry.set         !== undefined ? entry.set         : '',
          entry.SetNumber   !== undefined ? entry.SetNumber   : entry.setNumber   !== undefined ? entry.setNumber   : '',
          entry.MuscleGroup || entry.muscleGroup || ''
        ]);
        existingIds.add(String(entryId));
        imported++;
      });
      return _ok({ imported, skipped });
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
    entry.set         !== undefined ? entry.set         : entry.Set         !== undefined ? entry.Set         : '',
    entry.setNumber   !== undefined ? entry.setNumber   : entry.SetNumber   !== undefined ? entry.SetNumber   : '',
    entry.muscleGroup || entry.MuscleGroup || ''
  ]);

  return entryId;
}

// ════════════════════════════════════════════════════════════════
//  Hjælpefunktioner til manuel kørsel fra Apps Script editor
// ════════════════════════════════════════════════════════════════

/**
 * Tilføjer manglende kolonneoverskrifter til et eksisterende sheet.
 * Bruges til at migrere eksisterende sheets ved tilføjelse af nye kolonner.
 */
function _ensureColumns(sheet, headers) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < headers.length) {
    for (let i = lastCol; i < headers.length; i++) {
      sheet.getRange(1, i + 1).setValue(headers[i])
        .setFontWeight('bold');
    }
  }
}

/**
 * Kør denne funktion manuelt i Apps Script editoren
 * for at initialisere begge sheets med korrekte headers.
 */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const exSheet  = _getOrCreateSheet(ss, SHEET_EXERCISES, EXERCISE_HEADERS,
    r => r.setBackground('#1a2a38').setFontColor('#4ec9f7'));
  const logSheet = _getOrCreateSheet(ss, SHEET_LOG, LOG_HEADERS,
    r => r.setBackground('#0f1923').setFontColor('#4ec9f7'));
  _ensureColumns(exSheet,  EXERCISE_HEADERS);
  _ensureColumns(logSheet, LOG_HEADERS);
  SpreadsheetApp.getUi().alert('Sheets opsat/opdateret ✅');
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
