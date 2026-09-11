import React from 'react';
import { CheckCircle2, Circle, FileText, Film, Folder, Image, MoreHorizontal, Music } from 'lucide-react';
import { FileItem } from '../../../types';
import { getFileType } from './types';

interface FileListViewProps {
  files: FileItem[];
  selectionMode: boolean;
  selectedPaths: Set<string>;
  onItemClick: (item: FileItem) => void;
  onToggleSelect: (path: string, e: React.MouseEvent) => void;
  onOpenActions: (item: FileItem, e: React.MouseEvent) => void;
}

export const FileListView: React.FC<FileListViewProps> = ({ files, selectionMode, selectedPaths, onItemClick, onToggleSelect, onOpenActions }) => (
  <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
    {files.map((item) => {
      const type = getFileType(item.ext);
      const isSelected = selectedPaths.has(item.path);
      const icon = item.isDir ? (
        <Folder className="h-5 w-5 fill-amber-500/15 text-amber-500" />
      ) : type === 'video' ? (
        <Film className="h-5 w-5 text-violet-500" />
      ) : type === 'image' ? (
        <Image className="h-5 w-5 text-emerald-500" />
      ) : type === 'audio' ? (
        <Music className="h-5 w-5 text-pink-500" />
      ) : (
        <FileText className={`h-5 w-5 ${type === 'text' ? 'text-sky-500' : 'text-slate-400'}`} />
      );

      return (
        <div key={item.path} onClick={() => onItemClick(item)} className={`flex min-h-[62px] cursor-pointer items-center gap-3 px-1 py-2 [contain:layout_paint_style] [content-visibility:auto] [contain-intrinsic-size:62px] ${isSelected ? 'bg-sky-50 dark:bg-sky-500/10' : ''}`}>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-50 dark:bg-slate-800/70">{icon}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{item.name}</p>
            <p className="mt-0.5 truncate text-[11px] text-slate-400">{item.isDir ? item.mtimeString : `${item.sizeFormatted} · ${item.mtimeString}`}</p>
          </div>
          {selectionMode ? (
            <button type="button" onClick={(e) => onToggleSelect(item.path, e)} className="flex h-10 w-10 shrink-0 items-center justify-center text-slate-400" aria-label={`选择${item.name}`}>
              {isSelected ? <CheckCircle2 className="h-6 w-6 fill-sky-500 text-sky-500" /> : <Circle className="h-6 w-6" />}
            </button>
          ) : (
            <button type="button" onClick={(e) => onOpenActions(item, e)} className="flex h-10 w-10 shrink-0 items-center justify-center text-slate-500 dark:text-slate-400" aria-label={`${item.name} 更多操作`}>
              <MoreHorizontal className="h-5 w-5" />
            </button>
          )}
        </div>
      );
    })}
  </div>
);
