import React, { useRef, useState } from 'react';
import { ArchiveRestore, CheckCircle2, Download, Info, Upload, Database, ShieldAlert } from 'lucide-react';
import { api } from '../../api';

interface BackupRestoreSectionProps {
  onAlert: (alert: { type: 'success' | 'error'; text: string }) => void;
}

export const BackupRestoreSection: React.FC<BackupRestoreSectionProps> = ({ onAlert }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const downloadBackup = async () => {
    setExporting(true);
    try {
      const { blob, filename } = await api.downloadBackup();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      onAlert({ type: 'success', text: '备份文件已下载，请妥善保存。第一版备份未加密，不要上传到公网。' });
    } catch (error: any) {
      onAlert({ type: 'error', text: `创建备份失败：${error.message}` });
    } finally {
      setExporting(false);
    }
  };

  const restoreBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!window.confirm('恢复会覆盖当前 MacBox 配置和账号，但不会覆盖 /data 数据文件。确定继续吗？')) return;

    setRestoring(true);
    try {
      const result = await api.restoreBackup(file);
      onAlert({ type: 'success', text: result.message });
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (error: any) {
      onAlert({ type: 'error', text: `恢复失败：${error.message}` });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl border border-emerald-200 bg-white/90 shadow-[0_18px_48px_-32px_rgba(16,185,129,0.45)] dark:border-emerald-900/60 dark:bg-slate-900/85">
        <div className="border-b border-emerald-100 bg-[linear-gradient(120deg,#f0fdf8_0%,#ffffff_62%,#effcff_100%)] px-5 py-5 dark:border-emerald-900/50 dark:bg-[linear-gradient(120deg,#102a25_0%,#111827_62%,#102337_100%)] sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-100 text-emerald-600 dark:border-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"><ArchiveRestore className="h-5 w-5" /></div>
            <div><h3 className="text-base font-bold text-slate-900 dark:text-white">配置备份与恢复</h3><p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">重装 MacBox 后恢复账号、存储映射、终端设置和自定义应用，减少重复初始化。</p></div>
          </div>
        </div>
        <div className="space-y-4 p-5 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/35"><div className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100"><Database className="h-4 w-4 text-emerald-500" />备份内容</div><p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">系统配置、Web 用户账号、终端偏好和自定义 Docker 应用定义。</p></div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/35"><div className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100"><Info className="h-4 w-4 text-sky-500" />不会备份</div><p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">/data 文件、数据镜像、VM、Docker 镜像卷和终端会话。</p></div>
          </div>
          <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-200"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>当前第一版不设置备份密码，配置里可能包含夸克登录态。请只保存到自己的 Mac 或移动硬盘，不要上传 GitHub、网盘或公网。</span></div>
          <div className="flex flex-wrap gap-3 pt-1"><button type="button" onClick={() => void downloadBackup()} disabled={exporting || restoring} className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-emerald-500 px-5 text-sm font-bold text-white shadow-sm shadow-emerald-500/20 transition hover:bg-emerald-600 disabled:cursor-wait disabled:opacity-50"><Download className="h-4 w-4" />{exporting ? '正在创建备份…' : '下载配置备份'}</button><input ref={inputRef} type="file" accept=".macbox-backup,.zip,application/zip" onChange={(event) => void restoreBackup(event)} className="hidden" /><button type="button" onClick={() => inputRef.current?.click()} disabled={exporting || restoring} className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"><Upload className="h-4 w-4" />{restoring ? '正在恢复…' : '上传并恢复'}</button></div>
          <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />恢复后会自动退出当前账号并刷新页面，数据盘内容保持不变。</div>
        </div>
      </section>
    </div>
  );
};
