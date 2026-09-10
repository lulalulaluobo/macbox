import React, { useState, useEffect } from 'react';
import { Play, Square, RotateCw, Cpu, HardDrive, Server, Globe, ExternalLink, ShieldCheck, Coffee, Zap, Rocket, Settings, Sliders, Info, X } from 'lucide-react';
import { SystemOverview, AppMetadata, VMConfigInfo } from '../types';
import { api } from '../api';

interface DashboardProps {
  overview?: SystemOverview;
  apps: AppMetadata[];
  onRefresh: () => void;
  onNavigateTab: (tab: 'dashboard' | 'storage' | 'docker' | 'apps') => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  overview,
  apps,
  onRefresh,
  onNavigateTab,
}) => {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [powerLoading, setPowerLoading] = useState<boolean>(false);
  const [serviceLoading, setServiceLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);

  // VM Specs Modal
  const [showSpecsModal, setShowSpecsModal] = useState(false);
  const [specsLoading, setSpecsLoading] = useState(false);
  const [specsSaving, setSpecsSaving] = useState(false);
  const [specsInfo, setSpecsInfo] = useState<VMConfigInfo | null>(null);
  const [editCPUs, setEditCPUs] = useState(2);
  const [editMemory, setEditMemory] = useState(4);
  const [editDisk, setEditDisk] = useState(20);

  const handleOpenSpecs = async () => {
    setSpecsLoading(true);
    setShowSpecsModal(true);
    try {
      const cfg = await api.getVMConfig();
      setSpecsInfo(cfg);
      setEditCPUs(cfg.cpus || 2);
      setEditMemory(cfg.memory || 4);
      setEditDisk(cfg.diskSize || 20);
    } catch (err: any) {
      setMessage(`获取虚拟机配置失败: ${err.message}`);
    } finally {
      setSpecsLoading(false);
    }
  };

  const handleSaveSpecs = async (e: React.FormEvent) => {
    e.preventDefault();
    setSpecsSaving(true);
    try {
      const res = await api.updateVMConfig({
        cpus: editCPUs,
        memory: editMemory,
        diskSize: editDisk,
      });
      setMessage(res.message || '虚拟机硬件规格已更新！');
      setShowSpecsModal(false);
      onRefresh();
    } catch (err: any) {
      setMessage(`更新虚拟机规格失败: ${err.message}`);
    } finally {
      setSpecsSaving(false);
    }
  };

  const sys = overview?.system;
  const vm = overview?.vm;
  const docker = overview?.docker;
  const power = overview?.power;
  const service = overview?.service;
  const selectedDisk = overview?.storage.selectedDisk;

  const powerActive = power?.active || false;
  const serviceInstalled = service?.installed || false;

  const handleTogglePower = async () => {
    setPowerLoading(true);
    try {
      const updated = await api.togglePower(!powerActive);
      setMessage(updated.active ? '☕ 已激活 24h 防休眠守护（阻止系统与磁盘休眠，允许显示器息屏）' : '已关闭防休眠，系统闲置时将按 macOS 默认策略休眠');
      onRefresh();
    } catch (err: any) {
      setMessage(`切换防休眠失败: ${err.message}`);
    } finally {
      setPowerLoading(false);
    }
  };

  const handleToggleService = async () => {
    setServiceLoading(true);
    try {
      if (serviceInstalled) {
        await api.uninstallService();
        setMessage('已卸载 LaunchAgent 开机自启服务');
      } else {
        await api.installService();
        setMessage('🚀 已成功安装并激活 LaunchAgent 开机免登录自启服务！Mac 重启后自动在后台提供服务');
      }
      onRefresh();
    } catch (err: any) {
      setMessage(`配置开机自启失败: ${err.message}`);
    } finally {
      setServiceLoading(false);
    }
  };

  const vmAction = overview?.vmAction || '';
  const configDirty = overview?.configDirty || false;
  const isActionBusy = !!actionLoading || !!vmAction;
  const currentAction = actionLoading || vmAction;

  useEffect(() => {
    if (!overview?.vmAction) {
      setActionLoading(null);
    }
  }, [overview?.vmAction]);

  const handleVMAction = async (action: 'start' | 'stop' | 'restart') => {
    setActionLoading(action);
    setMessage(null);
    try {
      if (action === 'start') await api.startVM();
      if (action === 'stop') await api.stopVM();
      if (action === 'restart') await api.restartVM();
      setMessage(
        action === 'start'
          ? '虚拟机启动中（首次创建与初始化约需 1~2 分钟，请稍候）...'
          : action === 'stop'
          ? '虚拟机正在停止...'
          : '虚拟机正在重启...'
      );
      // Refresh once immediately to pick up the new vmAction state
      setTimeout(onRefresh, 1000);
    } catch (err: any) {
      setMessage(`操作失败: ${err.message}`);
      setActionLoading(null);
    }
  };

  const handleStartApp = async (appId: string) => {
    setActionLoading(`start-${appId}`);
    try {
      await api.startApp(appId);
      setMessage('应用正在启动中...');
      setTimeout(onRefresh, 1000);
    } catch (err: any) {
      setMessage(`启动应用失败: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const isVMRunning = vm?.status === 'Running';
  const installedApps = apps.filter(a => a.installed);

  return (
    <div className="space-y-6">
      {/* Action Notification Banner */}
      {message && (
        <div className="p-4 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-between text-sky-300 text-sm">
          <span>{message}</span>
          <button onClick={() => setMessage(null)} className="text-xs text-slate-400 hover:text-white">关闭</button>
        </div>
      )}

      {/* 7x24h Mac Server Daemon & Keep-Alive Panel */}
      <div className="p-5 rounded-2xl daemon-banner bg-gradient-to-r from-sky-50/90 via-indigo-50/40 to-white dark:from-slate-900/90 dark:via-slate-900/70 dark:to-indigo-950/40 border border-sky-100 dark:border-slate-800/80 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0 shadow-xs">
            <Coffee className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2.5">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Mac mini 7x24h 常驻守护引擎</h3>
              <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold ${
                powerActive
                  ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30 flex items-center space-x-1'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
              }`}>
                {powerActive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse mr-1" />}
                {powerActive ? '防休眠运行中' : '未开启防休眠'}
              </span>
              <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold ${
                serviceInstalled
                  ? 'bg-sky-100 dark:bg-sky-500/20 text-sky-800 dark:text-sky-300 border border-sky-300 dark:border-sky-500/30'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
              }`}>
                {serviceInstalled ? '开机自启生效' : '未装开机自启'}
              </span>
              {overview?.storage?.isExternalActive && (
                <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-indigo-100 dark:bg-indigo-500/20 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30 font-mono">
                  外接 SSD 数据盘
                </span>
              )}
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              通过 macOS 原生 <code>caffeinate</code> 防止 CPU 闲置休眠及外接盘休眠掉盘（支持显示器息屏节能），并通过 LaunchAgent 实现开机免登录后台守护。
            </p>
          </div>
        </div>

        {/* Action Toggles */}
        <div className="flex items-center space-x-3 shrink-0 self-end md:self-center">
          <button
            onClick={handleTogglePower}
            disabled={powerLoading}
            className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition shadow-xs ${
              powerActive
                ? 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-500/20 dark:hover:bg-amber-500/30 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-500/40'
                : 'bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
            }`}
            title="点击切换防休眠状态"
          >
            <Zap className={`w-3.5 h-3.5 ${powerActive ? 'text-amber-500 fill-amber-500 dark:text-amber-400 dark:fill-amber-400' : ''}`} />
            <span>{powerActive ? '已开启防休眠' : '开启防休眠'}</span>
          </button>

          <button
            onClick={handleToggleService}
            disabled={serviceLoading}
            className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition ${
              serviceInstalled
                ? 'bg-sky-50 hover:bg-rose-50 dark:bg-sky-500/20 dark:hover:bg-rose-500/20 text-sky-700 hover:text-rose-700 dark:text-sky-300 dark:hover:text-rose-300 border-sky-200 hover:border-rose-300 dark:border-sky-500/40 dark:hover:border-rose-500/40'
                : 'bg-sky-500 hover:bg-sky-600 text-white border-transparent shadow-md shadow-sky-500/25'
            }`}
            title={serviceInstalled ? '点击卸载开机自启' : '点击安装开机免登录自启'}
          >
            <Rocket className="w-3.5 h-3.5" />
            <span>{serviceInstalled ? '已装自启 (点此卸载)' : '一键配置开机自启'}</span>
          </button>
        </div>
      </div>

      {/* VM Errors Alert */}
      {vm?.errors && vm.errors.length > 0 && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-center justify-between">
          <span>虚拟机状态提示: {vm.errors.join('; ')}</span>
        </div>
      )}

      {/* Top 4 Quick Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* CPU */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900/60 border border-slate-200/90 dark:border-slate-800/80 shadow-xs backdrop-blur-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">CPU 使用率</span>
            <Cpu className="w-5 h-5 text-sky-500 dark:text-sky-400" />
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {sys ? sys.cpuPercent.toFixed(1) : '--'}%
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{sys?.cpuCores || '--'} 核处理器</span>
          </div>
          <div className="mt-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-sky-400 to-indigo-500 h-full transition-all duration-500"
              style={{ width: `${Math.min(sys?.cpuPercent || 0, 100)}%` }}
            />
          </div>
        </div>

        {/* Memory */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900/60 border border-slate-200/90 dark:border-slate-800/80 shadow-xs backdrop-blur-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">内存占用</span>
            <Server className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {sys ? sys.memPercent.toFixed(1) : '--'}%
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {sys ? `${(sys.memUsed / 1024 / 1024 / 1024).toFixed(1)} / ${(sys.memTotal / 1024 / 1024 / 1024).toFixed(1)} GB` : '--'}
            </span>
          </div>
          <div className="mt-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-indigo-400 to-purple-500 h-full transition-all duration-500"
              style={{ width: `${Math.min(sys?.memPercent || 0, 100)}%` }}
            />
          </div>
        </div>

        {/* Mac Status */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900/60 border border-slate-200/90 dark:border-slate-800/80 shadow-xs backdrop-blur-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Mac 运行状态</span>
            <ShieldCheck className="w-5 h-5 text-emerald-500 dark:text-emerald-400" />
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-white truncate">{sys?.hostname || 'Mac mini'}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">已稳定运行: {sys?.uptimeString || '--'}</p>
        </div>

        {/* Data Disk */}
        <div
          onClick={() => onNavigateTab('storage')}
          className="p-5 rounded-2xl bg-white dark:bg-slate-900/60 border border-slate-200/90 dark:border-slate-800/80 shadow-xs backdrop-blur-sm relative overflow-hidden cursor-pointer hover:border-sky-500/50 hover:shadow-md transition-all group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider group-hover:text-sky-500 transition">
              NAS 数据盘
            </span>
            <HardDrive className="w-5 h-5 text-sky-500 dark:text-sky-400 group-hover:scale-110 transition-transform" />
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">
              {selectedDisk ? selectedDisk.totalSizeString : '未配置数据盘'}
            </span>
          </div>
          <div className="mt-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-sky-500 h-full transition-all duration-500"
              style={{ width: `${selectedDisk?.usedPercent || 0}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex justify-between">
            <span>{selectedDisk ? `${selectedDisk.usedPercent.toFixed(1)}% 已用` : '点击选择磁盘'}</span>
            <span>{selectedDisk?.fileSystem || 'ext4'}</span>
          </p>
        </div>
      </div>

      {/* Center 2 Large Cards: Lima VM & Docker Engine */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lima VM Control (Spans 2 cols) */}
        <div className="lg:col-span-2 p-6 rounded-2xl bg-white dark:bg-slate-900/70 border border-slate-200/90 dark:border-slate-800/80 shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800/70 pb-4">
            <div className="flex items-center space-x-3">
              <div className={`w-3 h-3 rounded-full ${isVMRunning ? 'bg-emerald-500 shadow-lg shadow-emerald-500/50' : 'bg-amber-500'}`} />
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                  <span>Lima Linux 虚拟机 (MacNAS 底座)</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    isVMRunning ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30' : 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30'
                  }`}>
                    {vm?.status || '未创建'}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">驱动: Apple Virtualization.framework (vz) · 隔离运行 Docker & Samba</p>
              </div>
            </div>

            {/* Power Control Buttons */}
            <div className="flex items-center space-x-2">
              {!isVMRunning ? (
                <button
                  onClick={() => handleVMAction('start')}
                  disabled={isActionBusy}
                  className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow-md shadow-emerald-600/25 transition disabled:opacity-50"
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>{currentAction === 'start' ? '启动中...' : '启动服务'}</span>
                </button>
              ) : (
                <button
                  onClick={() => handleVMAction('stop')}
                  disabled={isActionBusy}
                  className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-600 border border-slate-200 hover:border-rose-300 dark:bg-slate-800 dark:hover:bg-rose-900/40 dark:text-slate-300 dark:hover:text-rose-300 dark:border-slate-700 text-sm font-medium transition disabled:opacity-50"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>{currentAction === 'stop' ? '停止中...' : '停止服务'}</span>
                </button>
              )}

              <button
                onClick={() => handleVMAction('restart')}
                disabled={isActionBusy}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 dark:border-slate-700 text-sm font-medium transition disabled:opacity-50"
              >
                <RotateCw className={`w-3.5 h-3.5 ${currentAction === 'restart' ? 'animate-spin text-sky-500 dark:text-sky-400' : ''}`} />
                <span>{currentAction === 'restart' ? '重启中...' : '重启 VM'}</span>
              </button>

              <button
                onClick={handleOpenSpecs}
                disabled={isActionBusy}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/50 dark:text-indigo-300 dark:border-indigo-700/50 text-sm font-medium transition disabled:opacity-50"
                title="自定义配置 CPU / 动态内存配额 / 系统盘扩容"
              >
                <Settings className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                <span>规格配置</span>
              </button>
            </div>
          </div>

          {/* Config Dirty Notice Banner */}
          {configDirty && isVMRunning && (
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-200 text-xs flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <RotateCw className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" />
                <span>虚拟机硬件或直通配置已变更，需重启 VM 生效</span>
              </div>
              <button
                onClick={() => handleVMAction('restart')}
                disabled={isActionBusy}
                className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-white font-bold text-xs shadow transition flex items-center space-x-1 shrink-0"
              >
                <RotateCw className={`w-3 h-3 ${currentAction === 'restart' ? 'animate-spin' : ''}`} />
                <span>{currentAction === 'restart' ? '重启中...' : '立即重启'}</span>
              </button>
            </div>
          )}

          {/* VM Specs Grid (Clickable to open Specs Config) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div
              onClick={handleOpenSpecs}
              className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800/80 border border-slate-200/80 dark:border-slate-800/60 hover:border-indigo-500/50 cursor-pointer transition group shadow-xs"
              title="点击修改 CPU 核心数"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">VM CPU 分配</span>
                <span className="text-[10px] text-indigo-500 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition">配置 →</span>
              </div>
              <p className="text-base font-bold text-slate-900 dark:text-white mt-1">{vm?.cpus || 2} vCPU</p>
            </div>
            <div
              onClick={handleOpenSpecs}
              className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800/80 border border-slate-200/80 dark:border-slate-800/60 hover:border-indigo-500/50 cursor-pointer transition group shadow-xs"
              title="点击调整动态内存配额"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">VM 内存分配</span>
                <span className="text-[10px] text-indigo-500 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition">配置 →</span>
              </div>
              <p className="text-base font-bold text-slate-900 dark:text-white mt-1">
                {vm?.memory ? `${(vm.memory / 1024 / 1024 / 1024).toFixed(0)} GiB` : '4 GiB'}
              </p>
            </div>
            <div
              onClick={handleOpenSpecs}
              className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800/80 border border-slate-200/80 dark:border-slate-800/60 hover:border-indigo-500/50 cursor-pointer transition group shadow-xs"
              title="点击在线扩容系统根盘"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">系统根盘</span>
                <span className="text-[10px] text-indigo-500 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition">扩容 →</span>
              </div>
              <p className="text-base font-bold text-slate-900 dark:text-white mt-1">
                {vm?.disk ? `${(vm.disk / 1024 / 1024 / 1024).toFixed(0)} GiB` : '20 GiB'}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800/60 shadow-xs">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Docker Socket</span>
              <p className="text-xs font-mono font-medium text-slate-700 dark:text-slate-300 mt-1 truncate" title={vm?.dockerSocket}>
                {vm?.dockerReady ? '已桥接映射' : '未连接'}
              </p>
            </div>
          </div>

          {/* Network & SMB Banner */}
          <div className="p-4 rounded-xl bg-sky-50/80 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-3">
              <Globe className="w-5 h-5 text-sky-500 dark:text-sky-400 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">局域网 SMB 多硬盘与文件夹共享已就绪</p>
                <p className="text-xs text-sky-700 dark:text-sky-300/80 font-mono mt-0.5">smb://{sys?.primaryIP || '127.0.0.1'}:4455/ (支持主硬盘、第二硬盘及自定义目录)</p>
              </div>
            </div>
            <button
              onClick={() => onNavigateTab('storage')}
              className="text-xs px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white font-medium shadow-xs transition"
            >
              管理 SMB 共享 →
            </button>
          </div>
        </div>

        {/* Docker Engine Card */}
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900/70 border border-slate-200/90 dark:border-slate-800/80 shadow-xs flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Docker 引擎状态</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                docker?.ready ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
              }`}>
                {docker?.ready ? '运行中' : '等待启动'}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">原生运行于 Linux VM，无需安装 Docker Desktop。</p>

            <div className="mt-5 space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800/60 text-sm">
                <span className="text-slate-500 dark:text-slate-400">运行中容器</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">{docker?.runningCount || 0} 个</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800/60 text-sm">
                <span className="text-slate-500 dark:text-slate-400">容器总数</span>
                <span className="font-bold text-slate-900 dark:text-white">{docker?.total || 0} 个</span>
              </div>
              <div className="flex justify-between items-center py-2 text-sm">
                <span className="text-slate-500 dark:text-slate-400">已部署预设应用</span>
                <span className="font-bold text-sky-600 dark:text-sky-400">{installedApps.length} / {apps.length}</span>
              </div>
            </div>
          </div>

          <button
            onClick={() => onNavigateTab('docker')}
            className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-sm font-semibold transition shadow-xs"
          >
            进入容器控制面板 →
          </button>
        </div>
      </div>

      {/* Quick Launch Installed Apps */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">已就绪的 NAS 应用服务</h3>
          <button
            onClick={() => onNavigateTab('apps')}
            className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 transition"
          >
            全部应用管理 →
          </button>
        </div>

        {installedApps.length === 0 ? (
          <div className="p-8 rounded-2xl bg-white dark:bg-slate-900/40 border border-dashed border-slate-200 dark:border-slate-800 text-center space-y-3 shadow-xs">
            <p className="text-sm text-slate-500 dark:text-slate-400">当前尚未安装任何应用，推荐一键安装 Jellyfin 影音中心或 FileBrowser 文件管理器。</p>
            <button
              onClick={() => onNavigateTab('apps')}
              className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold shadow-md transition"
            >
              前往安装预设应用
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {installedApps.map((app) => (
              <div
                key={app.id}
                className="p-5 rounded-2xl bg-white dark:bg-slate-900/60 border border-slate-200/90 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 shadow-xs hover:shadow-md transition flex items-center justify-between"
              >
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-white text-base">{app.name}</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">端口: {app.port}</p>
                  <span className={`inline-block mt-2 text-[10px] px-2 py-0.5 rounded font-semibold ${
                    app.status === 'running'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                  }`}>
                    {app.status === 'running' ? '运行中' : '已停止'}
                  </span>
                </div>

                {app.status === 'running' ? (
                  <a
                    href={app.webUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-sky-50 hover:bg-sky-500 text-sky-600 hover:text-white dark:bg-sky-500/20 dark:hover:bg-sky-500 dark:text-sky-300 dark:hover:text-white border border-sky-200 dark:border-sky-500/30 text-xs font-semibold shadow-xs transition"
                  >
                    <span>打开</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : (
                  <button
                    onClick={() => handleStartApp(app.id)}
                    disabled={actionLoading === `start-${app.id}`}
                    className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-emerald-600 text-slate-700 hover:text-white dark:bg-slate-800 dark:hover:bg-emerald-600/80 dark:text-slate-300 dark:hover:text-white border border-slate-200 dark:border-slate-700 text-xs font-semibold shadow-xs transition disabled:opacity-50"
                  >
                    {actionLoading === `start-${app.id}` ? (
                      <RotateCw className="w-3.5 h-3.5 animate-spin text-slate-400" />
                    ) : (
                      <Play className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                    )}
                    <span>启动</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {/* VM Hardware Specs Configuration Modal */}
      {showSpecsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Lima Linux 虚拟机规格自定义</h3>
                  <p className="text-xs text-slate-400">调整底层 Apple vz 驱动分配的硬件计算资源</p>
                </div>
              </div>
              <button
                onClick={() => setShowSpecsModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {specsLoading ? (
              <div className="py-12 text-center text-xs text-slate-400">正在读取虚拟机硬件规格...</div>
            ) : (
              <form onSubmit={handleSaveSpecs} className="space-y-5">
                {/* 1. CPU Cores */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300">CPU 核心分配 (vCPU)</span>
                    <span className="text-slate-400">宿主机总共: {specsInfo?.hostCpus || 10} 核</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 4, 6].map((cores) => (
                      <button
                        type="button"
                        key={cores}
                        onClick={() => setEditCPUs(cores)}
                        className={`py-2 rounded-xl text-xs font-semibold border transition ${
                          editCPUs === cores
                            ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-600/30'
                            : 'bg-slate-800/60 hover:bg-slate-800 text-slate-300 border-slate-700/60'
                        }`}
                      >
                        {cores} 核 {cores === 2 ? '(推荐)' : ''}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    建议保留 2~4 核给 Docker 与 Samba 容器，避免占用过高影响 Mac 宿主机日常办公。
                  </p>
                </div>

                {/* 2. Memory (Dynamic Ballooning) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300">内存分配上限 (GiB)</span>
                    <span className="text-slate-400">宿主机物理内存: {specsInfo?.hostMemoryGB || 16} GB</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[2, 4, 6, 8].map((mem) => (
                      <button
                        type="button"
                        key={mem}
                        onClick={() => setEditMemory(mem)}
                        className={`py-2 rounded-xl text-xs font-semibold border transition ${
                          editMemory === mem
                            ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-600/30'
                            : 'bg-slate-800/60 hover:bg-slate-800 text-slate-300 border-slate-700/60'
                        }`}
                      >
                        {mem} GiB {mem === 4 ? '(默认)' : ''}
                      </button>
                    ))}
                  </div>

                  {/* Dynamic Memory Banner Callout */}
                  <div className="p-3.5 rounded-xl bg-sky-950/40 border border-sky-800/40 text-[11px] text-sky-200/90 leading-relaxed space-y-1">
                    <div className="font-semibold flex items-center space-x-1 text-sky-300">
                      <Info className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span>Apple vz 原生动态气球内存机制说明：</span>
                    </div>
                    <p>
                      此设定为虚拟机的<strong>最大内存配额上限</strong>。底层基于 Apple Virtualization.framework 原生 Virtio-Balloon 气球驱动，系统启动及闲置时仅按需占用水位（约 1~1.5 GB），随 Docker 容器并发按需分配；容器退出后由 macOS 自动回收物理内存给 Mac 宿主机，绝非死占锁死物理内存。
                    </p>
                  </div>
                </div>

                {/* 3. System Root Disk (Expansion only) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300">系统根盘容量 (GiB)</span>
                    <span className="text-slate-400 font-mono">当前配置: {specsInfo?.diskSize || 20} GiB</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min={specsInfo?.diskSize || 20}
                      max={120}
                      value={editDisk}
                      onChange={(e) => setEditDisk(parseInt(e.target.value) || specsInfo?.diskSize || 20)}
                      className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
                    />
                    <div className="flex items-center space-x-1">
                      {[30, 40, 60].map((size) => (
                        <button
                          type="button"
                          key={size}
                          disabled={size < (specsInfo?.diskSize || 20)}
                          onClick={() => setEditDisk(size)}
                          className="px-2.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 transition"
                        >
                          +{size}G
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Disk Safety Rule Callout */}
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200/90 leading-relaxed space-y-1">
                    <div className="font-semibold flex items-center space-x-1 text-amber-300">
                      <Info className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>系统盘扩容原则：</span>
                    </div>
                    <p>
                      系统根盘仅支持安全扩容（只增不减，以防止 Linux ext4 分区数据结构损坏）。系统盘仅存放系统底层与 Docker 运行时镜像；影视、文件与下载等存放在外接 SSD 或直通目录中，系统盘 20~40 GiB 已非常充裕。
                    </p>
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="flex items-center justify-end space-x-2.5 pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowSpecsModal(false)}
                    className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={specsSaving}
                    className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition disabled:opacity-50"
                  >
                    {specsSaving ? '保存中...' : '保存规格配置 (重启后生效)'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
