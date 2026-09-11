import React from 'react';
import { Trash2, RefreshCw, Folder, FileText, RotateCcw } from 'lucide-react';
import { TrashItem } from '../../../types';

interface TrashViewProps {
  trashItems: TrashItem[];
  trashLoading: boolean;
  trashSelectedIds: Set<string>;
  onRefreshTrash: () => void;
  onOpenEmptyTrash: () => void;
  onToggleSelectAll: () => void;
  onToggleSelect: (id: string) => void;
  onPromptDeleteTrash: (item?: TrashItem) => void;
  onRestoreTrash: (ids: string[]) => void;
  onClearSelection: () => void;
}

export const TrashView: React.FC<TrashViewProps> = ({
  trashItems,
  trashLoading,
  trashSelectedIds,
  onRefreshTrash,
  onOpenEmptyTrash,
  onToggleSelectAll,
  onToggleSelect,
  onPromptDeleteTrash,
  onRestoreTrash,
  onClearSelection,
}) => {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
            <Trash2 className="w-5 h-5 text-rose-500 dark:text-rose-400" />
            <span>回收站</span>
          </h3>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={onRefreshTrash}
            className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 text-xs font-semibold flex items-center space-x-1.5 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${trashLoading ? 'animate-spin' : ''}`} />
            <span>刷新</span>
          </button>
          <button
            onClick={onOpenEmptyTrash}
            disabled={trashItems.length === 0}
            className="px-3.5 py-1.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold flex items-center space-x-1.5 shadow-md shadow-rose-500/20 transition disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>清空回收站</span>
          </button>
        </div>
      </div>

      {trashLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-2">
          <RefreshCw className="w-6 h-6 text-rose-400 animate-spin" />
          <p className="text-xs">正在读取回收站清单...</p>
        </div>
      ) : trashItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-3">
          <div className="p-4 rounded-2xl bg-slate-800/40 text-slate-600">
            <Trash2 className="w-12 h-12" />
          </div>
          <p className="text-sm font-semibold text-slate-300">回收站是空的</p>
          <p className="text-xs text-slate-500">所有删除的文件都会先保存在这里，防止误删破坏</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase font-mono text-[10px]">
                <th className="pb-3 font-semibold pl-3 w-8">
                  <input
                    type="checkbox"
                    checked={trashItems.length > 0 && trashSelectedIds.size === trashItems.length}
                    onChange={onToggleSelectAll}
                    className="rounded bg-slate-800 border-slate-700 text-sky-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                  />
                </th>
                <th className="pb-3 font-semibold">项目名称</th>
                <th className="pb-3 font-semibold">原存储路径</th>
                <th className="pb-3 font-semibold">大小</th>
                <th className="pb-3 font-semibold">删除时间</th>
                <th className="pb-3 font-semibold text-right pr-2">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {trashItems.map((it) => (
                <tr key={it.id} className={`hover:bg-slate-800/40 transition ${trashSelectedIds.has(it.id) ? 'bg-sky-500/10' : ''}`}>
                  <td className="py-3 pl-3">
                    <input
                      type="checkbox"
                      checked={trashSelectedIds.has(it.id)}
                      onChange={() => onToggleSelect(it.id)}
                      className="rounded bg-slate-800 border-slate-700 text-sky-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                    />
                  </td>
                  <td className="py-3 font-medium text-slate-200">
                    <div className="flex items-center space-x-2">
                      {it.isDir ? <Folder className="w-4 h-4 text-amber-400 shrink-0" /> : <FileText className="w-4 h-4 text-slate-400 shrink-0" />}
                      <span className="truncate max-w-xs">{it.name}</span>
                    </div>
                  </td>
                  <td className="py-3 text-slate-400 font-mono text-[11px] max-w-xs truncate" title={it.originalPath}>
                    {it.originalPath}
                  </td>
                  <td className="py-3 text-slate-400 font-mono text-[11px]">
                    {it.isDir ? '文件夹' : it.sizeFormatted}
                  </td>
                  <td className="py-3 text-slate-400 font-mono text-[11px]">
                    {it.deletedAtString}
                  </td>
                  <td className="py-3 text-right pr-2">
                    <div className="flex items-center justify-end space-x-1.5">
                      <button
                        onClick={() => onPromptDeleteTrash(it)}
                        className="px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center space-x-1 transition"
                        title="从回收站删除并移入 Mac 本机废纸篓 (~/.Trash)"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>删除</span>
                      </button>
                      <button
                        onClick={() => onRestoreTrash([it.id])}
                        className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center space-x-1 transition"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>还原</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Multi-selection Floating Bar for Trash */}
      {trashSelectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 border border-slate-700 shadow-2xl rounded-2xl px-5 py-3 flex items-center space-x-4 backdrop-blur-md animate-in fade-in slide-in-from-bottom-4">
          <span className="text-xs text-slate-300 font-medium">
            已选择 <strong className="text-sky-400 font-bold">{trashSelectedIds.size}</strong> 项
          </span>
          <div className="h-4 w-px bg-slate-800" />
          <button
            onClick={() => onRestoreTrash(Array.from(trashSelectedIds))}
            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center space-x-1.5 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>批量还原</span>
          </button>
          <button
            onClick={() => onPromptDeleteTrash()}
            className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center space-x-1.5 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>移入 Mac 废纸篓 (删除)</span>
          </button>
          <button
            onClick={onClearSelection}
            className="text-xs text-slate-400 hover:text-white transition"
          >
            取消选择
          </button>
        </div>
      )}
    </div>
  );
};
