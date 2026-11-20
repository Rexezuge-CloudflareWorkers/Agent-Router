import { UserDAO, UserPeakPreferenceDAO } from '@agent-router/backend-data/dao';
import type { D1Queryable } from '@rexezuge/d1';
import { BadRequestError, NotFoundError } from '@rexezuge/errors';
import { TimestampUtil } from '@rexezuge/shared';
import type { PeakPreferenceMode } from '@agent-router/shared';
import { PEAK_SCHEDULES, isPeakNow, isPeakPreferenceMode } from '@agent-router/shared';

interface UserPeakPreferenceServiceEnv {
  DB: D1Queryable;
}

interface UserPeakPreferenceServiceDeps {
  preferenceDAO?: () => Promise<UserPeakPreferenceDAO>;
  userDAO?: () => Promise<UserDAO>;
}

interface PeakPreference {
  mode: PeakPreferenceMode;
  fallbackModel: string | null;
}

interface PeakPreferenceStatus extends PeakPreference {
  isPeak: boolean;
  activeModelFamilies: string[];
}

const DEFAULT_PREFERENCE: PeakPreference = { mode: 'continue', fallbackModel: null };
const MAX_FALLBACK_MODEL_LENGTH = 200;

function modelFamilies(): string[] {
  return PEAK_SCHEDULES.flatMap((schedule) => schedule.modelPrefixes.map((prefix) => prefix.replace(/\/$/, '')));
}

class UserPeakPreferenceService {
  private readonly deps: Required<UserPeakPreferenceServiceDeps>;

  constructor(
    private readonly env: UserPeakPreferenceServiceEnv,
    deps: UserPeakPreferenceServiceDeps = {},
  ) {
    this.deps = {
      preferenceDAO: () => Promise.resolve(new UserPeakPreferenceDAO(env.DB)),
      userDAO: () => Promise.resolve(new UserDAO(env.DB)),
      ...deps,
    };
  }

  public async getPreference(email: string): Promise<PeakPreference> {
    const dao = await this.deps.preferenceDAO();
    const row = await dao.getByEmail(email.toLowerCase());
    if (!row) return { ...DEFAULT_PREFERENCE };
    const mode = isPeakPreferenceMode(row.mode) ? row.mode : DEFAULT_PREFERENCE.mode;
    return { mode, fallbackModel: mode === 'fallback' ? row.fallback_model : null };
  }

  public async updatePreference(email: string, input: unknown): Promise<PeakPreference> {
    const body = (input ?? {}) as { mode?: unknown; fallbackModel?: unknown };
    if (!isPeakPreferenceMode(body.mode)) {
      throw new BadRequestError('mode must be one of continue, fallback, reject');
    }
    const mode = body.mode;
    let fallbackModel: string | null = null;
    if (mode === 'fallback') {
      const raw = typeof body.fallbackModel === 'string' ? body.fallbackModel.trim() : '';
      if (raw.length === 0) throw new BadRequestError('fallbackModel is required when mode is fallback');
      if (raw.length > MAX_FALLBACK_MODEL_LENGTH) {
        throw new BadRequestError(`fallbackModel must be at most ${MAX_FALLBACK_MODEL_LENGTH} characters`);
      }
      fallbackModel = raw;
    }

    const normalized = email.toLowerCase();
    const user = await (await this.deps.userDAO()).getByEmail(normalized);
    if (!user) throw new NotFoundError('User not found');

    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await (await this.deps.preferenceDAO()).upsert(normalized, mode, fallbackModel, now);
    return { mode, fallbackModel };
  }

  public async getStatus(email: string, at: Date = new Date()): Promise<PeakPreferenceStatus> {
    const preference = await this.getPreference(email);
    return {
      ...preference,
      isPeak: PEAK_SCHEDULES.some((schedule) => isPeakNow(schedule, at)),
      activeModelFamilies: modelFamilies(),
    };
  }
}

export { UserPeakPreferenceService };
export type { PeakPreference, PeakPreferenceStatus, UserPeakPreferenceServiceDeps, UserPeakPreferenceServiceEnv };
