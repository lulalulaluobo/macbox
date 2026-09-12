import { SystemOverview, SystemDiagnostics, DiskInfo, ManagedDisk, ContainerInfo, ImageInfo, ComposeProject, DockerOverview, DockerNetwork, AppMetadata, CustomAppInput, SambaStatus, SMBShare, PowerStatus, ServiceStatus, LocalMount, LocalMountsResponse, VMConfigInfo, VMPrerequisites, BackgroundJob, FileItem, TrashItem, SystemUser, SSHConfig, TerminalSettings, TerminalSkillsSettings, SSHKeyGenerationResult, NASUser, AuthResponse, CreateNASUserRequest, UpdateNASUserRequest } from './types';

const BASE_URL = '/api';

function getAuthenticatedFileUrl(endpoint: 'download' | 'raw', path: string) {
  const params = new URLSearchParams({ path });
  return `${BASE_URL}/terminal/files/${endpoint}?${params.toString()}`;
}

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (res.status === 401 && !url.endsWith('/api/auth/login')) {
    window.dispatchEvent(new CustomEvent('macnas-unauthorized'));
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export const api = {
  // System Overview
  getOverview: () => fetchJSON<SystemOverview>(`${BASE_URL}/system/status`),
  getDiagnostics: () => fetchJSON<SystemDiagnostics>(`${BASE_URL}/system/diagnostics`),

  // VM Controls
  getVMPrerequisites: () => fetchJSON<VMPrerequisites>(`${BASE_URL}/vm/prerequisites`),
  installLima: () => fetchJSON<{ status: string; message: string; jobId: string }>(`${BASE_URL}/vm/lima/install`, { method: 'POST' }),
  startVM: () => fetchJSON<{ status: string; message: string; jobId: string }>(`${BASE_URL}/vm/start`, { method: 'POST' }),
  stopVM: () => fetchJSON<{ status: string; message: string; jobId: string }>(`${BASE_URL}/vm/stop`, { method: 'POST' }),
  restartVM: () => fetchJSON<{ status: string; message: string; jobId: string }>(`${BASE_URL}/vm/restart`, { method: 'POST' }),

  // Storage
  getDisks: () => fetchJSON<{
    disks: DiskInfo[];
    managedDisks: ManagedDisk[];
    selectedDisk: string;
    isExternalActive?: boolean;
    dataPath?: string;
    mountPoint?: string;
  }>(`${BASE_URL}/storage/disks`),
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
  bindSecondaryDisk: (diskId: string, mountPoint?: string, targetDir?: string, guestTarget?: string) =>
    fetchJSON<{
      status: string;
      message: string;
      requiresRestart: boolean;
      targetDir: string;
      guestTarget: string;
    }>(`${BASE_URL}/storage/bind-secondary`, {
      method: 'POST',
      body: JSON.stringify({ diskId, mountPoint, targetDir, guestTarget }),
    }),
  unbindSecondaryDisk: () =>
    fetchJSON<{ status: string; message: string; requiresRestart: boolean }>(`${BASE_URL}/storage/unbind-secondary`, {
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

  // Docker Overview & Containers
  getDockerOverview: () => fetchJSON<DockerOverview>(`${BASE_URL}/docker/overview`),
  getContainers: () => fetchJSON<ContainerInfo[]>(`${BASE_URL}/docker/containers`),
  containerAction: (id: string, action: 'start' | 'stop' | 'restart' | 'remove', force = false) =>
    fetchJSON<{ status: string }>(`${BASE_URL}/docker/containers/${id}/action`, {
      method: 'POST',
      body: JSON.stringify({ action, force }),
    }),
  removeContainer: (id: string, force = false) =>
    fetchJSON<{ status: string }>(`${BASE_URL}/docker/containers/${id}?force=${force}`, { method: 'DELETE' }),
  getContainerLogs: (id: string, tail = 100) => fetchJSON<{ logs: string }>(`${BASE_URL}/docker/containers/${id}/logs?tail=${tail}`),

  // Docker Images
  getImages: () => fetchJSON<ImageInfo[]>(`${BASE_URL}/docker/images`),
  pullImage: (image: string) => fetchJSON<{ status: string; logs: string }>(`${BASE_URL}/docker/images/pull`, {
    method: 'POST',
    body: JSON.stringify({ image }),
  }),
  removeImage: (id: string, force = false) =>
    fetchJSON<{ status: string }>(`${BASE_URL}/docker/images/${id}?force=${force}`, { method: 'DELETE' }),
  pruneImages: () => fetchJSON<{ status: string; output: string }>(`${BASE_URL}/docker/images/prune`, { method: 'POST' }),

  // Docker Compose
  getComposeProjects: () => fetchJSON<ComposeProject[]>(`${BASE_URL}/docker/compose`),
  getComposeYaml: (name: string) => fetchJSON<{ name: string; yaml: string }>(`${BASE_URL}/docker/compose/${name}`),
  deployCompose: (name: string, yaml: string) =>
    fetchJSON<{ status: string; logs: string }>(`${BASE_URL}/docker/compose/deploy`, {
      method: 'POST',
      body: JSON.stringify({ name, yaml }),
    }),
  composeAction: (name: string, action: 'start' | 'stop' | 'restart' | 'down' | 'pull') =>
    fetchJSON<{ status: string; output: string }>(`${BASE_URL}/docker/compose/${name}/action`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  deleteComposeProject: (name: string, deleteVolumes = false) =>
    fetchJSON<{ status: string }>(
      `${BASE_URL}/docker/compose/${name}?volumes=${deleteVolumes}${deleteVolumes ? '&confirm=DELETE_DATA' : ''}`,
      { method: 'DELETE' },
    ),

  // Docker Networks & Mirrors
  getDockerNetworks: () => fetchJSON<DockerNetwork[]>(`${BASE_URL}/docker/networks`),
  getRegistryMirrors: () => fetchJSON<{ mirrors: string[] }>(`${BASE_URL}/docker/mirrors`),
  setRegistryMirrors: (mirrors: string[]) =>
    fetchJSON<{ status: string }>(`${BASE_URL}/docker/mirrors`, {
      method: 'POST',
      body: JSON.stringify({ mirrors }),
    }),

  // Apps
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

  // Samba
  getSambaStatus: () => fetchJSON<SambaStatus>(`${BASE_URL}/samba/status`),
  updateSambaPassword: (password: string) => fetchJSON<{ status: string; message: string }>(`${BASE_URL}/samba/password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  }),
  addOrUpdateSMBShare: (share: Partial<SMBShare> & { name: string; path: string }) => fetchJSON<{ status: string; share: SMBShare }>(`${BASE_URL}/samba/shares`, {
    method: 'POST',
    body: JSON.stringify(share),
  }),
  toggleSMBShare: (id: string) => fetchJSON<{ status: string; enabled: boolean }>(`${BASE_URL}/samba/shares/${id}/toggle`, {
    method: 'POST',
  }),
  deleteSMBShare: (id: string) => fetchJSON<{ status: string; message: string }>(`${BASE_URL}/samba/shares/${id}`, {
    method: 'DELETE',
  }),
  toggleSMBService: (enable: boolean) => fetchJSON<{ status: string; message: string }>(`${BASE_URL}/samba/service/toggle`, {
    method: 'POST',
    body: JSON.stringify({ enable }),
  }),
  restartSMBService: () => fetchJSON<{ status: string; message: string }>(`${BASE_URL}/samba/service/restart`, {
    method: 'POST',
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
  getJobs: () => fetchJSON<{ jobs: BackgroundJob[] }>(`${BASE_URL}/jobs`),
  getJob: (id: string) => fetchJSON<BackgroundJob>(`${BASE_URL}/jobs/${encodeURIComponent(id)}`),

  // Web Terminal & File System
  listFiles: (path?: string, offset = 0, limit = 300) => fetchJSON<{ status: string; path: string; items: FileItem[]; hasMore: boolean; nextOffset: number }>(
    `${BASE_URL}/terminal/files?${new URLSearchParams({ ...(path ? { path } : {}), offset: String(offset), limit: String(limit) })}`
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
    const res = await fetch(`${BASE_URL}/terminal/files/upload?targetDir=${encodeURIComponent(targetDir)}`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || 'Upload failed');
    }
    return res.json();
  },
  getFileDownloadUrl: (path: string) => getAuthenticatedFileUrl('download', path),
  getFileRawUrl: (path: string) => getAuthenticatedFileUrl('raw', path),
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
  emptyTrash: () => fetchJSON<{ status: string; message: string; count?: number }>(
    `${BASE_URL}/terminal/files/empty-trash`,
    {
      method: 'POST',
    }
  ),
  deleteTrashItems: (ids: string[]) => fetchJSON<{ status: string; message: string; count?: number }>(
    `${BASE_URL}/terminal/files/trash/delete`,
    {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }
  ),

  // System Users & Security
  getUsers: () => fetchJSON<SystemUser[]>(`${BASE_URL}/system/users`),
  createUser: (req: { username: string; password?: string; isSudo?: boolean }) =>
    fetchJSON<{ status: string; message: string }>(`${BASE_URL}/system/users`, {
      method: 'POST',
      body: JSON.stringify(req),
    }),
  updateUserPassword: (username: string, password: string) =>
    fetchJSON<{ status: string; message: string }>(`${BASE_URL}/system/users/${encodeURIComponent(username)}/password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  deleteUser: (username: string) =>
    fetchJSON<{ status: string; message: string }>(`${BASE_URL}/system/users/${encodeURIComponent(username)}`, {
      method: 'DELETE',
    }),
  updateRootPassword: (password: string) =>
    fetchJSON<{ status: string; message: string }>(`${BASE_URL}/system/root/password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  // SSH Management
  getSSHConfig: () => fetchJSON<SSHConfig>(`${BASE_URL}/system/ssh`),
  bootstrapSSH: () => fetchJSON<{ status: string; message: string }>(`${BASE_URL}/system/ssh/bootstrap`, {
    method: 'POST',
  }),
  updateSSHConfig: (cfg: SSHConfig) =>
    fetchJSON<{ status: string; message: string }>(`${BASE_URL}/system/ssh`, {
      method: 'POST',
      body: JSON.stringify(cfg),
    }),
  toggleSSH: (enable: boolean) =>
    fetchJSON<{ status: string; message: string }>(`${BASE_URL}/system/ssh/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enable }),
    }),
  generateSSHRootKey: (comment?: string) =>
    fetchJSON<{ status: string; message: string; result: SSHKeyGenerationResult }>(`${BASE_URL}/system/ssh/keys/generate`, {
      method: 'POST',
      body: JSON.stringify({ comment: comment || '' }),
    }),
  getSSHAuthorizedKeys: () =>
    fetchJSON<{ status: string; keys: string[] }>(`${BASE_URL}/system/ssh/keys`),
  addSSHAuthorizedKey: (publicKey: string) =>
    fetchJSON<{ status: string; message: string }>(`${BASE_URL}/system/ssh/keys/add`, {
      method: 'POST',
      body: JSON.stringify({ publicKey }),
    }),
  clearSSHAuthorizedKeys: () =>
    fetchJSON<{ status: string; message: string }>(`${BASE_URL}/system/ssh/keys`, {
      method: 'DELETE',
    }),

  // Terminal Settings
  getTerminalSettings: () => fetchJSON<TerminalSettings>(`${BASE_URL}/system/terminal/settings`),
  updateTerminalSettings: (settings: TerminalSettings) =>
    fetchJSON<{ status: string; message: string }>(`${BASE_URL}/system/terminal/settings`, {
      method: 'POST',
      body: JSON.stringify(settings),
    }),
  getTerminalSkills: () => fetchJSON<TerminalSkillsSettings>(`${BASE_URL}/system/terminal/skills`),
  updateTerminalSkills: (settings: { enabled: boolean; hostPath: string }) =>
    fetchJSON<{ status: string; message: string; requiresRestart: boolean; settings: TerminalSkillsSettings }>(`${BASE_URL}/system/terminal/skills`, {
      method: 'POST',
      body: JSON.stringify(settings),
    }),

  // Web Console Authentication & User Management
  getAuthStatus: () =>
    fetchJSON<{ setupRequired: boolean }>(`${BASE_URL}/auth/status`),
  setupAdmin: (username: string, password: string, displayName?: string) =>
    fetchJSON<{ status: string; user: NASUser }>(`${BASE_URL}/auth/setup`, {
      method: 'POST',
      body: JSON.stringify({ username, password, displayName: displayName || '' }),
    }),
  login: (username: string, password: string, rememberMe: boolean = false) =>
    fetchJSON<AuthResponse>(`${BASE_URL}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username, password, rememberMe }),
    }),
  logout: () =>
    fetchJSON<{ status: string }>(`${BASE_URL}/auth/logout`, {
      method: 'POST',
    }),
  getMe: () =>
    fetchJSON<{ user: NASUser }>(`${BASE_URL}/auth/me`),
  changePassword: (oldPassword: string, newPassword: string) =>
    fetchJSON<{ status: string; message: string }>(`${BASE_URL}/auth/change-pwd`, {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    }),
  getNASUsers: () =>
    fetchJSON<{ users: NASUser[] }>(`${BASE_URL}/auth/users`),
  createNASUser: (req: CreateNASUserRequest) =>
    fetchJSON<{ status: string; user: NASUser }>(`${BASE_URL}/auth/users`, {
      method: 'POST',
      body: JSON.stringify(req),
    }),
  updateNASUser: (id: string, req: UpdateNASUserRequest) =>
    fetchJSON<{ status: string; user: NASUser }>(`${BASE_URL}/auth/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(req),
    }),
  deleteNASUser: (id: string) =>
    fetchJSON<{ status: string; message: string }>(`${BASE_URL}/auth/users/${id}`, {
      method: 'DELETE',
    }),
};
