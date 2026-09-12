import type { NASUser, AuthResponse, CreateNASUserRequest, UpdateNASUserRequest } from '../types';
import { BASE_URL, fetchJSON } from './client';

export const authApi = {  // Web Console Authentication & User Management
  getAuthStatus: () =>
    fetchJSON<{ setupRequired: boolean }>(`${BASE_URL}/auth/status`),
  setupAdmin: (username: string, password: string, displayName?: string) =>
	fetchJSON<{ status: string; user: NASUser; warning?: string }>(`${BASE_URL}/auth/setup`, {
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
	fetchJSON<{ status: string; message: string; smbSynced?: boolean; warning?: string }>(`${BASE_URL}/auth/change-pwd`, {
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
