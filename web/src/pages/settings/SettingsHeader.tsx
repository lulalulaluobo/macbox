import React from 'react';
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';

export type SettingsAlertMessage = { type: 'success' | 'error'; text: string };

interface SettingsHeaderProps {
  loading: boolean;
  onRefresh: () => void;
}

export const SettingsHeader: React.FC<SettingsHeaderProps> = ({ loading, onRefresh }) => (
  <div className="flex items-center justify-between gap-3">
    <div className="min-w-0">
      <h2 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-2xl">设置</h2>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">账户、安全与系统偏好</p>
    </div>

    <button
      onClick={onRefresh}
      aria-label="刷新设置状态"
      className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
    >
      <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
      <span className="hidden sm:inline">刷新</span>
    </button>
  </div>
);

interface SettingsAlertProps {
  alert: SettingsAlertMessage;
  onDismiss: () => void;
}

export const SettingsAlert: React.FC<SettingsAlertProps> = ({ alert, onDismiss }) => (
  <div
    className={`p-4 rounded-2xl text-xs flex items-center justify-between transition-all ${
      alert.type === 'success'
        ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
        : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
    }`}
  >
    <div className="flex items-center space-x-2.5">
      {alert.type === 'success' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
      <span>{alert.text}</span>
    </div>
    <button onClick={onDismiss} className="text-xs opacity-70 hover:opacity-100 ml-4 font-bold">
      ✕
    </button>
  </div>
);
