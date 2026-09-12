import type { DiskInfo, ManagedDisk, LocalMount, LocalMountsResponse } from '../types';
import { BASE_URL, fetchJSON } from './client';

export const storageApi = {  // Storage
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




};
