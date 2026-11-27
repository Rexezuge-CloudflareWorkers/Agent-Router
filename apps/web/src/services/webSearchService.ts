import { apiGet, apiPatch } from '../lib/api';
import type { WebSearchSettings } from '../types';

export async function loadWebSearchSettings(): Promise<WebSearchSettings> {
  return apiGet<WebSearchSettings>('/user/settings/web-search');
}

export async function saveWebSearchSettings(input: {
  mode: WebSearchSettings['mode'];
  selectedProviderId?: string | null;
}): Promise<WebSearchSettings> {
  return apiPatch<WebSearchSettings>('/user/settings/web-search', input);
}
