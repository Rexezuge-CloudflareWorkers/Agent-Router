import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/api';
import type { SearchProvider, SearchProviderKey } from '../types';

export async function listSearchProviders(): Promise<SearchProvider[]> {
  const data = await apiGet<{ searchProviders: SearchProvider[] }>('/user/search-providers');
  return data.searchProviders ?? [];
}

export async function createSearchProvider(kind: string, name: string): Promise<SearchProvider> {
  return apiPost<SearchProvider>('/user/search-providers', { kind, name });
}

export async function updateSearchProvider(id: string, patch: { name?: string; status?: string }): Promise<SearchProvider> {
  return apiPatch<SearchProvider>(`/user/search-providers/${id}`, patch);
}

export async function deleteSearchProvider(id: string): Promise<void> {
  await apiDelete<{ ok: boolean }>(`/user/search-providers/${id}`);
}

export async function listSearchProviderKeys(providerId: string): Promise<SearchProviderKey[]> {
  const data = await apiGet<{ keys: SearchProviderKey[] }>(`/user/search-providers/${providerId}/keys`);
  return data.keys ?? [];
}

export async function addSearchProviderKey(
  providerId: string,
  input: { name: string; secret: string; requestLimit?: number | null; resetInDays?: number | null; priority?: number },
): Promise<SearchProviderKey> {
  return apiPost<SearchProviderKey>(`/user/search-providers/${providerId}/keys`, input);
}

export async function updateSearchProviderKey(
  providerId: string,
  keyId: string,
  patch: { name?: string; priority?: number; requestLimit?: number | null; status?: string },
): Promise<SearchProviderKey> {
  return apiPatch<SearchProviderKey>(`/user/search-providers/${providerId}/keys/${keyId}`, patch);
}

export async function rotateSearchProviderKey(providerId: string, keyId: string, secret: string): Promise<SearchProviderKey> {
  return apiPost<SearchProviderKey>(`/user/search-providers/${providerId}/keys/${keyId}/rotate`, { secret });
}

export async function resetSearchProviderKeyUsage(providerId: string, keyId: string, resetInDays?: number): Promise<SearchProviderKey> {
  return apiPost<SearchProviderKey>(`/user/search-providers/${providerId}/keys/${keyId}/reset-usage`, { resetInDays });
}

export async function deleteSearchProviderKey(providerId: string, keyId: string): Promise<void> {
  await apiDelete<{ ok: boolean }>(`/user/search-providers/${providerId}/keys/${keyId}`);
}
