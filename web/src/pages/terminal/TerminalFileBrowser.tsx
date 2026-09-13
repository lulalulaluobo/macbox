import React from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  CornerDownRight,
  Download,
  Edit3,
  Eye,
  EyeOff,
  Folder,
  FolderPlus,
  RefreshCw,
  PanelLeftClose,
  Star,
  Terminal as TerminalIcon,
  Trash2,
  Upload,
} from 'lucide-react';
import { FileItem } from '../../types';
import { api } from '../../api';

type IconComponent = React.ComponentType<{ className?: string }>;

export interface TerminalShortcut {
  label: string;
  path: string;
  icon: IconComponent;
}

interface TerminalFileBrowserProps {
  currentPath: string;
  files: FileItem[];
  visibleFiles: FileItem[];
  filesLoading: boolean;
  uploading: boolean;
  isDragging: boolean;
  isVMSystemPath: boolean;
  showHiddenFiles: boolean;
  favoritePaths: string[];
  copiedPath: string | null;
  rootShortcuts: TerminalShortcut[];
  favoriteShortcuts: TerminalShortcut[];
  loginUser: 'root' | 'default';
  onOpenMkdir: () => void;
  onClose: () => void;
  onUpload: (files: FileList | null) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onToggleHidden: () => void;
  onNavigate: (path: string) => void | Promise<void>;
  onNavigateUp: () => void | Promise<void>;
  onSetDragging: (dragging: boolean) => void;
  onOpenInTerminal: (path: string) => void;
  onToggleFavorite: (path: string) => void;
  onViewFile: (item: FileItem) => void | Promise<void>;
  onDelete: (item: FileItem) => void | Promise<void>;
  onCopyPath: (path: string) => void;
  getFileIcon: (item: FileItem) => React.ReactNode;
}

