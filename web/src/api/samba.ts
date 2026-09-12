import type { SambaStatus, SMBShare } from '../types';
import { BASE_URL, fetchJSON } from './client';

export const sambaApi = {  // Samba
  getSambaStatus: () => fetchJSON<SambaStatus>(`${BASE_URL}/samba/status`),
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


};
