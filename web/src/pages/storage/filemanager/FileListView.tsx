import React from 'react';
import { FileArchive, FileText, Film, Folder, Image, MoreHorizontal, Music } from 'lucide-react';
import { FileItem } from '../../../types';
import { getFileType } from './types';

interface FileListViewProps {
  files: FileItem[];
  selectionMode: boolean;
  selectedPaths: Set<string>;
  onItemClick: (item: FileItem) => void;
  onToggleSelect: (path: string, e: React.MouseEvent) => void;
  onOpenActions: (item: FileItem, e: React.MouseEvent) => void;
  onDragStart?: (item: FileItem, e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (item: FileItem, e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (item: FileItem, e: React.DragEvent<HTMLDivElement>) => void;
  onLongPress?: (item: FileItem) => void;
  dropTargetPath?: string | null;
}

export const FileListView: React.FC<FileListViewProps> = ({ files, selectedPaths, onItemClick, onOpenActions, onDragStart, onDragOver, onDrop, onLongPress, dropTargetPath }) => (
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
      ) : type === 'archive' ? (
        <FileArchive className="h-5 w-5 text-amber-500" />
      ) : (
        <FileText className={`h-5 w-5 ${type === 'text' ? 'text-sky-500' : 'text-slate-400'}`} />
      );

      let longPressTimer: number | undefined;
      const clearLongPress = () => { if (longPressTimer) window.clearTimeout(longPressTimer); };
      return (
        <div key={item.path} data-file-item="true" data-file-path={item.path} draggable onDragStart={(event) => onDragStart?.(item, event)} onDragOver={(event) => onDragOver?.(item, event)} onDrop={(event) => onDrop?.(item, event)} onContextMenu={(event) => { event.preventDefault(); onOpenActions(item, event); }} onPointerDown={(event) => { if (event.pointerType === 'touch') { event.currentTarget.dataset.longPressed = 'false'; longPressTimer = window.setTimeout(() => { event.currentTarget.dataset.longPressed = 'true'; onLongPress?.(item); }, 500); } }} onPointerUp={clearLongPress} onPointerCancel={clearLongPress} onPointerLeave={clearLongPress} onClick={(event) => { if (event.currentTarget.dataset.longPressed === 'true') { delete event.currentTarget.dataset.longPressed; return; } onItemClick(item); }} className={`flex min-h-[62px] cursor-pointer items-center gap-3 px-1 py-2 [contain:layout_paint_style] [content-visibility:auto] [contain-intrinsic-size:62px] ${isSelected ? 'bg-sky-50 dark:bg-sky-500/10' : ''} ${dropTargetPath === item.path ? 'rounded-xl bg-sky-100 ring-2 ring-inset ring-sky-400 dark:bg-sky-500/20' : ''}`}>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-50 dark:bg-slate-800/70">{icon}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{item.name}</p>
            <p className="mt-0.5 truncate text-[11px] text-slate-400">{item.isDir ? item.mtimeString : `${item.sizeFormatted} · ${item.mtimeString}`}</p>
          </div>
          <button type="button" onClick={(e) => onOpenActions(item, e)} className="flex h-10 w-10 shrink-0 items-center justify-center text-slate-500 dark:text-slate-400" aria-label={`${item.name} 更多操作`}><MoreHorizontal className="h-5 w-5" /></button>
        </div>
      );
    })}
  </div>
);
