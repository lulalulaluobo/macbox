export interface DiskInfo {
  identifier: string;
  deviceNode: string;
  name: string;
  volumeName: string;
  totalSize: number;
  totalSizeString: string;
  usedSpace: number;
  usedSpaceString: string;
  freeSpace: number;
  freeSpaceString: string;
  usedPercent: number;
  mounted: boolean;
  mountPoint: string;
  recommendedTargetDir?: string;
  fileSystem: string;
  isExternal: boolean;
  isSSD: boolean;
  isWholeDisk: boolean;
  isSelected: boolean;
  isSecondary?: boolean;
  secondaryTarget?: string;
}
export interface ManagedDisk {
  name: string;
  size: number;
  actualSize?: number;
  actualSizeString?: string;
  format: string;
  dir: string;
  inUse: boolean;
  instance?: string;
}

export interface LocalMount {
  id: string;
  name: string;
  hostPath: string;
  guestTarget: string;
  writable: boolean;
  enabled: boolean;
  category: 'media' | 'downloads' | 'pictures' | 'custom' | string;
  description?: string;
}

export interface LocalMountCandidate {
  id: string;
  name: string;
  hostPath: string;
  category: string;
  description?: string;
  available: boolean;
  configured: boolean;
  enabled: boolean;
  reason?: string;
}

export interface LocalMountHealth {
  id: string;
  expectedEnabled: boolean;
  hostReady: boolean;
  sourceMounted: boolean;
  targetMounted: boolean;
  healthy: boolean;
  status: string;
  message: string;
  checkedAt: string;
}

export interface LocalMountsResponse {
  mounts: LocalMount[];
  recommended: LocalMount[];
  candidates?: LocalMountCandidate[];
  health?: LocalMountHealth[];
  healthError?: string;
}

export interface FileItem {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  sizeFormatted: string;
  mode: string;
  mtime: number;
  mtimeString: string;
  ext: string;
}

export interface TrashItem {
  id: string;
  name: string;
  originalPath: string;
  trashPath: string;
  isDir: boolean;
  size: number;
  sizeFormatted: string;
  deletedAt: number;
  deletedAtString: string;
}
