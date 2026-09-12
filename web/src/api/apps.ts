import type { AppMetadata, CustomAppInput } from '../types';
import { BASE_URL, fetchJSON } from './client';

export const appsApi = {  // Apps
  getApps: () => fetchJSON<AppMetadata[]>(`${BASE_URL}/apps`),
  getAppConfig: (id: string) => fetchJSON<AppMetadata>(`${BASE_URL}/apps/${id}/config`),
  installApp: (id: string) => fetchJSON<{ status: string; message: string }>(`${BASE_URL}/apps/${id}/install`, { method: 'POST' }),
  addCustomApp: (input: CustomAppInput) =>
    fetchJSON<AppMetadata>(`${BASE_URL}/apps/custom`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteCustomApp: (id: string) =>
    fetchJSON<{ status: string }>(`${BASE_URL}/apps/custom/${id}`, { method: 'DELETE' }),
  syncAppStore: () =>
    fetchJSON<{ status: string; count: number }>(`${BASE_URL}/apps/sync`, { method: 'POST' }),
  startApp: (id: string) => fetchJSON<{ status: string }>(`${BASE_URL}/apps/${id}/start`, { method: 'POST' }),
  stopApp: (id: string) => fetchJSON<{ status: string }>(`${BASE_URL}/apps/${id}/stop`, { method: 'POST' }),
  restartApp: (id: string) => fetchJSON<{ status: string }>(`${BASE_URL}/apps/${id}/restart`, { method: 'POST' }),
  uninstallApp: (id: string) => fetchJSON<{ status: string; message: string }>(`${BASE_URL}/apps/${id}/uninstall`, { method: 'POST' }),
  getAppLogs: (id: string, tail = 100) => fetchJSON<{ logs: string }>(`${BASE_URL}/apps/${id}/logs?tail=${tail}`),


};
