export interface SystemStats {
  hostname: string;
  os: string;
  platform: string;
  arch: string;
  uptime: number;
  uptimeString: string;
  cpuPercent: number;
  cpuCores: number;
  memTotal: number;
  memUsed: number;
  memPercent: number;
  ipAddresses: string[];
  primaryIP: string;
  status: string;
  timestamp: string;
}

export interface VMStatus {
  name: string;
  status: 'Running' | 'Stopped' | 'NotCreated' | 'Broken';
  dir: string;
  arch: string;
  cpus: number;
  memory: number;
  disk: number;
  sshLocalPort: number;
  dockerSocket: string;
  dockerReady: boolean;
  errors?: string[];
  updatedAt: string;
}

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
  fileSystem: string;
  isExternal: boolean;
  isSSD: boolean;
  isWholeDisk: boolean;
  isSelected: boolean;
}

export interface ManagedDisk {
  name: string;
  size: number;
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

export interface LocalMountsResponse {
  mounts: LocalMount[];
  recommended: LocalMount[];
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: 'running' | 'exited' | 'created' | string;
  status: string;
  ports: string;
  createdAt: string;
}

export interface AppMetadata {
  id: string;
  name: string;
  description: string;
  version: string;
  icon: string;
  category: string;
  port: number;
  webUrl: string;
  volumes: { host: string; container: string }[];
  status: 'not_installed' | 'running' | 'stopped' | 'error';
  installed: boolean;
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
}

export interface PowerStatus {
  preventSleep: boolean;
  active: boolean;
  assertions: string[];
  displayCanOff: boolean;
  description: string;
}

export interface ServiceStatus {
  installed: boolean;
  running: boolean;
  label: string;
  plistPath: string;
  logPath: string;
  binaryPath: string;
  workingDir: string;
}

export interface SystemOverview {
  system: SystemStats;
  power?: PowerStatus;
  service?: ServiceStatus;
  vm: VMStatus;
  docker: {
    ready: boolean;
    total: number;
    runningCount: number;
  };
  storage: {
    selectedDisk?: DiskInfo;
    diskCount: number;
    isExternalActive?: boolean;
    dataPath?: string;
    mountPoint?: string;
  };
  timestamp: string;
}
