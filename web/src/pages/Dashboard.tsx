import React, { useEffect, useState } from 'react';
import {
  Coffee,
  Cpu,
  HardDrive,
  Play,
  Rocket,
  RotateCw,
  Server,
  Sliders,
  Square,
  X,
} from 'lucide-react';
import { ContainerInfo, DockerServiceShortcut, SystemOverview } from '../types';
import { api } from '../api';
import { DockerServiceIcon } from '../components/DockerServiceIcon';
import { DOCKER_SERVICE_SHORTCUTS_CHANGED_EVENT, loadDockerServiceShortcuts, saveDockerServiceShortcuts } from '../utils/dockerServiceShortcuts';

type DashboardTarget = 'storage' | 'docker' | 'apps' | 'settings';

interface DashboardProps {
  overview?: SystemOverview;
  onRefresh: () => void;
  onNavigateTab: (tab: DashboardTarget) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ overview, onRefresh, onNavigateTab }) => {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [powerLoading, setPowerLoading] = useState(false);
  const [serviceLoading, setServiceLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showSpecsModal, setShowSpecsModal] = useState(false);
  const [specsLoading, setSpecsLoading] = useState(false);
  const [specsSaving, setSpecsSaving] = useState(false);
  const [editCPUs, setEditCPUs] = useState(2);
  const [editMemory, setEditMemory] = useState(4);
  const [editDisk, setEditDisk] = useState(20);
  const [dockerServices, setDockerServices] = useState<ContainerInfo[]>([]);
  const [serviceShortcuts, setServiceShortcuts] = useState<DockerServiceShortcut[]>(() => loadDockerServiceShortcuts());
  const [dockerListLoaded, setDockerListLoaded] = useState(false);

  const sys = overview?.system;
  const vm = overview?.vm;
  const selectedDisk = overview?.storage.selectedDisk;
  const isVMRunning = vm?.status === 'Running';
  const powerActive = overview?.power?.active || false;
  const serviceInstalled = overview?.service?.installed || false;
  const currentAction = actionLoading || overview?.vmAction || '';
  const isActionBusy = Boolean(currentAction);

  useEffect(() => {
    let active = true;
    const loadDockerServices = async () => {
      try {
        const containers = await api.getContainers();
        if (active) {
          setDockerServices(containers || []);
          setDockerListLoaded(true);
        }
      } catch {
        // A transient Docker/API error must not delete the user's shortcuts.
      }
    };
    loadDockerServices();
    const interval = window.setInterval(() => {
      if (!document.hidden) loadDockerServices();
    }, 10000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  // Service shortcuts are browser-local settings. Reconcile them with the
  // authoritative Docker list so deleting a container also removes its home
  // page entry, while a temporary API failure cannot wipe valid shortcuts.
  useEffect(() => {
    if (!dockerListLoaded) return;
    const stored = loadDockerServiceShortcuts();
    const valid = stored.filter((shortcut) => dockerServices.some((container) => (
      container.id === shortcut.id.replace(/^container:/, '') || container.name === shortcut.containerName
    )));
    setServiceShortcuts(valid);
    if (valid.length !== stored.length) saveDockerServiceShortcuts(valid);
  }, [dockerListLoaded, dockerServices]);

  useEffect(() => {
    const loadShortcuts = () => {
      const shortcuts = loadDockerServiceShortcuts();
      if (!dockerListLoaded) {
        setServiceShortcuts(shortcuts);
        return;
      }
      const valid = shortcuts.filter((shortcut) => dockerServices.some((container) => (
        container.id === shortcut.id.replace(/^container:/, '') || container.name === shortcut.containerName
      )));
      setServiceShortcuts(valid);
      if (valid.length !== shortcuts.length) saveDockerServiceShortcuts(valid);
    };
    window.addEventListener('storage', loadShortcuts);
    window.addEventListener(DOCKER_SERVICE_SHORTCUTS_CHANGED_EVENT, loadShortcuts);
    return () => {
      window.removeEventListener('storage', loadShortcuts);
      window.removeEventListener(DOCKER_SERVICE_SHORTCUTS_CHANGED_EVENT, loadShortcuts);
    };
  }, [dockerListLoaded, dockerServices]);

  const notify = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 3200);
  };

  const waitForJob = async (jobId: string) => {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const job = await api.getJob(jobId);
      if (job.status === 'succeeded') return;
      if (job.status === 'failed' || job.status === 'cancelled') {
        throw new Error(job.error || (job.status === 'cancelled' ? '操作已取消' : '虚拟机操作失败'));
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
    throw new Error('虚拟机操作超时，请查看任务状态或稍后重试');
  };

  const handleVMAction = async (action: 'start' | 'stop' | 'restart') => {
    setActionLoading(action);
    try {
      let result: { message: string; jobId: string };
      if (action === 'start') result = await api.startVM();
      else if (action === 'stop') result = await api.stopVM();
      else result = await api.restartVM();
      notify(action === 'start' ? '正在启动服务' : action === 'stop' ? '正在停止服务' : '正在重启虚拟机');
      await waitForJob(result.jobId);
      notify(action === 'start' ? '服务已启动' : action === 'stop' ? '服务已停止' : '虚拟机已重启');
      await onRefresh();
    } catch (err: any) {
      notify(`操作失败：${err.message}`);
      await onRefresh();
    } finally {
      setActionLoading(null);
    }
  };

  const handleTogglePower = async () => {
    setPowerLoading(true);
    try {
      const result = await api.togglePower(!powerActive);
      notify(result.active ? '防休眠已开启' : '防休眠已关闭');
      onRefresh();
    } catch (err: any) {
      notify(`操作失败：${err.message}`);
    } finally {
      setPowerLoading(false);
    }
  };

  const handleToggleService = async () => {
    setServiceLoading(true);
    try {
      if (serviceInstalled) await api.uninstallService();
      else await api.installService();
      notify(serviceInstalled ? '开机自启已关闭' : '开机自启已开启');
      onRefresh();
    } catch (err: any) {
      notify(`操作失败：${err.message}`);
    } finally {
      setServiceLoading(false);
    }
  };

  const handleOpenSpecs = async () => {
    setShowSpecsModal(true);
    setSpecsLoading(true);
    try {
      const config = await api.getVMConfig();
      setEditCPUs(config.cpus || 2);
      setEditMemory(config.memory || 4);
      setEditDisk(config.diskSize || 20);
    } catch (err: any) {
      notify(`读取规格失败：${err.message}`);
    } finally {
      setSpecsLoading(false);
    }
  };

  const handleSaveSpecs = async (event: React.FormEvent) => {
    event.preventDefault();
    setSpecsSaving(true);
    try {
      const result = await api.updateVMConfig({ cpus: editCPUs, memory: editMemory, diskSize: editDisk });
      notify(result.message || '规格已保存');
      setShowSpecsModal(false);
      onRefresh();
    } catch (err: any) {
      notify(`保存失败：${err.message}`);
    } finally {
      setSpecsSaving(false);
    }
  };

  const metrics = [
    { label: 'CPU', value: `${sys ? sys.cpuPercent.toFixed(0) : '--'}%`, progress: sys?.cpuPercent || 0, icon: Cpu, color: 'text-sky-500', bar: 'from-sky-400 to-blue-500' },
    { label: '内存', value: `${sys ? sys.memPercent.toFixed(0) : '--'}%`, progress: sys?.memPercent || 0, icon: Server, color: 'text-violet-500', bar: 'from-violet-400 to-purple-500' },
    { label: '存储', value: selectedDisk?.totalSizeString || '--', progress: selectedDisk?.usedPercent || 0, icon: HardDrive, color: 'text-cyan-500', bar: 'from-cyan-400 to-sky-500' },
  ];

  const serviceEntries = serviceShortcuts.map((shortcut) => ({
    shortcut,
    container: dockerServices.find((container) => (
      container.id === shortcut.id.replace(/^container:/, '') || container.name === shortcut.containerName
    )),
  }));

  const openDockerService = (shortcut: DockerServiceShortcut, container?: ContainerInfo) => {
    if (container?.state !== 'running') {
      notify(container ? `容器 ${container.name} 当前未运行，请先启动容器` : `未找到容器 ${shortcut.containerName}，请重新配置服务导航`);
      return;
    }
    window.open(shortcut.url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="mx-auto flex h-[calc(100dvh-152px)] min-h-[500px] w-full max-w-5xl flex-col gap-3 overflow-hidden sm:h-[calc(100dvh-160px)]">
      {message && (
        <div className="fixed left-1/2 top-20 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-sky-200 bg-white/95 px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200">
          <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500" /><span className="truncate">{message}</span>
          <button type="button" onClick={() => setMessage(null)} aria-label="关闭提示"><X className="h-3.5 w-3.5 text-slate-400" /></button>
        </div>
      )}

      <section className="flex min-h-[76px] items-center gap-3 rounded-[22px] border border-sky-100 bg-white px-4 py-3 shadow-xs dark:border-slate-800 dark:bg-slate-900/80">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-500 dark:bg-sky-500/10 dark:text-sky-300"><Server className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-black tracking-tight text-slate-900 dark:text-white">Mac mini</h1>
            {overview?.configDirty && <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">待重启</span>}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-500"><span className={`h-2 w-2 rounded-full ${isVMRunning ? 'bg-emerald-500' : 'bg-amber-500'}`} /><span className="truncate">{isVMRunning ? `运行中 · ${sys?.uptimeString || '状态稳定'}` : vm?.status || '未启动'}</span></div>
        </div>
        <button type="button" onClick={onRefresh} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-50 text-slate-500 transition hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300" aria-label="刷新状态"><RotateCw className="h-4 w-4" /></button>
      </section>

      <section className="grid grid-cols-3 gap-2.5">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <button key={metric.label} type="button" onClick={metric.label === '存储' ? () => onNavigateTab('storage') : undefined} className="min-w-0 rounded-[20px] border border-slate-200/80 bg-white p-3 text-left shadow-xs dark:border-slate-800 dark:bg-slate-900/75 sm:p-4">
              <div className="flex items-center justify-between gap-1"><span className="truncate text-[10px] font-bold text-slate-500 sm:text-xs">{metric.label}</span><Icon className={`h-4 w-4 shrink-0 ${metric.color}`} /></div>
              <p className="mt-2 truncate text-xl font-black leading-none text-slate-900 dark:text-white sm:text-2xl">{metric.value}</p>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full bg-gradient-to-r ${metric.bar}`} style={{ width: `${Math.min(metric.progress, 100)}%` }} /></div>
            </button>
          );
        })}
      </section>

      <section className="rounded-[22px] border border-slate-200/80 bg-white p-3 shadow-xs dark:border-slate-800 dark:bg-slate-900/75 sm:p-4">
        <div className="flex items-center justify-between gap-3 px-1">
          <div>
            <h2 className="text-xs font-black text-slate-900 dark:text-white">Docker 服务导航</h2>
          </div>
          {serviceEntries.length > 0 && <span className="shrink-0 text-[10px] font-semibold text-slate-400">{serviceEntries.length} 个服务</span>}
        </div>

        {serviceEntries.length === 0 ? (
          <div className="mt-2 flex min-h-20 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 text-center text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-400">
            暂无主页服务，前往 Docker → 容器，点击容器右侧「+」添加
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {serviceEntries.map(({ shortcut, container }) => {
              const isRunning = container?.state === 'running';
              const serviceContent = (
                <>
                  <span className={`flex h-10 w-10 items-center justify-center rounded-2xl ${isRunning ? 'bg-sky-50 text-sky-500 dark:bg-sky-500/10 dark:text-sky-300' : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'}`}>
                    <DockerServiceIcon name={shortcut.icon} className="h-5 w-5" />
                  </span>
                  <span className={`mt-1.5 max-w-full truncate text-xs font-bold ${isRunning ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}`} title={shortcut.name}>{shortcut.name}</span>
                  <span className={`mt-0.5 text-[9px] ${isRunning ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>{isRunning ? '运行中 · 点击打开' : '容器未运行'}</span>
                </>
              );

              return isRunning ? (
                <a key={shortcut.id} href={shortcut.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-col items-center rounded-2xl px-1 py-2 text-center transition hover:bg-sky-50 dark:hover:bg-sky-500/10" title={`打开 ${shortcut.name}：${shortcut.url}`}>
                  {serviceContent}
                </a>
              ) : (
                <button key={shortcut.id} type="button" onClick={() => openDockerService(shortcut, container)} className="flex min-w-0 flex-col items-center rounded-2xl px-1 py-2 text-center transition hover:bg-slate-50 dark:hover:bg-slate-800/60" title={`${shortcut.name} 当前不可用`}>
                  {serviceContent}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-[22px] border border-slate-200/80 bg-white p-3 shadow-xs dark:border-slate-800 dark:bg-slate-900/75 sm:p-4">
        <h2 className="px-1 text-xs font-black text-slate-900 dark:text-white">关键操作</h2>
        <div className="mt-2 grid grid-cols-5 gap-1.5 sm:gap-2">
          <ActionButton label={isVMRunning ? '停止' : '启动'} icon={isVMRunning ? Square : Play} active={!isVMRunning} loading={currentAction === (isVMRunning ? 'stop' : 'start')} disabled={isActionBusy} onClick={() => handleVMAction(isVMRunning ? 'stop' : 'start')} />
          <ActionButton label="重启" icon={RotateCw} loading={currentAction === 'restart'} disabled={isActionBusy} onClick={() => handleVMAction('restart')} />
          <ActionButton label="规格" icon={Sliders} onClick={handleOpenSpecs} />
          <ActionButton label="常驻" icon={Coffee} active={powerActive} loading={powerLoading} onClick={handleTogglePower} />
          <ActionButton label="自启" icon={Rocket} active={serviceInstalled} loading={serviceLoading} onClick={handleToggleService} />
        </div>
      </section>

      {showSpecsModal && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/35 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="w-full max-w-lg rounded-t-[28px] border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:rounded-[28px] sm:p-6">
            <div className="flex items-center justify-between"><div><h3 className="text-lg font-black text-slate-900 dark:text-white">虚拟机规格</h3><p className="mt-1 text-xs text-slate-500">修改后可能需要重启生效</p></div><button type="button" onClick={() => setShowSpecsModal(false)} className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800"><X className="h-4 w-4" /></button></div>
            {specsLoading ? <div className="flex h-44 items-center justify-center"><RotateCw className="h-5 w-5 animate-spin text-sky-500" /></div> : (
              <form onSubmit={handleSaveSpecs} className="mt-5 space-y-4">
                <SpecField label="CPU 核心" value={editCPUs} min={1} max={16} onChange={setEditCPUs} />
                <SpecField label="内存 (GiB)" value={editMemory} min={1} max={64} onChange={setEditMemory} />
                <SpecField label="系统盘 (GiB)" value={editDisk} min={20} max={2048} onChange={setEditDisk} />
                <button type="submit" disabled={specsSaving} className="min-h-11 w-full rounded-2xl bg-sky-500 text-sm font-bold text-white shadow-sm transition hover:bg-sky-600 disabled:opacity-50">{specsSaving ? '保存中…' : '保存规格'}</button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface ActionButtonProps {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

const ActionButton: React.FC<ActionButtonProps> = ({ label, icon: Icon, active, loading, disabled, onClick }) => (
  <button type="button" onClick={onClick} disabled={disabled || loading} className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[10px] font-bold transition disabled:opacity-50 sm:min-h-16 sm:text-xs ${active ? 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300' : 'bg-slate-50 text-slate-600 hover:bg-slate-100 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
    <Icon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /><span className="truncate">{label}</span>
  </button>
);

interface SpecFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

const SpecField: React.FC<SpecFieldProps> = ({ label, value, min, max, onChange }) => (
  <label className="grid grid-cols-[1fr_120px] items-center gap-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
    <span>{label}</span>
    <input type="number" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} className="min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-right outline-none focus:border-sky-400 dark:border-slate-700 dark:bg-slate-800" />
  </label>
);
