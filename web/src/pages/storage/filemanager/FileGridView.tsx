import React from 'react';
import { FileArchive, FileText, Film, Folder, Image as ImageIcon, MoreHorizontal, Music } from 'lucide-react';
import { FileItem } from '../../../types';
import { api } from '../../../api';
import { getFileType } from './types';

interface FileGridViewProps {
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

export const FileGridView: React.FC<FileGridViewProps> = ({ files, selectedPaths, onItemClick, onOpenActions, onDragStart, onDragOver, onDrop, onLongPress, dropTargetPath }) => (
  <div className="grid grid-cols-3 gap-2 md:grid-cols-4 xl:grid-cols-6">
    {files.map((item) => {
      const type = getFileType(item.ext);
      const isSelected = selectedPaths.has(item.path);
      let longPressTimer: number | undefined;
      const clearLongPress = () => { if (longPressTimer) window.clearTimeout(longPressTimer); };
      return (
        <div key={item.path} data-file-item="true" data-file-path={item.path} draggable onDragStart={(event) => onDragStart?.(item, event)} onDragOver={(event) => onDragOver?.(item, event)} onDrop={(event) => onDrop?.(item, event)} onContextMenu={(event) => { event.preventDefault(); onOpenActions(item, event); }} onPointerDown={(event) => { if (event.pointerType === 'touch') { event.currentTarget.dataset.longPressed = 'false'; longPressTimer = window.setTimeout(() => { event.currentTarget.dataset.longPressed = 'true'; onLongPress?.(item); }, 500); } }} onPointerUp={clearLongPress} onPointerCancel={clearLongPress} onPointerLeave={clearLongPress} onClick={(event) => { if (event.currentTarget.dataset.longPressed === 'true') { delete event.currentTarget.dataset.longPressed; return; } onItemClick(item); }} className={`relative min-w-0 cursor-pointer rounded-2xl border bg-white p-2 [contain:layout_paint_style] [content-visibility:auto] [contain-intrinsic-size:108px] dark:bg-slate-900/60 ${isSelected ? 'border-sky-500 bg-sky-50 dark:bg-sky-500/10' : 'border-slate-200/90 dark:border-slate-800/80'} ${dropTargetPath === item.path ? 'ring-2 ring-sky-400' : ''}`}>
          <button type="button" onClick={(e) => onOpenActions(item, e)} className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-500 dark:bg-slate-900 dark:text-slate-300" aria-label={`${item.name} 更多操作`}><MoreHorizontal className="h-4 w-4" /></button>

          <div className="mb-2 flex h-14 items-center justify-center overflow-hidden rounded-xl bg-slate-50 dark:bg-slate-950/60 sm:h-20">
            {item.isDir ? (
              <Folder className="h-9 w-9 fill-amber-500/20 text-amber-500 sm:h-10 sm:w-10" />
            ) : type === 'image' ? (
              <img src={api.getFileRawUrl(item.path)} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
            ) : type === 'video' ? (
              <Film className="h-9 w-9 text-violet-500" />
            ) : type === 'audio' ? (
              <Music className="h-9 w-9 text-pink-500" />
            ) : type === 'text' ? (
              <FileText className="h-9 w-9 text-sky-500" />
            ) : type === 'archive' ? (
              <FileArchive className="h-9 w-9 text-amber-500" />
            ) : (
              <ImageIcon className="h-9 w-9 text-slate-400" />
            )}
          </div>
          <p className="truncate text-[11px] font-semibold text-slate-800 dark:text-slate-200 sm:text-xs" title={item.name}>{item.name}</p>
          {!item.isDir && <p className="mt-0.5 truncate font-mono text-[9px] text-slate-400 sm:text-[10px]">{item.sizeFormatted}</p>}
        </div>
      );
    })}
  </div>
);
