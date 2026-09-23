import { describe, test, expect } from '@jest/globals';
import { mapExerciseToOpenGym, buildOpenGymCsv } from '../assets/opengym-export.js';

describe('OpenGym export mapping', () => {
  test('maps known exercise aliases to OpenGym id', () => {
    expect(mapExerciseToOpenGym('Bench Press')).toEqual({
      id: '0025',
      name: 'barbell bench press'
    });
  });

  test('returns null for unknown exercises', () => {
    expect(mapExerciseToOpenGym('My Unique Movement')).toBeNull();
  });
});

describe('buildOpenGymCsv', () => {
  test('exports FitNotes-style CSV with OpenGym ids', () => {
    const { csv, summary } = buildOpenGymCsv([
      {
        date: '2026-09-20 10:15',
        exercise: 'Bench Press',
        todayWeight: 80,
        todayReps: 8,
        set: 2,
        type: 'Push'
      }
    ], []);

    const lines = csv.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"barbell bench press"');
    expect(lines[1]).toContain('"0025"');
    expect(lines[1]).toContain('"Sæt 1/2"');
    expect(lines[2]).toContain('"Sæt 2/2"');
    expect(summary.exportedRows).toBe(2);
    expect(summary.mappedRows).toBe(2);
    expect(summary.unmappedNames).toEqual([]);
  });

  test('tracks unmapped exercises and derives category from muscle group', () => {
    const { csv, summary } = buildOpenGymCsv([
      {
        date: '2026-09-20 10:15',
        exercise: 'My Custom Lift',
        todayWeight: 45,
        todayReps: 10
      }
    ], [
      { exercise: 'My Custom Lift', muscleGroup: 'Shoulders' }
    ]);

    const lines = csv.split('\n');
    expect(lines[1]).toContain('"My Custom Lift"');
    expect(lines[1]).toContain('"shoulders"');
    expect(lines[1]).toContain('""');
    expect(summary.mappedRows).toBe(0);
    expect(summary.unmappedNames).toEqual(['My Custom Lift']);
  });
});
