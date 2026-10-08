import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Cpu,
  HardDrive,
  KeyRound,
  Loader2,
  Clock3,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { api } from '../api';
import { BackgroundJob, SystemDiagnostics, SystemOverview, VMConfigInfo, VMPrerequisites } from '../types';

interface InitializationWizardProps {
  overview?: SystemOverview;
  onRefresh: () => Promise<void> | void;
  onOpenStorageSettings?: () => void;
}

type WizardStep = 'check' | 'config' | 'start';

export const InitializationWizard: React.FC<InitializationWizardProps> = ({ overview, onRefresh, onOpenStorageSettings }) => {
  const [step, setStep] = useState<WizardStep>('check');
  const [prerequisites, setPrerequisites] = useState<VMPrerequisites | null>(null);
  const [vmConfig, setVMConfig] = useState<VMConfigInfo | null>(null);
  const [cpus, setCPUs] = useState(2);
  const [memory, setMemory] = useState(4);
  const [diskSize, setDiskSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<BackgroundJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sshReady, setSSHReady] = useState(false);
  const [installCommandCopied, setInstallCommandCopied] = useState(false);
  const [limaInstallJobId, setLimaInstallJobId] = useState<string | null>(null);
  const [limaInstallJob, setLimaInstallJob] = useState<BackgroundJob | null>(null);
  const [startStartedAt, setStartStartedAt] = useState<number | null>(null);
  const [startElapsedSeconds, setStartElapsedSeconds] = useState(0);
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(null);
  const finalizingRef = useRef(false);

  const cpuMax = useMemo(() => Math.max(1, Math.min(16, vmConfig?.hostCpus || 16)), [vmConfig]);
  const diskMin = Math.max(20, vmConfig?.diskSize || 20);
  const selectedDisk = overview?.storage.selectedDisk?.name || "本机存储";
  const storageReady = prerequisites?.storageReady !== false;
  const installCommand = prerequisites?.installCommand || 'brew install lima';

  const loadRequirements = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextPrerequisites, nextConfig, jobsResponse] = await Promise.all([
        api.getVMPrerequisites(),
        api.getVMConfig(),
        api.getJobs().catch(() => ({ jobs: [] })),
      ]);
      setPrerequisites(nextPrerequisites);
      setVMConfig(nextConfig);
      setCPUs(Math.min(Math.max(nextConfig.cpus || 2, 1), Math.max(1, Math.min(16, nextConfig.hostCpus || 16))));
      setMemory(Math.max(2, nextConfig.memory || 4));
      setDiskSize(Math.max(20, nextConfig.diskSize || 20));

      // Resume an in-flight first-run job after a browser refresh or a
      // temporary network interruption instead of starting a second Lima
      // operation against the same instance.
      const activeStart = (jobsResponse.jobs || []).find((candidate) => candidate.kind === 'vm.start' && candidate.status === 'running');
      const activeLimaInstall = (jobsResponse.jobs || []).find((candidate) => candidate.kind === 'lima.install' && candidate.status === 'running');
      if (activeStart) {
        setJob(activeStart);
        setJobId(activeStart.id);
        setStep('start');
        setStartStartedAt(new Date(activeStart.createdAt).getTime() || Date.now());
      }
      if (activeLimaInstall) {
        setLimaInstallJob(activeLimaInstall);
        setLimaInstallJobId(activeLimaInstall.id);
      }
    } catch (err: any) {
      setError(err.message || "未能读取准备情况，请重新检查");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRequirements();
  }, []);

  useEffect(() => {
    if (!limaInstallJobId) return;

    let active = true;
    const poll = async () => {
      try {
        const nextJob = await api.getJob(limaInstallJobId);
        if (!active) return;
        setLimaInstallJob(nextJob);
        if (nextJob.status === 'succeeded') {
          setLimaInstallJobId(null);
          await loadRequirements();
        } else if (nextJob.status === 'failed' || nextJob.status === 'cancelled') {
          setError(nextJob.error || "运行工具安装失败，请查看提示");
          setLimaInstallJobId(null);
        }
      } catch (err: any) {
        if (active) setError(err.message || "未能读取安装进度，请重新检查");
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 1200);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [limaInstallJobId]);

  useEffect(() => {
    if (!jobId) return;

    let active = true;
    const poll = async () => {
      try {
        const nextJob = await api.getJob(jobId);
        if (!active) return;
        setJob(nextJob);

        if (nextJob.status === 'succeeded' && !finalizingRef.current) {
          finalizingRef.current = true;
          try {
            await api.bootstrapSSH();
            if (active) setSSHReady(true);
            if (active) await onRefresh();
          } catch (err: any) {
            if (active) setError(err.message || "系统已启动，远程登录设置未完成");
          } finally {
            if (active) setJobId(null);
          }
        } else if ((nextJob.status === 'failed' || nextJob.status === 'cancelled') && active) {
          setError(nextJob.error || (nextJob.status === 'cancelled' ? "首次设置已取消" : "系统启动失败，请查看提示"));
          void api.getDiagnostics().then(setDiagnostics).catch(() => undefined);
          setJobId(null);
        }
      } catch (err: any) {
        if (active) setError(err.message || "未能读取设置进度，请重新检查");
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [jobId, onRefresh]);

  const handleStart = async () => {
    setSaving(true);
    setError(null);
    setDiagnostics(null);
    setJob(null);
    finalizingRef.current = false;
    setSSHReady(false);
    try {
      // A VM that was already running only needs the SSH/bootstrap step. Do
      // not mark a live VM as config-dirty just because the wizard is being
      // completed after an upgrade.
      if (overview?.vm.status !== 'Running') {
        await api.updateVMConfig({ cpus, memory, diskSize });
      }
      const result = await api.startVM();
      setStartStartedAt(Date.now());
      setStartElapsedSeconds(0);
      setJob({
        id: result.jobId,
        kind: 'vm.start',
        status: 'running',
        stage: 'checking',
        progress: 0,
        message: result.message,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setJobId(result.jobId);
      setStep('start');
    } catch (err: any) {
      setError(err.message || "未能开始设置，请查看提示");
    } finally {
      setSaving(false);
    }
  };

  const retry = () => {
    setJob(null);
    setJobId(null);
    setError(null);
    setDiagnostics(null);
    finalizingRef.current = false;
    setSSHReady(false);
    setStartStartedAt(null);
    setStartElapsedSeconds(0);
    setStep(prerequisites?.ready ? 'config' : 'check');
  };

  const copyInstallCommand = async () => {
    try {
      await navigator.clipboard.writeText(installCommand);
      setInstallCommandCopied(true);
      window.setTimeout(() => setInstallCommandCopied(false), 1800);
    } catch {
      setError(`无法复制，请手动执行：
${installCommand}`);
    }
  };

  const installLima = async () => {
    setError(null);
    setLimaInstallJob(null);
    try {
      const result = await api.installLima();
      setLimaInstallJob({
        id: result.jobId,
        kind: 'lima.install',
        status: 'running',
        message: result.message,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setLimaInstallJobId(result.jobId);
    } catch (err: any) {
      setError(err.message || "未能安装运行工具，请查看提示");
    }
  };

  const isStarting = Boolean(jobId) || job?.status === 'running';
  const isInstallingLima = Boolean(limaInstallJobId) || limaInstallJob?.status === 'running' || limaInstallJob?.status === 'verifying';
  const limaInstallAwaitingCheck = !isInstallingLima && limaInstallJob?.status === 'succeeded' && !prerequisites?.limaInstalled;
  const isComplete = job?.status === 'succeeded' && sshReady && !error;
  const vmIsRunning = overview?.vm.status === 'Running';
  const elapsedLabel = `${Math.floor(startElapsedSeconds / 60)}分${String(startElapsedSeconds % 60).padStart(2, '0')}秒`;
  const stageLabel: Record<string, string> = {
    starting: "准备中",
    checking: "检查中",
    'waiting-ssh': "等待服务",
    'syncing-mounts': "接入目录",
    'verifying-services': "检查服务",
    completed: "已就绪",
    failed: '启动失败',
    cancelled: "已取消",
  };
  const startProgressDetail = job?.error || (
    isStarting
      ? job?.message || (vmIsRunning
        ? "系统已启动，正在等待服务。\n请保持MacBox运行。"
        : "首次下载并启动，通常需要1至5分钟")
      : job?.message
  );

  useEffect(() => {
    if (step !== 'start' || startStartedAt === null || isComplete) return;

    const updateElapsed = () => {
      setStartElapsedSeconds(Math.max(0, Math.floor((Date.now() - startStartedAt) / 1000)));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [isComplete, startStartedAt, step]);

  const stepItems: Array<{ key: WizardStep; label: string }> = [
    { key: 'check', label: "准备检查" },
    { key: 'config', label: "资源设置" },
    { key: 'start', label: "启动系统" },
  ];

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-108px)] w-full max-w-4xl items-start justify-center pb-8 pt-2 sm:min-h-[calc(100dvh-132px)] sm:items-center sm:py-8">
      <section className="w-full overflow-hidden rounded-[28px] border border-sky-100 bg-white shadow-[0_20px_60px_-38px_rgba(15,118,170,0.45)] dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-100 bg-[linear-gradient(120deg,#f2fbff_0%,#ffffff_58%,#fff8ed_100%)] px-5 py-6 dark:border-slate-800 dark:bg-[linear-gradient(120deg,#102337_0%,#0f172a_62%,#211b15_100%)] sm:px-8 sm:py-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-500 text-white shadow-sm shadow-sky-500/25">
              <ServerCog className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-sky-600 dark:text-sky-300">MacBox first run</p>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 dark:text-white sm:text-3xl">首次设置</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">完成设置后自动启动并进入后台</p>
            </div>
          </div>

          <div className="mt-7 grid grid-cols-3 gap-2 sm:gap-3">
            {stepItems.map((item, index) => {
              const active = item.key === step;
              const completed = (step === 'config' && index === 0) || (step === 'start' && index < 2) || isComplete;
              return (
                <div key={item.key} className={`flex items-center gap-2 rounded-2xl px-3 py-2.5 text-xs font-bold ${active ? 'bg-white text-sky-700 shadow-sm dark:bg-slate-800 dark:text-sky-300' : 'text-slate-500 dark:text-slate-400'}`}>
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${completed ? 'bg-emerald-500 text-white' : active ? 'bg-sky-500 text-white' : 'bg-slate-200 text-slate-500 dark:bg-slate-700'}`}>
                    {completed ? <Check className="h-3.5 w-3.5" /> : index + 1}
                  </span>
                  <span className="truncate">{item.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-5 px-5 py-5 sm:px-8 sm:py-7">
          {error && (
            <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-300" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}

          {step === 'start' && job?.stage && !isComplete && (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 dark:border-sky-900/70 dark:bg-sky-950/25">
              <div className="flex items-center justify-between gap-3 text-xs font-bold text-sky-800 dark:text-sky-200">
                <span>当前进度{stageLabel[job.stage] || job.stage}</span>
                <span>{Math.max(0, Math.min(100, job.progress || 0))}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/80 dark:bg-slate-800">
                <div className="h-full rounded-full bg-sky-500 transition-[width] duration-500" style={{ width: `${Math.max(4, Math.min(100, job.progress || 0))}%` }} />
              </div>
            </div>
          )}

          {step === 'check' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-black text-slate-950 dark:text-white">准备检查</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">先检查运行工具，有问题时显示原因</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <StatusCard
                  icon={Terminal}
                  title="运行工具"
                  value={loading ? "检查中" : isInstallingLima ? "安装中" : limaInstallAwaitingCheck ? "复查中" : prerequisites?.limaInstalled ? '已安装' : '未找到'}
                  detail={isInstallingLima || limaInstallAwaitingCheck ? (limaInstallJob?.message || "检查中") : prerequisites?.version || prerequisites?.limaPath || "请先安装运行工具"}
                  ok={!isInstallingLima && Boolean(prerequisites?.limaInstalled)}
                />
                <StatusCard
                  icon={HardDrive}
                  title="数据磁盘"
                  value={loading ? "检查中" : storageReady ? selectedDisk : "需修复"}
                  detail={prerequisites?.storageMessage || "设置后可在“更多”中管理存储"}
                  ok={!loading && storageReady}
                />
                <StatusCard
                  icon={KeyRound}
                  title="后台账号"
                  value="首次登录时创建账号"
                  detail="请在登录页创建自己的管理账号"
                  ok
                />
                <StatusCard
                  icon={ShieldCheck}
                  title="远程登录"
                  value="密钥登录"
                  detail="远程登录仅用密钥，无需设置密码"
                  ok
                />
              </div>

              {!loading && prerequisites && !prerequisites.limaInstalled && !limaInstallAwaitingCheck && (
                <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-200">
                  <p className="font-black">安装工具</p>
                  <p className="leading-6">{prerequisites.message || "在Mac终端安装运行工具。\n安装后返回并重新检查。"} {prerequisites.installHint}</p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <code className="min-w-0 flex-1 break-all rounded-xl bg-white/80 px-3 py-2 font-mono text-xs dark:bg-slate-900/60">{installCommand}</code>
                    <button type="button" onClick={() => void copyInstallCommand()} className="min-h-10 shrink-0 rounded-xl border border-amber-300 px-3 text-xs font-bold transition hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900/40">
                      {installCommandCopied ? '已复制' : '复制命令'}
                    </button>
                  </div>
                  {prerequisites.canInstall && (
                    <button type="button" onClick={() => void installLima()} disabled={isInstallingLima} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 px-5 text-sm font-bold text-white shadow-sm shadow-sky-500/20 transition hover:bg-sky-600 disabled:cursor-wait disabled:opacity-55 sm:w-auto">
                      {isInstallingLima ? <Loader2 className="h-4 w-4 animate-spin" /> : <Terminal className="h-4 w-4" />}
                      {isInstallingLima ? "安装中" : "安装工具"}
                    </button>
                  )}
                  {limaInstallJob?.message && (
                    <p className="text-xs leading-5 text-amber-800 dark:text-amber-200">{limaInstallJob.message}</p>
                  )}
                </div>
              )}

              {!loading && prerequisites && prerequisites.storageReady === false && (
                <div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/25 dark:text-rose-200" role="alert">
                  <p className="font-black">数据盘无法读取，请检查连接</p>
                  <p className="break-words leading-6">{prerequisites.storageMessage}</p>
                  <p className="leading-6">请重新连接原数据盘。<br />也可解除外接盘并恢复本机备份。<br />修复前无法启动系统。</p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {onOpenStorageSettings && <button type="button" onClick={onOpenStorageSettings} className="min-h-10 rounded-xl bg-white px-3 text-xs font-bold text-rose-700 shadow-sm transition hover:bg-rose-100 dark:bg-slate-900 dark:text-rose-200 dark:hover:bg-rose-900/40">存储管理</button>}
                    <button type="button" onClick={() => void loadRequirements()} className="min-h-10 rounded-xl border border-rose-300 px-3 text-xs font-bold transition hover:bg-rose-100 dark:border-rose-800 dark:hover:bg-rose-900/40">重新检查</button>
                  </div>
                </div>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => void loadRequirements()} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  重新检查
                </button>
                <button type="button" onClick={() => setStep('config')} disabled={loading || !prerequisites?.ready} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-sky-500 px-5 text-sm font-bold text-white shadow-sm shadow-sky-500/20 transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-45">
                  下一步
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {step === 'config' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-black text-slate-950 dark:text-white">资源设置</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">设置系统可用资源，之后仍可调整</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <NumberField icon={Cpu} label="处理器" value={cpus} min={1} max={cpuMax} onChange={setCPUs} />
                <NumberField icon={ServerCog} label="内存大小" value={memory} min={2} max={64} onChange={setMemory} />
                <NumberField icon={HardDrive} label="系统空间" value={diskSize} min={diskMin} max={2048} onChange={setDiskSize} />
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-200">
                运行系统名称： <span className="font-bold">macbox</span> 远程登录仅用密钥。<br />可在设置页生成或导入密钥。
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setStep('check')} className="min-h-11 rounded-2xl border border-slate-200 px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">上一步</button>
                <button type="button" onClick={() => void handleStart()} disabled={saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-sky-500 px-5 text-sm font-bold text-white shadow-sm shadow-sky-500/20 transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ServerCog className="h-4 w-4" />}
                  {saving ? "准备中" : "开始设置"}
                </button>
              </div>
            </div>
          )}

          {step === 'start' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-black text-slate-950 dark:text-white">设置中</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">正在启动系统并检查服务。<br />请保持窗口打开。</p>
              </div>

              {!isComplete && (
                <div className="flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-900/70 dark:bg-sky-950/25 dark:text-sky-200" role="status">
                  <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-sky-500" />
                  <div className="min-w-0">
                    <p className="font-bold">后台仍在运行，已等待 {elapsedLabel}</p>
                    <p className="mt-1 leading-5">
                      {vmIsRunning ? "系统已启动，正在检查登录和服务" : "首次启动需下载系统和服务组件"}
                      {' '}超过10分钟未完成可返回重试
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/30">
                <ProgressRow label="启动系统" status={job?.status === 'failed' || job?.status === 'cancelled' ? 'error' : job?.status === 'succeeded' ? 'done' : isStarting ? 'running' : 'waiting'} detail={startProgressDetail} />
                <ProgressRow label="登录设置" status={isComplete ? 'done' : job?.status === 'succeeded' ? 'running' : 'waiting'} detail={isComplete ? "密码禁用" : job?.stage === 'waiting-ssh' ? "配置中" : undefined} />
                <ProgressRow label="进入后台" status={isComplete ? 'done' : 'waiting'} />
              </div>

              {diagnostics && (
                <DiagnosticPanel diagnostics={diagnostics} />
              )}

              {isComplete ? (
                <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/25 dark:text-emerald-300">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  设置完成，正在进入后台
                </div>
              ) : (
                <div className="flex justify-end">
                  <button type="button" onClick={retry} disabled={isStarting} className="min-h-11 rounded-2xl border border-slate-200 px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">返回重试</button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

interface StatusCardProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  detail: string;
  ok: boolean;
}

const DiagnosticPanel: React.FC<{ diagnostics: SystemDiagnostics }> = ({ diagnostics }) => {
  const statusStyle = (status: string) => {
    if (status === 'pass') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/25 dark:text-emerald-300';
    if (status === 'fail') return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/25 dark:text-rose-300';
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-200';
  };

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/30" role="status">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-slate-900 dark:text-white">问题检查</h3>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">检查运行工具、磁盘、应用和目录</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${diagnostics.ok ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'}`}>
          {diagnostics.ok ? "检查通过" : "需要处理"}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {diagnostics.checks.map((check) => (
          <div key={check.id} className={`rounded-xl border px-3 py-2.5 ${statusStyle(check.status)}`}>
            <div className="flex items-start gap-2">
              {check.status === 'pass' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
              <div className="min-w-0">
                <p className="text-xs font-bold">{check.title}</p>
                <p className="mt-1 break-words text-[11px] leading-5">{check.message}</p>
                {check.repair && <p className="mt-1 break-words text-[11px] leading-5 opacity-80">处理建议{check.repair}</p>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const StatusCard: React.FC<StatusCardProps> = ({ icon: Icon, title, value, detail, ok }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/60">
    <div className="flex items-start gap-3">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${ok ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300'}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{title}</p>
          {ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />}
        </div>
        <p className="mt-1 truncate text-sm font-black text-slate-900 dark:text-white">{value}</p>
        <p className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400" title={detail}>{detail}</p>
      </div>
    </div>
  </div>
);

interface NumberFieldProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

const NumberField: React.FC<NumberFieldProps> = ({ icon: Icon, label, value, min, max, onChange }) => (
  <label className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/60">
    <span className="flex items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400"><Icon className="h-4 w-4 text-sky-500" />{label}</span>
    <input type="number" value={value} min={min} max={max} onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value) || min)))} className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-lg font-black text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
    <span className="mt-2 block text-[11px] text-slate-400">检查范围 {min}–{max}</span>
  </label>
);

interface ProgressRowProps {
  label: string;
  status: 'waiting' | 'running' | 'done' | 'error';
  detail?: string;
}

const ProgressRow: React.FC<ProgressRowProps> = ({ label, status, detail }) => (
  <div className="flex items-start gap-3 rounded-xl bg-white px-3 py-3 dark:bg-slate-900/75">
    <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${status === 'done' ? 'bg-emerald-500 text-white' : status === 'error' ? 'bg-rose-500 text-white' : status === 'running' ? 'bg-sky-500 text-white' : 'bg-slate-100 text-slate-400 dark:bg-slate-800'}`}>
      {status === 'done' ? <Check className="h-3.5 w-3.5" /> : status === 'error' ? <AlertCircle className="h-3.5 w-3.5" /> : status === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Circle className="h-2.5 w-2.5" />}
    </span>
    <div className="min-w-0 flex-1">
      <p className={`text-sm font-bold ${status === 'error' ? 'text-rose-700 dark:text-rose-300' : 'text-slate-800 dark:text-slate-100'}`}>{label}</p>
      {detail && <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">{detail}</p>}
    </div>
    <span className="shrink-0 pt-0.5 text-[11px] font-bold text-slate-400">{status === 'done' ? '完成' : status === 'error' ? '失败' : status === 'running' ? '处理中' : "等待中"}</span>
  </div>
);
