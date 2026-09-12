import React, { useState } from 'react';
import { CheckCircle2, Clock3, Download, RefreshCw, Trash2, X, XCircle } from 'lucide-react';
import { BackgroundJob } from '../../../types';

interface CloudTransferTasksModalProps {
  jobs: BackgroundJob[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onCancel: (id: string) => Promise<void>;
  onClear: () => Promise<number>;
}

const formatBytes = (value?: number) => {
  if (!value) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
};

const formatSpeed = (value?: number) => value ? `${formatBytes(value)}/s` : '—';

const statusLabel = (status: BackgroundJob['status']) => ({
  running: '进行中', succeeded: '已完成', failed: '失败', cancelled: '已取消',
}[status] || status);

export const CloudTransferTasksModal: React.FC<CloudTransferTasksModalProps> = ({ jobs, onClose, onRefresh, onCancel, onClear }) => {
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [cancelling, setCancelling] = useState('');
  const [notice, setNotice] = useState('');
  const finishedCount = jobs.filter((job) => job.status !== 'running').length;

  const refresh = async () => {
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  };

  const clear = async () => {
    if (!finishedCount || !window.confirm('只清理任务记录，不会删除已下载文件，也不会影响进行中的任务。是否继续？')) return;
    setClearing(true);
    setNotice('');
    try {
      const count = await onClear();
      setNotice(`已清理 ${count} 条任务记录`);
    } catch (err: any) {
      setNotice(err.message || '清理任务记录失败');
    } finally { setClearing(false); }
  };

  const cancel = async (id: string) => {
    setCancelling(id);
    try { await onCancel(id); } finally { setCancelling(''); }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/35 p-4" role="dialog" aria-modal="true" aria-labelledby="cloud-transfer-tasks-title">
      <div className="flex max-h-[min(720px,calc(100vh-32px))] w-full max-w-2xl flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 id="cloud-transfer-tasks-title" className="text-base font-bold text-slate-900 dark:text-slate-100">传输任务</h2>
            <p className="mt-1 text-xs text-slate-500">共 {jobs.length} 条记录</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={refresh} disabled={refreshing} className="flex h-9 items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 text-xs font-semibold text-slate-600 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300"><RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />刷新</button>
            <button type="button" onClick={clear} disabled={!finishedCount || clearing} className="flex h-9 items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 text-xs font-semibold text-rose-600 disabled:opacity-40 dark:bg-rose-500/10 dark:text-rose-300"><Trash2 className="h-3.5 w-3.5" />{clearing ? '清理中' : '清理记录'}</button>
            <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800" aria-label="关闭任务列表"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {notice && <div className="mb-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/70 dark:text-slate-300">{notice}</div>}
          {jobs.length === 0 ? <div className="flex flex-col items-center justify-center py-16 text-slate-400"><Download className="mb-3 h-9 w-9" /><p className="text-sm">暂无云盘传输任务</p></div> : <div className="space-y-2">{jobs.map((job) => {
            const isFailed = job.status === 'failed';
            const isDone = job.status === 'succeeded';
            const isCancelled = job.status === 'cancelled';
            return <div key={job.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/60">
              <div className="flex items-start gap-2">
                {job.status === 'running' ? <Clock3 className="mt-0.5 h-4 w-4 shrink-0 animate-pulse text-sky-500" /> : isDone ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className={`mt-0.5 h-4 w-4 shrink-0 ${isFailed ? 'text-rose-500' : 'text-slate-400'}`} />}
                <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2 text-xs"><span className="truncate font-semibold text-slate-700 dark:text-slate-200">{job.currentFile || job.message || '云盘下载'}</span><span className={isFailed ? 'text-rose-500' : isDone ? 'text-emerald-500' : isCancelled ? 'text-slate-400' : 'text-sky-600'}>{statusLabel(job.status)}</span></div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className={`h-full rounded-full ${isFailed ? 'bg-rose-400' : isDone ? 'bg-emerald-400' : isCancelled ? 'bg-slate-400' : 'bg-sky-500'}`} style={{ width: `${Math.max(isDone ? 100 : 2, Math.min(100, job.progress || 0))}%` }} /></div>
                  <div className="mt-1.5 flex items-center gap-3 text-[10px] text-slate-400"><span>{job.bytesTotal ? `${formatBytes(job.bytesDone)} / ${formatBytes(job.bytesTotal)}` : `${job.progress || 0}%`}</span><span>{formatSpeed(job.speedBytesPerSecond)}</span>{job.status === 'running' && <button type="button" onClick={() => cancel(job.id)} disabled={cancelling === job.id} className="ml-auto text-rose-500 disabled:opacity-50">{cancelling === job.id ? '取消中' : '取消'}</button>}</div>
                  {job.error && <p className="mt-1 break-all text-[10px] text-rose-500">{job.error}</p>}
                </div>
              </div>
            </div>;
          })}</div>}
        </div>
        <div className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400 dark:border-slate-800">清理只删除任务记录，不删除云端文件或已传输文件。</div>
      </div>
    </div>
  );
};
