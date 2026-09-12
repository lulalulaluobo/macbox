import React from 'react';
import { Archive, Copy, Download, Edit3, FileText, Folder, Scissors, Star, Trash2, X } from 'lucide-react';
import { FileItem } from '../../../types';
import { api } from '../../../api';

interface FileActionSheetProps {
  item: FileItem | null;
  isFavorite: boolean;
  onClose: () => void;
  onToggleFavorite: () => void;
  onCopy: () => void;
  onCopyPath: () => void;
  onCut: () => void;
  onRename: () => void;
  onDelete: () => void;
  onArchive: () => void;
}

export const FileActionSheet: React.FC<FileActionSheetProps> = ({
  item,
  isFavorite,
  onClose,
  onToggleFavorite,
  onCopy,
  onCopyPath,
  onCut,
  onRename,
  onDelete,
  onArchive,
}) => {
  if (!item) return null;

  const actions = [
    { label: isFavorite ? '取消收藏' : '收藏', icon: Star, onClick: onToggleFavorite, active: isFavorite },
    { label: '移动', icon: Scissors, onClick: onCut },
    { label: '复制', icon: Copy, onClick: onCopy },
    { label: '重命名', icon: Edit3, onClick: onRename },
    { label: '删除', icon: Trash2, onClick: onDelete, danger: true },
  ];

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/35" role="dialog" aria-modal="true" aria-label={`${item.name} 文件操作`}>
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="关闭文件操作" />
      <section className="relative w-full rounded-t-[28px] border-t border-slate-200 bg-white px-4 pb-[calc(18px+env(safe-area-inset-bottom))] pt-3 dark:border-slate-700 dark:bg-slate-900 sm:mb-4 sm:max-w-lg sm:rounded-[28px] sm:border">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
        <div className="flex min-w-0 items-center gap-3">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${item.isDir ? 'bg-sky-50 text-sky-500 dark:bg-sky-500/10' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'}`}>
            {item.isDir ? <Folder className="h-6 w-6 fill-sky-500/15" /> : <FileText className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-bold text-slate-900 dark:text-white">{item.name}</h3>
            <p className="mt-0.5 truncate text-[11px] text-slate-400">{item.isDir ? item.mtimeString : `${item.sizeFormatted} · ${item.mtimeString}`}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-5 gap-2">
          {actions.map(({ label, icon: Icon, onClick, active, danger }) => (
            <button key={label} type="button" onClick={onClick} className={`flex min-w-0 flex-col items-center gap-2 rounded-2xl bg-slate-50 px-1 py-3 text-[11px] font-medium dark:bg-slate-800/70 ${danger ? 'text-rose-500' : active ? 'text-amber-500' : 'text-slate-700 dark:text-slate-200'}`}>
              <Icon className={`h-5 w-5 ${active ? 'fill-amber-500' : ''}`} />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>

        <button type="button" onClick={onCopyPath} className="mt-3 flex min-h-12 w-full items-center justify-between rounded-2xl bg-slate-50 px-4 text-sm font-medium text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
          <span>复制{item.isDir ? '文件夹' : '文件'}路径</span>
          <Copy className="h-5 w-5" />
        </button>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={onArchive} className="flex min-h-12 items-center justify-between rounded-2xl bg-violet-50 px-4 text-sm font-medium text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
            <span>{item.isDir || !['zip', 'rar', '7z'].includes(item.ext.toLowerCase()) ? '压缩' : '解压'}</span>
            <Archive className="h-5 w-5" />
          </button>
          <a href={api.getFileDownloadUrl(item.path)} download onClick={onClose} className="flex min-h-12 items-center justify-between rounded-2xl bg-slate-50 px-4 text-sm font-medium text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
            <span>{item.isDir ? '下载文件夹（ZIP）' : '下载文件'}</span>
            <Download className="h-5 w-5" />
          </a>
        </div>
      </section>
    </div>
  );
};
