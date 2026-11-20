/**
Peak / off-peak windows for upstream models.

Some upstreams price or congest their models on a weekly schedule. DeepSeek is
the first: Monday to Friday, Asia/Shanghai (UTC+8), 09:00-12:00 and
14:00-18:00. Users choose what the gateway should do when they call such a
model while it is in its peak window.
*/

export type PeakPreferenceMode = 'continue' | 'fallback' | 'reject';

export const PEAK_PREFERENCE_MODES: readonly PeakPreferenceMode[] = ['continue', 'fallback', 'reject'];

function isPeakPreferenceMode(value: unknown): value is PeakPreferenceMode {
  return typeof value === 'string' && (PEAK_PREFERENCE_MODES as readonly string[]).includes(value);
}

/**
Half-open window, in minutes after local midnight.
*/
export interface PeakWindow {
  startMinute: number;
  endMinute: number;
}

export interface PeakSchedule {
  /**
  Lowercase model-name prefixes this schedule applies to.
  */
  modelPrefixes: readonly string[];
  /**
  IANA zone the schedule is expressed in.
  */
  timeZone: string;
  /**
  Days the schedule runs on; 0 = Sunday, matching `Date#getUTCDay`.
  */
  weekdays: readonly number[];
  windows: readonly PeakWindow[];
}

export const PEAK_SCHEDULES: readonly PeakSchedule[] = [
  {
    modelPrefixes: ['deepseek/'],
    timeZone: 'Asia/Shanghai',
    weekdays: [1, 2, 3, 4, 5],
    windows: [
      { startMinute: 9 * 60, endMinute: 12 * 60 },
      { startMinute: 14 * 60, endMinute: 18 * 60 },
    ],
  },
];

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const MINUTE_MS = 60_000;
const MAX_SCAN_MINUTES = 8 * 24 * 60;

interface ZonedClock {
  weekday: number;
  minuteOfDay: number;
}

/**
Reads the weekday and minute-of-day of `at` in `timeZone`.

`hourCycle: 'h23'` is explicit: without it some runtimes render midnight as
`24`, which would fold into the wrong day boundary.
*/
function zonedClock(at: Date, timeZone: string): ZonedClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  let weekday = 0;
  let hour = 0;
  let minute = 0;
  for (const part of parts) {
    switch (part.type) {
      case 'weekday': {
        weekday = WEEKDAY_INDEX[part.value] ?? 0;
        break;
      }
      case 'hour': {
        hour = Number(part.value);
        break;
      }
      case 'minute': {
        minute = Number(part.value);
        break;
      }
      default:
    }
  }
  return { weekday, minuteOfDay: hour * 60 + minute };
}

function isPeakAt(schedule: PeakSchedule, at: Date): boolean {
  const { weekday, minuteOfDay } = zonedClock(at, schedule.timeZone);
  if (!schedule.weekdays.includes(weekday)) return false;
  return schedule.windows.some((window) => minuteOfDay >= window.startMinute && minuteOfDay < window.endMinute);
}

/**
The schedule that governs `model`, or null when the model has no peak windows.
*/
function findPeakSchedule(model: string | null | undefined): PeakSchedule | null {
  if (typeof model !== 'string' || model.length === 0) return null;
  const lower = model.toLowerCase();
  return PEAK_SCHEDULES.find((schedule) => schedule.modelPrefixes.some((prefix) => prefix.length > 0 && lower.startsWith(prefix))) ?? null;
}

/**
True when `at` falls inside the schedule's peak windows.
*/
function isPeakNow(schedule: PeakSchedule, at: Date): boolean {
  return isPeakAt(schedule, at);
}

/**
Milliseconds from `at` until the schedule next leaves its peak windows.

Returns 0 when `at` is already off-peak. The scan steps a minute at a time,
which is exact enough for a `Retry-After` header and only runs on the reject
path.
*/
function millisUntilOffPeak(schedule: PeakSchedule, at: Date): number {
  if (!isPeakAt(schedule, at)) return 0;
  for (let minutes = 1; minutes <= MAX_SCAN_MINUTES; minutes += 1) {
    const candidate = new Date(at.getTime() + minutes * MINUTE_MS);
    if (!isPeakAt(schedule, candidate)) return minutes * MINUTE_MS;
  }
  return MAX_SCAN_MINUTES * MINUTE_MS;
}

/**
The first instant at or after `at` that is outside the peak windows.
*/
function nextOffPeakAt(schedule: PeakSchedule, at: Date): Date {
  return new Date(at.getTime() + millisUntilOffPeak(schedule, at));
}

export { findPeakSchedule, isPeakNow, isPeakPreferenceMode, millisUntilOffPeak, nextOffPeakAt };
