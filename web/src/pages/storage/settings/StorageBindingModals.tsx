import React from 'react';
import { AlertCircle, Check, CheckCircle2, HardDrive, RefreshCw, X, Zap } from 'lucide-react';
import type { DiskInfo } from '../../../types';

interface StorageBindingModalsProps {
  showBindModal: boolean;
  bindingDisk: DiskInfo | null;
  bindSizeGB: number;
  bindLoading: boolean;
  showUnbindConfirm: boolean;
  unbindLoading: boolean;
  showSecondaryModal: boolean;
  secondaryTargetDisk: DiskInfo | null;
  secondaryCustomDir: string;
  bindingSecondary: boolean;
  scanningSecondaryPath: boolean;
  onCloseBindModal: () => void;
  onBindSizeChange: (size: number) => void;
  onConfirmBind: () => void;
  onCloseUnbindConfirm: () => void;
  onConfirmUnbind: () => void;
  onCloseSecondaryModal: () => void;
  onRescanSecondaryPath: () => void;
  onConfirmBindSecondary: () => void;
}

export const StorageBindingModals: React.FC<StorageBindingModalsProps> = ({
  showBindModal,
  bindingDisk,
  bindSizeGB,
  bindLoading,
  showUnbindConfirm,
  unbindLoading,
  showSecondaryModal,
  secondaryTargetDisk,
  secondaryCustomDir,
  bindingSecondary,
  scanningSecondaryPath,
  onCloseBindModal,
  onBindSizeChange,
  onConfirmBind,
  onCloseUnbindConfirm,
  onConfirmUnbind,
  onCloseSecondaryModal,
  onRescanSecondaryPath,
  onConfirmBindSecondary,
}) => (
  <>
    {showBindModal && bindingDisk && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm dark:bg-black/70">
        <div className="w-full max-w-lg space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex items-center space-x-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400"><HardDrive className="h-5 w-5" /></div>
              <div><h3 className="text-base font-bold text-slate-900 dark:text-white">绑定外接 SSD 为 NAS 数据盘</h3><p className="text-xs text-slate-500 dark:text-slate-400">{bindingDisk.name} ({bindingDisk.deviceNode})</p></div>
            </div>
            <button type="button" onClick={onCloseBindModal} className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"><X className="h-4 w-4" /></button>
          </div>

          <div className="space-y-4 text-xs text-slate-700 dark:text-slate-300">
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700/60 dark:bg-slate-800/50">
              <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">挂载目录:</span><span className="font-mono font-semibold text-sky-600 dark:text-sky-300">{bindingDisk.mountPoint || '自动识别'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">可用空闲容量:</span><span className="font-mono font-semibold text-slate-900 dark:text-white">{bindingDisk.freeSpaceString || bindingDisk.totalSizeString}</span></div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">NAS 本地数据盘上限 (GiB)</label>
              <p className="mb-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">这是外接盘上的稀疏镜像最大容量，仅用于未直通的应用配置、持久化数据和缓存。通过“本机目录直通”映射的文件仍留在 Mac 原目录，不占用此镜像。建议 10 GiB，纯测试可填写 5 GiB。</p>
              <div className="flex items-center space-x-3"><input type="number" min={5} max={20000} value={bindSizeGB} onChange={(event) => onBindSizeChange(parseInt(event.target.value, 10) || 10)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 font-mono text-sm text-slate-900 transition focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white" /><span className="text-sm font-semibold text-slate-500 dark:text-slate-400">GiB</span></div>
            </div>
          </div>

          <div className="flex justify-end space-x-2 border-t border-slate-100 pt-2 dark:border-slate-800">
            <button type="button" onClick={onCloseBindModal} className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">取消</button>
            <button type="button" onClick={onConfirmBind} disabled={bindLoading} className="flex items-center space-x-1.5 rounded-xl bg-sky-500 px-5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-sky-600 disabled:opacity-50"><Check className="h-3.5 w-3.5" /><span>{bindLoading ? '正在绑定...' : '确认绑定为数据盘'}</span></button>
          </div>
        </div>
      </div>
    )}

    {showUnbindConfirm && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm dark:bg-black/75" role="presentation">
        <div className="w-full max-w-md space-y-5 rounded-3xl border border-rose-200 bg-white p-6 shadow-2xl dark:border-rose-900/60 dark:bg-slate-900" role="dialog" aria-modal="true" aria-labelledby="unbind-storage-title">
          <div className="flex items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"><AlertCircle className="h-5 w-5" /></div><div className="min-w-0"><h3 id="unbind-storage-title" className="text-base font-black text-slate-900 dark:text-white">解除主盘绑定？</h3><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">当前外接镜像无法访问，MacNAS 将移除外接盘链接并恢复本机内部数据盘备份。</p></div></div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-200">外接盘原始数据不会被删除；恢复完成后需要返回主页重新初始化虚拟机。</div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={onCloseUnbindConfirm} disabled={unbindLoading} className="min-h-11 rounded-2xl border border-slate-200 px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">取消</button><button type="button" onClick={onConfirmUnbind} disabled={unbindLoading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-rose-500 px-5 text-sm font-bold text-white transition hover:bg-rose-600 disabled:cursor-wait disabled:opacity-60">{unbindLoading && <RefreshCw className="h-4 w-4 animate-spin" />}{unbindLoading ? '正在恢复…' : '确认解除并恢复'}</button></div>
        </div>
      </div>
    )}

    {showSecondaryModal && secondaryTargetDisk && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm dark:bg-black/80">
        <div className="w-full max-w-lg space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex items-center space-x-3"><div className="rounded-2xl border border-purple-200 bg-purple-50 p-3 text-purple-600 dark:border-purple-500/30 dark:bg-purple-500/15 dark:text-purple-400"><Zap className="h-6 w-6 text-amber-500 dark:text-yellow-300" /></div><div><h3 className="text-base font-bold text-slate-900 dark:text-white">挂载为扩展存储空间 (存储空间 2)</h3><p className="text-xs text-slate-500 dark:text-slate-400">利用高速固态进行扩展</p></div></div>
            <button type="button" onClick={onCloseSecondaryModal} className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"><X className="h-5 w-5" /></button>
          </div>
          <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs dark:border-slate-800 dark:bg-slate-950"><div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">物理磁盘:</span><span className="font-mono font-bold text-slate-900 dark:text-white">{secondaryTargetDisk.name} ({secondaryTargetDisk.totalSizeString})</span></div><div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">可用容量:</span><span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{secondaryTargetDisk.freeSpaceString} 可用</span></div><div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">虚拟机挂载点:</span><span className="font-mono font-bold text-purple-600 dark:text-purple-300">/data/volume2-ssd</span></div></div>
          <div className="space-y-1.5 text-xs"><div className="flex items-center justify-between gap-3"><label className="block font-semibold text-slate-700 dark:text-slate-300">Mac 本机高速存储池文件夹</label><button type="button" onClick={onRescanSecondaryPath} disabled={scanningSecondaryPath} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-purple-600 hover:bg-purple-50 disabled:opacity-50 dark:text-purple-300 dark:hover:bg-purple-500/10"><RefreshCw className={`h-3.5 w-3.5 ${scanningSecondaryPath ? 'animate-spin' : ''}`} />{scanningSecondaryPath ? '扫描中...' : '重新扫描'}</button></div><div className="flex min-h-12 items-center gap-2 rounded-xl border border-purple-300 bg-purple-50 px-4 py-3 dark:border-purple-500/50 dark:bg-purple-500/10"><span className="min-w-0 flex-1 truncate font-mono text-sm text-slate-900 dark:text-white" title={secondaryCustomDir}>{secondaryCustomDir || '未找到可用目录'}</span>{secondaryCustomDir && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />}</div><p className="text-[11px] leading-5 text-slate-500 dark:text-slate-400">已由 MacNAS 根据这块磁盘的实际挂载状态自动扫描并推荐目录。该目录只存放扩展盘镜像；虚拟机内固定访问路径为 /data/volume2-ssd。</p></div>
          <div className="flex items-center justify-end space-x-2 border-t border-slate-100 pt-2 dark:border-slate-800"><button type="button" onClick={onCloseSecondaryModal} className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">取消</button><button type="button" onClick={onConfirmBindSecondary} disabled={bindingSecondary || !secondaryCustomDir.trim()} className="flex items-center space-x-1.5 rounded-xl bg-purple-600 px-5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-purple-500 disabled:opacity-50"><Zap className="h-3.5 w-3.5 text-yellow-300" /><span>{bindingSecondary ? '正在挂载...' : '确认挂载为空间 2'}</span></button></div>
        </div>
      </div>
    )}
  </>
);
