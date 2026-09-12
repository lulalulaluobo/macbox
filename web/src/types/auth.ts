export interface NASUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  enabled: boolean;
}
export interface AuthResponse {
  user: NASUser;
  warning?: string;
}

export interface CreateNASUserRequest {
  username: string;
  displayName?: string;
  password: string;
  role: 'admin' | 'user';
}

export interface UpdateNASUserRequest {
  displayName?: string;
  role?: 'admin' | 'user';
  enabled?: boolean;
  newPassword?: string;
}
