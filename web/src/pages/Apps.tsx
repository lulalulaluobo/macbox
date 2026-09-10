import React, { useState, useEffect, useRef } from 'react';
import { Film, RefreshCw, Folder, ExternalLink, Play, Square, RotateCw, Trash2, Terminal, CheckCircle2, AlertCircle, Download, Cloud, X } from 'lucide-react';
import { AppMetadata } from '../types';
import { api } from '../api';

export const Apps: React.FC = () => {
  const [apps, setApps] = useState<AppMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Logs modal
  const [activeLogApp, setActiveLogApp] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>('');
  const [logsLoading, setLogsLoading] = useState(false);

  // Install Drawer Modal State
  const [drawerApp, setDrawerApp] = useState<AppMetadata | null>(null);
  const [drawerPort, setDrawerPort] = useState<number>(0);
  const [installLogs, setInstallLogs] = useState<string[]>([]);
  const [installStatus, setInstallStatus] = useState<'idle' | 'installing' | 'done' | 'error'>('idle');
  const [installError, setInstallError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  const loadApps = async () => {
    setLoading(true);
    try {
      const data = await api.getApps();
      setApps(data || []);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `加载应用列表失败: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadApps();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [installLogs]);

  const handleOpenInstallDrawer = (app: AppMetadata) => {
    setDrawerApp(app);
    setDrawerPort(app.port);
    setInstallLogs([]);
    setInstallStatus('idle');
    setInstallError(null);
  };

  const handleCloseInstallDrawer = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setDrawerApp(null);
    setInstallStatus('idle');
    loadApps();
  };

  const handleStartInstallStream = () => {
    if (!drawerApp) return;
    setInstallStatus('installing');
    setInstallLogs([`🚀 正在连接 MacNAS 应用引擎并准备安装 ${drawerApp.name}...`]);

    const targetPort = drawerPort || drawerApp.port;
    const es = new EventSource(`/api/apps/${drawerApp.id}/install/stream?port=${targetPort}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      setInstallLogs((prev) => [...prev, event.data]);
    };

    es.addEventListener('done', () => {
      es.close();
      eventSourceRef.current = null;
      setInstallStatus('done');
      loadApps();
    });

    es.addEventListener('error', (event: any) => {
      es.close();
      eventSourceRef.current = null;
      const errMsg = event.data || '安装过程出现异常，请检查网络或 Docker 环境';
      setInstallError(errMsg);
      setInstallStatus('error');
      loadApps();
    });
  };

  const handleAppAction = async (id: string, action: 'start' | 'stop' | 'restart' | 'uninstall') => {
    if (action === 'uninstall') {
      if (!confirm(`确定要卸载该应用吗？容器将被移除，AppData 配置仍将保留。`)) return;
    }
    setActionLoading(`${action}-${id}`);
    try {
      if (action === 'start') await api.startApp(id);
      if (action === 'stop') await api.stopApp(id);
      if (action === 'restart') await api.restartApp(id);
      if (action === 'uninstall') await api.uninstallApp(id);
      setAlertMsg({ type: 'success', text: `操作成功完成！` });
      await loadApps();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `操作失败: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleViewLogs = async (id: string) => {
    setActiveLogApp(id);
    setLogsLoading(true);
    try {
      const res = await api.getAppLogs(id, 150);
      setLogs(res.logs || '暂无日志输出');
    } catch (err: any) {
      setLogs(`获取日志失败: ${err.message}`);
    } finally {
      setLogsLoading(false);
    }
  };

  const getAppIcon = (icon: string) => {
    switch (icon) {
      case 'film':
        return <Film className="w-6 h-6 text-sky-400" />;
      case 'refresh-cw':
        return <RefreshCw className="w-6 h-6 text-indigo-400" />;
      case 'folder':
        return <Folder className="w-6 h-6 text-amber-400" />;
      case 'download':
        return <Download className="w-6 h-6 text-emerald-400" />;
      case 'cloud':
        return <Cloud className="w-6 h-6 text-cyan-400" />;
      default:
        return <Folder className="w-6 h-6 text-sky-400" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-white">预设 NAS 核心应用</h2>
          <p className="text-sm text-slate-400 mt-1">
            精选 5 款家庭核心 NAS 应用，支持 Docker 镜像实时拉取流、端口自定义与一键快速部署。
          </p>
        </div>

        <button
          onClick={loadApps}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>刷新状态</span>
        </button>
      </div>

      {/* Alert Banner */}
      {alertMsg && (
        <div className={`p-4 rounded-xl text-sm flex items-center justify-between ${
          alertMsg.type === 'success'
            ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
            : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
        }`}>
          <div className="flex items-center space-x-2">
            {alertMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span>{alertMsg.text}</span>
          </div>
          <button onClick={() => setAlertMsg(null)} className="text-xs opacity-70 hover:opacity-100">关闭</button>
        </div>
      )}

      {/* Apps Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {apps.map((app) => {
          const isInstalled = app.installed;
          const isRunning = app.status === 'running';

          return (
            <div
              key={app.id}
              className={`p-6 rounded-2xl border transition-all flex flex-col justify-between space-y-5 ${
                isRunning
                  ? 'bg-slate-900/80 border-sky-500/40 shadow-lg shadow-sky-500/10'
                  : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
              }`}
            >
              <div className="space-y-4">
                {/* Top Info */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center shadow-inner">
                      {getAppIcon(app.icon)}
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                        <span>{app.name}</span>
                        <span className="text-[10px] font-mono font-normal text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                          v{app.version}
                        </span>
                      </h3>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">默认端口: {app.port}</p>
                    </div>
                  </div>

                  <span className={`text-[11px] px-2.5 py-1 rounded-full font-semibold ${
                    isRunning
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center space-x-1.5'
                      : isInstalled
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-slate-800 text-slate-400'
                  }`}>
                    {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                    <span>{isRunning ? '运行中' : isInstalled ? '已停止' : '未安装'}</span>
                  </span>
                </div>

                {/* Description */}
                <p className="text-xs text-slate-300 leading-relaxed min-h-[36px]">
                  {app.description}
                </p>

                {/* Live Address if running */}
                {isRunning && (
                  <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between">
                    <div>
                      <span className="text-[11px] text-slate-400 block">WebUI 访问地址:</span>
                      <a
                        href={app.webUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-mono font-bold text-sky-400 hover:text-sky-300 truncate max-w-[200px] block"
                      >
                        {app.webUrl}
                      </a>
                    </div>
                    <a
                      href={app.webUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="p-2 rounded-lg bg-sky-500/20 hover:bg-sky-500 text-sky-300 hover:text-white transition"
                      title="打开 WebUI"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                )}

                {/* Default Credentials Tips */}
                {app.id === 'filebrowser' && (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200/90 font-mono flex flex-col space-y-1">
                    <span className="text-[10px] text-amber-400 font-sans font-semibold">🔑 登录凭据:</span>
                    <div className="flex justify-between">
                      <span>默认账号: <strong className="text-amber-100 font-bold">admin</strong></span>
                      <span>默认密码: <strong className="text-amber-100 font-bold">adminadmin123</strong></span>
                    </div>
                  </div>
                )}

                {app.id === 'jellyfin' && (
                  <div className="p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/20 text-xs text-sky-200/90 flex items-center space-x-2">
                    <span>💡 首次访问将启动配置向导，自行创建管理员账号密码</span>
                  </div>
                )}

                {app.id === 'syncthing' && (
                  <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-xs text-purple-200/90 flex items-center space-x-2">
                    <span>💡 首次进入免密，建议在「操作-设置-图形化界面」设置账号密码</span>
                  </div>
                )}

                {app.id === 'qbittorrent' && (
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-200/90 font-mono flex flex-col space-y-1">
                    <span className="text-[10px] text-emerald-400 font-sans font-semibold">🔑 登录凭据:</span>
                    <div className="flex justify-between">
                      <span>默认账号: <strong className="text-emerald-100 font-bold">admin</strong></span>
                      <span>默认密码: <strong className="text-emerald-100 font-bold">adminadmin</strong></span>
                    </div>
                  </div>
                )}

                {app.id === 'alist' && (
                  <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-xs text-cyan-200/90 font-mono flex flex-col space-y-1">
                    <span className="text-[10px] text-cyan-400 font-sans font-semibold">🔑 登录凭据:</span>
                    <div className="flex justify-between">
                      <span>默认账号: <strong className="text-cyan-100 font-bold">admin</strong></span>
                      <span>已置密码: <strong className="text-cyan-100 font-bold">adminadmin123</strong></span>
                    </div>
                  </div>
                )}

                {/* Storage directory bindings */}
                <div className="text-[11px] text-slate-400 space-y-1 bg-slate-950/40 p-3 rounded-xl border border-slate-800/60 font-mono">
                  <span className="text-slate-400 font-semibold block text-[10px] uppercase tracking-wider">数据挂载映射:</span>
                  {app.volumes.map((v, i) => (
                    <div key={i} className="flex justify-between truncate" title={`${v.host} -> ${v.container}`}>
                      <span className="text-slate-400">{v.host}</span>
                      <span className="text-slate-400">→ {v.container}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Bottom Actions */}
              <div className="pt-3 border-t border-slate-800/80">
                {!isInstalled ? (
                  <button
                    onClick={() => handleOpenInstallDrawer(app)}
                    className="w-full py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold shadow-lg shadow-sky-500/25 transition flex items-center justify-center space-x-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>配置并安装应用</span>
                  </button>
                ) : (
                  <div className="flex items-center justify-between gap-1.5">
                    {/* Open Button */}
                    {isRunning && (
                      <a
                        href={app.webUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold text-center flex items-center justify-center space-x-1.5 shadow-md transition"
                      >
                        <span>打开</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}

                    {/* Start / Stop */}
                    {!isRunning ? (
                      <button
                        onClick={() => handleAppAction(app.id, 'start')}
                        disabled={actionLoading !== null}
                        className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center space-x-1 transition disabled:opacity-50"
                      >
                        <Play className="w-3.5 h-3.5 fill-white" />
                        <span>启动</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleAppAction(app.id, 'stop')}
                        disabled={actionLoading !== null}
                        className="p-2 rounded-xl bg-slate-800 hover:bg-rose-900/40 text-slate-300 hover:text-rose-300 border border-slate-700 text-xs font-medium transition disabled:opacity-50"
                        title="停止服务"
                      >
                        <Square className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Restart */}
                    <button
                      onClick={() => handleAppAction(app.id, 'restart')}
                      disabled={actionLoading !== null}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium transition disabled:opacity-50"
                      title="重启服务"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>

                    {/* View Logs */}
                    <button
                      onClick={() => handleViewLogs(app.id)}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium transition"
                      title="查看应用日志"
                    >
                      <Terminal className="w-3.5 h-3.5 text-sky-400" />
                    </button>

                    {/* Uninstall */}
                    <button
                      onClick={() => handleAppAction(app.id, 'uninstall')}
                      disabled={actionLoading !== null}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 border border-slate-700 text-xs font-medium transition disabled:opacity-50"
                      title="卸载应用"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Logs Drawer/Modal */}
      {activeLogApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl h-[75vh] flex flex-col rounded-2xl bg-[#0b0f19] border border-slate-800 shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Terminal className="w-4 h-4 text-sky-400" />
                <span className="font-bold text-sm text-white font-mono">{activeLogApp} 应用日志</span>
              </div>
              <button
                onClick={() => setActiveLogApp(null)}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-xs font-semibold transition"
              >
                关闭
              </button>
            </div>

            <div className="flex-1 p-4 bg-black/90 overflow-y-auto font-mono text-xs text-emerald-400/90 leading-relaxed whitespace-pre-wrap select-text">
              {logsLoading ? (
                <div className="text-slate-400 flex items-center space-x-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>正在获取最新日志...</span>
                </div>
              ) : (
                logs || '暂无日志输出'
              )}
            </div>
          </div>
        </div>
      )}

      {/* Install & Realtime Pull Stream Modal */}
      {drawerApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
              <div className="flex items-center space-x-3.5">
                <div className="w-12 h-12 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center shadow-inner">
                  {getAppIcon(drawerApp.icon)}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                    <span>{drawerApp.name}</span>
                    <span className="text-xs font-normal text-slate-400 font-mono bg-slate-800 px-2 py-0.5 rounded">
                      {drawerApp.version}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">{drawerApp.description}</p>
                </div>
              </div>
              <button
                onClick={handleCloseInstallDrawer}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-5 overflow-y-auto flex-1">
              {installStatus === 'idle' && (
                <div className="space-y-4 text-xs text-slate-300">
                  <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200">WebUI 访问端口设置:</span>
                      <div className="flex items-center space-x-2">
                        <input
                          type="number"
                          min={1024}
                          max={65535}
                          value={drawerPort}
                          onChange={(e) => setDrawerPort(parseInt(e.target.value) || drawerApp.port)}
                          className="w-24 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono text-center text-xs focus:outline-none focus:border-sky-500"
                        />
                        <span className="text-slate-400 font-mono">（默认: {drawerApp.port}）</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      若默认端口与 Mac 上其他服务冲突，可在此自定义修改（映射至宿主机端口）。
                    </p>
                  </div>

                  <div className="space-y-1.5 bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 font-mono text-xs">
                    <span className="text-slate-400 font-bold block text-[11px] uppercase tracking-wider mb-2">自动挂载的 NAS 数据目录:</span>
                    {drawerApp.volumes.map((v, i) => (
                      <div key={i} className="flex justify-between py-0.5 text-slate-300">
                        <span className="text-sky-300">{v.host}</span>
                        <span className="text-slate-500">→ {v.container}</span>
                      </div>
                    ))}
                  </div>

                  <div className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-200 text-xs leading-relaxed space-y-1">
                    <p className="font-bold text-sky-300">💡 准备就绪</p>
                    <p>点击下方按钮将开始在 Lima 虚拟机中下载官方 Docker 镜像并启动容器。实时拉取进度将在控制台即时展示。</p>
                  </div>
                </div>
              )}

              {(installStatus === 'installing' || installStatus === 'done' || installStatus === 'error') && (
                <div className="space-y-4">
                  {/* Status Banner */}
                  {installStatus === 'installing' && (
                    <div className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-300 text-xs flex items-center justify-between">
                      <div className="flex items-center space-x-2.5">
                        <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
                        <span className="font-semibold">正在拉取 Docker 镜像并部署启动，请观察实时控制台...</span>
                      </div>
                      <span className="font-mono text-[11px] opacity-75">实时流</span>
                    </div>
                  )}

                  {installStatus === 'done' && (
                    <div className="p-4 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs space-y-2">
                      <div className="flex items-center space-x-2 font-bold text-sm">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                        <span>应用已成功部署并上线！</span>
                      </div>
                      <p className="text-xs text-emerald-200/90">
                        WebUI 访问地址: <strong className="font-mono text-white underline select-all">{drawerApp.webUrl}</strong>
                      </p>
                    </div>
                  )}

                  {installStatus === 'error' && (
                    <div className="p-4 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs space-y-1">
                      <div className="flex items-center space-x-2 font-bold text-sm">
                        <AlertCircle className="w-5 h-5 text-rose-400" />
                        <span>部署遇到异常:</span>
                      </div>
                      <p className="font-mono">{installError}</p>
                    </div>
                  )}

                  {/* Terminal Console */}
                  <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 font-mono text-xs text-emerald-400/90 h-72 overflow-y-auto space-y-1 shadow-inner select-text">
                    {installLogs.map((line, idx) => (
                      <div key={idx} className="leading-relaxed whitespace-pre-wrap break-all">
                        {line}
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-between">
              <span className="text-xs text-slate-500 font-mono">
                {installStatus === 'installing' ? '实时日志传输中...' : `当前目标端口: ${drawerPort || drawerApp.port}`}
              </span>

              <div className="flex items-center space-x-2.5">
                {installStatus === 'idle' && (
                  <>
                    <button
                      onClick={handleCloseInstallDrawer}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleStartInstallStream}
                      className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold shadow-lg shadow-sky-500/25 transition flex items-center space-x-2"
                    >
                      <Download className="w-4 h-4" />
                      <span>开始安装并拉取镜像</span>
                    </button>
                  </>
                )}

                {installStatus === 'installing' && (
                  <button
                    disabled
                    className="px-5 py-2 rounded-xl bg-slate-800 text-slate-400 text-xs font-semibold cursor-not-allowed flex items-center space-x-2"
                  >
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>正在安装中...</span>
                  </button>
                )}

                {installStatus === 'done' && (
                  <>
                    <button
                      onClick={handleCloseInstallDrawer}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                    >
                      关闭窗口
                    </button>
                    <a
                      href={drawerApp.webUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/25 transition flex items-center space-x-1.5"
                    >
                      <span>立即打开应用</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </>
                )}

                {installStatus === 'error' && (
                  <>
                    <button
                      onClick={handleCloseInstallDrawer}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                    >
                      关闭
                    </button>
                    <button
                      onClick={handleStartInstallStream}
                      className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold transition"
                    >
                      重试安装
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
