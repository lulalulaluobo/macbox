import React from 'react';
import {
  ArrowLeft, Search, Grid, List, FolderPlus, Upload, RefreshCw, Copy, Scissors, Clipboard, X
} from 'lucide-react';
import { ClipboardState } from './types';

interface FileToolbarProps {
  currentPath: string;
  pathParts: string[];
  searchQuery: string;
  sortBy: 'name' | 'size' | 'mtime';
  sortOrder: 'asc' | 'desc';
  viewMode: 'grid' | 'list';
  loading: boolean;
  uploading: boolean;
  uploadProgress: string;
  clipboard: ClipboardState | null;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onNavigateToPart: (index: number) => void;
  onGoUp: () => void;
  onGoHome: () => void;
  onSearchChange: (query: string) => void;
  onSortChange: (sortBy: 'name' | 'size' | 'mtime', sortOrder: 'asc' | 'desc') => void;
  onViewModeChange: (mode: 'grid' | 'list') => void;
  onOpenMkdir: () => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRefresh: () => void;
  onPaste: () => void;
  onClearClipboard: () => void;
}

export const FileToolbar: React.FC<FileToolbarProps> = ({
  currentPath,
  pathParts,
  searchQuery,
  sortBy,
  sortOrder,
  viewMode,
  loading,
  uploading,
  uploadProgress,
  clipboard,
  fileInputRef,
  onNavigateToPart,
  onGoUp,
  onGoHome,
  onSearchChange,
  onSortChange,
  onViewModeChange,
  onOpenMkdir,
  onFileChange,
  onRefresh,
  onPaste,
  onClearClipboard,
}) => {
  return (
    <div className="space-y-3">
      {/* Action Toolbar */}
      <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Breadcrumbs & Navigation */}
        <div className="flex items-center space-x-2 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          <button
            onClick={onGoUp}
            disabled={currentPath === '/' || currentPath === '/data'}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 disabled:opacity-30 disabled:pointer-events-none transition"
            title="返回上一级"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <button
            onClick={onGoHome}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              currentPath === '/data' ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:text-white'
            }`}
          >
            NAS 数据
          </button>

          {pathParts.map((part, index) => {
            const isLast = index === pathParts.length - 1;
            return (
              <div key={index} className="flex items-center space-x-1 shrink-0">
                <span className="text-slate-600 text-xs">/</span>
                <button
                  onClick={() => onNavigateToPart(index)}
                  className={`px-2 py-1 rounded-lg text-xs font-mono transition ${
                    isLast
                      ? 'font-bold text-sky-400 bg-sky-500/10'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                  }`}
                >
                  {part}
                </button>
              </div>
            );
          })}
        </div>

        {/* Right Toolbar Controls */}
        <div className="flex items-center space-x-2 shrink-0">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="搜索文件..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-36 md:w-44 pl-8 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500 transition"
            />
          </div>

          {/* Sort Order */}
          <select
            value={`${sortBy}-${sortOrder}`}
            onChange={(e) => {
              const [by, order] = e.target.value.split('-') as ['name' | 'size' | 'mtime', 'asc' | 'desc'];
              onSortChange(by, order);
            }}
            className="px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-sky-500 transition"
          >
            <option value="name-asc">按名称 (A-Z)</option>
            <option value="name-desc">按名称 (Z-A)</option>
            <option value="size-desc">按大小 (大到小)</option>
            <option value="mtime-desc">按时间 (最新)</option>
          </select>

          {/* View Mode Toggle */}
          <div className="flex items-center bg-slate-950 p-0.5 rounded-xl border border-slate-800">
            <button
              onClick={() => onViewModeChange('grid')}
              className={`p-1.5 rounded-lg transition ${viewMode === 'grid' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'}`}
              title="网格视图"
            >
              <Grid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onViewModeChange('list')}
              className={`p-1.5 rounded-lg transition ${viewMode === 'list' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'}`}
              title="列表视图"
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* New Folder */}
          <button
            onClick={onOpenMkdir}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center space-x-1.5 transition"
          >
            <FolderPlus className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">新建</span>
          </button>

          {/* Upload File */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-lg shadow-sky-600/20 transition disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{uploading ? '上传中...' : '上传'}</span>
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={onFileChange}
            multiple
            className="hidden"
          />

          {/* Refresh */}
          <button
            onClick={onRefresh}
            className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition"
            title="刷新"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Upload Progress Bar */}
      {uploading && (
        <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-300 text-xs flex items-center justify-between animate-pulse">
          <div className="flex items-center space-x-2">
            <Upload className="w-4 h-4 animate-bounce" />
            <span>{uploadProgress || '正在上传文件，请稍候...'}</span>
          </div>
        </div>
      )}

      {/* Clipboard Paste Banner */}
      {clipboard && (
        <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg animate-in fade-in">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-300 shrink-0">
              {clipboard.action === 'copy' ? <Copy className="w-4 h-4" /> : <Scissors className="w-4 h-4" />}
            </div>
            <div>
              <span className="font-bold text-white text-xs">
                剪贴板：已{clipboard.action === 'copy' ? '复制' : '剪切'} {clipboard.items.length} 个项目
              </span>
              <p className="text-[11px] text-slate-400 mt-0.5">
                当前目标目录：<code className="text-amber-300 font-mono">{currentPath}</code>，点击右侧按钮即可粘贴放入。
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2 self-end sm:self-center shrink-0">
            <button
              onClick={onPaste}
              className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center space-x-1.5 shadow-md shadow-amber-500/20 transition"
            >
              <Clipboard className="w-3.5 h-3.5" />
              <span>粘贴到当前目录</span>
            </button>
            <button
              onClick={onClearClipboard}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="清除剪贴板"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
