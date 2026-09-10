import React from 'react';
import {
  Folder, Film, Music, FileText, Play,
  CheckSquare, Square, Star, Copy, Scissors, Edit3, Download, Trash2
} from 'lucide-react';
import { FileItem } from '../../../types';
import { api } from '../../../api';
import { getFileType } from './types';

interface FileGridViewProps {
  files: FileItem[];
  selectedPaths: Set<string>;
  favorites: string[];
  onItemClick: (item: FileItem) => void;
  onToggleSelect: (path: string, e: React.MouseEvent) => void;
  onToggleFavorite: (path: string, e: React.MouseEvent) => void;
  onCopy: (paths: string[], e: React.MouseEvent) => void;
  onCut: (paths: string[], e: React.MouseEvent) => void;
  onOpenRename: (item: FileItem, e: React.MouseEvent) => void;
  onOpenDelete: (item: FileItem, e: React.MouseEvent) => void;
}

export const FileGridView: React.FC<FileGridViewProps> = ({
  files,
  selectedPaths,
  favorites,
  onItemClick,
  onToggleSelect,
  onToggleFavorite,
  onCopy,
  onCut,
  onOpenRename,
  onOpenDelete,
}) => {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4">
      {files.map((item) => {
        const type = getFileType(item.ext);
        const isDir = item.isDir;
        const isImage = !isDir && type === 'image';
        const isVideo = !isDir && type === 'video';
        const isAudio = !isDir && type === 'audio';
        const isSelected = selectedPaths.has(item.path);
        const isFav = favorites.includes(item.path);

        return (
          <div
            key={item.path}
            onClick={() => onItemClick(item)}
            className={`group relative p-3.5 rounded-2xl bg-slate-950/60 hover:bg-slate-800/80 border transition-all flex flex-col justify-between cursor-pointer hover:shadow-xl hover:shadow-sky-500/5 ${
              isSelected
                ? 'border-sky-500 bg-sky-500/10 ring-1 ring-sky-500/40'
                : 'border-slate-800/80 hover:border-sky-500/40'
            }`}
          >
            {/* Top Left Selection Checkbox */}
            <div
              className={`absolute top-2.5 left-2.5 z-20 transition-opacity ${
                isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
              onClick={(e) => onToggleSelect(item.path, e)}
            >
              <div className={`p-1 rounded-md transition ${isSelected ? 'text-sky-400' : 'text-slate-400 hover:text-white bg-slate-900/80'}`}>
                {isSelected ? <CheckSquare className="w-4 h-4 fill-sky-500/20" /> : <Square className="w-4 h-4" />}
              </div>
            </div>

            {/* Top Right Action Menu */}
            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-0.5 z-20 bg-slate-900/95 rounded-lg p-1 shadow-lg border border-slate-700/60">
              {/* Star / Favorite */}
              <button
                onClick={(e) => onToggleFavorite(item.path, e)}
                className="p-1 text-slate-400 hover:text-amber-400 rounded hover:bg-slate-800 transition"
                title={isFav ? '取消收藏' : '收藏'}
              >
                <Star className={`w-3 h-3 ${isFav ? 'text-amber-400 fill-amber-400' : ''}`} />
              </button>
              {/* Copy */}
              <button
                onClick={(e) => onCopy([item.path], e)}
                className="p-1 text-slate-400 hover:text-sky-400 rounded hover:bg-slate-800 transition"
                title="复制"
              >
                <Copy className="w-3 h-3" />
              </button>
              {/* Cut */}
              <button
                onClick={(e) => onCut([item.path], e)}
                className="p-1 text-slate-400 hover:text-amber-400 rounded hover:bg-slate-800 transition"
                title="剪切 (移动)"
              >
                <Scissors className="w-3 h-3" />
              </button>
              {/* Rename */}
              <button
                onClick={(e) => onOpenRename(item, e)}
                className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition"
                title="重命名"
              >
                <Edit3 className="w-3 h-3" />
              </button>
              {!isDir && (
                <a
                  href={api.getFileDownloadUrl(item.path)}
                  onClick={(e) => e.stopPropagation()}
                  download
                  className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition"
                  title="下载"
                >
                  <Download className="w-3 h-3" />
                </a>
              )}
              {/* Delete */}
              <button
                onClick={(e) => onOpenDelete(item, e)}
                className="p-1 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800 transition"
                title="移入回收站"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>

            {/* Thumbnail / Icon */}
            <div className="h-28 rounded-xl bg-slate-900/90 flex items-center justify-center overflow-hidden relative border border-slate-800/50 mb-2.5">
              {isDir ? (
                <Folder className="w-12 h-12 text-amber-400/90 fill-amber-400/20 group-hover:scale-105 transition-transform" />
              ) : isImage ? (
                <img
                  src={api.getFileRawUrl(item.path)}
                  alt={item.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  loading="lazy"
                />
              ) : isVideo ? (
                <div className="flex flex-col items-center justify-center space-y-1 text-violet-400">
                  <Film className="w-10 h-10 group-hover:scale-105 transition-transform" />
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-500/20 uppercase font-semibold">{item.ext}</span>
                </div>
              ) : isAudio ? (
                <div className="flex flex-col items-center justify-center space-y-1 text-pink-400">
                  <Music className="w-10 h-10 group-hover:scale-105 transition-transform" />
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-pink-500/20 uppercase font-semibold">{item.ext}</span>
                </div>
              ) : type === 'text' ? (
                <div className="flex flex-col items-center justify-center space-y-1 text-sky-400">
                  <FileText className="w-10 h-10 group-hover:scale-105 transition-transform" />
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-500/20 uppercase font-semibold">{item.ext || 'txt'}</span>
                </div>
              ) : (
                <FileText className="w-10 h-10 text-slate-400 group-hover:scale-105 transition-transform" />
              )}

              {/* Play Badge for Videos */}
              {isVideo && (
                <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="p-2 rounded-full bg-violet-600/90 text-white shadow-lg">
                    <Play className="w-4 h-4 fill-white" />
                  </div>
                </div>
              )}
            </div>

            {/* Metadata */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-200 truncate group-hover:text-sky-300 transition-colors" title={item.name}>
                {item.name}
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                <span>{isDir ? '文件夹' : item.sizeFormatted}</span>
                <span>{item.mtimeString.split(' ')[0]}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
