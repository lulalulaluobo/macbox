import React, { useState } from 'react';
import { ArrowLeft, CheckSquare, FolderPlus, Grid, List, Plus, RefreshCw, Search, SlidersHorizontal, Upload, X } from 'lucide-react';

interface FileToolbarProps {
  currentPath: string;
  searchQuery: string;
  sortBy: 'name' | 'size' | 'mtime';
  sortOrder: 'asc' | 'desc';
  viewMode: 'grid' | 'list';
  selectionMode: boolean;
  selectedCount: number;
  totalCount: number;
  loading: boolean;
  uploading: boolean;
  uploadProgress: string;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onGoUp: () => void;
  onSearchChange: (query: string) => void;
  onSortChange: (sortBy: 'name' | 'size' | 'mtime', sortOrder: 'asc' | 'desc') => void;
  onViewModeChange: (mode: 'grid' | 'list') => void;
  onToggleSelectionMode: () => void;
  onSelectAll: () => void;
  onOpenMkdir: () => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRefresh: () => void;
}

const sortOptions = [
  { label: '名称 A–Z', by: 'name', order: 'asc' },
  { label: '名称 Z–A', by: 'name', order: 'desc' },
  { label: '最近修改', by: 'mtime', order: 'desc' },
  { label: '文件大小', by: 'size', order: 'desc' },
] as const;

export const FileToolbar: React.FC<FileToolbarProps> = ({
  currentPath, searchQuery, sortBy, sortOrder, viewMode, selectionMode, selectedCount, totalCount,
  loading, uploading, uploadProgress, fileInputRef, onGoUp,
  onSearchChange, onSortChange, onViewModeChange, onToggleSelectionMode, onSelectAll, onOpenMkdir,
  onFileChange, onRefresh,
}) => {
  const [showFilters, setShowFilters] = useState(false);

  return (
    <div className="shrink-0 space-y-2">
      <section className="rounded-[20px] border border-slate-200/80 bg-white p-2 dark:border-slate-800/80 dark:bg-slate-900/80">
        {selectionMode ? (
          <div className="flex min-h-11 items-center justify-between gap-3 px-1">
            <button type="button" onClick={onToggleSelectionMode} className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 dark:text-slate-300" aria-label="退出选择"><X className="h-5 w-5" /></button>
            <div className="min-w-0 text-center">
              <p className="text-sm font-bold text-slate-900 dark:text-white">选择文件</p>
              <p className="text-[10px] text-slate-400">已选择 {selectedCount} 项</p>
            </div>
            <button type="button" onClick={onSelectAll} className="min-h-10 px-2 text-xs font-bold text-sky-600 dark:text-sky-400">{selectedCount === totalCount && totalCount > 0 ? '取消全选' : '全选'}</button>
          </div>
        ) : (
          <>
            <div className="flex min-h-11 items-center gap-1.5">
              <button onClick={onGoUp} disabled={currentPath === '/' || currentPath === '/data'} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-600 disabled:pointer-events-none disabled:opacity-30 dark:bg-slate-800 dark:text-slate-300" title="返回上一级"><ArrowLeft className="h-4 w-4" /></button>
              <button type="button" onClick={() => setShowFilters(true)} className="min-w-0 flex-1 truncate px-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">{sortOptions.find((item) => item.by === sortBy && item.order === sortOrder)?.label || '排序'}</button>
              <button type="button" onClick={() => setShowFilters((open) => !open)} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${showFilters || searchQuery ? 'bg-sky-500 text-white' : 'bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-300'}`} aria-label="搜索和筛选"><SlidersHorizontal className="h-4 w-4" /></button>
              <button onClick={() => onViewModeChange(viewMode === 'grid' ? 'list' : 'grid')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-300" title={viewMode === 'grid' ? '切换列表视图' : '切换网格视图'}>{viewMode === 'grid' ? <List className="h-4 w-4" /> : <Grid className="h-4 w-4" />}</button>
              <button type="button" onClick={onToggleSelectionMode} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-300" aria-label="选择文件"><CheckSquare className="h-4 w-4" /></button>
              <div className="hidden items-center gap-1 md:flex">
                <button onClick={onRefresh} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500" title="刷新"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
                <button onClick={onOpenMkdir} className="hidden h-9 items-center gap-1 rounded-lg px-2 text-xs text-slate-600 md:flex dark:text-slate-300"><FolderPlus className="h-4 w-4" />新建</button>
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="hidden h-9 items-center gap-1 rounded-lg px-2 text-xs text-slate-600 disabled:opacity-50 md:flex dark:text-slate-300"><Upload className="h-4 w-4" />上传</button>
              </div>
            </div>

            {showFilters && (
              <div className="mt-2 space-y-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input autoFocus type="search" placeholder="搜索名称或后缀，如 .mp4" value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs text-slate-800 focus:border-sky-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200" />
                </div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {sortOptions.map((option) => <button key={option.label} type="button" onClick={() => { onSortChange(option.by, option.order); setShowFilters(false); }} className={`min-h-10 rounded-xl px-2 text-xs font-semibold ${sortBy === option.by && sortOrder === option.order ? 'bg-sky-500 text-white' : 'bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{option.label}</button>)}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <input type="file" ref={fileInputRef} onChange={onFileChange} multiple className="hidden" />

      {uploading && <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 p-3 text-xs text-sky-600 dark:text-sky-300"><span>{uploadProgress || '正在上传文件…'}</span></div>}

      {!selectionMode && (
        <details className="fixed bottom-[calc(92px+env(safe-area-inset-bottom))] right-4 z-30 md:hidden">
          <summary className="flex h-14 w-14 cursor-pointer list-none items-center justify-center rounded-full bg-sky-500 text-white" aria-label="新建或上传"><Plus className="h-7 w-7" /></summary>
          <div className="absolute bottom-16 right-0 w-40 space-y-1 rounded-2xl border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
            <button type="button" onClick={onOpenMkdir} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-xs font-bold text-slate-700 dark:text-slate-200"><FolderPlus className="h-4 w-4 text-sky-500" />新建文件夹</button>
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-xs font-bold text-slate-700 disabled:opacity-50 dark:text-slate-200"><Upload className="h-4 w-4 text-[#ff7d9a]" />上传文件</button>
          </div>
        </details>
      )}
    </div>
  );
};
