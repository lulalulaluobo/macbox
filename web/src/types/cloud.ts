export interface CloudMount {
  id: string;
  provider: 'quark' | string;
  name: string;
  rootFid: string;
  account?: string;
  status: string;
  message?: string;
  lastChecked?: string;
}
export interface CloudFile {
  fid: string;
  name: string;
  isDir: boolean;
  size: number;
  updatedAt: number;
}
