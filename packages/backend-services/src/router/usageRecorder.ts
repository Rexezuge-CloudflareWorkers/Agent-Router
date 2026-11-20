import type { ProviderKeyDAO, ProviderKeyRow, UsageLedgerDAO } from '@agent-router/backend-data/dao';
import type { ParsedUsage } from '@agent-router/provider-clients/upstream';
import { TimestampUtil, UUIDUtil } from '@rexezuge/shared';
import { isCapExceeded } from './keyHealth';

/**
The part of a proxy request the ledger needs. Kept structural (rather than
importing `ProxyRequest`) so this module has no dependency on the router.
*/
interface UsageContext {
  userEmail: string;
  gatewayKeyId: string | null;
  providerId: string;
  upstreamModel: string | null;
}

/**
Records a successful call: bumps the key's usage counters, marks the key
exhausted if it just crossed a cap, and writes the ledger row. Best-effort —
accounting must never fail the response the client already earned.
*/
async function recordSuccessfulUsage(
  keyDAO: ProviderKeyDAO,
  usageDAO: UsageLedgerDAO,
  candidate: ProviderKeyRow,
  req: UsageContext,
  usage: ParsedUsage,
  latencyMs: number,
  statusCode = 200,
): Promise<void> {
  const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
  await keyDAO.recordSuccess(candidate.id, usage.promptTokens, usage.completionTokens, now).catch(() => {});
  const refreshed = await keyDAO.getById(candidate.id).catch(() => null);
  if (refreshed && isCapExceeded(refreshed)) {
    await keyDAO.markExhausted(candidate.id, now).catch(() => {});
  }
  await usageDAO
    .insert({
      id: UUIDUtil.getRandomUUID(),
      userEmail: req.userEmail,
      gatewayKeyId: req.gatewayKeyId,
      providerId: req.providerId,
      providerKeyId: candidate.id,
      upstreamModel: req.upstreamModel,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      latencyMs,
      statusCode,
      errorCode: null,
      estimated: usage.estimated,
      now,
    })
    .catch(() => {});
}

/**
Records a failed attempt (no tokens, upstream status recorded as the error
code). Best-effort, like the success path.
*/
async function recordFailedUsage(
  usageDAO: UsageLedgerDAO,
  candidate: ProviderKeyRow,
  req: UsageContext,
  statusCode: number,
  latencyMs: number,
): Promise<void> {
  await usageDAO
    .insert({
      id: UUIDUtil.getRandomUUID(),
      userEmail: req.userEmail,
      gatewayKeyId: req.gatewayKeyId,
      providerId: req.providerId,
      providerKeyId: candidate.id,
      upstreamModel: req.upstreamModel,
      promptTokens: 0,
      completionTokens: 0,
      latencyMs,
      statusCode,
      errorCode: `UPSTREAM_${statusCode}`,
      estimated: false,
      now: TimestampUtil.getCurrentUnixTimestampInSeconds(),
    })
    .catch(() => {});
}

export { recordFailedUsage, recordSuccessfulUsage };
export type { UsageContext };
