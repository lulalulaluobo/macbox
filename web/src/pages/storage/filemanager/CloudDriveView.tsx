import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckSquare, ChevronRight, Cloud, Copy, Download, Folder, ListChecks, MoreHorizontal, Move, Pencil, Plus, RefreshCw, Square, Trash2, Upload, X } from 'lucide-react';
import { api } from '../../../api';
import { BackgroundJob, CloudFile, CloudMount } from '../../../types';
import { CloudDownloadModal } from './CloudDownloadModal';
import { CloudDestinationModal } from './CloudDestinationModal';
import { CloudTransferTasksModal } from './CloudTransferTasksModal';

interface CloudDriveViewProps {
  mount: CloudMount;
  onBack: () => void;
  onRemoved: () => void;
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

export const CloudDriveView: React.FC<CloudDriveViewProps> = ({ mount, onBack, onRemoved }) => {
  const [parentFid, setParentFid] = useState(mount.rootFid || '0');
  const [breadcrumbs, setBreadcrumbs] = useState([{ fid: mount.rootFid || '0', name: mount.name }]);
  const [files, setFiles] = useState<CloudFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloadTargets, setDownloadTargets] = useState<CloudFile[]>([]);
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [showTransferTasks, setShowTransferTasks] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedFids, setSelectedFids] = useState<Set<string>>(new Set());
  const [cloudTransfer, setCloudTransfer] = useState<{ operation: 'copy' | 'move'; files: CloudFile[] } | null>(null);
  const [isDraggingUpload, setIsDraggingUpload] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const lastCompletedUploadRef = useRef('');

  const isTransferJob = (job: BackgroundJob) => job.kind === 'cloud.download' || job.kind === 'cloud.upload';

  const loadFiles = async (fid = parentFid) => {
    setLoading(true);
    setError('');
    try {
      const result = await api.listCloudFiles(mount.id, fid);
      setFiles(result.items || []);
    } catch (err: any) {
      setError(err.message || '读取云盘目录失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setParentFid(mount.rootFid || '0');
    setBreadcrumbs([{ fid: mount.rootFid || '0', name: mount.name }]);
    setSelectionMode(false);
    setSelectedFids(new Set());
    setDownloadTargets([]);
    setCloudTransfer(null);
  }, [mount.id, mount.rootFid, mount.name]);

  useEffect(() => { loadFiles(parentFid); }, [mount.id, parentFid]);

  useEffect(() => {
    let active = true;
    const refreshJobs = () => api.getJobs().then((result) => {
      if (active) setJobs((result.jobs || []).filter(isTransferJob).slice(0, 50));
    }).catch(() => {});
    refreshJobs();
    const timer = window.setInterval(refreshJobs, 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const latest = jobs
      .filter((job) => job.kind === 'cloud.upload' && job.status === 'succeeded')
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
    if (!latest || latest.id === lastCompletedUploadRef.current) return;
    lastCompletedUploadRef.current = latest.id;
    void loadFiles();
  }, [jobs, parentFid, mount.id]);

  const openFolder = (file: CloudFile) => {
    setParentFid(file.fid);
    setBreadcrumbs((current) => [...current, { fid: file.fid, name: file.name }]);
  };

  const jumpTo = (index: number) => {
    const crumb = breadcrumbs[index];
    setParentFid(crumb.fid);
    setBreadcrumbs((current) => current.slice(0, index + 1));
  };

  const goUp = () => {
    if (breadcrumbs.length <= 1) return;
    jumpTo(breadcrumbs.length - 2);
  };

  const selectedFiles = files.filter((file) => selectedFids.has(file.fid));

  const toggleSelection = (file: CloudFile) => {
    setSelectedFids((current) => {
      const next = new Set(current);
      if (next.has(file.fid)) next.delete(file.fid);
      else next.add(file.fid);
      return next;
    });
  };

  const toggleSelectionMode = () => {
    setSelectionMode((current) => {
      if (current) setSelectedFids(new Set());
      return !current;
    });
  };

  const selectAllFiles = () => {
    setSelectedFids((current) => current.size === files.length ? new Set() : new Set(files.map((file) => file.fid)));
  };

  async function refreshJobs() {
    const result = await api.getJobs();
    setJobs((result.jobs || []).filter(isTransferJob).slice(0, 50));
  }

  const clearTransferJobs = async () => {
    const result = await api.clearTransferJobs();
    await refreshJobs();
    return result.count;
  };

  const download = async (targets: CloudFile[], destination: string) => {
    try {
      await Promise.all(targets.map((file) => api.downloadCloudFile(mount.id, file, destination)));
      setDownloadTargets([]);
      setSelectionMode(false);
      setSelectedFids(new Set());
      await refreshJobs();
    } catch (err: any) {
      throw new Error(err.message || '创建下载任务失败');
    }
  };

  const uploadFiles = async (selected: File[]) => {
    if (!selected.length) return;
    setError('');
    try {
      for (const file of selected) await api.uploadCloudFile(mount.id, parentFid, file);
      await refreshJobs();
      await loadFiles();
    } catch (err: any) {
      setError(err.message || '创建云盘上传任务失败');
    }
  };

  const handleUploadDragOver = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingUpload(true);
  };

  const handleUploadDragLeave = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsDraggingUpload(false);
  };

  const handleUploadDrop = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingUpload(false);
    const selected = Array.from(event.dataTransfer.files || []);
    void uploadFiles(selected);
  };

  const transferFiles = async (targetFid: string) => {
    if (!cloudTransfer) return;
    const fids = cloudTransfer.files.map((file) => file.fid);
    if (cloudTransfer.operation === 'copy') await api.copyCloudFiles(mount.id, fids, targetFid);
    else await api.moveCloudFiles(mount.id, fids, targetFid);
    setCloudTransfer(null);
    setSelectionMode(false);
    setSelectedFids(new Set());
    await loadFiles();
  };

  const createFolder = async () => {
    const name = window.prompt('新建云端文件夹', '新建文件夹');
    if (!name?.trim()) return;
    try {
      await api.createCloudFolder(mount.id, parentFid, name.trim());
      await loadFiles();
    } catch (err: any) { setError(err.message || '创建文件夹失败'); }
  };

  const rename = async (file: CloudFile) => {
    const name = window.prompt('重命名', file.name);
    if (!name?.trim() || name.trim() === file.name) return;
    try {
      await api.renameCloudFile(mount.id, file.fid, name.trim());
      await loadFiles();
    } catch (err: any) { setError(err.message || '重命名失败'); }
  };

  const remove = async (file: CloudFile) => {
    if (!window.confirm(`确定删除“${file.name}”吗？此操作会同步删除云端项目。`)) return;
    try {
      await api.deleteCloudFile(mount.id, file.fid);
      await loadFiles();
    } catch (err: any) { setError(err.message || '删除云端文件失败'); }
  };

  const removeMount = async () => {
    if (!window.confirm(`解除“${mount.name}”挂载？不会删除夸克云端文件。`)) return;
    try {
      await api.deleteCloudMount(mount.id);
      onRemoved();
    } catch (err: any) { setError(err.message || '解除云盘挂载失败'); }
  };

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col gap-2.5"
      onDragOver={handleUploadDragOver}
      onDragLeave={handleUploadDragLeave}
      onDrop={handleUploadDrop}
    >
      {isDraggingUpload && (
        <div className="pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center border-4 border-dashed border-sky-400 bg-sky-500/20 backdrop-blur-sm">
          <Upload className="mb-3 h-16 w-16 animate-bounce text-sky-500" />
          <p className="text-xl font-bold text-slate-900 dark:text-white">松开鼠标上传到夸克网盘</p>
          <p className="mt-1 text-sm text-sky-700 dark:text-sky-200">{breadcrumbs[breadcrumbs.length - 1]?.name || mount.name}</p>
        </div>
      )}
      <section className="shrink-0 rounded-[22px] border border-slate-200/80 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/80">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onBack} className="flex h-10 items-center gap-2 rounded-xl bg-slate-100 px-3 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200"><ArrowLeft className="h-4 w-4" />返回</button>
          <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-slate-500">
            <Cloud className="h-4 w-4 shrink-0 text-sky-500" />
            {breadcrumbs.map((crumb, index) => <React.Fragment key={crumb.fid}><button type="button" onClick={() => jumpTo(index)} className="max-w-[140px] truncate hover:text-sky-600">{crumb.name}</button>{index < breadcrumbs.length - 1 && <ChevronRight className="h-3.5 w-3.5 shrink-0" />}</React.Fragment>)}
          </div>
          <input ref={uploadInputRef} type="file" multiple className="hidden" onChange={(event) => { const selected = Array.from(event.target.files || []); event.target.value = ''; void uploadFiles(selected); }} />
          <button type="button" onClick={() => uploadInputRef.current?.click()} className="flex h-10 items-center gap-1.5 rounded-xl bg-sky-500 px-3 text-xs font-semibold text-white shadow-sm"><Upload className="h-4 w-4" />上传</button>
          <button type="button" onClick={createFolder} className="flex h-10 items-center gap-1.5 rounded-xl bg-sky-500 px-3 text-xs font-semibold text-white shadow-sm"><Plus className="h-4 w-4" />新建</button>
          <button type="button" onClick={() => loadFiles()} className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800" aria-label="刷新云盘"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
          <button type="button" onClick={toggleSelectionMode} className={`flex h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold ${selectionMode ? 'bg-sky-500 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`} aria-label="选择云端文件"><CheckSquare className="h-4 w-4" /><span className="hidden sm:inline">选择</span></button>
          {selectionMode && <>
            <button type="button" onClick={selectAllFiles} disabled={!files.length} className="flex h-10 items-center rounded-xl bg-slate-100 px-3 text-xs font-semibold text-slate-600 disabled:opacity-40 dark:bg-slate-800 dark:text-slate-300">{selectedFids.size === files.length && files.length ? '取消全选' : '全选'}</button>
            <button type="button" onClick={() => setDownloadTargets(selectedFiles)} disabled={!selectedFiles.length} className="flex h-10 items-center gap-1.5 rounded-xl bg-sky-500 px-3 text-xs font-semibold text-white disabled:opacity-40"><Download className="h-4 w-4" />下载{selectedFiles.length ? ` (${selectedFiles.length})` : ''}</button>
            <button type="button" onClick={() => setCloudTransfer({ operation: 'copy', files: selectedFiles })} disabled={!selectedFiles.length} className="flex h-10 items-center gap-1.5 rounded-xl bg-slate-100 px-3 text-xs font-semibold text-slate-600 disabled:opacity-40 dark:bg-slate-800 dark:text-slate-300"><Copy className="h-4 w-4" />复制</button>
            <button type="button" onClick={() => setCloudTransfer({ operation: 'move', files: selectedFiles })} disabled={!selectedFiles.length} className="flex h-10 items-center gap-1.5 rounded-xl bg-slate-100 px-3 text-xs font-semibold text-slate-600 disabled:opacity-40 dark:bg-slate-800 dark:text-slate-300"><Move className="h-4 w-4" />移动</button>
          </>}
          <details className="relative">
            <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800"><MoreHorizontal className="h-4 w-4" /></summary>
            <div className="absolute right-0 top-12 z-20 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
              <button type="button" onClick={() => setShowTransferTasks(true)} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs text-slate-700 hover:bg-sky-50 dark:text-slate-200 dark:hover:bg-slate-500/10"><ListChecks className="h-4 w-4 text-sky-500" />传输任务{jobs.some((job) => job.status === 'running') && <span className="ml-auto h-2 w-2 rounded-full bg-sky-500" />}</button>
              <button type="button" onClick={removeMount} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"><X className="h-4 w-4" />解除云盘挂载</button>
            </div>
          </details>
        </div>
      </section>

      <section className="min-h-0 flex-1 overflow-y-auto rounded-[22px] border border-slate-200/80 bg-white p-3 dark:border-slate-800/80 dark:bg-slate-900/60 sm:p-4">
        {error && <div className="mb-3 flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600"><span>{error}</span><button type="button" onClick={() => setError('')}><X className="h-4 w-4" /></button></div>}
        <div className="mb-3 flex items-center gap-2"><button type="button" onClick={goUp} disabled={breadcrumbs.length <= 1} className="flex h-9 items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 text-xs text-slate-600 disabled:opacity-40 dark:bg-slate-800 dark:text-slate-300"><ArrowLeft className="h-3.5 w-3.5" />上一级</button><span className="text-[11px] text-slate-400">{files.length} 个项目</span></div>
        {loading ? <div className="flex justify-center py-20"><RefreshCw className="h-6 w-6 animate-spin text-sky-400" /></div> : files.length === 0 ? <div className="flex flex-col items-center justify-center py-20 text-slate-400"><Cloud className="mb-3 h-10 w-10" /><p className="text-sm">当前云端目录为空</p></div> : <div className="divide-y divide-slate-100 dark:divide-slate-800">{files.map((file) => <div key={file.fid} className={`flex items-center gap-3 py-3 ${selectionMode && selectedFids.has(file.fid) ? 'rounded-xl bg-sky-50 px-2 dark:bg-sky-500/10' : ''}`}>
          {selectionMode && <button type="button" onClick={() => toggleSelection(file)} className="flex h-9 w-9 shrink-0 items-center justify-center text-sky-500" aria-label={`选择${file.name}`}>{selectedFids.has(file.fid) ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5 text-slate-300 dark:text-slate-600" />}</button>}
          <button type="button" onClick={() => selectionMode ? toggleSelection(file) : file.isDir && openFolder(file)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sky-500 dark:bg-slate-800"><Folder className="h-5 w-5" /></span><span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{file.name}</span><span className="block text-[11px] text-slate-400">{file.isDir ? '文件夹' : formatBytes(file.size)}</span></span></button>
          {!selectionMode && <button type="button" onClick={() => setDownloadTargets([file])} className="flex h-9 items-center gap-1.5 rounded-lg bg-sky-50 px-2.5 text-xs font-semibold text-sky-600 dark:bg-sky-500/10 dark:text-sky-300"><Download className="h-3.5 w-3.5" />下载</button>}
          {!selectionMode && <button type="button" onClick={() => rename(file)} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-sky-500 dark:hover:bg-slate-800" aria-label={`重命名${file.name}`}><Pencil className="h-4 w-4" /></button>}
          {!selectionMode && <button type="button" onClick={() => remove(file)} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10" aria-label={`删除${file.name}`}><Trash2 className="h-4 w-4" /></button>}
        </div>)}</div>}
      </section>
      <CloudDownloadModal files={downloadTargets} onClose={() => setDownloadTargets([])} onConfirm={(destination) => download(downloadTargets, destination)} />
      {cloudTransfer && <CloudDestinationModal mount={mount} operation={cloudTransfer.operation} count={cloudTransfer.files.length} initialFid={parentFid} initialName={breadcrumbs[breadcrumbs.length - 1]?.name || mount.name} onClose={() => setCloudTransfer(null)} onConfirm={transferFiles} />}
      {showTransferTasks && <CloudTransferTasksModal jobs={jobs} onClose={() => setShowTransferTasks(false)} onRefresh={refreshJobs} onCancel={async (id) => { await api.cancelJob(id); await refreshJobs(); }} onClear={clearTransferJobs} />}
    </div>
  );
};
