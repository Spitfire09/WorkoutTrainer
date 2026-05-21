import { describe, test, expect } from '@jest/globals';
import {
  isoDate, isoTime, sortDayValues, esc, uid,
  deriveDateOnly, normalizeTimeOnly, logEntrySortValue, linReg,
  createLogEntry
} from '../assets/state.js';
import { DEFAULTS } from '../assets/schema.js';

describe('isoDate', () => {
  test('returns YYYY-MM-DD format', () => {
    const result = isoDate(new Date('2024-03-15T10:30:00Z'));
    expect(result).toBe('2024-03-15');
  });
});

describe('isoTime', () => {
  test('returns HH:MM format', () => {
    const result = isoTime(new Date('2024-03-15T10:30:00'));
    expect(result).toBe('10:30');
  });
});

describe('sortDayValues', () => {
  test('sorts numeric days numerically', () => {
    expect(sortDayValues(['3', '1', '2'])).toEqual(['1', '2', '3']);
  });

  test('numbers come before strings', () => {
    expect(sortDayValues(['H', '2', '1'])).toEqual(['1', '2', 'H']);
  });

  test('strings are sorted alphabetically', () => {
    expect(sortDayValues(['H', 'A', 'B'])).toEqual(['A', 'B', 'H']);
  });
});

describe('esc', () => {
  test('escapes HTML special characters', () => {
    expect(esc('<script>"&')).toBe('&lt;script&gt;&quot;&amp;');
  });

  test('handles null/undefined', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
});

describe('uid', () => {
  test('generates unique ids', () => {
    const id1 = uid();
    const id2 = uid();
    expect(id1).not.toBe(id2);
    expect(typeof id1).toBe('string');
    expect(id1.length).toBeGreaterThan(0);
  });
});

describe('deriveDateOnly', () => {
  test('extracts date from ISO format', () => {
    expect(deriveDateOnly('2024-03-15 10:30')).toBe('2024-03-15');
  });

  test('extracts date from ISO date only', () => {
    expect(deriveDateOnly('2024-03-15')).toBe('2024-03-15');
  });

  test('converts EU format DD-MM-YYYY', () => {
    expect(deriveDateOnly('15-03-2024')).toBe('2024-03-15');
  });

  test('returns empty string for empty input', () => {
    expect(deriveDateOnly('')).toBe('');
    expect(deriveDateOnly(null)).toBe('');
  });
});

describe('normalizeTimeOnly', () => {
  test('normalizes HH:MM format', () => {
    expect(normalizeTimeOnly('9:05')).toBe('09:05');
  });

  test('handles dot separator', () => {
    expect(normalizeTimeOnly('14.30')).toBe('14:30');
  });

  test('returns empty for invalid input', () => {
    expect(normalizeTimeOnly('')).toBe('');
    expect(normalizeTimeOnly('abc')).toBe('');
  });
});

describe('logEntrySortValue', () => {
  test('returns timestamp for ISO date+time', () => {
    const val = logEntrySortValue({ date: '2024-03-15 10:30' });
    expect(val).toBeGreaterThan(0);
  });

  test('handles EU format', () => {
    const val = logEntrySortValue({ date: '15-03-2024 10:30' });
    expect(val).toBeGreaterThan(0);
  });

  test('returns 0 for empty date', () => {
    expect(logEntrySortValue({ date: '' })).toBe(0);
  });
});

describe('linReg', () => {
  test('returns null for less than 2 values', () => {
    expect(linReg([5])).toBeNull();
    expect(linReg([])).toBeNull();
  });

  test('computes slope and intercept for linear data', () => {
    const result = linReg([10, 20, 30, 40]);
    expect(result.slope).toBeCloseTo(10, 5);
    expect(result.intercept).toBeCloseTo(10, 5);
  });

  test('slope is 0 for constant values', () => {
    const result = linReg([5, 5, 5]);
    expect(result.slope).toBeCloseTo(0, 5);
    expect(result.intercept).toBeCloseTo(5, 5);
  });
});

describe('createLogEntry', () => {
  test('creates a log entry with correct fields', () => {
    const ex = {
      type: 'Push',
      exercise: 'Bench Press',
      day: '1',
      lastWeight: 80,
      lastReps: 8,
      set: 3,
      muscleGroup: 'Chest'
    };
    const entry = createLogEntry(ex, {
      todayWeight: 85,
      todayReps: 6,
      date: '2024-03-15 10:30'
    });
    expect(entry.exercise).toBe('Bench Press');
    expect(entry.todayWeight).toBe(85);
    expect(entry.todayReps).toBe(6);
    expect(entry.type).toBe('Push');
    expect(entry.day).toBe('1');
    expect(entry.muscleGroup).toBe('Chest');
    expect(entry.date).toBe('2024-03-15 10:30');
    expect(entry.entryId).toBeDefined();
  });
});
