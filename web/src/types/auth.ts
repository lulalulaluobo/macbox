export interface ConsoleUser {
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
  user: ConsoleUser;
  warning?: string;
}

export interface CreateConsoleUserRequest {
  username: string;
  displayName?: string;
  password: string;
  role: 'admin' | 'user';
}

export interface UpdateConsoleUserRequest {
  displayName?: string;
  role?: 'admin' | 'user';
  enabled?: boolean;
  newPassword?: string;
}
