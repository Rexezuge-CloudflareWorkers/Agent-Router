import { describe, expect, it } from 'vitest';
import { findPeakSchedule, isPeakNow, millisUntilOffPeak, nextOffPeakAt } from '@agent-router/shared';

// Asia/Shanghai is UTC+8 with no DST; 2026-01-05 is a Monday.
const schedule = findPeakSchedule('deepseek/deepseek-v4-pro');

function at(iso: string): Date {
  return new Date(iso);
}

describe('peak schedule', () => {
  it('resolves schedules by model prefix', () => {
    expect(schedule).not.toBeNull();
    expect(findPeakSchedule('DEEPSEEK/deepseek-v4-flash')).toBe(schedule);
    expect(findPeakSchedule('gpt-5.5')).toBeNull();
    expect(findPeakSchedule('moonshotai/Kimi-K2.5')).toBeNull();
    expect(findPeakSchedule(null)).toBeNull();
    expect(findPeakSchedule(undefined)).toBeNull();
    expect(findPeakSchedule('')).toBeNull();
  });

  it('treats weekday windows as peak, with half-open boundaries', () => {
    if (!schedule) throw new Error('missing schedule');
    // Mon 09:00 CST
    expect(isPeakNow(schedule, at('2026-01-05T01:00:00Z'))).toBe(true);
    // Mon 08:59 CST
    expect(isPeakNow(schedule, at('2026-01-05T00:59:00Z'))).toBe(false);
    // Mon 12:00 CST — window end is exclusive
    expect(isPeakNow(schedule, at('2026-01-05T04:00:00Z'))).toBe(false);
    // Mon 13:59 CST — lunch gap
    expect(isPeakNow(schedule, at('2026-01-05T05:59:00Z'))).toBe(false);
    // Mon 14:00 CST
    expect(isPeakNow(schedule, at('2026-01-05T06:00:00Z'))).toBe(true);
    // Fri 17:59 CST
    expect(isPeakNow(schedule, at('2026-01-09T09:59:00Z'))).toBe(true);
    // Fri 18:00 CST
    expect(isPeakNow(schedule, at('2026-01-09T10:00:00Z'))).toBe(false);
  });

  it('is off-peak on weekends', () => {
    if (!schedule) throw new Error('missing schedule');
    // Sat 10:00 CST
    expect(isPeakNow(schedule, at('2026-01-10T02:00:00Z'))).toBe(false);
    // Sun 10:00 CST
    expect(isPeakNow(schedule, at('2026-01-11T02:00:00Z'))).toBe(false);
  });

  it('computes the time until the next off-peak boundary', () => {
    if (!schedule) throw new Error('missing schedule');
    // Mon 09:00 CST -> 3 hours until noon
    expect(millisUntilOffPeak(schedule, at('2026-01-05T01:00:00Z'))).toBe(3 * 60 * 60 * 1000);
    // Mon 11:59 CST -> 1 minute
    expect(millisUntilOffPeak(schedule, at('2026-01-05T03:59:00Z'))).toBe(60 * 1000);
    // Already off-peak -> 0
    expect(millisUntilOffPeak(schedule, at('2026-01-05T04:00:00Z'))).toBe(0);
    // Fri 17:59 CST -> 1 minute to the weekend
    expect(millisUntilOffPeak(schedule, at('2026-01-09T09:59:00Z'))).toBe(60 * 1000);
  });

  it('returns the boundary as a Date', () => {
    if (!schedule) throw new Error('missing schedule');
    const boundary = nextOffPeakAt(schedule, at('2026-01-05T01:00:00Z'));
    expect(boundary.toISOString()).toBe('2026-01-05T04:00:00.000Z');
  });
});
