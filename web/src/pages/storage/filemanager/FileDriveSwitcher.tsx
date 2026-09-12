import React from 'react';
import { Cloud, HardDrive, MoreHorizontal, Pencil, ShieldCheck, Star, Trash2 } from 'lucide-react';
import type { CloudMount, LocalMount } from '../../../types';
import type { StorageDriveOption } from './useStorageDriveOptions';

interface FileDriveSwitcherProps {
  selectionMode: boolean;
  currentPath: string;
  driveOptions: StorageDriveOption[];
  activeDriveId?: string;
  activeCloudMountId?: string | null;
  diskNames: Record<string, string>;
  cloudMounts: CloudMount[];
  favorites: string[];
  localMounts: LocalMount[];
  secondaryPaths: string[];
  trashCount: number;
  viewingTrash: boolean;
  viewingFavorites: boolean;
  hideSystemFiles: boolean;
  onSelectDrive: (path: string) => void;
  onSelectCloudMount: (id: string) => void;
  onSelectFavorite: (path: string) => void;
  onOpenDriveDetail: (id: string) => void;
  onOpenFavorites: () => void;
  onOpenTrash: () => void;
  onOpenCloudMount: () => void;
  onSelectLocalMount: (path: string) => void;
  onToggleSystemFiles: () => void;
}

const toGuestPath = (target: string) => {
  const value = target.trim();
  return value.startsWith('/') ? value : `/data/${value}`;
};

export const FileDriveSwitcher: React.FC<FileDriveSwitcherProps> = ({
  selectionMode,
  currentPath,
  driveOptions,
  activeDriveId,
  activeCloudMountId,
  diskNames,
  cloudMounts,
  favorites,
  localMounts,
  secondaryPaths,
  trashCount,
  viewingTrash,
  viewingFavorites,
  hideSystemFiles,
  onSelectDrive,
  onSelectCloudMount,
  onSelectFavorite,
  onOpenDriveDetail,
  onOpenFavorites,
  onOpenTrash,
  onOpenCloudMount,
  onSelectLocalMount,
  onToggleSystemFiles,
}) => (
  <section className={`${selectionMode ? 'hidden' : 'flex'} relative shrink-0 items-stretch gap-2 rounded-[22px] border border-slate-200/80 bg-white p-2 dark:border-slate-800 dark:bg-slate-900/80`}>
    <div className="mobile-chip-row flex min-w-0 flex-1 gap-2 overflow-x-auto">
      {driveOptions.map((drive) => {
        const name = diskNames[drive.id] || drive.defaultName;
        const active = !viewingTrash && !viewingFavorites && activeDriveId === drive.id;
        return <div key={drive.id} className={`flex min-w-[128px] shrink-0 items-center rounded-2xl border px-2 transition sm:min-w-[150px] ${active ? 'border-sky-200 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/15' : 'border-transparent bg-slate-50 dark:bg-slate-800/50'}`}><button type="button" onClick={() => onSelectDrive(drive.path)} className="flex min-h-12 min-w-0 flex-1 items-center gap-2 text-left"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${active ? 'bg-white text-sky-500 dark:bg-slate-800' : 'bg-white text-slate-400 dark:bg-slate-800'}`}><HardDrive className="h-4 w-4" /></span><span className={`truncate text-xs font-bold ${active ? 'text-sky-700 dark:text-sky-300' : 'text-slate-700 dark:text-slate-200'}`}>{name}</span></button><button type="button" onClick={() => onOpenDriveDetail(drive.id)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-sky-500 dark:hover:bg-slate-800" aria-label={`查看${name}详情`}><Pencil className="h-3.5 w-3.5" /></button></div>;
      })}
      {cloudMounts.map((mount) => { const active = !viewingTrash && !viewingFavorites && activeCloudMountId === mount.id; return <button key={mount.id} type="button" onClick={() => onSelectCloudMount(mount.id)} className={`flex min-h-12 min-w-[150px] shrink-0 items-center gap-2 rounded-2xl border px-3 text-left transition ${active ? 'border-sky-200 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/15' : 'border-transparent bg-slate-50 dark:bg-slate-800/50'}`}><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${active ? 'bg-white text-sky-500 dark:bg-slate-800' : 'bg-white text-slate-400 dark:bg-slate-800'}`}><Cloud className="h-4 w-4" /></span><span className={`truncate text-xs font-bold ${active ? 'text-sky-700 dark:text-sky-300' : 'text-slate-700 dark:text-slate-200'}`}>{mount.name}</span></button>; })}
      {favorites.map((path) => { const name = path.split('/').filter(Boolean).pop() || path; const active = !viewingTrash && !viewingFavorites && (currentPath === path || currentPath.startsWith(`${path}/`)); return <button key={path} type="button" onClick={() => onSelectFavorite(path)} className={`flex min-h-12 min-w-[140px] shrink-0 items-center gap-2 rounded-2xl border px-3 text-left transition ${active ? 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10' : 'border-transparent bg-slate-50 dark:bg-slate-800/50'}`} title={path}><Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-400" /><span className={`truncate text-xs font-bold ${active ? 'text-amber-700 dark:text-amber-300' : 'text-slate-700 dark:text-slate-200'}`}>{name}</span></button>; })}
    </div>
    <details className="group relative shrink-0">
      <summary className="flex h-full min-h-12 w-12 cursor-pointer list-none flex-col items-center justify-center rounded-2xl bg-slate-50 text-[9px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-300"><MoreHorizontal className="h-5 w-5" /><span className="mt-0.5">更多</span></summary>
      <div className="absolute right-0 top-[calc(100%+8px)] z-40 max-h-[min(360px,55dvh)] w-[min(300px,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <button type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); onOpenFavorites(); }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-xs text-slate-700 hover:bg-amber-50 hover:text-amber-700 dark:text-slate-200 dark:hover:bg-amber-500/10"><Star className="h-4 w-4 fill-amber-400 text-amber-400" /><span className="flex-1">收藏</span><span className="text-[10px] text-slate-400">{favorites.length}</span></button>
        <button type="button" onClick={onOpenTrash} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-xs text-slate-700 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-200 dark:hover:bg-rose-500/10"><Trash2 className="h-4 w-4 text-rose-500" /><span className="flex-1">回收站</span><span className="text-[10px] text-slate-400">{trashCount}</span></button>
        <button type="button" onClick={onOpenCloudMount} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-xs text-slate-700 hover:bg-sky-50 hover:text-sky-700 dark:text-slate-200 dark:hover:bg-sky-500/10"><Cloud className="h-4 w-4 text-sky-500" /><span className="flex-1">挂载云盘</span><span className="text-[10px] text-slate-400">夸克</span></button>
        {localMounts.filter((mount) => mount.enabled && !secondaryPaths.includes(toGuestPath(mount.guestTarget))).map((mount) => <button key={mount.id} type="button" onClick={() => onSelectLocalMount(toGuestPath(mount.guestTarget))} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"><HardDrive className="h-4 w-4 text-cyan-500" /><span className="truncate">{mount.name}</span></button>)}
        <button type="button" onClick={onToggleSystemFiles} className="mt-1 flex min-h-11 w-full items-center gap-3 border-t border-slate-100 px-3 pt-1 text-left text-xs text-slate-700 dark:border-slate-800 dark:text-slate-200"><ShieldCheck className={`h-4 w-4 ${hideSystemFiles ? 'text-emerald-500' : 'text-amber-500'}`} /><span className="flex-1">系统目录</span><span className="text-[10px] text-slate-400">{hideSystemFiles ? '隐藏' : '显示'}</span></button>
      </div>
    </details>
  </section>
);
