import { SystemOverview, DiskInfo, ManagedDisk, ContainerInfo, AppMetadata, SambaStatus, PowerStatus, ServiceStatus, LocalMount, LocalMountsResponse } from './types';

const BASE_URL = '/api';

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export const api = {
  // System Overview
  getOverview: () => fetchJSON<SystemOverview>(`${BASE_URL}/system/status`),

  // VM Controls
  startVM: () => fetchJSON<{ status: string; message: string }>(`${BASE_URL}/vm/start`, { method: 'POST' }),
  stopVM: () => fetchJSON<{ status: string; message: string }>(`${BASE_URL}/vm/stop`, { method: 'POST' }),
  restartVM: () => fetchJSON<{ status: string; message: string }>(`${BASE_URL}/vm/restart`, { method: 'POST' }),

  // Storage
  getDisks: () => fetchJSON<{
    disks: DiskInfo[];
    managedDisks: ManagedDisk[];
    selectedDisk: string;
    isExternalActive?: boolean;
    dataPath?: string;
    mountPoint?: string;
  }>(`${BASE_URL}/storage/disks`),
  selectDisk: (identifier: string) => fetchJSON<{ status: string; selectedDisk: string }>(`${BASE_URL}/storage/select`, {
    method: 'POST',
    body: JSON.stringify({ identifier }),
  }),
  bindStorage: (identifier: string, mountPoint: string, sizeGB: number) => fetchJSON<{
    status: string;
    message: string;
    dataPath: string;
    requiresRestart: boolean;
  }>(`${BASE_URL}/storage/bind`, {
    method: 'POST',
    body: JSON.stringify({ identifier, mountPoint, sizeGB }),
  }),
  unbindStorage: () => fetchJSON<{ status: string; message: string; requiresRestart: boolean }>(`${BASE_URL}/storage/unbind`, {
    method: 'POST',
  }),

  // Local Mounts (VirtioFS Direct Passthrough)
  getLocalMounts: () => fetchJSON<LocalMountsResponse>(`${BASE_URL}/storage/mounts`),
  addLocalMount: (mount: Partial<LocalMount>) => fetchJSON<{
    status: string;
    message: string;
    mounts: LocalMount[];
    recommended: LocalMount[];
    requiresRestart: boolean;
  }>(`${BASE_URL}/storage/mounts`, {
    method: 'POST',
    body: JSON.stringify(mount),
  }),
  toggleLocalMount: (id: string) => fetchJSON<{
    status: string;
    message: string;
    enabled: boolean;
    mounts: LocalMount[];
    recommended: LocalMount[];
    requiresRestart: boolean;
  }>(`${BASE_URL}/storage/mounts/${id}/toggle`, {
    method: 'POST',
  }),
  deleteLocalMount: (id: string) => fetchJSON<{
    status: string;
    message: string;
    mounts: LocalMount[];
    recommended: LocalMount[];
    requiresRestart: boolean;
  }>(`${BASE_URL}/storage/mounts/${id}`, {
    method: 'DELETE',
  }),

  // Power Management (Caffeinate)
  getPowerStatus: () => fetchJSON<PowerStatus>(`${BASE_URL}/system/power`),
  togglePower: (enable: boolean) => fetchJSON<PowerStatus>(`${BASE_URL}/system/power/toggle`, {
    method: 'POST',
    body: JSON.stringify({ enable }),
  }),

  // Service Management (LaunchAgent)
  getServiceStatus: () => fetchJSON<ServiceStatus>(`${BASE_URL}/system/service`),
  installService: () => fetchJSON<ServiceStatus>(`${BASE_URL}/system/service/install`, {
    method: 'POST',
  }),
  uninstallService: () => fetchJSON<ServiceStatus>(`${BASE_URL}/system/service/uninstall`, {
    method: 'POST',
  }),

  // Docker
  getContainers: () => fetchJSON<ContainerInfo[]>(`${BASE_URL}/docker/containers`),
  startContainer: (id: string) => fetchJSON<{ status: string }>(`${BASE_URL}/docker/containers/${id}/start`, { method: 'POST' }),
  stopContainer: (id: string) => fetchJSON<{ status: string }>(`${BASE_URL}/docker/containers/${id}/stop`, { method: 'POST' }),
  restartContainer: (id: string) => fetchJSON<{ status: string }>(`${BASE_URL}/docker/containers/${id}/restart`, { method: 'POST' }),
  getContainerLogs: (id: string, tail = 100) => fetchJSON<{ logs: string }>(`${BASE_URL}/docker/containers/${id}/logs?tail=${tail}`),

  // Apps
  getApps: () => fetchJSON<AppMetadata[]>(`${BASE_URL}/apps`),
  installApp: (id: string) => fetchJSON<{ status: string; message: string }>(`${BASE_URL}/apps/${id}/install`, { method: 'POST' }),
  startApp: (id: string) => fetchJSON<{ status: string }>(`${BASE_URL}/apps/${id}/start`, { method: 'POST' }),
  stopApp: (id: string) => fetchJSON<{ status: string }>(`${BASE_URL}/apps/${id}/stop`, { method: 'POST' }),
  restartApp: (id: string) => fetchJSON<{ status: string }>(`${BASE_URL}/apps/${id}/restart`, { method: 'POST' }),
  uninstallApp: (id: string) => fetchJSON<{ status: string; message: string }>(`${BASE_URL}/apps/${id}/uninstall`, { method: 'POST' }),
  getAppLogs: (id: string, tail = 100) => fetchJSON<{ logs: string }>(`${BASE_URL}/apps/${id}/logs?tail=${tail}`),

  // Samba
  getSambaStatus: () => fetchJSON<SambaStatus>(`${BASE_URL}/samba/status`),
  updateSambaPassword: (password: string) => fetchJSON<{ status: string; message: string }>(`${BASE_URL}/samba/password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  }),
};
