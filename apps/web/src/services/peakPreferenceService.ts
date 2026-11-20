import type { PeakPreference, PeakPreferenceStatus } from '../types';
import { apiGet, apiPatch } from '../lib/api';

export async function loadPeakPreference(): Promise<PeakPreferenceStatus> {
  return apiGet<PeakPreferenceStatus>('/user/settings/peak');
}

export async function savePeakPreference(input: PeakPreference): Promise<PeakPreference> {
  return apiPatch<PeakPreference>('/user/settings/peak', input);
}
