import type { DiskInfo } from './storage';

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
  vmAction?: string;    // "starting" | "stopping" | "restarting" | "" (idle)
  configDirty?: boolean; // true when config changed and VM needs restart
  initializationRequired?: boolean;
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

export interface VMConfigInfo {
  cpus: number;
  memory: number;
  diskSize: number;
  hostCpus: number;
  hostMemoryGB: number;
  vmStatus: string;
  isDynamicMemory: boolean;
  balloonDescription: string;
  diskDescription: string;
}

export interface VMPrerequisites {
  limaInstalled: boolean;
  limaPath?: string;
  version?: string;
  ready: boolean;
  message?: string;
  installCommand?: string;
  installHint?: string;
  brewInstalled?: boolean;
  brewPath?: string;
  canInstall?: boolean;
  storageReady?: boolean;
  storageMessage?: string;
}

export interface BackgroundJob {
  id: string;
  kind: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | string;
  stage?: string;
  progress?: number;
  bytesDone?: number;
  bytesTotal?: number;
  speedBytesPerSecond?: number;
  currentFile?: string;
  message?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiagnosticCheck {
  id: string;
  title: string;
  status: 'pass' | 'warn' | 'fail' | string;
  message: string;
  detail?: string;
  repair?: string;
}

export interface SystemDiagnostics {
  ok: boolean;
  checkedAt: string;
  instanceName: string;
  checks: DiagnosticCheck[];
}

export interface SystemUser {
  username: string;
  uid: number;
  gid: number;
  homeDir: string;
  shell: string;
  groups: string[];
  isRoot: boolean;
  isSudo: boolean;
}
