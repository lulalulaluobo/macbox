import React, { useEffect, useState } from 'react';
import { ArrowLeft, Check, Copy, Folder, Move, X } from 'lucide-react';
import { api } from '../../../api';
import { FileItem } from '../../../types';

export type TransferOperation = 'copy' | 'move';
export type ConflictPolicy = 'error' | 'overwrite' | 'rename' | 'skip';

interface TransferDestinationModalProps {
  operation: TransferOperation;
  sourcePaths: string[];
  initialPath: string;
  onClose: () => void;
  onConfirm: (destination: string, policy: ConflictPolicy) => Promise<void>;
}

const policyOptions: Array<{ value: ConflictPolicy; label: string; description: string }> = [
  { value: 'rename', label: '保留两份', description: '自动添加 (1)、(2)…' },
  { value: 'overwrite', label: '覆盖', description: '替换目标中的同名项目' },
  { value: 'skip', label: '跳过', description: '保留目标中的原项目' },
  { value: 'error', label: '遇到冲突即停止', description: '不自动处理同名项目' },
];

export const TransferDestinationModal: React.FC<TransferDestinationModalProps> = ({ operation, sourcePaths, initialPath, onClose, onConfirm }) => {
  const [currentPath, setCurrentPath] = useState(initialPath || '/data');
  const [folders, setFolders] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [policy, setPolicy] = useState<ConflictPolicy>('rename');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.listFiles(currentPath).then((result) => {
      setFolders((result.items || []).filter((item) => item.isDir));
      setError(null);
    }).catch((err: any) => setError(err.message || '读取目录失败')).finally(() => setLoading(false));
  }, [currentPath]);

  const goUp = () => {
    if (currentPath === '/' || currentPath === '/data') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setCurrentPath('/' + parts.join('/'));
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(currentPath, policy);
    } catch (err: any) {
      setError(err.message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <section className="flex max-h-[min(720px,92dvh)] w-full max-w-lg flex-col rounded-t-[28px] border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:rounded-[28px] sm:p-6">
        <header className="flex items-center gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 text-sky-500 dark:bg-sky-500/10 dark:text-sky-300">{operation === 'copy' ? <Copy className="h-5 w-5" /> : <Move className="h-5 w-5" />}</span>
          <div className="min-w-0 flex-1"><h3 className="text-base font-black text-slate-900 dark:text-white">选择{operation === 'copy' ? '复制' : '移动'}目标</h3><p className="mt-1 text-[11px] text-slate-500">已选择 {sourcePaths.length} 个项目</p></div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300" aria-label="关闭"><X className="h-4 w-4" /></button>
        </header>

        <div className="mt-4 flex items-center gap-2"><button type="button" onClick={goUp} disabled={currentPath === '/' || currentPath === '/data'} className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 disabled:opacity-30 dark:bg-slate-800 dark:text-slate-300" aria-label="返回上一级"><ArrowLeft className="h-4 w-4" /></button><div className="min-w-0 flex-1 truncate rounded-xl bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600 dark:bg-slate-950/60 dark:text-slate-300">{currentPath}</div></div>
        <div className="mt-3 min-h-36 flex-1 overflow-y-auto rounded-2xl border border-slate-100 p-2 dark:border-slate-800">
          {loading ? <div className="py-12 text-center text-xs text-slate-400">正在读取目录…</div> : folders.length === 0 ? <div className="py-12 text-center text-xs text-slate-400">当前目录没有子文件夹</div> : folders.map((folder) => <button key={folder.path} type="button" onClick={() => setCurrentPath(folder.path)} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-xs font-semibold text-slate-700 hover:bg-sky-50 dark:text-slate-200 dark:hover:bg-sky-500/10"><Folder className="h-4 w-4 fill-amber-400/20 text-amber-500" />{folder.name}</button>)}
        </div>
        <div className="mt-4"><p className="mb-2 text-xs font-bold text-slate-600 dark:text-slate-300">遇到同名项目时</p><div className="grid grid-cols-2 gap-2">{policyOptions.map((item) => <button key={item.value} type="button" onClick={() => setPolicy(item.value)} className={`rounded-xl border px-3 py-2 text-left transition ${policy === item.value ? 'border-sky-400 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-500/10 dark:text-sky-300' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}><span className="flex items-center gap-1.5 text-xs font-bold">{policy === item.value && <Check className="h-3.5 w-3.5" />}{item.label}</span><span className="mt-1 block text-[10px] text-slate-400">{item.description}</span></button>)}</div></div>
        {error && <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
        <footer className="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800"><button type="button" onClick={onClose} className="rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">取消</button><button type="button" disabled={submitting || loading} onClick={submit} className="rounded-xl bg-sky-500 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-sky-500/20 disabled:opacity-50">{submitting ? '处理中…' : `确认${operation === 'copy' ? '复制' : '移动'}到此处`}</button></footer>
      </section>
    </div>
  );
};
