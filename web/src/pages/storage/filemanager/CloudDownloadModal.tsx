import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, CloudDownload, Folder, Loader2, X } from 'lucide-react';
import { api } from '../../../api';
import { CloudFile, FileItem } from '../../../types';

interface CloudDownloadModalProps {
  files: CloudFile[];
  onClose: () => void;
  onConfirm: (destination: string) => Promise<void>;
}

const NAS_ROOT = '/data';

const parentPath = (value: string) => {
  if (value === NAS_ROOT) return NAS_ROOT;
  const parts = value.split('/').filter(Boolean);
  parts.pop();
  const result = `/${parts.join('/')}`;
  return result === '/' ? NAS_ROOT : result;
};

export const CloudDownloadModal: React.FC<CloudDownloadModalProps> = ({ files, onClose, onConfirm }) => {
  const [currentPath, setCurrentPath] = useState(NAS_ROOT);
  const [folders, setFolders] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!files.length) return;
    setCurrentPath(NAS_ROOT);
    setError('');
  }, [files]);

  useEffect(() => {
    if (!files.length) return;
    let active = true;
    setLoading(true);
    setError('');
    api.listFiles(currentPath)
      .then((result) => {
        if (!active) return;
        setFolders((result.items || []).filter((item) => item.isDir && !item.name.startsWith('.')));
      })
      .catch((err: any) => {
        if (active) setError(err.message || '读取 NAS 目录失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [files, currentPath]);

  const pathLabel = useMemo(() => currentPath.replace(/^\/data\/?/, 'NAS /') || 'NAS', [currentPath]);

  if (!files.length) return null;

  const confirm = async () => {
    setSubmitting(true);
    setError('');
    try {
      await onConfirm(currentPath);
    } catch (err: any) {
      setError(err.message || '创建下载任务失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="选择云盘下载目录">
      <section className="flex max-h-[min(760px,92dvh)] w-full max-w-xl flex-col overflow-hidden rounded-t-[28px] border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:rounded-[28px]">
        <header className="flex items-start gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-500 dark:bg-sky-500/10 dark:text-sky-300"><CloudDownload className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-black text-slate-900 dark:text-white">复制到 NAS</h2>
            <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{files.length === 1 ? `${files[0].name}${files[0].isDir ? '（文件夹）' : ''}` : `已选择 ${files.length} 个项目`}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300" aria-label="关闭"><X className="h-5 w-5" /></button>
        </header>

        <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
            <Folder className="h-4 w-4 shrink-0 text-sky-500" />
            <span className="truncate">{pathLabel}</span>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-slate-400">云端文件夹会连同内部文件一起复制。请选择 NAS 数据目录作为保存位置。</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <button type="button" onClick={() => setCurrentPath(parentPath(currentPath))} disabled={currentPath === NAS_ROOT || loading || submitting} className="mb-2 flex min-h-10 items-center gap-2 rounded-xl px-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-800"><ArrowLeft className="h-4 w-4" />上一级</button>
          {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-300">{error}</div>}
          {loading ? <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-sky-500" /></div> : folders.length === 0 ? <div className="py-12 text-center text-xs text-slate-400">当前目录没有可进入的文件夹</div> : <div className="space-y-1">{folders.map((folder) => <button type="button" key={folder.path} onClick={() => setCurrentPath(folder.path)} disabled={submitting} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left transition hover:bg-sky-50 dark:hover:bg-sky-500/10"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50 text-sky-500 dark:bg-sky-500/10 dark:text-sky-300"><Folder className="h-4 w-4" /></span><span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200">{folder.name}</span><span className="text-xs text-slate-400">进入</span></button>)}</div>}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-4 sm:flex-row sm:justify-end dark:border-slate-800">
          <button type="button" onClick={onClose} disabled={submitting} className="min-h-11 rounded-xl bg-slate-100 px-4 text-sm font-semibold text-slate-600 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300">取消</button>
          <button type="button" onClick={() => void confirm()} disabled={loading || submitting} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-sky-500 px-5 text-sm font-bold text-white shadow-sm shadow-sky-500/20 disabled:cursor-wait disabled:opacity-50"><Check className="h-4 w-4" />{submitting ? '正在创建任务…' : `复制到 ${pathLabel}`}</button>
        </footer>
      </section>
    </div>
  );
};
