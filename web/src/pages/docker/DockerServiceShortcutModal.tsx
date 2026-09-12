import React, { useMemo, useState } from 'react';
import { Check, ExternalLink, Plus, X } from 'lucide-react';
import { ContainerInfo, DockerServiceShortcut } from '../../types';
import { DOCKER_SERVICE_ICON_OPTIONS, DockerServiceIcon } from '../../components/DockerServiceIcon';

interface DockerServiceShortcutModalProps {
  container: ContainerInfo;
  hostIP: string;
  initialShortcut?: DockerServiceShortcut;
  onClose: () => void;
  onSaved: (shortcut: DockerServiceShortcut) => void;
}

export const DockerServiceShortcutModal: React.FC<DockerServiceShortcutModalProps> = ({
  container,
  hostIP,
  initialShortcut,
  onClose,
  onSaved,
}) => {
  const ports = useMemo(() => (
    (container.portsMap || []).filter((port) => Number(port.hostPort) > 0)
  ), [container.portsMap]);
  const [name, setName] = useState(initialShortcut?.name || container.name || container.id.slice(0, 12));
  const [selectedPort, setSelectedPort] = useState(ports.find((port) => initialShortcut?.url.endsWith(`:${port.hostPort}`))?.hostPort || ports[0]?.hostPort || 0);
  const [url, setUrl] = useState(() => (
    initialShortcut?.url || (ports[0]?.hostPort ? `http://${hostIP}:${ports[0].hostPort}` : '')
  ));
  const [icon, setIcon] = useState(initialShortcut?.icon || 'box');
  const [error, setError] = useState<string | null>(null);

  const handlePortChange = (port: number) => {
    setSelectedPort(port);
    setUrl(`http://${hostIP}:${port}`);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedURL = url.trim();
    if (!trimmedName) {
      setError('请填写服务名称');
      return;
    }
    if (!trimmedURL) {
      setError('请填写内网网址，容器至少需要映射一个 Web 端口');
      return;
    }
    try {
      const parsed = new URL(trimmedURL);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
    } catch {
      setError('内网网址格式不正确，例如 http://192.168.2.123:8080');
      return;
    }

    onSaved({
      id: `container:${container.id}`,
      containerName: container.name || container.id,
      name: trimmedName,
      url: trimmedURL,
      icon,
    });
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="w-full max-w-lg rounded-t-[28px] border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:rounded-[28px] sm:p-6">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-500 dark:bg-sky-500/10 dark:text-sky-300">
              <Plus className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-black text-slate-900 dark:text-white">添加到主页服务导航</h3>
              <p className="mt-1 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">容器：{container.name || container.id}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">服务名称</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-900 outline-none transition focus:border-sky-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              placeholder="例如：迅雷下载"
              autoFocus
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">内网网址</span>
            <div className="relative">
              <ExternalLink className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-sky-500" />
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                readOnly={ports.length > 0}
                className={`min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm font-mono text-slate-900 outline-none transition focus:border-sky-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white ${ports.length > 0 ? 'cursor-not-allowed opacity-90' : ''}`}
                placeholder={`例如：http://${hostIP}:8080`}
                inputMode="url"
              />
            </div>
            <p className="mt-1.5 text-[10px] text-slate-500 dark:text-slate-400">
              {ports.length > 0 ? '已根据容器映射端口自动生成；多个端口可在下方切换。' : '该容器没有映射端口，请手动填写可访问的内网网址。'}
            </p>
          </label>

          {ports.length > 1 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="mb-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">选择 Web 端口（可自动回填网址）</div>
              <div className="flex flex-wrap gap-1.5">
                {ports.map((port) => (
                  <button
                    key={`${port.hostPort}-${port.containerPort}-${port.protocol}`}
                    type="button"
                    onClick={() => handlePortChange(port.hostPort)}
                    className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-mono transition ${selectedPort === port.hostPort
                      ? 'border-sky-400 bg-sky-50 font-bold text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-sky-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                    }`}
                  >
                    {port.hostPort} → {port.containerPort}/{port.protocol}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 text-xs font-bold text-slate-700 dark:text-slate-200">选择图标（20 个预设）</div>
            <div className="grid grid-cols-5 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-950/60">
              {DOCKER_SERVICE_ICON_OPTIONS.map((option) => {
                const selected = icon === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setIcon(option.value)}
                    className={`relative flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl border transition ${selected
                      ? 'border-sky-400 bg-white text-sky-500 shadow-sm dark:bg-slate-800 dark:text-sky-300'
                      : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-white dark:text-slate-400 dark:hover:border-slate-700 dark:hover:bg-slate-800'
                    }`}
                    title={option.label}
                    aria-label={option.label}
                    aria-pressed={selected}
                  >
                    <DockerServiceIcon name={option.value} className="h-5 w-5" />
                    <span className="text-[9px] leading-none">{option.label}</span>
                    {selected && <Check className="absolute right-1 top-1 h-3 w-3 text-sky-500" />}
                  </button>
                );
              })}
            </div>
          </div>

          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <button type="button" onClick={onClose} className="min-h-11 rounded-xl bg-slate-100 px-4 text-xs font-semibold text-slate-600 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">取消</button>
            <button type="submit" className="flex min-h-11 items-center gap-1.5 rounded-xl bg-sky-500 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-sky-600">
              <Check className="h-4 w-4" />
              <span>确认添加</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
