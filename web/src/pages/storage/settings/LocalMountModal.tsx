import React from 'react';
import { Check, DownloadCloud, Film, Folder, FolderOpen, FolderPlus, Image, X } from 'lucide-react';
import type { LocalMountCandidate } from '../../../types';

export type MountCategory = 'media' | 'downloads' | 'pictures' | 'custom';

interface LocalMountModalProps {
  open: boolean;
  candidates: LocalMountCandidate[];
  path: string;
  name: string;
  category: MountCategory;
  guestTarget: string;
  writable: boolean;
  loading: boolean;
  pickingHostDirectory: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onSelectCandidate: (candidate: LocalMountCandidate) => void;
  onPathChange: (value: string) => void;
  onPickHostDirectory: () => void;
  onNameChange: (value: string) => void;
  onCategoryChange: (category: MountCategory) => void;
  onGuestTargetChange: (value: string) => void;
  onWritableChange: (value: boolean) => void;
}

export const LocalMountModal: React.FC<LocalMountModalProps> = ({
  open,
  candidates,
  path,
  name,
  category,
  guestTarget,
  writable,
  loading,
  pickingHostDirectory,
  onClose,
  onSubmit,
  onSelectCandidate,
  onPathChange,
  onPickHostDirectory,
  onNameChange,
  onCategoryChange,
  onGuestTargetChange,
  onWritableChange,
}) => {
  if (!open) return null;

  const chooseCategory = (nextCategory: MountCategory, fallbackName: string) => {
    onCategoryChange(nextCategory);
    const targetPrefix = nextCategory === 'pictures' ? 'photos' : nextCategory === 'custom' ? 'shared' : nextCategory;
    onGuestTargetChange(`${targetPrefix}/${name.trim() || fallbackName}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/60 p-3 backdrop-blur-sm dark:bg-black/70 sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="local-mount-modal-title" className="my-2 flex max-h-[calc(100dvh-1rem)] w-full max-w-lg flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:my-4 sm:max-h-[calc(100dvh-2rem)] sm:p-6">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400"><FolderPlus className="h-5 w-5" /></div>
            <h3 id="local-mount-modal-title" className="text-base font-bold text-slate-900 dark:text-white">接入文件</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        <form onSubmit={onSubmit} className="mt-5 flex min-h-0 flex-1 flex-col text-xs">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1 pb-2">
            <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-3 dark:border-sky-900/60 dark:bg-sky-500/10">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-bold text-slate-800 dark:text-slate-100">选择位置</p>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">选择文件夹，也可手动填写完整位置</p>
              </div>
              <FolderOpen className="h-4 w-4 text-sky-500" />
            </div>
            <div className="mt-2 grid max-h-36 gap-2 overflow-y-auto sm:grid-cols-2">
              {candidates.filter((candidate) => candidate.available).map((candidate) => (
                <button
                  key={candidate.hostPath}
                  type="button"
                  disabled={candidate.configured}
                  onClick={() => onSelectCandidate(candidate)}
                  className={`rounded-xl border px-3 py-2 text-left transition ${candidate.configured ? 'cursor-not-allowed border-slate-200 bg-slate-100/80 text-slate-400 dark:border-slate-800 dark:bg-slate-800/60' : path === candidate.hostPath ? 'border-sky-400 bg-white text-sky-700 shadow-sm dark:bg-slate-900 dark:text-sky-300' : 'border-white bg-white/80 text-slate-700 hover:border-sky-300 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200'}`}
                >
                  <span className="block truncate text-xs font-bold">{candidate.name}{candidate.configured ? "已接入" : ''}</span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-slate-500" title={candidate.hostPath}>{candidate.hostPath}</span>
                </button>
              ))}
            </div>
            {candidates.every((candidate) => !candidate.available) && <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">未找到文件夹，请连接磁盘或填位置</p>}
            </div>

            <div>
              <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">本机目录 <span className="text-rose-500">*</span></label>
              <div className="flex gap-2">
                <input type="text" value={path} onChange={(event) => onPathChange(event.target.value)} placeholder="例如：/Users/你的用户名/Downloads" className="min-w-0 flex-1 rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-sky-500/50 dark:bg-sky-500/10 dark:text-white" />
                <button type="button" onClick={onPickHostDirectory} disabled={pickingHostDirectory || loading} className="flex shrink-0 items-center gap-1.5 rounded-xl border border-sky-300 bg-white px-3 py-2 text-xs font-semibold text-sky-700 transition hover:border-sky-400 hover:bg-sky-50 disabled:cursor-wait disabled:opacity-60 dark:border-sky-500/50 dark:bg-slate-900 dark:text-sky-300 dark:hover:bg-sky-500/10">
                  <FolderOpen className={`h-4 w-4 ${pickingHostDirectory ? 'animate-pulse' : ''}`} />
                  <span>{pickingHostDirectory ? "选择中" : "选择位置"}</span>
                </button>
              </div>
              <p className="mt-1.5 text-[11px] leading-5 text-slate-500 dark:text-slate-400">直接使用Mac文件夹，文件留在原处</p>
            </div>

            <div>
              <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">网盘名称</label>
              <input type="text" value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="例如: 蓝光影院" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-slate-900 transition placeholder:text-slate-400 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
            </div>

            <div>
              <label className="mb-1.5 block font-semibold text-slate-700 dark:text-slate-300">文件用途</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button type="button" onClick={() => chooseCategory('media', 'MacMedia')} className={`flex flex-col items-center space-y-1 rounded-xl border p-2.5 text-center transition ${category === 'media' ? 'border-sky-400 bg-sky-50 font-bold text-sky-700 dark:bg-sky-500/20 dark:text-sky-300' : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'}`}><Film className="h-4 w-4" /><span className="text-[11px]">影音</span></button>
                <button type="button" onClick={() => chooseCategory('downloads', 'MacDownloads')} className={`flex flex-col items-center space-y-1 rounded-xl border p-2.5 text-center transition ${category === 'downloads' ? 'border-sky-400 bg-sky-50 font-bold text-sky-700 dark:bg-sky-500/20 dark:text-sky-300' : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'}`}><DownloadCloud className="h-4 w-4" /><span className="text-[11px]">下载</span></button>
                <button type="button" onClick={() => chooseCategory('pictures', 'MacPhotos')} className={`flex flex-col items-center space-y-1 rounded-xl border p-2.5 text-center transition ${category === 'pictures' ? 'border-sky-400 bg-sky-50 font-bold text-sky-700 dark:bg-sky-500/20 dark:text-sky-300' : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'}`}><Image className="h-4 w-4" /><span className="text-[11px]">照片</span></button>
                <button type="button" onClick={() => chooseCategory('custom', 'Folder')} className={`flex flex-col items-center space-y-1 rounded-xl border p-2.5 text-center transition ${category === 'custom' ? 'border-sky-400 bg-sky-50 font-bold text-sky-700 dark:bg-sky-500/20 dark:text-sky-300' : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'}`}><Folder className="h-4 w-4" /><span className="text-[11px]">通用</span></button>
              </div>
            </div>

            <div>
              <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">系统文件 <span className="text-rose-500">*</span></label>
              <input type="text" value={guestTarget} onChange={(event) => onGuestTargetChange(event.target.value)} placeholder="例如：/data/macdownload/download" className="w-full rounded-xl border border-violet-300 bg-violet-50 px-4 py-3 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20 dark:border-violet-500/50 dark:bg-violet-500/10 dark:text-white" />
              <p className="mt-1.5 text-[11px] leading-5 text-slate-500 dark:text-slate-400">只能填写/data下的文件夹</p>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
              <div><span className="block font-semibold text-slate-800 dark:text-slate-200">文件权限</span><span className="text-[11px] text-slate-500 dark:text-slate-400">{writable ? "允许修改" : "只能读取"}</span></div>
              <button type="button" onClick={() => onWritableChange(!writable)} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${writable ? 'border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/20 dark:text-amber-300' : 'border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-300'}`}>{writable ? "允许修改" : "只能读取"}</button>
            </div>
          </div>

          <div className="flex shrink-0 justify-end space-x-2 border-t border-slate-100 bg-white pt-3 dark:border-slate-800 dark:bg-slate-900">
            <button type="button" onClick={onClose} className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">取消</button>
            <button type="submit" disabled={loading} className="flex items-center space-x-1.5 rounded-xl bg-sky-500 px-5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-sky-600 disabled:opacity-50"><Check className="h-3.5 w-3.5" /><span>{loading ? "保存中" : "接入文件"}</span></button>
          </div>
        </form>
      </div>
    </div>
  );
};
