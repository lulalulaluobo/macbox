export interface SMBShare {
  id: string;
  name: string;
  path: string;
  comment?: string;
  writable: boolean;
  guestOk: boolean;
  enabled: boolean;
  diskSource?: 'primary' | 'secondary' | 'passthrough' | 'custom' | string;
  address?: string;
}
export interface AvailableTarget {
  name: string;
  path: string;
  source: string;
  description: string;
  exists: boolean;
}

export interface SambaStatus {
  shareName: string;
  path: string;
  address: string;
  user: string;
  port: number;
  status: 'running' | 'stopped' | string;
  hasConflict: boolean;
  message: string;
  shares?: SMBShare[];
  availableTargets?: AvailableTarget[];
}
