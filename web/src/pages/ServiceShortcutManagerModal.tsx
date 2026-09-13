import React from 'react';
import { ArrowDown, ArrowUp, Box, Pencil, Settings2, Trash2, X } from 'lucide-react';
import type { ServiceShortcut } from '../types';
import { DockerServiceIcon } from '../components/DockerServiceIcon';

interface ServiceShortcutManagerModalProps {
  shortcuts: ServiceShortcut[];
  onClose: () => void;
  onEdit: (shortcut: ServiceShortcut) => void;
  onDelete: (id: string) => void | Promise<void>;
  onMove: (id: string, direction: -1 | 1) => void | Promise<void>;
}

export const ServiceShortcutManagerModal: React.FC<ServiceShortcutManagerModalProps> = ({ shortcuts, onClose, onEdit, onDelete, onMove }) => {
  const handleDelete = (shortcut: ServiceShortcut) => {
    if (window.confirm(`确定从主页删除“${shortcut.name}”吗？\n\n只会删除导航入口，不会删除实际服务。`)) {
      void onDelete(shortcut.id);
    }
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="service-manager-title">
      <div className="flex max-h-[min(720px,90dvh)] w-full max-w-xl flex-col rounded-t-[28px] border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:rounded-[28px] sm:p-6">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-500 dark:bg-sky-500/10 dark:text-sky-300"><Settings2 className="h-5 w-5" /></span>
            <div className="min-w-0">
              <h3 id="service-manager-title" className="text-base font-black text-slate-900 dark:text-white">管理服务导航</h3>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">手动服务可编辑或删除，Docker 服务仍由容器页面管理。</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700" aria-label="关闭"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-4 min-h-0 space-y-2 overflow-y-auto pr-1">
          {shortcuts.length === 0 ? (
            <div className="flex min-h-28 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">还没有服务导航</div>
          ) : shortcuts.map((shortcut, index) => {
            const isManual = shortcut.source === 'manual';
            return (
              <div key={shortcut.id} className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                <div className="flex shrink-0 flex-col gap-1">
                  <button type="button" onClick={() => void onMove(shortcut.id, -1)} disabled={index === 0} className="flex h-6 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white hover:text-sky-500 disabled:opacity-25 dark:hover:bg-slate-800" aria-label={`将 ${shortcut.name} 上移`}><ArrowUp className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => void onMove(shortcut.id, 1)} disabled={index === shortcuts.length - 1} className="flex h-6 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white hover:text-sky-500 disabled:opacity-25 dark:hover:bg-slate-800" aria-label={`将 ${shortcut.name} 下移`}><ArrowDown className="h-3.5 w-3.5" /></button>
                </div>
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isManual ? 'bg-white text-sky-500 dark:bg-slate-800 dark:text-sky-300' : 'bg-sky-50 text-sky-500 dark:bg-sky-500/10 dark:text-sky-300'}`}><DockerServiceIcon name={shortcut.icon} className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><p className="truncate text-xs font-bold text-slate-800 dark:text-slate-100">{shortcut.name}</p><span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${isManual ? 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300' : 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300'}`}>{isManual ? '手动服务' : 'Docker'}</span></div>
                  <p className="mt-1 truncate font-mono text-[10px] text-slate-500 dark:text-slate-400" title={shortcut.url}>{shortcut.url}</p>
                </div>
                {isManual ? (
                  <div className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => onEdit(shortcut)} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-white hover:text-sky-600 dark:hover:bg-slate-800 dark:hover:text-sky-300" aria-label={`编辑 ${shortcut.name}`}><Pencil className="h-4 w-4" /></button>
                    <button type="button" onClick={() => handleDelete(shortcut)} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-300" aria-label={`删除 ${shortcut.name}`}><Trash2 className="h-4 w-4" /></button>
                  </div>
                ) : <Box className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" aria-label="Docker 服务" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
