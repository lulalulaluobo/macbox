import type { CloudMount, CloudFile } from '../types';
import { BASE_URL, fetchJSON } from './client';

export const cloudApi = {
  // Remote cloud drives
  beginQuarkQRLogin: () => fetchJSON<{ loginId: string; qrURL: string; imageURL: string; expiresAt: string }>(`${BASE_URL}/storage/cloud-auth/quark/qr`, { method: 'POST' }),
  pollQuarkQRLogin: (loginId: string) => fetchJSON<{ status: string; account?: string; message?: string }>(`${BASE_URL}/storage/cloud-auth/quark/qr/${encodeURIComponent(loginId)}`),
  getQuarkQRImageUrl: (loginId: string) => `${BASE_URL}/storage/cloud-auth/quark/qr/${encodeURIComponent(loginId)}/image`,
  createQuarkMountFromQR: (loginId: string, name: string) => fetchJSON<{ status: string; mount: CloudMount }>(`${BASE_URL}/storage/cloud-mounts/quark/qr/${encodeURIComponent(loginId)}`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  }),
  getCloudMounts: () => fetchJSON<{ mounts: CloudMount[] }>(`${BASE_URL}/storage/cloud-mounts`),
  checkCloudMount: (id: string) => fetchJSON<{ status: string; message: string }>(`${BASE_URL}/storage/cloud-mounts/${encodeURIComponent(id)}/check`, { method: 'POST' }),
  deleteCloudMount: (id: string) => fetchJSON<{ status: string }>(`${BASE_URL}/storage/cloud-mounts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listCloudFiles: (id: string, fid = '0', offset = 0, limit = 300) => fetchJSON<{ mount: CloudMount; parentFid: string; items: CloudFile[]; hasMore: boolean; nextOffset: number }>(
    `${BASE_URL}/storage/cloud-mounts/${encodeURIComponent(id)}/files?${new URLSearchParams({ fid, offset: String(offset), limit: String(limit) })}`
  ),
  createCloudFolder: (id: string, parentFid: string, name: string) => fetchJSON<{ status: string }>(`${BASE_URL}/storage/cloud-mounts/${encodeURIComponent(id)}/folders`, {
    method: 'POST',
    body: JSON.stringify({ parentFid, name }),
  }),
  renameCloudFile: (id: string, fid: string, name: string) => fetchJSON<{ status: string }>(`${BASE_URL}/storage/cloud-mounts/${encodeURIComponent(id)}/rename`, {
    method: 'POST',
    body: JSON.stringify({ fid, name }),
  }),
  deleteCloudFile: (id: string, fid: string) => fetchJSON<{ status: string }>(`${BASE_URL}/storage/cloud-mounts/${encodeURIComponent(id)}/files?fid=${encodeURIComponent(fid)}`, { method: 'DELETE' }),
  copyCloudFiles: (id: string, fids: string[], targetFid: string) => fetchJSON<{ status: string }>(`${BASE_URL}/storage/cloud-mounts/${encodeURIComponent(id)}/copy`, {
    method: 'POST',
    body: JSON.stringify({ fids, targetFid }),
  }),
  moveCloudFiles: (id: string, fids: string[], targetFid: string) => fetchJSON<{ status: string }>(`${BASE_URL}/storage/cloud-mounts/${encodeURIComponent(id)}/move`, {
    method: 'POST',
    body: JSON.stringify({ fids, targetFid }),
  }),
  uploadCloudFile: async (id: string, parentFid: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${BASE_URL}/storage/cloud-mounts/${encodeURIComponent(id)}/upload?parentFid=${encodeURIComponent(parentFid)}`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || 'Upload failed');
    }
    return res.json() as Promise<{ status: string; jobId: string }>;
  },
  downloadCloudFile: (id: string, file: Pick<CloudFile, 'fid' | 'name' | 'isDir' | 'size'>, destination: string) => fetchJSON<{ status: string; jobId: string }>(`${BASE_URL}/storage/cloud-mounts/${encodeURIComponent(id)}/download`, {
    method: 'POST',
    body: JSON.stringify({ ...file, destination }),
  }),
};
