'use strict';

export const API_ACTIONS = Object.freeze({
  LIST_EXERCISES: 'listExercises',
  LIST_LOG: 'listLog',
  UPDATE_EXERCISE: 'updateExercise',
  NEW_EXERCISE: 'newExercise',
  DELETE_LOG: 'deleteLog',
  NEW_DAY: 'newDay',
  DELETE_EXERCISE: 'deleteExercise',
  IMPORT_EXERCISES: 'importExercises',
  IMPORT_LOG: 'importLog',
  MARK_COMPLETED: 'markCompleted',
  LOG_WORKOUT: 'logWorkout'
});

export const EXERCISE_DEFAULTS = Object.freeze({
  id: null,
  date: '',
  type: '',
  category: '',
  muscleGroup: '',
  day: '',
  exercise: '',
  lastWeight: 0,
  todayWeight: 0,
  lastReps: 0,
  todayReps: 0,
  set: 3,
  completed: 'no',
  lastCompletedDate: '',
  description: '',
  rpe: null,
  synced: false
});

export const LOG_DEFAULTS = Object.freeze({
  date: '',
  type: '',
  exercise: '',
  day: '',
  lastWeight: 0,
  todayWeight: 0,
  lastReps: 0,
  todayReps: 0,
  set: null,
  setNumber: null,
  totalSets: null,
  muscleGroup: '',
  isPR: false,
  synced: false
});

export const CFG_DEFAULTS = Object.freeze({
  url: '',
  secret: '',
  restDuration: 90,
  timerSound: true
});

export const DEFAULTS = Object.freeze({
  exercise: EXERCISE_DEFAULTS,
  log: LOG_DEFAULTS,
  cfg: CFG_DEFAULTS
});
