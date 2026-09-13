import React from 'react';
import { Folder, FolderSync, Lock, Plus, Trash2, Unlock, X } from 'lucide-react';
import type { LocalMount, LocalMountHealth } from '../../../types';

interface LocalMountSectionProps {
  localMounts: LocalMount[];
  mountHealth: LocalMountHealth[];
  showManager: boolean;
  onOpenManager: () => void;
  onCloseManager: () => void;
  onOpenAdd: () => void;
  onDeleteMount: (id: string, name: string) => void;
  onToggleMountWritable: (id: string, writable: boolean) => void;
  onToggleMount: (id: string) => void;
}

export const LocalMountSection: React.FC<LocalMountSectionProps> = ({
  localMounts,
  mountHealth,
  showManager,
  onOpenManager,
  onCloseManager,
  onOpenAdd,
  onDeleteMount,
  onToggleMountWritable,
  onToggleMount,
}) => (
  <>
    <button
      type="button"
      onClick={onOpenManager}
      className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 text-left dark:border-slate-800 dark:bg-slate-900"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400"><FolderSync className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-slate-900 dark:text-white">本机目录直通</span><span className="mt-0.5 block text-[11px] text-slate-500">{localMounts.length} 个 Mac 目录已映射到 MacBox</span></span>
      <span className="text-xs font-semibold text-sky-600 dark:text-sky-400">管理</span>
    </button>

    {showManager && (
      <div className="fixed inset-0 z-[60] bg-white dark:bg-slate-950 sm:flex sm:items-center sm:justify-center sm:bg-slate-950/55 sm:p-6">
        <section className="flex h-[100dvh] w-full flex-col bg-white dark:bg-slate-950 sm:h-auto sm:max-h-[82dvh] sm:max-w-xl sm:rounded-3xl sm:border sm:border-slate-200 sm:dark:border-slate-800">
          <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-slate-100 px-4 dark:border-slate-800">
            <button type="button" onClick={onCloseManager} className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" aria-label="关闭"><X className="h-5 w-5" /></button>
            <div className="min-w-0 flex-1"><h3 className="text-base font-bold text-slate-900 dark:text-white">本机目录直通</h3><p className="text-[11px] text-slate-500">将 Mac 文件夹映射到 MacBox，不复制或删除原目录</p></div>
            <button type="button" onClick={onOpenAdd} className="flex min-h-10 items-center gap-1.5 rounded-xl bg-sky-500 px-3 text-xs font-bold text-white"><Plus className="h-4 w-4" />添加</button>
          </header>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
            {localMounts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-500 dark:border-slate-800">还没有直通目录</div>
            ) : localMounts.map((mount) => (
              <article key={mount.id} className={`rounded-2xl border p-3 ${mount.enabled ? 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900' : 'border-slate-200 bg-slate-50 opacity-60 dark:border-slate-800 dark:bg-slate-900/50'}`}>
                {(() => {
                  const health = mountHealth.find((item) => item.id === mount.id);
                  const healthClass = health?.healthy ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : health?.status === 'disabled' ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200';
                  return health ? <p className={`mb-2 rounded-xl px-3 py-2 text-[11px] font-semibold ${healthClass}`}>探针：{health.message}</p> : null;
                })()}
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400"><Folder className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1"><h4 className="truncate text-sm font-bold text-slate-900 dark:text-white">{mount.name}</h4><p className="truncate text-[11px] text-slate-500" title={mount.hostPath}>{mount.hostPath}</p></div>
                  <button type="button" onClick={() => onDeleteMount(mount.id, mount.name)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="移除目录"><Trash2 className="h-4 w-4" /></button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div
                    className={`flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-bold ${mount.writable ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200'}`}
                    role="status"
                    aria-label={`当前访问权限：${mount.writable ? '可读写' : '只读'}`}
                  >
                    {mount.writable ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                    <span>当前：{mount.writable ? '可读写' : '只读'}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleMountWritable(mount.id, !mount.writable)}
                    className="min-h-10 rounded-xl bg-slate-100 px-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    title={mount.writable ? '切换为只读保护' : '开启读写权限'}
                  >
                    {mount.writable ? '切换为只读' : '切换为可读写'}
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="min-w-0 truncate" title={`/data/${mount.guestTarget}`}>MacBox 目录：<code className="font-mono">/data/{mount.guestTarget}</code></span>
                  <button type="button" onClick={() => onToggleMount(mount.id)} className={`shrink-0 rounded-lg px-2 py-1 font-semibold ${mount.enabled ? 'text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-500/10' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`} title={mount.enabled ? '停用本机目录直通' : '启用本机目录直通'}>{mount.enabled ? '已启用 · 停用' : '已停用 · 启用'}</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    )}
  </>
);
