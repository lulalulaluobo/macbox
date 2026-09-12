import React, { useEffect, useState } from 'react';
import { Check, ChevronRight, Cloud, Copy, Folder, Loader2, Move, X } from 'lucide-react';
import { api } from '../../../api';
import { CloudMount } from '../../../types';

type CloudTransferOperation = 'copy' | 'move';

interface CloudDestinationModalProps {
  mount: CloudMount;
  operation: CloudTransferOperation;
  count: number;
  initialFid: string;
  initialName: string;
  onClose: () => void;
  onConfirm: (targetFid: string) => Promise<void>;
}

export const CloudDestinationModal: React.FC<CloudDestinationModalProps> = ({ mount, operation, count, initialFid, initialName, onClose, onConfirm }) => {
  const rootFid = mount.rootFid || '0';
  const [parentFid, setParentFid] = useState(initialFid || rootFid);
  const [breadcrumbs, setBreadcrumbs] = useState(() => initialFid && initialFid !== rootFid ? [{ fid: rootFid, name: mount.name }, { fid: initialFid, name: initialName || '当前目录' }] : [{ fid: rootFid, name: mount.name }]);
  const [folders, setFolders] = useState<{ fid: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.listCloudFiles(mount.id, parentFid)
      .then((result) => {
        if (active) setFolders((result.items || []).filter((item) => item.isDir).map((item) => ({ fid: item.fid, name: item.name })));
      })
      .catch((err: any) => { if (active) setError(err.message || '读取云端目录失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [mount.id, parentFid]);

  const jumpTo = (index: number) => {
    const crumb = breadcrumbs[index];
    setParentFid(crumb.fid);
    setBreadcrumbs((current) => current.slice(0, index + 1));
  };

  const openFolder = (folder: { fid: string; name: string }) => {
    setParentFid(folder.fid);
    setBreadcrumbs((current) => [...current, folder]);
  };

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try { await onConfirm(parentFid); } catch (err: any) { setError(err.message || `云端${operation === 'copy' ? '复制' : '移动'}失败`); } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`选择云端${operation === 'copy' ? '复制' : '移动'}目录`}>
      <section className="flex max-h-[min(720px,92dvh)] w-full max-w-xl flex-col overflow-hidden rounded-t-[28px] border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:rounded-[28px]">
        <header className="flex items-start gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-500 dark:bg-sky-500/10 dark:text-sky-300">{operation === 'copy' ? <Copy className="h-5 w-5" /> : <Move className="h-5 w-5" />}</div>
          <div className="min-w-0 flex-1"><h2 className="text-base font-black text-slate-900 dark:text-white">选择{operation === 'copy' ? '复制' : '移动'}目标</h2><p className="mt-1 text-xs text-slate-500">已选择 {count} 个云端项目</p></div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300" aria-label="关闭"><X className="h-5 w-5" /></button>
        </header>
        <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-800"><div className="flex items-center gap-1 overflow-x-auto text-xs font-semibold text-slate-600 dark:text-slate-300"><Cloud className="mr-1 h-4 w-4 shrink-0 text-sky-500" />{breadcrumbs.map((crumb, index) => <React.Fragment key={crumb.fid}><button type="button" onClick={() => jumpTo(index)} className="max-w-[130px] shrink-0 truncate hover:text-sky-600">{crumb.name}</button>{index < breadcrumbs.length - 1 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />}</React.Fragment>)}</div><p className="mt-2 text-[11px] text-slate-400">请选择云端文件夹。文件夹本身不会被移动或复制，只改变所选项目的目标位置。</p></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-300">{error}</div>}
          {loading ? <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-sky-500" /></div> : folders.length === 0 ? <div className="py-12 text-center text-xs text-slate-400">当前目录没有子文件夹，可将项目放到当前目录</div> : <div className="space-y-1">{folders.map((folder) => <button type="button" key={folder.fid} onClick={() => openFolder(folder)} disabled={submitting} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left transition hover:bg-sky-50 disabled:opacity-50 dark:hover:bg-sky-500/10"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50 text-sky-500 dark:bg-sky-500/10 dark:text-sky-300"><Folder className="h-4 w-4" /></span><span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200">{folder.name}</span><span className="text-xs text-slate-400">进入</span></button>)}</div>}
        </div>
        <footer className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-4 sm:flex-row sm:justify-end dark:border-slate-800"><button type="button" onClick={onClose} disabled={submitting} className="min-h-11 rounded-xl bg-slate-100 px-4 text-sm font-semibold text-slate-600 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300">取消</button><button type="button" onClick={() => void submit()} disabled={loading || submitting} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-sky-500 px-5 text-sm font-bold text-white shadow-sm shadow-sky-500/20 disabled:cursor-wait disabled:opacity-50"><Check className="h-4 w-4" />{submitting ? '处理中…' : `确认${operation === 'copy' ? '复制' : '移动'}到此处`}</button></footer>
      </section>
    </div>
  );
};
