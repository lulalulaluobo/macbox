import React from 'react';
import { ChevronRight, Trash2, Star, X, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { LocalMount } from '../../../types';
import { CategoryItem } from './types';

function HardDriveIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="12" x2="2" y2="12"></line>
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path>
      <line x1="6" y1="16" x2="6.01" y2="16"></line>
      <line x1="10" y1="16" x2="10.01" y2="16"></line>
    </svg>
  );
}

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
  return (
    <div className="w-full lg:w-64 shrink-0 space-y-4">
      <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800/80 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800/60">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">快速分类导航</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 font-semibold">飞牛风</span>
        </div>

        <nav className="space-y-1">
          {categories.map((cat) => {
            const active = !viewingTrash && currentPath === cat.path;
            const Icon = cat.icon;
            return (
              <button
                key={cat.path}
                onClick={() => onSelectCategory(cat.path)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition ${
                  active
                    ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30 font-semibold'
                    : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                }`}
              >
                <div className="flex items-center space-x-2.5 truncate">
                  <Icon className={`w-4 h-4 ${cat.color} shrink-0`} />
                  <span className="truncate">{cat.name}</span>
                </div>
                {active && <ChevronRight className="w-3.5 h-3.5 text-sky-400 shrink-0" />}
              </button>
            );
          })}

          {/* Trash Bin Nav Item */}
          <button
            onClick={onOpenTrash}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition ${
              viewingTrash
                ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30 font-semibold'
                : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
            }`}
          >
            <div className="flex items-center space-x-2.5 truncate">
              <Trash2 className="w-4 h-4 text-rose-400 shrink-0" />
              <span className="truncate">回收站</span>
            </div>
            {trashCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-500/20 text-rose-300 font-mono font-bold">
                {trashCount}
              </span>
            )}
          </button>
        </nav>

        {/* Favorites (Starred) Section */}
        <div className="pt-2 border-t border-slate-800/60">
          <div className="flex items-center justify-between pb-1.5 px-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">我的收藏</span>
            <span className="text-[10px] text-amber-400 font-mono">{favorites.length} 项</span>
          </div>
          {favorites.length === 0 ? (
            <p className="text-[11px] text-slate-500 italic px-2 py-1">点击文件或目录的 ⭐ 即可添加收藏</p>
          ) : (
            <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
              {favorites.map((favPath) => {
                const favBase = favPath.split('/').pop() || favPath;
                return (
                  <div
                    key={favPath}
                    className="group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs hover:bg-slate-800/60 text-slate-300 hover:text-white transition cursor-pointer"
                    onClick={() => onSelectFavorite(favPath)}
                  >
                    <div className="flex items-center space-x-2 truncate" title={favPath}>
                      <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />
                      <span className="truncate">{favBase}</span>
                    </div>
                    <button
                      onClick={(e) => onToggleFavorite(favPath, e)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-500 hover:text-rose-400"
                      title="取消收藏"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Mac Local VirtioFS Mounts Section */}
        {localMounts.filter((m) => m.enabled).length > 0 && (
          <div className="pt-2 border-t border-slate-800/60">
            <div className="flex items-center justify-between pb-1.5 px-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Mac 本地直通目录</span>
              <span className="text-[10px] text-cyan-400 font-mono">VirtioFS</span>
            </div>
            <div className="space-y-1">
              {localMounts.filter((m) => m.enabled).map((m) => {
                const targetPath = `/data/${m.guestTarget}`;
                const active = !viewingTrash && (currentPath === targetPath || currentPath.startsWith(targetPath + '/'));
                return (
                  <button
                    key={m.id}
                    onClick={() => onSelectMount(targetPath)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition ${
                      active
                        ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-semibold'
                        : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <HardDriveIcon className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span className="truncate">{m.name}</span>
                    </div>
                    <div className="flex items-center space-x-1 shrink-0">
                      <span className={`text-[9px] px-1 py-0.2 rounded font-mono ${
                        m.writable ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {m.writable ? '读写' : '只读'}
                      </span>
                      {active && <ChevronRight className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Protection Info Card */}
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-2.5">
        <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>系统安全防线</span>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          默认隐藏 <code className="text-amber-300 font-mono text-[10px]">lost+found</code> 与 <code className="text-amber-300 font-mono text-[10px]">appdata</code> 核心容器运行目录，防止小白误删。
        </p>
        <button
          onClick={onToggleHideSystemFiles}
          className={`w-full py-2 px-3 rounded-xl text-xs font-medium border flex items-center justify-center space-x-1.5 transition ${
            hideSystemFiles
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
              : 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
          }`}
        >
          {hideSystemFiles ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          <span>{hideSystemFiles ? '系统目录已隐藏 (保护中)' : '已显示系统目录 (警告)'}</span>
        </button>
      </div>
    </div>
  );
};
