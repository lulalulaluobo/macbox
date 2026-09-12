import React from 'react';
import { HardDrive } from 'lucide-react';
import type { DiskInfo, ManagedDisk } from '../../../types';

interface StorageDiskSectionProps {
  visible: boolean;
  loading: boolean;
  disks: DiskInfo[];
  managedDisks: ManagedDisk[];
  selectedDiskId: string;
  isExternalActive: boolean;
  dataPath: string;
  onOpenBindModal: (disk: DiskInfo) => void;
  onOpenSecondaryModal: (disk: DiskInfo) => void;
  onRequestUnbind: () => void;
  onUnbindSecondary: () => void;
}

export const StorageDiskSection: React.FC<StorageDiskSectionProps> = ({
  visible,
  loading,
  disks,
  managedDisks,
  selectedDiskId,
  isExternalActive,
  dataPath,
  onOpenBindModal,
  onOpenSecondaryModal,
  onRequestUnbind,
  onUnbindSecondary,
}) => (
  <>
    <div className={`${visible ? '' : 'hidden'} space-y-3`}>
      <div className="flex items-center justify-between">
        <div><h3 className="text-sm font-bold text-slate-900 dark:text-white">磁盘</h3></div>
        <span className="text-xs text-slate-500 dark:text-slate-400">{disks.length} 个设备</span>
      </div>

      {disks.length === 0 && !loading ? (
        <div className="p-8 rounded-2xl bg-white dark:bg-slate-900/40 border border-dashed border-slate-200 dark:border-slate-800 text-center text-slate-500 dark:text-slate-400 text-sm shadow-xs">
          未扫描到外接磁盘设备，请检查 USB/雷电外接硬盘连接。
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {disks.map((disk) => {
            const isSelected = disk.identifier === selectedDiskId || disk.deviceNode === selectedDiskId || disk.isSelected;
            const roleLabel = isSelected ? '主存储' : disk.isSecondary ? '扩展存储' : disk.isExternal ? '外接磁盘' : '系统磁盘';
            return (
              <article
                key={disk.identifier}
                className={`rounded-2xl border bg-white p-4 dark:bg-slate-900 ${
                  isSelected
                    ? 'border-sky-400 dark:border-sky-500'
                    : disk.isSecondary ? 'border-violet-300 dark:border-violet-700' : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isSelected ? 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400' : disk.isSecondary ? 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                    <HardDrive className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate text-sm font-bold text-slate-900 dark:text-white" title={disk.name}>{disk.name}</h4>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">{roleLabel}{disk.isSSD ? ' · SSD' : ''} · {disk.totalSizeString}</p>
                  </div>
                  {(isSelected || disk.isSecondary) && <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${isSelected ? 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' : 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'}`}>{isSelected ? '使用中' : '已扩展'}</span>}
                </div>

                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className={`h-full ${isSelected ? 'bg-sky-500' : disk.isSecondary ? 'bg-violet-500' : 'bg-slate-400'}`} style={{ width: `${Math.min(disk.usedPercent || 0, 100)}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="truncate text-[11px] text-slate-500">{disk.usedPercent > 0 ? `${disk.usedPercent.toFixed(0)}% 已用` : disk.mounted ? '已就绪' : '未挂载'}</span>
                  {isSelected ? (
                    isExternalActive ? <button type="button" onClick={onRequestUnbind} className="min-h-9 shrink-0 rounded-xl bg-slate-100 px-3 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200" title={dataPath}>解除主盘</button> : <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">主盘</span>
                  ) : disk.isSecondary ? (
                    <button type="button" onClick={onUnbindSecondary} className="min-h-9 shrink-0 rounded-xl bg-slate-100 px-3 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">解除扩展</button>
                  ) : (
                    <div className="flex shrink-0 items-center gap-2">
                      {disk.mountPoint && <button type="button" onClick={() => onOpenBindModal(disk)} className="min-h-9 rounded-xl bg-slate-100 px-3 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">设为主盘</button>}
                      <button type="button" onClick={() => onOpenSecondaryModal(disk)} className="min-h-9 rounded-xl bg-violet-500 px-3 text-xs font-semibold text-white">设为扩展</button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>

    {visible && managedDisks.length > 0 && (
      <details className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-4">
          <span className="text-sm font-bold text-slate-900 dark:text-white">虚拟磁盘</span>
          <span className="text-xs text-slate-500">{managedDisks.length} 个 · 查看详情</span>
        </summary>
        <div className="space-y-3 border-t border-slate-100 p-4 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">Lima 托管 ext4 虚拟磁盘 (Managed Disks)</h4>
            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">动态精简分配 (Thin Provisioning)</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {managedDisks.map((disk) => (
              <div key={disk.name} className="flex flex-col justify-between space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-800/40">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-slate-900 dark:text-slate-200">{disk.name}</span>
                    <span className="rounded bg-sky-500/20 px-1.5 py-0.5 font-mono text-[10px] text-sky-700 dark:text-sky-300">ext4</span>
                  </div>
                  <span className="font-mono text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">实际占用: {disk.actualSizeString || '24 MB'}</span>
                </div>
                <div className="space-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  <p>虚拟上限: <strong className="font-mono text-slate-800 dark:text-slate-300">{(disk.size / 1024 / 1024 / 1024).toFixed(0)} GiB</strong> · 格式: <span className="font-mono text-slate-700 dark:text-slate-300">{disk.format}</span></p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </details>
    )}
  </>
);
