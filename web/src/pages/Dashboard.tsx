import React, { useState } from 'react';
import { Play, Square, RotateCw, Cpu, HardDrive, Server, Globe, ExternalLink, ShieldCheck } from 'lucide-react';
import { SystemOverview, AppMetadata } from '../types';
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
  const [message, setMessage] = useState<string | null>(null);

  const sys = overview?.system;
  const vm = overview?.vm;
  const docker = overview?.docker;
  const selectedDisk = overview?.storage.selectedDisk;

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

      let attempts = 0;
      const pollInterval = setInterval(() => {
        attempts++;
        onRefresh();
        if (attempts >= 20) {
          clearInterval(pollInterval);
          setActionLoading(null);
        }
      }, 3000);
    } catch (err: any) {
      setMessage(`操作失败: ${err.message}`);
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

      {/* VM Errors Alert */}
      {vm?.errors && vm.errors.length > 0 && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-center justify-between">
          <span>虚拟机状态提示: {vm.errors.join('; ')}</span>
        </div>
      )}

      {/* Top 4 Quick Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* CPU */}
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">CPU 使用率</span>
            <Cpu className="w-5 h-5 text-sky-400" />
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-white">
              {sys ? sys.cpuPercent.toFixed(1) : '--'}%
            </span>
            <span className="text-xs text-slate-400">{sys?.cpuCores || '--'} 核处理器</span>
          </div>
          <div className="mt-3 w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-sky-400 to-indigo-500 h-full transition-all duration-500"
              style={{ width: `${Math.min(sys?.cpuPercent || 0, 100)}%` }}
            />
          </div>
        </div>

        {/* Memory */}
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">内存占用</span>
            <Server className="w-5 h-5 text-indigo-400" />
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-white">
              {sys ? sys.memPercent.toFixed(1) : '--'}%
            </span>
            <span className="text-xs text-slate-400">
              {sys ? `${(sys.memUsed / 1024 / 1024 / 1024).toFixed(1)} / ${(sys.memTotal / 1024 / 1024 / 1024).toFixed(1)} GB` : '--'}
            </span>
          </div>
          <div className="mt-3 w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-indigo-400 to-purple-500 h-full transition-all duration-500"
              style={{ width: `${Math.min(sys?.memPercent || 0, 100)}%` }}
            />
          </div>
        </div>

        {/* Mac Status */}
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Mac 运行状态</span>
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-white truncate">{sys?.hostname || 'Mac mini'}</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">已稳定运行: {sys?.uptimeString || '--'}</p>
        </div>

        {/* Data Disk */}
        <div
          onClick={() => onNavigateTab('storage')}
          className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-sm relative overflow-hidden cursor-pointer hover:border-sky-500/50 transition-all group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider group-hover:text-sky-400 transition">
              NAS 数据盘
            </span>
            <HardDrive className="w-5 h-5 text-sky-400 group-hover:scale-110 transition-transform" />
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-white">
              {selectedDisk ? selectedDisk.totalSizeString : '未配置数据盘'}
            </span>
          </div>
          <div className="mt-2 w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-sky-500 h-full transition-all duration-500"
              style={{ width: `${selectedDisk?.usedPercent || 0}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-400 flex justify-between">
            <span>{selectedDisk ? `${selectedDisk.usedPercent.toFixed(1)}% 已用` : '点击选择磁盘'}</span>
            <span>{selectedDisk?.fileSystem || 'ext4'}</span>
          </p>
        </div>
      </div>

      {/* Center 2 Large Cards: Lima VM & Docker Engine */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lima VM Control (Spans 2 cols) */}
        <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 shadow-xl space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800/70 pb-4">
            <div className="flex items-center space-x-3">
              <div className={`w-3 h-3 rounded-full ${isVMRunning ? 'bg-emerald-500 shadow-lg shadow-emerald-500/50' : 'bg-amber-500'}`} />
              <div>
                <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                  <span>Lima Linux 虚拟机 (MacNAS 底座)</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    isVMRunning ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  }`}>
                    {vm?.status || '未创建'}
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">驱动: Apple Virtualization.framework (vz) · 隔离运行 Docker & Samba</p>
              </div>
            </div>

            {/* Power Control Buttons */}
            <div className="flex items-center space-x-2">
              {!isVMRunning ? (
                <button
                  onClick={() => handleVMAction('start')}
                  disabled={actionLoading !== null}
                  className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow-lg shadow-emerald-600/30 transition disabled:opacity-50"
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>{actionLoading === 'start' ? '启动中...' : '启动服务'}</span>
                </button>
              ) : (
                <button
                  onClick={() => handleVMAction('stop')}
                  disabled={actionLoading !== null}
                  className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-rose-900/40 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-500/30 text-sm font-medium transition disabled:opacity-50"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>{actionLoading === 'stop' ? '停止中...' : '停止服务'}</span>
                </button>
              )}

              <button
                onClick={() => handleVMAction('restart')}
                disabled={actionLoading !== null}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-sm font-medium transition disabled:opacity-50"
              >
                <RotateCw className={`w-3.5 h-3.5 ${actionLoading === 'restart' ? 'animate-spin text-sky-400' : ''}`} />
                <span>重启 VM</span>
              </button>
            </div>
          </div>

          {/* VM Specs Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800/60">
              <span className="text-[11px] text-slate-400 font-medium">VM CPU 分配</span>
              <p className="text-base font-bold text-white mt-1">{vm?.cpus || 2} vCPU</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800/60">
              <span className="text-[11px] text-slate-400 font-medium">VM 内存分配</span>
              <p className="text-base font-bold text-white mt-1">
                {vm?.memory ? `${(vm.memory / 1024 / 1024 / 1024).toFixed(0)} GiB` : '4 GiB'}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800/60">
              <span className="text-[11px] text-slate-400 font-medium">系统根盘</span>
              <p className="text-base font-bold text-white mt-1">
                {vm?.disk ? `${(vm.disk / 1024 / 1024 / 1024).toFixed(0)} GiB` : '20 GiB'}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800/60">
              <span className="text-[11px] text-slate-400 font-medium">Docker Socket</span>
              <p className="text-xs font-mono font-medium text-slate-300 mt-1 truncate" title={vm?.dockerSocket}>
                {vm?.dockerReady ? '已桥接映射' : '未连接'}
              </p>
            </div>
          </div>

          {/* Network & SMB Banner */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-sky-950/40 via-indigo-950/30 to-slate-900 border border-sky-800/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-3">
              <Globe className="w-5 h-5 text-sky-400 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-white">局域网 SMB 共享已开启</p>
                <p className="text-xs text-sky-300/80 font-mono mt-0.5">smb://{sys?.primaryIP || '127.0.0.1'}:4455/MacNAS</p>
              </div>
            </div>
            <button
              onClick={() => onNavigateTab('storage')}
              className="text-xs px-3 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 font-medium transition"
            >
              配置 SMB 共享 →
            </button>
          </div>
        </div>

        {/* Docker Engine Card */}
        <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 shadow-xl flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">Docker 引擎状态</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                docker?.ready ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-400'
              }`}>
                {docker?.ready ? '运行中' : '等待启动'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">原生运行于 Linux VM，无需安装 Docker Desktop。</p>

            <div className="mt-5 space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-slate-800/60 text-sm">
                <span className="text-slate-400">运行中容器</span>
                <span className="font-bold text-emerald-400">{docker?.runningCount || 0} 个</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-800/60 text-sm">
                <span className="text-slate-400">容器总数</span>
                <span className="font-bold text-white">{docker?.total || 0} 个</span>
              </div>
              <div className="flex justify-between items-center py-2 text-sm">
                <span className="text-slate-400">已部署预设应用</span>
                <span className="font-bold text-sky-400">{installedApps.length} / {apps.length}</span>
              </div>
            </div>
          </div>

          <button
            onClick={() => onNavigateTab('docker')}
            className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-sm font-semibold transition"
          >
            进入容器控制面板 →
          </button>
        </div>
      </div>

      {/* Quick Launch Installed Apps */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-white">已就绪的 NAS 应用服务</h3>
          <button
            onClick={() => onNavigateTab('apps')}
            className="text-xs font-semibold text-sky-400 hover:text-sky-300"
          >
            全部应用管理 →
          </button>
        </div>

        {installedApps.length === 0 ? (
          <div className="p-8 rounded-2xl bg-slate-900/40 border border-dashed border-slate-800 text-center space-y-3">
            <p className="text-sm text-slate-400">当前尚未安装任何应用，推荐一键安装 Jellyfin 影音中心或 FileBrowser 文件管理器。</p>
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
                className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 hover:border-slate-700 transition flex items-center justify-between"
              >
                <div>
                  <h4 className="font-bold text-white text-base">{app.name}</h4>
                  <p className="text-xs text-slate-400 mt-0.5">端口: {app.port}</p>
                  <span className={`inline-block mt-2 text-[10px] px-2 py-0.5 rounded font-semibold ${
                    app.status === 'running' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {app.status === 'running' ? '运行中' : '已停止'}
                  </span>
                </div>

                {app.status === 'running' && (
                  <a
                    href={app.webUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-sky-500/20 hover:bg-sky-500 text-sky-300 hover:text-white border border-sky-500/30 text-xs font-semibold transition"
                  >
                    <span>打开</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
