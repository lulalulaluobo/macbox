import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import type { AppInstallStatus } from './hooks/useAppInstallStream';

interface AppInstallProgressProps {
  status: Exclude<AppInstallStatus, 'idle'>;
  logs: string[];
  error: string | null;
  logsEndRef: React.Ref<HTMLDivElement>;
}

export const AppInstallProgress: React.FC<AppInstallProgressProps> = ({ status, logs, error, logsEndRef }) => (
  <div className="space-y-4">
    {status === 'installing' && <div className="flex items-center justify-between rounded-2xl border border-sky-500/30 bg-sky-500/10 p-4 text-xs text-sky-300"><div className="flex items-center space-x-2.5"><RefreshCw className="h-4 w-4 animate-spin text-sky-400" /><span className="font-semibold">正在拉取 Docker 镜像并部署启动，请观察实时控制台...</span></div><span className="font-mono text-[11px] opacity-75">SSE 实时流</span></div>}
    {status === 'error' && <div className="space-y-1 rounded-2xl border border-rose-500/30 bg-rose-500/15 p-4 text-xs text-rose-300"><div className="flex items-center space-x-2 text-sm font-bold"><AlertCircle className="h-5 w-5 text-rose-400" /><span>部署遇到异常:</span></div><p className="font-mono">{error}</p></div>}
    <div className="h-80 space-y-1 overflow-y-auto rounded-2xl border border-slate-800 bg-[#070a10] p-4 font-mono text-xs leading-relaxed text-emerald-400/90 shadow-inner select-text">{logs.map((line, index) => <div key={`${index}-${line}`} className="whitespace-pre-wrap break-all">{line}</div>)}<div ref={logsEndRef} /></div>
  </div>
);
