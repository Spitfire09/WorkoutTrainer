'use strict';

const OPEN_GYM_ALIAS_ENTRIES = [
  { id: '0025', name: 'barbell bench press', aliases: ['bench press', 'barbell bench press', 'flat bench press'] },
  { id: '0047', name: 'incline bench press', aliases: ['incline bench press'] },
  { id: '0033', name: 'decline bench press', aliases: ['decline bench press'] },
  { id: '0043', name: 'barbell squat', aliases: ['squat', 'back squat', 'barbell squat'] },
  { id: '0042', name: 'front squat', aliases: ['front squat'] },
  { id: '0032', name: 'barbell deadlift', aliases: ['deadlift', 'barbell deadlift'] },
  { id: '0085', name: 'romanian deadlift', aliases: ['romanian deadlift', 'rdl'] },
  { id: '0091', name: 'barbell overhead press', aliases: ['overhead press', 'military press', 'shoulder press', 'ohp'] },
  { id: '0027', name: 'barbell bent over row', aliases: ['barbell row', 'bent over row'] },
  { id: '2330', name: 'cable lat pulldown', aliases: ['lat pulldown', 'pulldown', 'lat pull down'] },
  { id: '0292', name: 'dumbbell row', aliases: ['dumbbell row', 'one arm dumbbell row'] },
  { id: '0294', name: 'dumbbell biceps curl', aliases: ['bicep curl', 'biceps curl', 'dumbbell curl'] },
  { id: '0241', name: 'triceps pushdown', aliases: ['tricep pushdown', 'triceps pushdown', 'pushdown'] },
  { id: '0585', name: 'leg extension', aliases: ['leg extension'] },
  { id: '0586', name: 'lying leg curl', aliases: ['leg curl', 'lying leg curl', 'seated leg curl'] },
  { id: '0739', name: 'sled leg press', aliases: ['leg press'] },
  { id: '1372', name: 'standing calf raise', aliases: ['calf raise', 'standing calf raise'] },
  { id: '0334', name: 'dumbbell lateral raise', aliases: ['lateral raise', 'side raise'] },
  { id: '3666', name: 'treadmill', aliases: ['treadmill', 'treadmill walk', 'treadmill run'] },
  { id: '2331', name: 'cycling', aliases: ['cycling', 'cross trainer'] },
  { id: '2141', name: 'elliptical machine', aliases: ['elliptical'] },
  { id: '2138', name: 'stationary bike run', aliases: ['stationary bike', 'exercise bike'] }
];

const TYPE_TO_CATEGORY = Object.freeze({
  push: 'chest',
  pull: 'back',
  leg: 'legs',
  upper: 'shoulders',
  lower: 'legs',
  cardio: 'cardio'
});

const MUSCLE_GROUP_TO_CATEGORY = Object.freeze({
  chest: 'chest',
  back: 'back',
  shoulders: 'shoulders',
  delts: 'shoulders',
  biceps: 'arms',
  triceps: 'arms',
  forearms: 'forearms',
  abs: 'core',
  core: 'core',
  obliques: 'core',
  glutes: 'legs',
  hamstrings: 'legs',
  quads: 'legs',
  quadriceps: 'legs',
  calves: 'calves',
  legs: 'legs',
  cardio: 'cardio'
});

const OPEN_GYM_ALIAS_MAP = (() => {
  const map = new Map();
  OPEN_GYM_ALIAS_ENTRIES.forEach(entry => {
    entry.aliases.forEach(alias => {
      map.set(normalizeKey(alias), { id: entry.id, name: entry.name });
    });
  });
  return map;
})();

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[()[\]{}]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function csvCell(value) {
  const raw = value == null ? '' : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function toPositiveNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function formatDateTime(value) {
  const dateText = String(value || '').trim();
  if (!dateText) return '';
  const isoLike = dateText.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?/);
  if (isoLike) {
    return `${isoLike[1]} ${isoLike[2] || '00:00'}`;
  }
  const d = new Date(dateText);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function resolveCategory(entry, exerciseByName) {
  const localExercise = exerciseByName.get(normalizeKey(entry.exercise));
  const fromMuscle = normalizeKey(localExercise?.muscleGroup || entry.muscleGroup);
  if (MUSCLE_GROUP_TO_CATEGORY[fromMuscle]) return MUSCLE_GROUP_TO_CATEGORY[fromMuscle];
  const fromType = normalizeKey(localExercise?.type || entry.type);
  return TYPE_TO_CATEGORY[fromType] || '';
}

export function mapExerciseToOpenGym(entryName) {
  const key = normalizeKey(entryName);
  return OPEN_GYM_ALIAS_MAP.get(key) || null;
}

export function buildOpenGymCsv(logRows, exerciseRows) {
  const header = [
    'Date',
    'Exercise',
    'Category',
    'Weight',
    'Weight Unit',
    'Reps',
    'Distance',
    'Distance Unit',
    'Time',
    'Comment',
    'OpenGym Exercise ID'
  ];
  const lines = [header.map(csvCell).join(',')];
  const exerciseByName = new Map((exerciseRows || []).map(ex => [normalizeKey(ex.exercise), ex]));
  const unmappedNames = new Set();
  let mappedRows = 0;
  let exportedRows = 0;

  (logRows || []).forEach(entry => {
    const date = formatDateTime(entry.date);
    if (!date) return;
    const map = mapExerciseToOpenGym(entry.exercise);
    const weight = toPositiveNumber(entry.todayWeight);
    const reps = Math.round(toPositiveNumber(entry.todayReps));
    if (!weight && !reps) return;
    const category = resolveCategory(entry, exerciseByName);
    const setCount = entry.setNumber ? 1 : Math.max(1, Math.round(toPositiveNumber(entry.set)) || 1);
    if (!map) unmappedNames.add(String(entry.exercise || '').trim());

    for (let i = 0; i < setCount; i++) {
      if (map) mappedRows++;
      exportedRows++;
      const setInfo = entry.setNumber
        ? `Sæt ${entry.setNumber}/${entry.totalSets || entry.set || 1}`
        : (setCount > 1 ? `Sæt ${i + 1}/${setCount}` : '');
      lines.push([
        date,
        map?.name || String(entry.exercise || ''),
        category,
        weight || '',
        weight ? 'kg' : '',
        reps || '',
        '',
        '',
        '',
        setInfo,
        map?.id || ''
      ].map(csvCell).join(','));
    }
  });

  return {
    csv: lines.join('\n'),
    summary: {
      exportedRows,
      mappedRows,
      unmappedNames: [...unmappedNames].filter(Boolean).sort()
    }
  };
}
