import type { ServiceShortcut, ServiceShortcutInput } from '../types';
import { BASE_URL, fetchJSON } from './client';

export const serviceShortcutsApi = {
  getServiceShortcuts: () => fetchJSON<{ shortcuts: ServiceShortcut[] }>(`${BASE_URL}/service-shortcuts`),
  createServiceShortcut: (shortcut: ServiceShortcutInput) => fetchJSON<{ status: string; shortcut: ServiceShortcut }>(`${BASE_URL}/service-shortcuts`, {
    method: 'POST',
    body: JSON.stringify(shortcut),
  }),
  updateServiceShortcut: (id: string, shortcut: ServiceShortcutInput) => fetchJSON<{ status: string; shortcut: ServiceShortcut }>(`${BASE_URL}/service-shortcuts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ ...shortcut, id }),
  }),
  deleteServiceShortcut: (id: string) => fetchJSON<{ status: string }>(`${BASE_URL}/service-shortcuts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  reorderServiceShortcuts: (ids: string[]) => fetchJSON<{ status: string }>(`${BASE_URL}/service-shortcuts/reorder`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  }),
};
