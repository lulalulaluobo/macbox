import React from 'react';
import { Copy, Scissors, Trash2, X } from 'lucide-react';

interface BatchActionBarProps {
  selectedCount: number;
  onCopy: () => void;
  onCut: () => void;
  onDelete: () => void;
  onClearSelection: () => void;
}

export const BatchActionBar: React.FC<BatchActionBarProps> = ({
  selectedCount,
  onCopy,
  onCut,
  onDelete,
  onClearSelection,
}) => {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 border border-sky-500/40 rounded-2xl shadow-2xl px-5 py-3 backdrop-blur-md flex items-center space-x-3 text-xs animate-in slide-in-from-bottom-5">
      <div className="flex items-center space-x-2 pr-3 border-r border-slate-700">
        <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
        <span className="font-bold text-white">已选择 {selectedCount} 项</span>
      </div>
      <button
        onClick={onCopy}
        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium flex items-center space-x-1.5 transition"
      >
        <Copy className="w-3.5 h-3.5 text-sky-400" />
        <span>复制</span>
      </button>
      <button
        onClick={onCut}
        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium flex items-center space-x-1.5 transition"
      >
        <Scissors className="w-3.5 h-3.5 text-amber-400" />
        <span>剪切 (移动)</span>
      </button>
      <button
        onClick={onDelete}
        className="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 font-medium flex items-center space-x-1.5 transition"
      >
        <Trash2 className="w-3.5 h-3.5 text-rose-400" />
        <span>移入回收站</span>
      </button>
      <button
        onClick={onClearSelection}
        className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
        title="取消选择"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
