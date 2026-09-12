import type { SystemOverview, SystemDiagnostics, PowerStatus, ServiceStatus, VMConfigInfo, VMPrerequisites, BackgroundJob, SystemUser, SSHConfig, SSHKeyGenerationResult } from '../types';
import { BASE_URL, fetchJSON } from './client';

export const systemApi = {  // System Overview
  getOverview: () => fetchJSON<SystemOverview>(`${BASE_URL}/system/status`),
  getDiagnostics: () => fetchJSON<SystemDiagnostics>(`${BASE_URL}/system/diagnostics`),

  // VM Controls
  getVMPrerequisites: () => fetchJSON<VMPrerequisites>(`${BASE_URL}/vm/prerequisites`),
  installLima: () => fetchJSON<{ status: string; message: string; jobId: string }>(`${BASE_URL}/vm/lima/install`, { method: 'POST' }),
  startVM: () => fetchJSON<{ status: string; message: string; jobId: string }>(`${BASE_URL}/vm/start`, { method: 'POST' }),
  stopVM: () => fetchJSON<{ status: string; message: string; jobId: string }>(`${BASE_URL}/vm/stop`, { method: 'POST' }),
  restartVM: () => fetchJSON<{ status: string; message: string; jobId: string }>(`${BASE_URL}/vm/restart`, { method: 'POST' }),

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
  cancelJob: (id: string) => fetchJSON<{ status: string }>(`${BASE_URL}/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  clearTransferJobs: () => fetchJSON<{ status: string; count: number }>(`${BASE_URL}/jobs/clear?kind=cloud.transfer`, { method: 'POST' }),

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




};
