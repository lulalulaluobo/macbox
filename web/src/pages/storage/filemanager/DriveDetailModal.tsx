import React, { useEffect, useState } from 'react';
import { Check, Copy, HardDrive, Pencil, X } from 'lucide-react';

export interface DriveDetailInfo {
  kind: string;
  source?: string;
  total?: string;
  used?: string;
  free?: string;
  usedPercent?: number;
  fileSystem?: string;
  writable?: boolean;
  description?: string;
}

export interface DriveDetailEntry {
  id: string;
  name: string;
  path: string;
  detail: DriveDetailInfo;
}

interface DriveDetailModalProps {
  drive: DriveDetailEntry | null;
  onClose: () => void;
  onSaveName: (driveId: string, nextName: string) => void;
}

export const DriveDetailModal: React.FC<DriveDetailModalProps> = ({ drive, onClose, onSaveName }) => {
  const [name, setName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (drive) {
      setName(drive.name);
      setEditingName(false);
      setCopied(false);
    }
    // 仅在切换硬盘时重置；依赖对象本体的话，父组件轮询刷新会不断清空输入框
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drive?.id]);

  useEffect(() => {
    if (!drive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // 名称输入框内 Esc 先退出编辑而非关闭弹窗
      if (e.key !== 'Escape') return;
      const active = document.activeElement;
      if (editingName && active instanceof HTMLInputElement) {
        setEditingName(false);
        setName(drive.name);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drive?.id, editingName, drive?.name]);

  if (!drive) return null;
  const { detail } = drive;

  const saveName = () => {
    const next = name.trim();
    if (!next || next === drive.name) {
      setEditingName(false);
      setName(drive.name);
      return;
    }
    onSaveName(drive.id, next);
    setEditingName(false);
  };

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(drive.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默忽略
    }
  };

  const rows: Array<{ label: string; value?: React.ReactNode }> = [
    { label: '类型', value: detail.kind },
    {
      label: '容量',
      value:
        detail.total && detail.used ? (
          <span>
            {detail.used} / {detail.total}
            {typeof detail.usedPercent === 'number' && <span className="text-slate-400">（{Math.round(detail.usedPercent)}% 已用）</span>}
          </span>
        ) : detail.total ? (
          <span>{detail.total}</span>
        ) : (
          <span className="text-slate-400">目录直通，随来源而定</span>
        ),
    },
    ...(detail.free ? [{ label: '可用空间', value: <span>{detail.free}</span> }] : []),
    ...(detail.fileSystem ? [{ label: '文件系统', value: <span>{detail.fileSystem}</span> }] : []),
    {
      label: '映射路径',
      value: (
        <span className="flex min-w-0 items-center gap-1.5">
          <code className="truncate font-mono text-[11px] text-slate-600 dark:text-slate-300">{drive.path}</code>
          <button
            type="button"
            onClick={copyPath}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-sky-500 dark:hover:bg-slate-800"
            aria-label="复制映射路径"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </button>
        </span>
      ),
    },
    ...(detail.source ? [{ label: detail.kind === '本机目录直通' ? 'Mac 来源目录' : 'Mac 来源磁盘', value: <span className="break-all">{detail.source}</span> }] : []),
    ...(detail.writable !== undefined ? [{ label: '写入权限', value: <span>{detail.writable ? '可读写' : '只读'}</span> }] : []),
    ...(detail.description ? [{ label: '说明', value: <span className="break-all">{detail.description}</span> }] : []),
  ];

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/35 sm:items-center" role="dialog" aria-modal="true" aria-label={`${drive.name} 硬盘详情`}>
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="关闭硬盘详情" />
      <section className="relative max-h-[85dvh] w-full overflow-y-auto rounded-t-[28px] border-t border-slate-200 bg-white px-4 pb-[calc(18px+env(safe-area-inset-bottom))] pt-3 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:mb-4 sm:max-w-md sm:rounded-[28px] sm:border">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700 sm:hidden" />

        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-500 dark:bg-sky-500/10">
            <HardDrive className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            {editingName ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveName();
                    if (e.key === 'Escape') {
                      setName(drive.name);
                      setEditingName(false);
                    }
                  }}
                  maxLength={24}
                  autoFocus
                  className="w-full min-w-0 rounded-lg border border-sky-300 bg-white px-2 py-1.5 text-sm font-bold text-slate-900 focus:border-sky-500 focus:outline-none dark:border-sky-500/40 dark:bg-slate-950 dark:text-white"
                  aria-label="硬盘显示名称"
                />
                <button type="button" onClick={saveName} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500 text-white hover:bg-sky-600" aria-label="保存名称">
                  <Check className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <h3 className="truncate text-sm font-bold text-slate-900 dark:text-white">{name}</h3>
                <button
                  type="button"
                  onClick={() => setEditingName(true)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-sky-500 dark:hover:bg-slate-800"
                  aria-label="修改名称"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <p className="mt-0.5 text-[11px] text-slate-400">{detail.kind}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        {typeof detail.usedPercent === 'number' && detail.total && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.min(100, Math.max(2, detail.usedPercent))}%` }} />
          </div>
        )}

        <dl className="mt-3 space-y-2.5 border-t border-slate-100 pt-3 dark:border-slate-800">
          {rows.map(({ label, value }) => (
            <div key={label} className="flex items-start justify-between gap-4 text-xs">
              <dt className="shrink-0 text-slate-400">{label}</dt>
              <dd className="min-w-0 text-right font-medium text-slate-700 dark:text-slate-200">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
};
