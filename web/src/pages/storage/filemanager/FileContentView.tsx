import React from 'react';
import { Folder, Star } from 'lucide-react';
import type { FileItem, TrashItem } from '../../../types';
import { FileGridView } from './FileGridView';
import { FileListView } from './FileListView';
import { TrashView } from './TrashView';

type MarqueeRect = { startX: number; startY: number; currentX: number; currentY: number };

interface FileContentViewProps {
  fileListRef: React.RefObject<HTMLDivElement>;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  marquee: MarqueeRect | null;
  viewingTrash: boolean;
  viewingFavorites: boolean;
  favoritesLoading: boolean;
  favoriteItems: FileItem[];
  filteredFiles: FileItem[];
  loading: boolean;
  loadingMore: boolean;
  hasMoreFiles: boolean;
  viewMode: 'grid' | 'list';
  selectionMode: boolean;
  selectedPaths: Set<string>;
  dropTargetPath: string | null;
  trashItems: TrashItem[];
  trashLoading: boolean;
  trashSelectedIds: Set<string>;
  currentPath: string;
  onItemClick: (item: FileItem) => void;
  onToggleSelect: (path: string, event: React.MouseEvent) => void;
  onOpenActions: (item: FileItem, event: React.MouseEvent) => void;
  onLongPress: (item: FileItem) => void;
  onDragStart: (item: FileItem, event: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (item: FileItem, event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (item: FileItem, event: React.DragEvent<HTMLDivElement>) => void;
  onLoadMore: () => void;
  onUploadEmpty: () => void;
  onRefreshTrash: () => void;
  onOpenEmptyTrash: () => void;
  onToggleTrashSelectAll: () => void;
  onToggleTrashSelect: (id: string) => void;
  onPromptDeleteTrash: (item?: TrashItem) => void;
  onRestoreTrash: (ids: string[]) => void;
  onClearTrashSelection: () => void;
}

export const FileContentView: React.FC<FileContentViewProps> = ({
  fileListRef,
  onPointerDown,
  onClick,
  marquee,
  viewingTrash,
  viewingFavorites,
  favoritesLoading,
  favoriteItems,
  filteredFiles,
  loading,
  loadingMore,
  hasMoreFiles,
  viewMode,
  selectionMode,
  selectedPaths,
  dropTargetPath,
  trashItems,
  trashLoading,
  trashSelectedIds,
  currentPath,
  onItemClick,
  onToggleSelect,
  onOpenActions,
  onLongPress,
  onDragStart,
  onDragOver,
  onDrop,
  onLoadMore,
  onUploadEmpty,
  onRefreshTrash,
  onOpenEmptyTrash,
  onToggleTrashSelectAll,
  onToggleTrashSelect,
  onPromptDeleteTrash,
  onRestoreTrash,
  onClearTrashSelection,
}) => {
  const fileViewProps = {
    selectedPaths,
    onItemClick,
    onToggleSelect,
    onOpenActions,
    onLongPress,
    onDragStart,
    onDragOver,
    onDrop,
    dropTargetPath,
  };

  return (
    <div ref={fileListRef} onPointerDown={onPointerDown} onClick={onClick} className={`relative min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain rounded-[22px] border border-slate-200/80 bg-white p-3 [-webkit-overflow-scrolling:touch] [contain:strict] dark:border-slate-800/80 dark:bg-slate-900/60 sm:p-4 ${marquee ? 'select-none' : ''}`}>
      {marquee && <div className="pointer-events-none fixed z-[70] border border-sky-500 bg-sky-400/20" style={{ left: Math.min(marquee.startX, marquee.currentX), top: Math.min(marquee.startY, marquee.currentY), width: Math.abs(marquee.currentX - marquee.startX), height: Math.abs(marquee.currentY - marquee.startY) }} />}
      {viewingTrash ? (
        <TrashView
          trashItems={trashItems}
          trashLoading={trashLoading}
          trashSelectedIds={trashSelectedIds}
          onRefreshTrash={onRefreshTrash}
          onOpenEmptyTrash={onOpenEmptyTrash}
          onToggleSelectAll={onToggleTrashSelectAll}
          onToggleSelect={onToggleTrashSelect}
          onPromptDeleteTrash={onPromptDeleteTrash}
          onRestoreTrash={onRestoreTrash}
          onClearSelection={onClearTrashSelection}
        />
      ) : viewingFavorites ? (
        favoritesLoading ? (
          <div className="flex flex-col items-center justify-center space-y-3 py-24 text-slate-400"><div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" /><p className="text-xs">正在读取收藏…</p></div>
        ) : favoriteItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center space-y-3 py-24 text-center text-slate-400"><Star className="h-12 w-12" /><p className="text-sm font-semibold text-slate-700 dark:text-slate-300">还没有收藏文件夹</p><p className="text-xs">只能在文件夹的三点菜单中添加收藏</p></div>
        ) : viewMode === 'grid' ? (
          <FileGridView {...fileViewProps} files={favoriteItems} selectionMode={false} />
        ) : (
          <FileListView {...fileViewProps} files={favoriteItems} selectionMode={false} />
        )
      ) : loading ? (
        <div className="flex flex-col items-center justify-center space-y-3 py-24 text-slate-400"><div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" /><p className="text-xs">加载文件列表中...</p></div>
      ) : filteredFiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center space-y-4 py-24 text-slate-400">
          <div className="rounded-2xl bg-slate-100 p-4 text-slate-400 dark:bg-slate-800/50 dark:text-slate-500"><Folder className="h-12 w-12 stroke-[1.5]" /></div>
          <div className="text-center"><p className="text-sm font-semibold text-slate-700 dark:text-slate-300">当前目录为空</p><p className="mt-1 text-xs text-slate-400 dark:text-slate-500">可点击上方上传或新建文件夹</p></div>
          <button type="button" onClick={onUploadEmpty} className="rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-sky-500/20 transition hover:bg-sky-600">立即上传文件</button>
        </div>
      ) : viewMode === 'grid' ? (
        <FileGridView {...fileViewProps} files={filteredFiles} selectionMode={selectionMode} />
      ) : (
        <FileListView {...fileViewProps} files={filteredFiles} selectionMode={selectionMode} />
      )}
      {!viewingTrash && !viewingFavorites && hasMoreFiles && !loading && (
        <button type="button" disabled={loadingMore} onClick={onLoadMore} className="mx-auto mt-3 flex min-h-10 items-center justify-center rounded-xl bg-slate-100 px-5 text-xs font-semibold text-slate-600 disabled:opacity-60 dark:bg-slate-800 dark:text-slate-300">{loadingMore ? '正在加载…' : '加载更多'}</button>
      )}
      <span className="sr-only">当前目录：{currentPath}</span>
    </div>
  );
};
