import React from 'react';
import {
  ArrowLeft,
  Check,
  Folder,
  FolderOpen,
  Lock,
  RefreshCw,
  RotateCw,
  Unlock,
  X,
} from 'lucide-react';
import type { FileItem, SMBShare } from '../../../types';

interface SMBShareModalsProps {
  showShareModal: boolean;
  editingShare: SMBShare | null;
  shareFormName: string;
  shareFormPath: string;
  shareFormComment: string;
  shareFormWritable: boolean;
  shareFormGuestOk: boolean;
  shareFormEnabled: boolean;
  shareActionLoading: string | null;
  showSharePathPicker: boolean;
  sharePickerPath: string;
  sharePickerFolders: FileItem[];
  sharePickerLoading: boolean;
  onCloseShareModal: () => void;
  onShareFormNameChange: (value: string) => void;
  onShareFormPathPicker: () => void;
  onShareFormCommentChange: (value: string) => void;
  onShareFormWritableChange: (value: boolean) => void;
  onShareFormGuestOkChange: (value: boolean) => void;
  onShareFormEnabledChange: (value: boolean) => void;
  onSaveShare: (event: React.FormEvent) => void;
  onCloseSharePathPicker: () => void;
  onLoadSharePickerFolders: (path: string) => void;
  onConfirmSharePickerPath: () => void;
}

