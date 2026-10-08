import React from 'react';
import {
  Check, Copy, Edit3, Folder, FolderLock, Lock, Plus, Power, RotateCw,
  ShieldCheck, Trash2, Unlock, Zap,
} from 'lucide-react';
import { SambaStatus, SMBShare } from '../../../types';

export interface SMBSharingSectionProps {
  visible: boolean;
  samba: SambaStatus | null;
  shareActionLoading: string | null;
  copiedShareId: string | null;
  restartingSamba: boolean;
  onOpenAddShare: () => void;
  onRestartSamba: () => void;
  onToggleSMBService: (enable: boolean) => void;
  onCopyShareAddress: (address: string, id: string) => void;
  onToggleShare: (share: SMBShare) => void;
  onOpenEditShare: (share: SMBShare) => void;
  onDeleteShare: (share: SMBShare) => void;
}

export const SMBSharingSection: React.FC<SMBSharingSectionProps> = ({
  visible,
  samba,
  shareActionLoading,
  copiedShareId,
  restartingSamba,
  onOpenAddShare,
  onRestartSamba,
  onToggleSMBService,
  onCopyShareAddress,
  onToggleShare,
  onOpenEditShare,
  onDeleteShare,
}) => {
  return (
      <div className={`${visible ? '' : 'hidden'} p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-5`}>
        {/* Top Header & Global Actions */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between pb-5 border-b border-slate-100 dark:border-slate-800/80 gap-4">
          <div className="flex items-start space-x-3.5">
            <div className="w-11 h-11 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-500 dark:text-sky-400 shadow-inner shrink-0 mt-0.5">
              <FolderLock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-wide">文件共享</h3>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold flex items-center space-x-1.5 ${
                  samba?.status === 'running'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                    : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${samba?.status === 'running' ? 'bg-emerald-500 dark:bg-emerald-400 animate-pulse' : 'bg-rose-500 dark:bg-rose-400'}`} />
                  <span>{samba?.status === 'running' ? "运行中" : "系统已停止"}</span>
                </span>
                <span className="text-xs px-2.5 py-0.5 rounded-full font-mono bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                  访问端口 {samba?.port || 4455}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onOpenAddShare()}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md shadow-sky-600/20 transition active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>添加共享</span>
            </button>
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">更多操作</summary>
              <div className="absolute right-0 z-20 mt-2 w-40 space-y-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                <button onClick={onRestartSamba} disabled={restartingSamba} className="flex min-h-10 w-full items-center gap-2 rounded-xl px-2.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800">
                  <RotateCw className={`h-3.5 w-3.5 text-sky-500 ${restartingSamba ? 'animate-spin' : ''}`} /><span>{restartingSamba ? "重启中" : '重启服务'}</span>
                </button>
                <div className="flex min-h-10 items-center gap-2 rounded-xl px-2.5 text-xs text-slate-500 dark:text-slate-400">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /><span>登录密码</span>
                </div>
              </div>
            </details>
            <button
              onClick={() => onToggleSMBService(samba?.status !== 'running')}
              disabled={shareActionLoading === 'service-toggle'}
              className={`p-2 rounded-xl border text-xs font-medium transition ${
                samba?.status === 'running'
                  ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 dark:text-rose-300 border-rose-500/30'
                  : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border-emerald-500/30'
              }`}
              title={samba?.status === 'running' ? "停止共享" : "启动共享"}
            >
              <Power className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Global Connection Instructions */}
        <details className="rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40">
          <summary className="cursor-pointer list-none px-3.5 py-3 text-xs font-bold text-slate-700 dark:text-slate-300">连接方法</summary>
          <div className="flex flex-col justify-between gap-2.5 border-t border-slate-200 p-3.5 text-xs text-slate-700 dark:border-slate-700 dark:text-slate-300 md:flex-row md:items-center">
            <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-sky-500 dark:bg-sky-400 shrink-0" />
            <span>
              <strong>连接方法</strong>在Mac访达中按： <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-mono">Cmd + K</kbd> 输入下面的共享地址。<br />Windows请在文件管理器地址栏输入。 <code>\\&lt;IP&gt;\&lt;共享名&gt;</code>。
            </span>
            </div>
            <div className="flex items-center space-x-3 text-slate-500 dark:text-slate-400 text-[11px] shrink-0">
            <span>共享账号 <code className="text-sky-600 dark:text-sky-300 font-mono font-bold">{samba?.user || 'macbox'}</code></span>
            <span>•</span>
            <span>使用首位后台管理员的密码</span>
            <span>•</span>
            <span>文件权限 <span className="text-slate-700 dark:text-slate-300">系统内的账号可读写这些文件</span></span>
            </div>
          </div>
          <p className="px-3.5 pb-3.5 text-[11px] text-slate-500 dark:text-slate-400">
            共享登录使用首位后台管理员账号。<br />修改该账号密码后会自动同步。<br />各文件夹可分别设置免密访问。
          </p>
        </details>

        {/* Multi-Share List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
              共享目录{samba?.shares?.length || 0})
            </h4>
          </div>

          <div className="grid grid-cols-1 gap-3.5">
            {(!samba?.shares || samba.shares.length === 0) ? (
              <div className="space-y-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center dark:border-slate-700 dark:bg-slate-800/30">
                <FolderLock className="mx-auto h-8 w-8 text-slate-400" />
                <p className="text-sm text-slate-500 dark:text-slate-400">还没有共享文件夹</p>
                <button
                  type="button"
                  onClick={() => onOpenAddShare()}
                  className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition shadow"
                >
                  添加共享
                </button>
              </div>
            ) : (
              samba.shares.map((share) => {
                const isToggling = shareActionLoading === `toggle-${share.id}`;
                const isDeleting = shareActionLoading === `delete-${share.id}`;
                const isCopied = copiedShareId === share.id;

                return (
                  <div
                    key={share.id}
                    className={`p-4 rounded-xl border transition flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                      share.enabled
                        ? 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700/80 shadow-xs'
                        : 'bg-slate-100/60 dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-800/40 opacity-60'
                    }`}
                  >
                    {/* Share Identification & Path */}
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-bold text-slate-900 dark:text-white font-mono tracking-tight flex items-center space-x-1.5">
                          <Folder className={`w-4 h-4 ${share.enabled ? 'text-sky-500 dark:text-sky-400' : 'text-slate-400'}`} />
                          <span>{share.name}</span>
                        </span>

                        {share.diskSource === 'primary' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/25 font-semibold">
                            主存储
                          </span>
                        )}
                        {share.diskSource === 'secondary' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 font-semibold flex items-center space-x-1">
                            <Zap className="w-2.5 h-2.5" />
                            <span>扩展存储</span>
                          </span>
                        )}
                        {share.diskSource === 'passthrough' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/25 font-semibold">
                            本机文件
                          </span>
                        )}
                        {(!share.diskSource || share.diskSource === 'custom') && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold">
                            其他目录
                          </span>
                        )}

                        {share.enabled ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25 font-bold">
                            共享中
                          </span>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700 font-bold">
                            已停用
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                        <span>文件位置 <code className="text-slate-700 dark:text-slate-300 font-mono bg-slate-200/60 dark:bg-slate-800/80 px-1.5 py-0.5 rounded">{share.path}</code></span>
                        {share.comment && <span>备注 <span className="text-slate-700 dark:text-slate-300">{share.comment}</span></span>}
                      </div>

                      {/* Connection Address Box */}
                      {share.address && (
                        <div className="inline-flex items-center space-x-2 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 shadow-xs max-w-full">
                          <span className="text-xs font-mono font-bold text-sky-600 dark:text-sky-300 truncate select-all">
                            {share.address}
                          </span>
                          <button
                            type="button"
                            onClick={() => onCopyShareAddress(share.address!, share.id)}
                            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white transition"
                            title="复制地址"
                          >
                            {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Permissions & Controls */}
                    <div className="flex flex-wrap items-center gap-3 shrink-0">
                      {/* Permission Badges */}
                      <div className="flex items-center space-x-2">
                        {share.writable ? (
                          <span className="text-xs px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 font-semibold flex items-center space-x-1" title="允许新建、修改和删除文件">
                            <Unlock className="w-3 h-3" />
                            <span>允许修改</span>
                          </span>
                        ) : (
                          <span className="text-xs px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 font-semibold flex items-center space-x-1" title="仅能浏览和下载，不能修改或删除">
                            <Lock className="w-3 h-3" />
                            <span>只能读取</span>
                          </span>
                        )}

                        {share.guestOk ? (
                          <span className="text-xs px-2.5 py-1 rounded-lg bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/20 font-semibold" title="同一网络的设备无需密码即可访问">
                            免密访问
                          </span>
                        ) : (
                          <span className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-400 border border-slate-200 dark:border-slate-700 font-semibold flex items-center space-x-1" title="需要共享账号和密码">
                            <ShieldCheck className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                            <span>需密码</span>
                          </span>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center space-x-1.5 pl-2 border-l border-slate-200 dark:border-slate-700/60">
                        {/* Toggle Share Button */}
                        <button
                          type="button"
                          onClick={() => onToggleShare(share)}
                          disabled={isToggling}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1 transition ${
                            share.enabled
                              ? 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                              : 'bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                          }`}
                          title={share.enabled ? "停用共享" : "启用共享"}
                        >
                          {isToggling ? (
                            <RotateCw className="w-3.5 h-3.5 animate-spin" />
                          ) : share.enabled ? (
                            <span>停用</span>
                          ) : (
                            <span>启用</span>
                          )}
                        </button>

                        {/* Edit Button */}
                        <button
                          type="button"
                          onClick={() => onOpenEditShare(share)}
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition"
                          title="编辑共享"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>

                        {/* Delete Button */}
                        <button
                          type="button"
                          onClick={() => onDeleteShare(share)}
                          disabled={isDeleting}
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 dark:bg-slate-800 dark:hover:bg-rose-500/20 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 border border-slate-200 dark:border-slate-700 transition disabled:opacity-50"
                          title="删除共享"
                        >
                          {isDeleting ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
  );
};
