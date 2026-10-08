export interface NetworkStatus { mode: string; interface: string; ip: string; ready: boolean; installed: boolean; message: string }
export interface VersionInfo { version: string; commit: string; builtAt: string; arch: string; managed: boolean; message: string }
export interface ReleaseInfo { version: string; notes: string; url: string; publishedAt: string; available: boolean; asset: string }
export interface UpdateState { id: string; version: string; previousVersion: string; status: string; stage: string; message: string; error?: string; updatedAt: string; canRollback: boolean }
