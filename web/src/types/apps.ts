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
