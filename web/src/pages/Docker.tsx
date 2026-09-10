import React, { useState, useEffect } from 'react';
import { Play, Square, RotateCw, Terminal, RefreshCw, Box, Copy, Check } from 'lucide-react';
import { ContainerInfo } from '../types';
import { api } from '../api';

export const Docker: React.FC = () => {
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'running' | 'stopped'>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Logs modal
  const [activeLogContainer, setActiveLogContainer] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadContainers = async () => {
    setLoading(true);
    try {
      const data = await api.getContainers();
      setContainers(data || []);
    } catch (err) {
      setContainers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadContainers();
    let interval = setInterval(loadContainers, 8000);

    const handleVisibility = () => {
      if (document.hidden) {
        clearInterval(interval);
      } else {
        loadContainers();
        interval = setInterval(loadContainers, 8000);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const handleContainerAction = async (id: string, action: 'start' | 'stop' | 'restart') => {
    setActionLoading(`${action}-${id}`);
    try {
      if (action === 'start') await api.startContainer(id);
      if (action === 'stop') await api.stopContainer(id);
      if (action === 'restart') await api.restartContainer(id);
      await loadContainers();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `操作失败: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenLogs = async (id: string) => {
    setActiveLogContainer(id);
    setLogsLoading(true);
    try {
      const res = await api.getContainerLogs(id, 150);
      setLogs(res.logs || '暂无日志输出');
    } catch (err: any) {
      setLogs(`获取日志失败: ${err.message}`);
    } finally {
      setLogsLoading(false);
    }
  };

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(logs);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredContainers = containers.filter(c => {
    if (filter === 'running') return c.state === 'running';
    if (filter === 'stopped') return c.state !== 'running';
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Alert Banner */}
      {alertMsg && (
        <div className={`p-4 rounded-xl text-sm flex items-center justify-between ${
          alertMsg.type === 'success'
            ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
            : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
        }`}>
          <span>{alertMsg.text}</span>
          <button onClick={() => setAlertMsg(null)} className="text-xs opacity-70 hover:opacity-100">关闭</button>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-white">Docker 容器管理</h2>
          <p className="text-sm text-slate-400 mt-1">
            由 MacNAS 虚拟机提供底层 Docker Engine 支持，无需安装 Docker Desktop。
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Filters */}
          <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs font-semibold">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 rounded-lg transition ${
                filter === 'all' ? 'bg-sky-500 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              全部 ({containers.length})
            </button>
            <button
              onClick={() => setFilter('running')}
              className={`px-3 py-1.5 rounded-lg transition ${
                filter === 'running' ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              运行中 ({containers.filter(c => c.state === 'running').length})
            </button>
            <button
              onClick={() => setFilter('stopped')}
              className={`px-3 py-1.5 rounded-lg transition ${
                filter === 'stopped' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              已停止 ({containers.filter(c => c.state !== 'running').length})
            </button>
          </div>

          <button
            onClick={loadContainers}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Containers List */}
      {filteredContainers.length === 0 ? (
        <div className="p-12 rounded-2xl bg-slate-900/40 border border-dashed border-slate-800 text-center space-y-3">
          <Box className="w-10 h-10 text-slate-600 mx-auto" />
          <h3 className="text-base font-bold text-slate-300">暂无容器</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            当前环境暂无匹配的 Docker 容器。您可以在「应用」页面一键安装 Jellyfin、Syncthing 或 FileBrowser。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredContainers.map((container) => {
            const isRunning = container.state === 'running';
            return (
              <div
                key={container.id}
                className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/90 hover:border-slate-700/80 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                {/* Info */}
                <div className="flex items-center space-x-4">
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                    isRunning ? 'bg-emerald-500 shadow-md shadow-emerald-500/50 animate-pulse' : 'bg-slate-600'
                  }`} />

                  <div>
                    <div className="flex items-center space-x-2.5">
                      <h4 className="font-bold text-white text-base font-mono">{container.name}</h4>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${
                        isRunning ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {container.state}
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 mt-1 font-mono">镜像: {container.image}</p>
                    {container.ports && (
                      <p className="text-xs text-sky-400 font-mono mt-0.5">端口映射: {container.ports}</p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center space-x-2 self-end md:self-auto">
                  {!isRunning ? (
                    <button
                      onClick={() => handleContainerAction(container.id, 'start')}
                      disabled={actionLoading !== null}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition disabled:opacity-50"
                    >
                      <Play className="w-3.5 h-3.5 fill-white" />
                      <span>启动</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleContainerAction(container.id, 'stop')}
                      disabled={actionLoading !== null}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-900/40 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-500/30 text-xs font-semibold transition disabled:opacity-50"
                    >
                      <Square className="w-3 h-3" />
                      <span>停止</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleContainerAction(container.id, 'restart')}
                    disabled={actionLoading !== null}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition disabled:opacity-50"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>重启</span>
                  </button>

                  <button
                    onClick={() => handleOpenLogs(container.id)}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 text-xs font-semibold transition"
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    <span>查看日志</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Terminal Logs Drawer/Modal */}
      {activeLogContainer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl h-[75vh] flex flex-col rounded-2xl bg-[#0b0f19] border border-slate-800 shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="px-5 py-3.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Terminal className="w-4 h-4 text-sky-400" />
                <span className="font-bold text-sm text-white font-mono">容器实时日志</span>
                <span className="text-xs text-slate-400">({activeLogContainer})</span>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleCopyLogs}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? '已复制' : '复制日志'}</span>
                </button>

                <button
                  onClick={() => handleOpenLogs(activeLogContainer)}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                  title="刷新日志"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${logsLoading ? 'animate-spin' : ''}`} />
                </button>

                <button
                  onClick={() => setActiveLogContainer(null)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-xs font-semibold transition"
                >
                  关闭
                </button>
              </div>
            </div>

            {/* Terminal View */}
            <div className="flex-1 p-4 bg-black/90 overflow-y-auto font-mono text-xs text-emerald-400/90 leading-relaxed whitespace-pre-wrap select-text">
              {logsLoading ? (
                <div className="text-slate-400 flex items-center space-x-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>正在拉取最新容器日志...</span>
                </div>
              ) : (
                logs || '暂无容器输出日志'
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