export const SMBShareModals: React.FC<SMBShareModalsProps> = ({
  showShareModal,
  editingShare,
  shareFormName,
  shareFormPath,
  shareFormComment,
  shareFormWritable,
  shareFormGuestOk,
  shareFormEnabled,
  shareActionLoading,
  showSharePathPicker,
  sharePickerPath,
  sharePickerFolders,
  sharePickerLoading,
  onCloseShareModal,
  onShareFormNameChange,
  onShareFormPathPicker,
  onShareFormCommentChange,
  onShareFormWritableChange,
  onShareFormGuestOkChange,
  onShareFormEnabledChange,
  onSaveShare,
  onCloseSharePathPicker,
  onLoadSharePickerFolders,
  onConfirmSharePickerPath,
}) => (
  <>
    {showShareModal && (
      <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 dark:bg-black/75 sm:items-center sm:p-4">
        <div className="h-[100dvh] w-full max-w-xl space-y-5 overflow-y-auto bg-white p-4 dark:bg-slate-900 sm:h-auto sm:max-h-[90dvh] sm:rounded-3xl sm:border sm:border-slate-200 sm:p-6 sm:shadow-2xl dark:sm:border-slate-800">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              {editingShare ? '编辑 SMB 共享' : '新增 SMB 共享目录'}
            </h3>
            <button
              type="button"
              onClick={onCloseShareModal}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={onSaveShare} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                共享服务名称 <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={shareFormName}
                onChange={(event) => onShareFormNameChange(event.target.value)}
                placeholder="例如：硬盘2或MediaShare"
                required
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 font-mono text-sm text-slate-900 transition placeholder:text-slate-400 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                共享目录 <span className="text-rose-500">*</span>
              </label>
              <button
                type="button"
                onClick={onShareFormPathPicker}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-left transition hover:border-sky-300 hover:bg-sky-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-sky-600"
              >
                <FolderOpen className="h-5 w-5 shrink-0 text-sky-500" />
                <span className={`min-w-0 flex-1 truncate font-mono text-sm ${shareFormPath ? 'text-slate-900 dark:text-white' : 'text-slate-400'}`}>
                  {shareFormPath || '点击选择 MacBox 中的文件夹'}
                </span>
                <span className="shrink-0 text-xs font-semibold text-sky-600 dark:text-sky-400">选择</span>
              </button>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">备注说明</label>
              <input
                type="text"
                value={shareFormComment}
                onChange={(event) => onShareFormCommentChange(event.target.value)}
                placeholder="例如: 家庭相册"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700/70 dark:bg-slate-800/50">
              <span className="block text-xs font-bold text-slate-700 dark:text-slate-300">权限与安全控制</span>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => onShareFormWritableChange(true)}
                  className={`flex items-start space-x-2 rounded-xl border p-3 text-left transition ${shareFormWritable ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-white' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/40 dark:text-slate-400'}`}
                >
                  <Unlock className={`mt-0.5 h-4 w-4 ${shareFormWritable ? 'text-emerald-500 dark:text-emerald-400' : 'text-slate-400'}`} />
                  <div>
                    <span className="block text-xs font-bold">读写模式 (RW)</span>
                    <span className="mt-0.5 block text-[10px] text-slate-500 dark:text-slate-400">允许上传与修改</span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onShareFormWritableChange(false)}
                  className={`flex items-start space-x-2 rounded-xl border p-3 text-left transition ${!shareFormWritable ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-white' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/40 dark:text-slate-400'}`}
                >
                  <Lock className={`mt-0.5 h-4 w-4 ${!shareFormWritable ? 'text-amber-500 dark:text-amber-400' : 'text-slate-400'}`} />
                  <div>
                    <span className="block text-xs font-bold">只读模式 (RO)</span>
                    <span className="mt-0.5 block text-[10px] text-slate-500 dark:text-slate-400">仅浏览与下载</span>
                  </div>
                </button>
              </div>
              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-white p-2.5 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700/60">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">允许匿名免密直接访问 (Guest OK)</span>
                <input type="checkbox" checked={shareFormGuestOk} onChange={(event) => onShareFormGuestOkChange(event.target.checked)} className="h-4 w-4 cursor-pointer rounded border-slate-300 text-sky-500 focus:ring-0 dark:border-slate-700" />
              </label>
              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-white p-2.5 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700/60">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">立即启用此项共享 (Enabled)</span>
                <input type="checkbox" checked={shareFormEnabled} onChange={(event) => onShareFormEnabledChange(event.target.checked)} className="h-4 w-4 cursor-pointer rounded border-slate-300 text-emerald-500 focus:ring-0 dark:border-slate-700" />
              </label>
            </div>

            <div className="flex items-center justify-end space-x-2 border-t border-slate-100 pt-2 dark:border-slate-800">
              <button type="button" onClick={onCloseShareModal} className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">取消</button>
              <button type="submit" disabled={shareActionLoading === 'save'} className="flex items-center space-x-1.5 rounded-xl bg-sky-500 px-5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-sky-600 disabled:opacity-50">
                {shareActionLoading === 'save' ? <><RotateCw className="h-3.5 w-3.5 animate-spin" /><span>正在应用...</span></> : <><Check className="h-3.5 w-3.5" /><span>{editingShare ? '保存修改' : '确认创建'}</span></>}
              </button>
            </div>
          </form>
        </div>
      </div>
    )}

    {showSharePathPicker && (
      <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="选择共享目录">
        <section className="flex h-[82dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] bg-white dark:bg-slate-900 sm:h-[min(680px,85dvh)] sm:rounded-3xl sm:border sm:border-slate-200 dark:sm:border-slate-700">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">选择共享目录</h3>
              <p className="mt-0.5 truncate font-mono text-[11px] text-sky-600 dark:text-sky-400">{sharePickerPath}</p>
            </div>
            <button type="button" onClick={onCloseSharePathPicker} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300" aria-label="关闭目录选择"><X className="h-4 w-4" /></button>
          </header>
          <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-4 py-2 dark:border-slate-800">
            <button
              type="button"
              disabled={sharePickerPath === '/'}
              onClick={() => {
                const parent = sharePickerPath.split('/').slice(0, -1).join('/') || '/';
                onLoadSharePickerFolders(parent);
              }}
              className="flex min-h-10 items-center gap-1.5 rounded-xl bg-slate-100 px-3 text-xs font-semibold text-slate-700 disabled:opacity-40 dark:bg-slate-800 dark:text-slate-200"
            ><ArrowLeft className="h-4 w-4" />上一级</button>
            <span className="min-w-0 flex-1 truncate text-right text-xs text-slate-400">点击文件夹继续进入</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
            {sharePickerLoading ? <div className="flex h-32 items-center justify-center gap-2 text-sm text-slate-400"><RefreshCw className="h-4 w-4 animate-spin" />读取目录…</div> : sharePickerFolders.length === 0 ? <div className="flex h-32 flex-col items-center justify-center gap-2 text-sm text-slate-400"><FolderOpen className="h-7 w-7" />当前目录没有子文件夹</div> : sharePickerFolders.map((folder) => <button key={folder.path} type="button" onClick={() => onLoadSharePickerFolders(folder.path)} className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-sky-50 dark:hover:bg-slate-800"><Folder className="h-6 w-6 shrink-0 fill-sky-500/15 text-sky-500" /><span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{folder.name}</span><span className="text-slate-300">›</span></button>)}
          </div>
          <footer className="grid shrink-0 grid-cols-[auto_1fr] gap-2 border-t border-slate-200 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 dark:border-slate-800 dark:bg-slate-900">
            <button type="button" onClick={onCloseSharePathPicker} className="min-h-11 rounded-xl bg-slate-100 px-4 text-sm font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">取消</button>
            <button type="button" onClick={onConfirmSharePickerPath} className="min-h-11 rounded-xl bg-sky-500 px-4 text-sm font-bold text-white">选择当前目录</button>
          </footer>
        </section>
      </div>
    )}
  </>
);
