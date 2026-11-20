import type { Container } from '@agent-router/backend-runtime/di';
import { findPeakSchedule, isPeakNow, millisUntilOffPeak } from '@agent-router/shared';
import { Tokens } from '../composition/index';

type PeakDecision = { action: 'allow' } | { action: 'rewrite'; model: string } | { action: 'reject'; response: Response };

const MIN_RETRY_AFTER_SECONDS = 60;

function peakRejection(model: string, retryAfterSeconds: number): Response {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return Response.json(
    {
      error: {
        message: `Model ${model} is unavailable during peak hours. Off-peak resumes in about ${minutes} minute(s).`,
        type: 'peak_hours',
      },
    },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  );
}

/**
Applies the user's peak-hours preference to a request for `requestedModel`.

Returns `allow` when the model has no schedule, the current time is off-peak,
or the user chose `continue`. Returns `rewrite` when the user wants a fallback
and the request is inside a peak window. Returns `reject` with a ready-to-send
429 response when the user chose `reject` (or `fallback` without a model).
*/
async function applyPeakPolicy(
  scope: Container,
  userEmail: string,
  requestedModel: string | null,
  at: Date = new Date(),
): Promise<PeakDecision> {
  const schedule = findPeakSchedule(requestedModel);
  if (!schedule || !isPeakNow(schedule, at)) return { action: 'allow' };

  const preference = await scope.get(Tokens.UserPeakPreferenceService).getPreference(userEmail);
  if (preference.mode === 'continue') return { action: 'allow' };

  if (preference.mode === 'fallback' && preference.fallbackModel) {
    return { action: 'rewrite', model: preference.fallbackModel };
  }

  const retryAfterSeconds = Math.max(MIN_RETRY_AFTER_SECONDS, Math.ceil(millisUntilOffPeak(schedule, at) / 1000));
  return { action: 'reject', response: peakRejection(requestedModel ?? 'this model', retryAfterSeconds) };
}

export { applyPeakPolicy, peakRejection };
export type { PeakDecision };
