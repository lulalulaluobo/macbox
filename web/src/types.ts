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

export interface LocalMountsResponse {
  mounts: LocalMount[];
  recommended: LocalMount[];
}

export interface PortMapping {
  hostIp: string;
  hostPort: number;
  containerPort: number;
  protocol: string;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: 'running' | 'exited' | 'created' | string;
  status: string;
  ports: string;
  portsMap?: PortMapping[];
  createdAt: string;
  cpuPerc?: string;
  memUsage?: string;
  memPerc?: string;
  netIo?: string;
  blockIo?: string;
  project?: string;
}

export interface ImageInfo {
  id: string;
  repository: string;
  tag: string;
  size: string;
  sizeBytes: number;
  createdAt: string;
  createdSince: string;
  containers: number;
  inUse: boolean;
}

export interface ComposeProject {
  name: string;
  status: 'running' | 'partially_running' | 'stopped' | string;
  configFiles: string;
  workingDir: string;
  servicesCount: number;
  containers: string[];
  isSystemApp: boolean;
}

export interface DockerOverview {
  healthy: boolean;
  healthMessage: string;
  dockerReady: boolean;
  dockerVersion: string;
  storageLocation: string;
  autoStart: boolean;
  containersTotal: number;
  containersRunning: number;
  containersStopped: number;
  imagesTotal: number;
  imagesInUse: number;
  projectsTotal: number;
  projectsRunning: number;
  cpuPerc: number;
  memUsageMb: number;
  memTotalMb: number;
  memPerc: number;
  netRxKb: number;
  netTxKb: number;
}

export interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
  ipv4: string;
  internal: boolean;
  createdAt: string;
}

export interface AppPort {
  hostPort: number;
  containerPort: number;
  protocol: string;
  description?: string;
}

export interface AppVolume {
  host: string;
  container: string;
  description?: string;
}

export interface AppEnv {
  key: string;
  value: string;
  description?: string;
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
  ports?: AppPort[];
  volumes: AppVolume[];
  env?: AppEnv[];
  status: 'not_installed' | 'running' | 'stopped' | 'error' | string;
  installed: boolean;
  source?: 'builtin' | 'community' | 'custom' | string;
  composeTemplate?: string;
}

export interface InstallCustomConfig {
  portsMap?: Record<string, number>;
  volumesMap?: Record<string, string>;
  envMap?: Record<string, string>;
  customYaml?: string;
}

export interface CustomAppInput {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  port?: number;
  composeYaml: string;
}

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
}

export interface BackgroundJob {
  id: string;
  kind: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | string;
  message?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
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

export interface SSHConfig {
  enabled: boolean;
  status: 'running' | 'stopped';
  port: number;
  sshLocalPort?: number;
  permitRootLogin: boolean;
  passwordAuthentication: boolean;
  pubkeyAuthentication?: boolean;
  authorizedKeyCount?: number;
}

export interface SSHKeyGenerationResult {
  privateKey: string;
  publicKey: string;
  keyType: string;
  fingerprint: string;
  comment: string;
  filename: string;
}

export interface TerminalSettings {
  defaultLoginUser: 'root' | 'default' | string;
  fontSize: number;
  cursorStyle: 'block' | 'underline' | 'bar';
}

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
