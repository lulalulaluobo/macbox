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

export interface ServiceShortcut {
  id: string;
  source: 'docker' | 'manual';
  containerId?: string;
  containerName?: string;
  name: string;
  url: string;
  icon: string;
  description?: string;
  enabled: boolean;
}

export interface DockerServiceShortcut extends ServiceShortcut {
  source: 'docker';
  containerName: string;
  containerId?: string;
}

export type ServiceShortcutInput = Omit<ServiceShortcut, 'id'> & { id?: string };

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
