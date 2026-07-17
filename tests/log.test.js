import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { setExercises, setLogEntries, exercises } from '../assets/state.js';
import { checkPR, getProgressionHint, isStagnant, getPerformanceScore, getBestPerformance, mergeExercises } from '../assets/log.js';

describe('log performance logic', () => {
  beforeEach(() => {
    setExercises([]);
    setLogEntries([]);
  });

  afterEach(() => {
    setExercises([]);
    setLogEntries([]);
    jest.restoreAllMocks();
  });

  test('checkPR counts higher reps at the same weight as a PR', () => {
    setLogEntries([
      { exercise: 'Bench Press', todayWeight: 100, todayReps: 5, date: '2024-01-01 10:00' }
    ]);

    expect(checkPR('Bench Press', 100, 6)).toBe(true);
    expect(checkPR('Bench Press', 100, 5)).toBe(false);
  });

  test('getProgressionHint uses weight and reps together', () => {
    setLogEntries([
      { exercise: 'Bench Press', todayWeight: 95, todayReps: 12, date: '2024-01-01 10:00' },
      { exercise: 'Bench Press', todayWeight: 95, todayReps: 12, date: '2024-01-02 10:00' },
      { exercise: 'Bench Press', todayWeight: 95, todayReps: 12, date: '2024-01-03 10:00' }
    ]);

    const hint = getProgressionHint({
      exercise: 'Bench Press',
      lastWeight: 100,
      lastReps: 8
    });

    expect(hint).toBe(102.5);
  });

  test('isStagnant follows the latest PR performance, not just heaviest weight', () => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2024-02-20T00:00:00').getTime());
    setLogEntries([
      { exercise: 'Deadlift', todayWeight: 120, todayReps: 3, date: '2024-01-01 10:00' },
      { exercise: 'Deadlift', todayWeight: 115, todayReps: 8, date: '2024-02-10 10:00' }
    ]);

    expect(isStagnant('Deadlift')).toBe(false);
  });

  test('getPerformanceScore returns reps score for 0 kg bodyweight exercises', () => {
    expect(getPerformanceScore(0, 10)).toBe(10);
    expect(getPerformanceScore(0, 0)).toBe(0);
    expect(getPerformanceScore(0, 15)).toBe(15);
  });

  test('checkPR detects PR for 0 kg bodyweight exercises based on reps', () => {
    setLogEntries([
      { exercise: 'Pull-up', todayWeight: 0, todayReps: 8, date: '2024-01-01 10:00' }
    ]);

    expect(checkPR('Pull-up', 0, 9)).toBe(true);
    expect(checkPR('Pull-up', 0, 8)).toBe(false);
    expect(checkPR('Pull-up', 0, 7)).toBe(false);
  });

  test('getBestPerformance finds best for 0 kg exercises', () => {
    setLogEntries([
      { exercise: 'Pull-up', todayWeight: 0, todayReps: 8, date: '2024-01-01 10:00' },
      { exercise: 'Pull-up', todayWeight: 0, todayReps: 12, date: '2024-01-02 10:00' },
      { exercise: 'Pull-up', todayWeight: 0, todayReps: 10, date: '2024-01-03 10:00' }
    ]);

    const best = getBestPerformance('Pull-up');
    expect(best).not.toBeNull();
    expect(best.todayReps).toBe(12);
  });

  test('checkPR returns true on first ever log for 0 kg exercise', () => {
    expect(checkPR('Pull-up', 0, 5)).toBe(true);
  });

  test('mergeExercises backfills missing ExRx URL on duplicates', () => {
    setExercises([
      { entryId: 'ex-1', exercise: 'Bench Press', exRxUrl: '' }
    ]);

    const result = mergeExercises([
      { entryId: 'ex-1', Exercise: 'Bench Press', ExRxUrl: 'https://exrx.net/WeightExercises/PectoralSternal/BBBenchPress' }
    ]);

    expect(result).toEqual({ added: 0, updatedUrl: 1 });
  });

  test('mergeExercises marks updated exercises as exRxUrlDirty for sync', () => {
    setExercises([
      { entryId: 'ex-2', exercise: 'Squat', exRxUrl: '' }
    ]);

    mergeExercises([
      { entryId: 'ex-2', Exercise: 'Squat', ExRxUrl: 'https://exrx.net/WeightExercises/Quadriceps/BBSquat' }
    ]);

    const updated = exercises.find(e => e.entryId === 'ex-2');
    expect(updated.exRxUrlDirty).toBe(true);
  });
});
