import { SystemOverview, DiskInfo, ManagedDisk, ContainerInfo, AppMetadata, SambaStatus, PowerStatus, ServiceStatus, LocalMount, LocalMountsResponse, VMConfigInfo, FileItem, TrashItem } from './types';

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
  toggleLocalMountWritable: (id: string, writable: boolean) => fetchJSON<{
    status: string;
    message: string;
    writable: boolean;
    mounts: LocalMount[];
    recommended: LocalMount[];
  }>(`${BASE_URL}/storage/mounts/${id}/writable`, {
    method: 'POST',
    body: JSON.stringify({ writable }),
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

  // VM Specs
  getVMConfig: () => fetchJSON<VMConfigInfo>(`${BASE_URL}/vm/config`),
  updateVMConfig: (cfg: { cpus: number; memory: number; diskSize: number }) => fetchJSON<{
    status: string;
    requiresRestart: boolean;
    message: string;
    cpus: number;
    memory: number;
    diskSize: number;
  }>(`${BASE_URL}/vm/config`, {
    method: 'POST',
    body: JSON.stringify(cfg),
  }),

  // Web Terminal & File System
  listFiles: (path?: string) => fetchJSON<{ status: string; path: string; items: FileItem[] }>(
    `${BASE_URL}/terminal/files${path ? `?path=${encodeURIComponent(path)}` : ''}`
  ),
  readFile: (path: string) => fetchJSON<{ status: string; path: string; content: string }>(
    `${BASE_URL}/terminal/files/read?path=${encodeURIComponent(path)}`
  ),
  writeFile: (path: string, content: string) => fetchJSON<{ status: string; message: string }>(
    `${BASE_URL}/terminal/files/write`,
    {
      method: 'POST',
      body: JSON.stringify({ path, content }),
    }
  ),
  createFolder: (path: string) => fetchJSON<{ status: string; message: string }>(
    `${BASE_URL}/terminal/files/mkdir`,
    {
      method: 'POST',
      body: JSON.stringify({ path }),
    }
  ),
  deleteFile: (path: string) => fetchJSON<{ status: string; message: string }>(
    `${BASE_URL}/terminal/files?path=${encodeURIComponent(path)}`,
    {
      method: 'DELETE',
    }
  ),
  uploadFile: async (file: File, targetDir: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('targetDir', targetDir);
    const res = await fetch(`${BASE_URL}/terminal/files/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || 'Upload failed');
    }
    return res.json();
  },
  getFileDownloadUrl: (path: string) => `${BASE_URL}/terminal/files/download?path=${encodeURIComponent(path)}`,
  getFileRawUrl: (path: string) => `${BASE_URL}/terminal/files/raw?path=${encodeURIComponent(path)}`,
  renameFile: (oldPath: string, newPath: string) => fetchJSON<{ status: string; message: string }>(
    `${BASE_URL}/terminal/files/rename`,
    {
      method: 'POST',
      body: JSON.stringify({ oldPath, newPath }),
    }
  ),
  copyFiles: (srcPaths: string[], destDir: string) => fetchJSON<{ status: string; message: string }>(
    `${BASE_URL}/terminal/files/copy`,
    {
      method: 'POST',
      body: JSON.stringify({ srcPaths, destDir }),
    }
  ),
  moveFiles: (srcPaths: string[], destDir: string) => fetchJSON<{ status: string; message: string }>(
    `${BASE_URL}/terminal/files/move`,
    {
      method: 'POST',
      body: JSON.stringify({ srcPaths, destDir }),
    }
  ),
  moveToTrash: (paths: string[]) => fetchJSON<{ status: string; message: string }>(
    `${BASE_URL}/terminal/files/trash`,
    {
      method: 'POST',
      body: JSON.stringify({ paths }),
    }
  ),
  listTrash: () => fetchJSON<{ status: string; items: TrashItem[] }>(
    `${BASE_URL}/terminal/files/trash`
  ),
  restoreTrash: (ids: string[]) => fetchJSON<{ status: string; message: string }>(
    `${BASE_URL}/terminal/files/restore`,
    {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }
  ),
  emptyTrash: () => fetchJSON<{ status: string; message: string }>(
    `${BASE_URL}/terminal/files/empty-trash`,
    {
      method: 'POST',
    }
  ),
};
