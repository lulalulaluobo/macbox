import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface FileManagerAlertsProps {
  alertMsg: { type: 'success' | 'error' | 'warning'; text: string } | null;
  hideSystemFiles: boolean;
  onDismiss: () => void;
}

export const FileManagerAlerts: React.FC<FileManagerAlertsProps> = ({ alertMsg, hideSystemFiles, onDismiss }) => (
  <>
    {alertMsg && (
      <div className={`fixed left-1/2 top-20 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center justify-between gap-3 rounded-full border bg-white/95 px-4 py-2.5 text-xs shadow-xl backdrop-blur dark:bg-slate-900/95 ${
        alertMsg.type === 'success'
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          : alertMsg.type === 'warning'
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
          : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
      }`}>
        <span>{alertMsg.text}</span>
        <button type="button" onClick={onDismiss} className="p-1 hover:text-white"><X className="h-4 w-4" /></button>
      </div>
    )}
    {!hideSystemFiles && (
      <div className="fixed left-1/2 top-20 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-amber-300 bg-white/95 px-4 py-2.5 text-xs text-amber-700 shadow-xl backdrop-blur dark:bg-slate-900/95 dark:text-amber-300">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
        <span>您已开启系统保护目录显示。请注意：<strong className="underline">appdata</strong> 包含各 Docker 容器的 SQLite 数据库与持久化卷，误删可能导致容器损坏！</span>
      </div>
    )}
  </>
);
