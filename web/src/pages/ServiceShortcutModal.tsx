import React, { useState } from 'react';
import { Check, ExternalLink, Globe2, X } from 'lucide-react';
import type { ServiceShortcut, ServiceShortcutInput } from '../types';
import { DOCKER_SERVICE_ICON_OPTIONS, DockerServiceIcon } from '../components/DockerServiceIcon';

interface ServiceShortcutModalProps {
  initialShortcut?: ServiceShortcut;
  onClose: () => void;
  onSaved: (shortcut: ServiceShortcutInput) => void | Promise<void>;
}

export const ServiceShortcutModal: React.FC<ServiceShortcutModalProps> = ({ initialShortcut, onClose, onSaved }) => {
  const [name, setName] = useState(initialShortcut?.name || '');
  const [url, setURL] = useState(initialShortcut?.url || '');
  const [icon, setIcon] = useState(initialShortcut?.icon || 'globe');
  const [description, setDescription] = useState(initialShortcut?.description || '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedURL = url.trim();
    const trimmedDescription = description.trim();
    if (!trimmedName) {
      setError('请填写服务名称');
      return;
    }
    if (!trimmedURL) {
      setError('请填写访问地址');
      return;
    }
    try {
      const parsed = new URL(trimmedURL);
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) throw new Error('protocol');
    } catch {
      setError('访问地址格式不正确，例如 http://192.168.2.123:30141');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSaved({
        ...(initialShortcut?.id ? { id: initialShortcut.id } : {}),
        source: 'manual',
        name: trimmedName,
        url: trimmedURL,
        icon,
        description: trimmedDescription,
        enabled: true,
      });
    } catch (err: any) {
      setError(err?.message || '保存服务导航失败');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="service-shortcut-title">
      <div className="w-full max-w-lg rounded-t-[28px] border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:rounded-[28px] sm:p-6">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-500 dark:bg-sky-500/10 dark:text-sky-300"><Globe2 className="h-5 w-5" /></span>
            <div className="min-w-0">
              <h3 id="service-shortcut-title" className="text-base font-black text-slate-900 dark:text-white">{initialShortcut ? '编辑服务导航' : '添加服务导航'}</h3>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">手动服务只保存主页入口，不会创建或删除实际服务。</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700" aria-label="关闭"><X className="h-4 w-4" /></button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">服务名称</span>
            <input value={name} onChange={(event) => setName(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-900 outline-none transition focus:border-sky-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white" placeholder="例如：Pi Web" autoFocus />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">访问地址</span>
            <div className="relative">
              <ExternalLink className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-sky-500" />
              <input value={url} onChange={(event) => setURL(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm font-mono text-slate-900 outline-none transition focus:border-sky-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white" placeholder="例如：http://192.168.2.123:30141" inputMode="url" />
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">只支持 http:// 或 https:// 地址，点击后将在新标签页打开。</p>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">备注说明 <span className="font-normal text-slate-400">（可选）</span></span>
            <input value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-900 outline-none transition focus:border-sky-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white" placeholder="例如：VM 内的个人工作台" />
          </label>

          <div>
            <div className="mb-2 text-xs font-bold text-slate-700 dark:text-slate-200">选择图标</div>
            <div className="grid max-h-44 grid-cols-5 gap-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-950/60">
              {DOCKER_SERVICE_ICON_OPTIONS.map((option) => {
                const selected = icon === option.value;
                return (
                  <button key={option.value} type="button" onClick={() => setIcon(option.value)} className={`relative flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl border transition ${selected ? 'border-sky-400 bg-white text-sky-500 shadow-sm dark:bg-slate-800 dark:text-sky-300' : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-white dark:text-slate-400 dark:hover:border-slate-700 dark:hover:bg-slate-800'}`} title={option.label} aria-label={option.label} aria-pressed={selected}>
                    <DockerServiceIcon name={option.value} className="h-5 w-5" />
                    <span className="text-[9px] leading-none">{option.label}</span>
                    {selected && <Check className="absolute right-1 top-1 h-3 w-3 text-sky-500" />}
                  </button>
                );
              })}
            </div>
          </div>

          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 dark:bg-rose-500/10 dark:text-rose-300" role="alert">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <button type="button" onClick={onClose} disabled={saving} className="min-h-11 rounded-xl bg-slate-100 px-4 text-xs font-semibold text-slate-600 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">取消</button>
            <button type="submit" disabled={saving} className="flex min-h-11 items-center gap-1.5 rounded-xl bg-sky-500 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-sky-600 disabled:opacity-50"><Check className={`h-4 w-4 ${saving ? 'animate-pulse' : ''}`} /><span>{saving ? '保存中…' : initialShortcut ? '保存修改' : '添加服务'}</span></button>
          </div>
        </form>
      </div>
    </div>
  );
};