export const TerminalFileBrowser: React.FC<TerminalFileBrowserProps> = ({
  currentPath,
  files,
  visibleFiles,
  filesLoading,
  uploading,
  isDragging,
  isVMSystemPath,
  showHiddenFiles,
  favoritePaths,
  copiedPath,
  rootShortcuts,
  favoriteShortcuts,
  loginUser,
  onOpenMkdir,
  onClose,
  onUpload,
  onRefresh,
  onToggleHidden,
  onNavigate,
  onNavigateUp,
  onSetDragging,
  onOpenInTerminal,
  onToggleFavorite,
  onViewFile,
  onDelete,
  onCopyPath,
  getFileIcon,
}) => (
  <div className="order-1 flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/80 lg:w-[320px] lg:flex-none lg:shrink-0">
    <div className="space-y-3 border-b border-slate-800/80 p-3.5 sm:p-4">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-center justify-between gap-3 lg:flex-1 lg:justify-start">
          <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 ring-1 ring-sky-400/20">
            <Folder className="h-4 w-4 text-sky-400" />
          </div>
          <div className="min-w-0">
            <span className="block truncate whitespace-nowrap text-[15px] font-bold text-white">虚拟机文件系统</span>
          </div>
          </div>
          <button
            onClick={onClose}
            aria-label="返回终端"
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-slate-800 px-2.5 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-700 lg:hidden"
            title="返回终端"
          >
            <PanelLeftClose className="h-4 w-4" />
            <span>终端</span>
          </button>
        </div>
        <div className="grid w-full shrink-0 grid-cols-4 gap-2 lg:flex lg:w-auto lg:items-center lg:gap-1.5">
          <button
            onClick={onOpenMkdir}
            disabled={isVMSystemPath}
            aria-label="新建文件夹"
            className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-slate-800 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700 disabled:pointer-events-none disabled:opacity-40 lg:h-9 lg:w-9"
            title="新建文件夹"
          >
            <FolderPlus className="h-4 w-4" />
            <span className="lg:hidden">新建</span>
          </button>
          <label
            aria-label="上传文件"
            className={`flex h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-slate-800 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700 lg:h-9 lg:w-9 ${isVMSystemPath ? 'pointer-events-none opacity-40' : ''}`}
            title="上传文件"
          >
            <Upload className="h-4 w-4" />
            <span className="lg:hidden">上传</span>
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(event) => onUpload(event.target.files)}
              disabled={uploading || isVMSystemPath}
            />
          </label>
          <button
            onClick={onRefresh}
            disabled={filesLoading}
            aria-label="刷新列表"
            className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-slate-800 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700 disabled:opacity-50 lg:h-9 lg:w-9"
            title="刷新列表"
          >
            <RefreshCw className={`h-4 w-4 ${filesLoading ? 'animate-spin' : ''}`} />
            <span className="lg:hidden">刷新</span>
          </button>
          <button
            onClick={onToggleHidden}
            aria-pressed={showHiddenFiles}
            className={`flex h-10 w-full items-center justify-center gap-1.5 rounded-xl text-[11px] font-medium transition lg:h-9 lg:w-9 ${showHiddenFiles
              ? 'bg-sky-500/20 text-sky-300 hover:bg-sky-500/30'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title={showHiddenFiles ? '隐藏以 . 开头的文件和文件夹' : '显示隐藏文件和文件夹'}
            aria-label={showHiddenFiles ? '隐藏隐藏文件和文件夹' : '显示隐藏文件和文件夹'}
          >
            {showHiddenFiles ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            <span className="lg:hidden">{showHiddenFiles ? '隐藏' : '显示'}</span>
          </button>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          {rootShortcuts.map((shortcut) => (
            <button
              key={shortcut.path}
              onClick={() => onNavigate(shortcut.path)}
              className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-2 text-[11px] font-medium transition ${currentPath === shortcut.path
                ? 'border-sky-500/40 bg-sky-500/20 font-bold text-sky-300'
                : 'border-slate-700/60 bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
              title={shortcut.path}
            >
              <shortcut.icon className="h-3.5 w-3.5" />
              <span>{shortcut.label}</span>
            </button>
          ))}
          {favoriteShortcuts.length > 0 && <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-700/80" aria-hidden="true" />}
          {favoriteShortcuts.map((shortcut) => (
            <button
              key={shortcut.path}
              onClick={() => onNavigate(shortcut.path)}
              className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-2 text-[11px] font-medium transition ${currentPath === shortcut.path
                ? 'border-sky-500/40 bg-sky-500/20 font-bold text-slate-100'
                : 'border-slate-700/60 bg-slate-800/60 text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
              title={shortcut.path}
            >
              <shortcut.icon className="h-3.5 w-3.5 fill-amber-300 text-amber-300" />
              <span>{shortcut.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center space-x-1 overflow-x-auto rounded-xl border border-slate-800/80 bg-slate-950/60 p-2.5 font-mono text-xs">
        <button
          onClick={onNavigateUp}
          disabled={currentPath === '/'}
          className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:opacity-30"
          title="返回上一级"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <div className="min-w-0 flex-1 truncate font-semibold text-slate-200 sm:hidden">{currentPath}</div>
        <div className="hidden min-w-0 items-center space-x-1 truncate text-slate-300 sm:flex">
          <span
            onClick={() => loginUser === 'root' && onNavigate('/')}
            className={`${loginUser === 'root' ? 'cursor-pointer hover:text-sky-400' : 'cursor-default opacity-50'} font-bold`}
          >
            /
          </span>
          {currentPath.split('/').filter(Boolean).map((segment, index, segments) => {
            const segmentPath = '/' + segments.slice(0, index + 1).join('/');
            return (
              <React.Fragment key={segmentPath}>
                <span className="text-slate-600">/</span>
                <span
                  onClick={() => onNavigate(segmentPath)}
                  className={`cursor-pointer truncate hover:text-sky-400 ${index === segments.length - 1 ? 'font-bold text-white' : 'text-slate-400'}`}
                >
                  {segment}
                </span>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>

    <div
      className={`relative flex-1 space-y-1 overflow-y-auto p-2 ${isDragging ? 'border-2 border-dashed border-sky-500 bg-sky-500/5' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        onSetDragging(true);
      }}
      onDragLeave={() => onSetDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        onSetDragging(false);
        onUpload(event.dataTransfer.files);
      }}
    >
      {uploading && <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-center text-xs text-sky-300">文件上传写入中...</div>}
      {filesLoading && files.length === 0 ? (
        <div className="p-8 text-center text-xs text-slate-500">正在扫描文件系统...</div>
      ) : visibleFiles.length === 0 ? (
        <div className="p-8 text-center text-xs text-slate-500">该目录下暂无文件</div>
      ) : (
        visibleFiles.map((file) => (
          <div key={file.path} className="group flex items-center justify-between rounded-xl p-2 text-xs transition hover:bg-slate-800/60">
            <div
              onClick={() => (file.isDir ? onNavigate(file.path) : onViewFile(file))}
              className="flex min-w-0 flex-1 cursor-pointer items-center space-x-2.5"
            >
              {getFileIcon(file)}
              <span className={`truncate ${file.isDir ? 'font-medium text-slate-200 group-hover:text-sky-300' : 'text-slate-300'}`}>{file.name}</span>
            </div>
            <div className="flex shrink-0 items-center space-x-2 text-slate-500">
              <span className="hidden font-mono text-[11px] sm:inline">{file.sizeFormatted}</span>
              {file.isDir && (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleFavorite(file.path);
                  }}
                  className={`rounded p-1 transition ${favoritePaths.includes(file.path) ? 'text-amber-300 hover:bg-amber-400/20 hover:text-amber-200' : 'text-slate-500 hover:bg-amber-400/20 hover:text-amber-300'}`}
                  title={favoritePaths.includes(file.path) ? '取消收藏' : '收藏目录'}
                  aria-label={favoritePaths.includes(file.path) ? `取消收藏 ${file.name}` : `收藏 ${file.name}`}
                >
                  <Star className={`h-3.5 w-3.5 ${favoritePaths.includes(file.path) ? 'fill-amber-300' : ''}`} />
                </button>
              )}
              <div className="flex items-center space-x-1 opacity-70 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                {file.isDir ? (
                  <button onClick={() => onOpenInTerminal(file.path)} className="rounded p-1 text-slate-400 transition hover:bg-sky-500/20 hover:text-sky-300" title="在终端中打开 (cd)">
                    <TerminalIcon className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <>
                    {!isVMSystemPath && (
                      <button onClick={() => onViewFile(file)} className="rounded p-1 text-slate-400 transition hover:bg-sky-500/20 hover:text-sky-300" title="查看/编辑文件">
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <a href={api.getFileDownloadUrl(file.path)} download={file.name} className="rounded p-1 text-slate-400 transition hover:bg-emerald-500/20 hover:text-emerald-300" title="下载文件">
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  </>
                )}
                <button onClick={() => onCopyPath(file.path)} className="rounded p-1 text-slate-400 transition hover:bg-slate-700 hover:text-white" title="复制绝对路径">
                  {copiedPath === file.path ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                {!isVMSystemPath && (
                  <button onClick={() => onDelete(file)} className="rounded p-1 text-slate-400 transition hover:bg-rose-500/20 hover:text-rose-400" title="删除">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))
      )}
    </div>

    <div className="flex items-center justify-between border-t border-slate-800/80 bg-slate-950/40 p-3 text-[11px] text-slate-400">
      <span>当前路径: <code className="font-mono text-sky-400">{currentPath}</code></span>
      <button onClick={() => onOpenInTerminal(currentPath)} className="flex items-center space-x-1 rounded bg-slate-800 px-2 py-1 font-medium text-slate-300 transition hover:bg-sky-600 hover:text-white">
        <CornerDownRight className="h-3 w-3" />
        <span>终端切入此目录</span>
      </button>
    </div>
  </div>
);
