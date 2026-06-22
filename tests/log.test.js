import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { setLogEntries } from '../assets/state.js';
import { checkPR, getProgressionHint, isStagnant } from '../assets/log.js';

describe('log performance logic', () => {
  beforeEach(() => {
    setLogEntries([]);
  });

  afterEach(() => {
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
});
