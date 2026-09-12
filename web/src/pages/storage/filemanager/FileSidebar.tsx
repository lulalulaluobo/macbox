import React from 'react';
import { ChevronRight, HardDrive, MoreHorizontal, ShieldCheck, Star, Trash2, X } from 'lucide-react';
import { LocalMount } from '../../../types';
import { CategoryItem } from './types';

interface FileSidebarProps {
  categories: CategoryItem[];
  currentPath: string;
  viewingTrash: boolean;
  trashCount: number;
  favorites: string[];
  localMounts: LocalMount[];
  hideSystemFiles: boolean;
  onSelectCategory: (path: string) => void;
  onOpenTrash: () => void;
  onSelectFavorite: (path: string) => void;
  onToggleFavorite: (path: string, e: React.MouseEvent) => void;
  onSelectMount: (path: string) => void;
  onToggleHideSystemFiles: () => void;
}

export const FileSidebar: React.FC<FileSidebarProps> = ({
  categories,
  currentPath,
  viewingTrash,
  trashCount,
  favorites,
  localMounts,
  hideSystemFiles,
  onSelectCategory,
  onOpenTrash,
  onSelectFavorite,
  onToggleFavorite,
  onSelectMount,
  onToggleHideSystemFiles,
}) => {
  const enabledMounts = localMounts.filter((mount) => mount.enabled);

  return (
    <section className="relative shrink-0 rounded-[22px] border border-slate-200/80 bg-white p-2 shadow-xs dark:border-slate-800 dark:bg-slate-900/80">
      <nav className="grid grid-cols-5 gap-1" aria-label="文件分类">
        {categories.map((category) => {
          const active = !viewingTrash && currentPath === category.path;
          const Icon = category.icon;
          return (
            <button key={category.path} type="button" onClick={() => onSelectCategory(category.path)} className={`flex min-w-0 flex-col items-center justify-center rounded-2xl py-2 text-[10px] font-bold transition sm:text-xs ${active ? 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300' : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'}`}>
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/70 dark:bg-slate-800/70"><Icon className={`h-4.5 w-4.5 ${category.color}`} /></span>
              <span className="mt-1 truncate">{category.name.replace('文件', '') || '全部'}</span>
            </button>
          );
        })}

        <details className="group relative">
          <summary className={`flex h-full min-w-0 cursor-pointer list-none flex-col items-center justify-center rounded-2xl py-2 text-[10px] font-bold transition sm:text-xs ${viewingTrash ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'}`}>
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-50 dark:bg-slate-800"><MoreHorizontal className="h-5 w-5" /></span>
            <span className="mt-1">更多</span>
          </summary>

          <div className="absolute right-0 top-[calc(100%+8px)] z-40 max-h-[min(360px,55dvh)] w-[min(310px,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <button type="button" onClick={onOpenTrash} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-xs font-semibold text-slate-700 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-200 dark:hover:bg-rose-500/10">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-500 dark:bg-rose-500/10"><Trash2 className="h-4 w-4" /></span>
              <span className="flex-1">回收站</span><span className="text-[10px] text-slate-400">{trashCount} 项</span>
            </button>

            {enabledMounts.length > 0 && <p className="px-3 pb-1 pt-3 text-[9px] font-black uppercase tracking-wider text-slate-400">本机目录直通</p>}
            {enabledMounts.map((mount) => {
              const path = `/data/${mount.guestTarget}`;
              return (
                <button key={mount.id} type="button" onClick={() => onSelectMount(path)} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
                  <HardDrive className="h-4 w-4 shrink-0 text-cyan-500" /><span className="min-w-0 flex-1 truncate">{mount.name}</span><ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                </button>
              );
            })}

            {favorites.length > 0 && <p className="px-3 pb-1 pt-3 text-[9px] font-black uppercase tracking-wider text-slate-400">收藏</p>}
            {favorites.map((path) => (
              <div key={path} className="group/fav flex min-h-11 items-center rounded-xl px-3 hover:bg-slate-50 dark:hover:bg-slate-800">
                <button type="button" onClick={() => onSelectFavorite(path)} className="flex min-w-0 flex-1 items-center gap-3 text-left text-xs text-slate-700 dark:text-slate-200"><Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-400" /><span className="truncate">{path.split('/').pop() || path}</span></button>
                <button type="button" onClick={(event) => onToggleFavorite(path, event)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-rose-500" aria-label="取消收藏"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}

            <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800">
              <button type="button" onClick={onToggleHideSystemFiles} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
                <ShieldCheck className={`h-4 w-4 ${hideSystemFiles ? 'text-emerald-500' : 'text-amber-500'}`} /><span className="flex-1">系统目录</span><span className="text-[10px] text-slate-400">{hideSystemFiles ? '已隐藏' : '已显示'}</span>
              </button>
            </div>
          </div>
        </details>
      </nav>
    </section>
  );
};
