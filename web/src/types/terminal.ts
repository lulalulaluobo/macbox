export interface TerminalPrefill {
  id: number;
  text: string;
  source?: string;
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

export interface AISkillsCandidate {
  name: string;
  hostPath: string;
  description: string;
  available: boolean;
  skillCount: number;
  reason?: string;
}

export interface TerminalSkillsSettings {
  enabled: boolean;
  hostPath: string;
  guestPaths: string[];
  readOnly: boolean;
  status: 'disabled' | 'ready' | 'missing' | 'invalid' | string;
  message: string;
  requiresRestart: boolean;
  candidates: AISkillsCandidate[];
}
