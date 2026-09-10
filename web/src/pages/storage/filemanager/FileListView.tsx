import React from 'react';
import {
  Folder, Film, Image, Music, FileText,
  CheckSquare, Square, Star, Copy, Scissors, Edit3, Download, Trash2
} from 'lucide-react';
import { FileItem } from '../../../types';
import { api } from '../../../api';
import { getFileType } from './types';

interface FileListViewProps {
  files: FileItem[];
  selectedPaths: Set<string>;
  favorites: string[];
  onSelectAll: () => void;
  onItemClick: (item: FileItem) => void;
  onToggleSelect: (path: string, e: React.MouseEvent) => void;
  onToggleFavorite: (path: string, e: React.MouseEvent) => void;
  onCopy: (paths: string[], e: React.MouseEvent) => void;
  onCut: (paths: string[], e: React.MouseEvent) => void;
  onOpenRename: (item: FileItem, e: React.MouseEvent) => void;
  onOpenDelete: (item: FileItem, e: React.MouseEvent) => void;
}

export const FileListView: React.FC<FileListViewProps> = ({
  files,
  selectedPaths,
  favorites,
  onSelectAll,
  onItemClick,
  onToggleSelect,
  onToggleFavorite,
  onCopy,
  onCut,
  onOpenRename,
  onOpenDelete,
}) => {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-800 text-slate-400 uppercase font-mono text-[10px]">
            <th className="w-8 pb-3 pl-2">
              <button onClick={onSelectAll} className="p-0.5 text-slate-400 hover:text-white" title="全选 / 反选">
                {selectedPaths.size > 0 && selectedPaths.size === files.length ? (
                  <CheckSquare className="w-3.5 h-3.5 text-sky-400 fill-sky-500/20" />
                ) : (
                  <Square className="w-3.5 h-3.5" />
                )}
              </button>
            </th>
            <th className="pb-3 font-semibold">名称</th>
            <th className="pb-3 font-semibold">大小</th>
            <th className="pb-3 font-semibold">类型</th>
            <th className="pb-3 font-semibold">最后修改</th>
            <th className="pb-3 font-semibold text-right pr-2">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/50">
          {files.map((item) => {
            const isDir = item.isDir;
            const type = getFileType(item.ext);
            const isSelected = selectedPaths.has(item.path);
            const isFav = favorites.includes(item.path);

            return (
              <tr
                key={item.path}
                onClick={() => onItemClick(item)}
                className={`group cursor-pointer transition-colors ${
                  isSelected ? 'bg-sky-500/10' : 'hover:bg-slate-800/40'
                }`}
              >
                <td className="w-8 py-2.5 pl-2" onClick={(e) => onToggleSelect(item.path, e)}>
                  <div className="p-0.5 text-slate-400 hover:text-white">
                    {isSelected ? (
                      <CheckSquare className="w-3.5 h-3.5 text-sky-400 fill-sky-500/20" />
                    ) : (
                      <Square className="w-3.5 h-3.5" />
                    )}
                  </div>
                </td>
                <td className="py-2.5">
                  <div className="flex items-center space-x-2.5 truncate max-w-sm">
                    <button
                      onClick={(e) => onToggleFavorite(item.path, e)}
                      className="text-slate-500 hover:text-amber-400 shrink-0"
                      title={isFav ? '取消收藏' : '收藏'}
                    >
                      <Star className={`w-3.5 h-3.5 ${isFav ? 'text-amber-400 fill-amber-400' : 'opacity-0 group-hover:opacity-100'}`} />
                    </button>
                    {isDir ? (
                      <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                    ) : type === 'video' ? (
                      <Film className="w-4 h-4 text-violet-400 shrink-0" />
                    ) : type === 'image' ? (
                      <Image className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : type === 'audio' ? (
                      <Music className="w-4 h-4 text-pink-400 shrink-0" />
                    ) : type === 'text' ? (
                      <FileText className="w-4 h-4 text-sky-400 shrink-0" />
                    ) : (
                      <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                    <span className="font-medium text-slate-200 group-hover:text-sky-300 truncate">
                      {item.name}
                    </span>
                  </div>
                </td>
                <td className="py-2.5 text-slate-400 font-mono text-[11px]">
                  {isDir ? '--' : item.sizeFormatted}
                </td>
                <td className="py-2.5 text-slate-400">
                  {isDir ? '文件夹' : item.ext.toUpperCase() || '文件'}
                </td>
                <td className="py-2.5 text-slate-400 font-mono text-[11px]">
                  {item.mtimeString}
                </td>
                <td className="py-2.5 text-right pr-2">
                  <div className="flex items-center justify-end space-x-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={(e) => onCopy([item.path], e)}
                      className="p-1 rounded-lg text-slate-400 hover:text-sky-400 hover:bg-slate-800 transition"
                      title="复制"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => onCut([item.path], e)}
                      className="p-1 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition"
                      title="剪切 (移动)"
                    >
                      <Scissors className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => onOpenRename(item, e)}
                      className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                      title="重命名"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    {!isDir && (
                      <a
                        href={api.getFileDownloadUrl(item.path)}
                        download
                        className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                        title="下载"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>
                    )}
                    <button
                      onClick={(e) => onOpenDelete(item, e)}
                      className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
                      title="移入回收站"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
