import {describe, expect, it} from 'vitest';
import {addDays, daysBetween, parseTanaDate, todayIn} from '../src/dates';

const TODAY = '2026-10-29';

describe('parseTanaDate', () => {
  it.each([
    ['Tomorrow', '2026-10-30'],
    ['Today', '2026-10-29'],
    ['Yesterday', '2026-10-28'],
    ['Tue, 27 Oct', '2026-10-27'],
    ['Today, Thu, 29 Oct', '2026-10-29'],
    ['Yesterday, Wed, 28 Oct', '2026-10-28'],
    ['Sun, 3 Aug 2025', '2025-08-03'],
    ['Mon, 12 Aug 2024 ', '2024-08-12'],
    ['Thu, 5 Nov 14:30', '2026-11-05'],
    ['Fri, 30 Oct - Sun, 1 Nov', '2026-10-30'],
    ['2026-02-05/2026-02-07', '2026-02-05'],
    ['Nov 4, 2027', '2027-11-04'],
    ['Tomorrow <!-- node-id: abc123 -->', '2026-10-30'],
  ])('%s → %s', (input, expected) => {
    expect(parseTanaDate(input, TODAY)).toBe(expected);
  });

  it.each([[''], ['Week 44'], ['soon'], ['31 Feb']])('returns null for %j', input => {
    expect(parseTanaDate(input, TODAY)).toBeNull();
  });
});

describe('date helpers', () => {
  it('computes today in a time zone', () => {
    // 23:30 UTC on 28 Oct is already 29 Oct in Amsterdam (UTC+1 in winter).
    expect(todayIn('Europe/Amsterdam', new Date('2026-10-28T23:30:00Z'))).toBe('2026-10-29');
  });

  it('adds days across month ends and counts days between', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(daysBetween('2026-10-26', '2026-10-29')).toBe(3);
  });
});
