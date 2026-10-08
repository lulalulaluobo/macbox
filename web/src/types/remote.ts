export interface TailscaleStatus {
  installed: boolean;
  state: 'notInstalled' | 'vmStopped' | 'needsLogin' | 'needsApproval' | 'connecting' | 'connected' | 'paused' | 'expired' | 'unavailable';
  message: string;
  version?: string;
  deviceName?: string;
  networkName?: string;
  dnsName?: string;
  ip?: string;
  authURL?: string;
  consoleURL?: string;
  consoleReady: boolean;
  keyExpiry?: string;
  health?: string[];
  busy: boolean;
}

export type RemoteAction = 'install' | 'connect' | 'pause' | 'logout';
