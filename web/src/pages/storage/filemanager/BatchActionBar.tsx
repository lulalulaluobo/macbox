import React from 'react';
import { Copy, Scissors, Trash2 } from 'lucide-react';

interface BatchActionBarProps {
  visible: boolean;
  selectedCount: number;
  onCopy: () => void;
  onCut: () => void;
  onDelete: () => void;
}

export const BatchActionBar: React.FC<BatchActionBarProps> = ({ visible, selectedCount, onCopy, onCut, onDelete }) => {
  if (!visible) return null;
  const disabled = selectedCount === 0;
  const actions = [
    { label: '移动', icon: Scissors, onClick: onCut },
    { label: '复制', icon: Copy, onClick: onCopy },
    { label: '删除', icon: Trash2, onClick: onDelete, danger: true },
  ];

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] grid grid-cols-3 border-t border-slate-200 bg-white px-4 pb-[calc(8px+env(safe-area-inset-bottom))] pt-2 dark:border-slate-700 dark:bg-slate-900 sm:left-1/2 sm:right-auto sm:bottom-6 sm:w-[360px] sm:-translate-x-1/2 sm:rounded-2xl sm:border sm:py-2">
      {actions.map(({ label, icon: Icon, onClick, danger }) => (
        <button key={label} type="button" disabled={disabled} onClick={onClick} className={`flex min-h-12 flex-col items-center justify-center gap-1 text-[10px] font-semibold disabled:opacity-30 ${danger ? 'text-rose-500' : 'text-slate-600 dark:text-slate-300'}`}>
          <Icon className="h-4 w-4" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
};
