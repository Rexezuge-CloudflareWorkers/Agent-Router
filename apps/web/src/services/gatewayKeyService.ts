import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/api';
import type { CreatedGatewayKey, GatewayKey, PeakPreference, PeakPreferenceStatus } from '../types';

export async function listGatewayKeys(): Promise<GatewayKey[]> {
  const data = await apiGet<{ keys: GatewayKey[] }>('/user/gateway-keys');
  return data.keys ?? [];
}

export async function createGatewayKey(name: string, expiresInDays?: number): Promise<CreatedGatewayKey> {
  return apiPost<CreatedGatewayKey>('/user/gateway-keys', { name, expiresInDays });
}

export async function revokeGatewayKey(keyId: string): Promise<void> {
  await apiDelete<{ ok: boolean }>(`/user/gateway-keys/${keyId}`);
}

export async function loadGatewayKeyPeakStatus(keyId: string): Promise<PeakPreferenceStatus> {
  return apiGet<PeakPreferenceStatus>(`/user/gateway-keys/${keyId}/settings/peak`);
}

export async function saveGatewayKeyPeakPreference(keyId: string, input: PeakPreference): Promise<PeakPreference> {
  return apiPatch<PeakPreference>(`/user/gateway-keys/${keyId}/settings/peak`, input);
}
