import React, { useEffect, useMemo, useState } from 'react';
import { Archive, Check, FolderArchive, X } from 'lucide-react';
import { FileItem } from '../../../types';

type ArchiveOperation = 'compress' | 'extract';
type ArchiveFormat = 'zip' | 'rar' | '7z';

interface ArchiveModalProps {
  item: FileItem | null;
  currentPath: string;
  defaultOperation?: ArchiveOperation;
  onClose: () => void;
  onConfirm: (operation: ArchiveOperation, format: ArchiveFormat, destination: string) => Promise<void>;
}

const archiveBaseName = (name: string) => name.replace(/\.(zip|rar|7z)$/i, '');

export const ArchiveModal: React.FC<ArchiveModalProps> = ({ item, currentPath, defaultOperation, onClose, onConfirm }) => {
  const initialExtension = item?.ext?.toLowerCase() || '';
  const initialOperation = defaultOperation || (['zip', 'rar', '7z'].includes(initialExtension) ? 'extract' : 'compress');
  const [operation, setOperation] = useState<ArchiveOperation>(initialOperation);
  const [format, setFormat] = useState<ArchiveFormat>('zip');
  const [destinationName, setDestinationName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    const base = archiveBaseName(item.name);
    setOperation(defaultOperation || (item.ext && ['zip', 'rar', '7z'].includes(item.ext.toLowerCase()) ? 'extract' : 'compress'));
    setFormat(['zip', 'rar', '7z'].includes(item.ext.toLowerCase()) ? item.ext.toLowerCase() as ArchiveFormat : 'zip');
    setDestinationName(item.ext && ['zip', 'rar', '7z'].includes(item.ext.toLowerCase())
      ? base
      : `${base}.zip`);
    setError(null);
  }, [defaultOperation, item]);

  const destination = useMemo(() => {
    const name = destinationName.trim().replace(/^\/+/, '');
    return `${currentPath === '/' ? '' : currentPath}/${name}` || '/data';
  }, [currentPath, destinationName]);

  if (!item) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = destinationName.trim();
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
      setError('请输入当前目录下的有效名称');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(operation, format, destination);
    } catch (err: any) {
      setError(err.message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="w-full max-w-lg rounded-t-[28px] border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:rounded-[28px] sm:p-6">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-500 dark:bg-violet-500/10 dark:text-violet-300">
              {operation === 'extract' ? <FolderArchive className="h-5 w-5" /> : <Archive className="h-5 w-5" />}
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-black text-slate-900 dark:text-white">{operation === 'extract' ? '解压文件' : '压缩文件'}</h3>
              <p className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">{item.name}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
            {(['compress', 'extract'] as ArchiveOperation[]).map((value) => (
              <button key={value} type="button" onClick={() => { setOperation(value); setError(null); }} className={`rounded-xl px-3 py-2.5 text-xs font-bold transition ${operation === value ? 'bg-white text-violet-700 shadow-sm dark:bg-slate-700 dark:text-violet-300' : 'text-slate-500 dark:text-slate-400'}`}>
                {value === 'compress' ? '创建压缩包' : '解压到文件夹'}
              </button>
            ))}
          </div>

          <div>
            <label className="mb-2 block text-xs font-bold text-slate-600 dark:text-slate-300">压缩格式</label>
            <div className="grid grid-cols-3 gap-2">
              {(['zip', '7z', 'rar'] as ArchiveFormat[]).map((value) => (
                <button key={value} type="button" onClick={() => { setFormat(value); if (operation === 'compress' && value !== 'zip') setDestinationName(`${archiveBaseName(item.name)}.${value}`); }} className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-bold uppercase transition ${format === value ? 'border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-500 dark:bg-violet-500/10 dark:text-violet-300' : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400'}`}>
                  {format === value && <Check className="h-3.5 w-3.5" />}{value}
                </button>
              ))}
            </div>
            {format !== 'zip' && <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-300">7z/RAR 需要虚拟机已安装对应命令行工具；ZIP 可直接使用。</p>}
          </div>

          <div>
            <label htmlFor="archive-destination" className="mb-2 block text-xs font-bold text-slate-600 dark:text-slate-300">{operation === 'compress' ? '压缩包名称' : '解压目录名称'}</label>
            <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 dark:border-slate-700 dark:bg-slate-950/60">
              <span className="shrink-0 text-xs text-slate-400">{currentPath}/</span>
              <input id="archive-destination" value={destinationName} onChange={(event) => setDestinationName(event.target.value)} className="min-w-0 flex-1 bg-transparent px-1 py-3 text-sm text-slate-900 outline-none dark:text-white" autoFocus />
            </div>
          </div>

          {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <button type="button" onClick={onClose} className="rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">取消</button>
            <button type="submit" disabled={submitting} className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-violet-600/20 disabled:opacity-50">
              <Archive className="h-3.5 w-3.5" />{submitting ? '处理中…' : '确认执行'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
