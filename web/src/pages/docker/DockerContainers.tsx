import React, { useState, useEffect } from 'react';
import {
  Play,
  Square,
  RotateCw,
  Terminal,
  Trash2,
  RefreshCw,
  ExternalLink,
  Search,
  Box,
  Copy,
  Check,
  AlertCircle,
  Cpu,
  Layers,
} from 'lucide-react';
import { ContainerInfo } from '../../types';
import { api } from '../../api';

export const DockerContainers: React.FC = () => {
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<'all' | 'running' | 'stopped'>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Logs Modal
  const [activeLogContainer, setActiveLogContainer] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Delete Confirm Modal
  const [deleteModalContainer, setDeleteModalContainer] = useState<ContainerInfo | null>(null);
  const [forceDelete, setForceDelete] = useState(false);

  const loadContainers = async () => {
    try {
      const data = await api.getContainers();
      setContainers(data || []);
    } catch (err: any) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadContainers();
    const interval = setInterval(loadContainers, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleContainerAction = async (id: string, action: 'start' | 'stop' | 'restart') => {
    setActionLoading(`${action}-${id}`);
    try {
      await api.containerAction(id, action);
      await loadContainers();
      setAlertMsg({ type: 'success', text: `容器已成功执行 ${action} 操作` });
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `操作失败: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteModalContainer) return;
    const id = deleteModalContainer.id;
    setActionLoading(`delete-${id}`);
    try {
      await api.removeContainer(id, forceDelete);
      setDeleteModalContainer(null);
      setAlertMsg({ type: 'success', text: `容器 ${deleteModalContainer.name} 已成功删除` });
      await loadContainers();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `删除容器失败: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenLogs = async (id: string) => {
    setActiveLogContainer(id);
    setLogsLoading(true);
    try {
      const res = await api.getContainerLogs(id, 200);
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
    if (filter === 'running' && c.state !== 'running') return false;
    if (filter === 'stopped' && c.state === 'running') return false;
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      return (
        c.name.toLowerCase().includes(term) ||
        c.image.toLowerCase().includes(term) ||
        (c.ports && c.ports.toLowerCase().includes(term)) ||
        (c.project && c.project.toLowerCase().includes(term))
      );
    }
    return true;
  });

  const hostIP = window.location.hostname;

  return (
    <div className="space-y-5">
      {/* Alert Banner */}
      {alertMsg && (
        <div
          className={`p-4 rounded-2xl text-xs flex items-center justify-between shadow-lg ${
            alertMsg.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4" />
            <span>{alertMsg.text}</span>
          </div>
          <button onClick={() => setAlertMsg(null)} className="opacity-70 hover:opacity-100 font-bold">
            ✕
          </button>
        </div>
      )}

      {/* Control Bar: Filters & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-2">
          {/* Segmented Filter */}
          <div className="flex bg-slate-900 p-1 rounded-2xl border border-slate-800 text-xs font-semibold">
            <button
              onClick={() => setFilter('all')}
              className={`px-3.5 py-1.5 rounded-xl transition ${
                filter === 'all' ? 'bg-sky-500 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              全部 ({containers.length})
            </button>
            <button
              onClick={() => setFilter('running')}
              className={`px-3.5 py-1.5 rounded-xl transition ${
                filter === 'running' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              运行中 ({containers.filter(c => c.state === 'running').length})
            </button>
            <button
              onClick={() => setFilter('stopped')}
              className={`px-3.5 py-1.5 rounded-xl transition ${
                filter === 'stopped' ? 'bg-slate-700 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              已停止 ({containers.filter(c => c.state !== 'running').length})
            </button>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Search box */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="搜索容器名称、镜像或端口..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9 pr-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 w-64 transition"
            />
          </div>

          <button
            onClick={loadContainers}
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition"
            title="刷新容器"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Containers List */}
      {filteredContainers.length === 0 ? (
        <div className="p-16 rounded-3xl bg-slate-900/60 border border-dashed border-slate-800 text-center space-y-3">
          <Box className="w-12 h-12 text-slate-600 mx-auto" />
          <h3 className="text-base font-bold text-slate-300">暂无容器实例</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            未检索到匹配的 Docker 容器。您可以通过 Compose 部署服务，或在「应用」中心一键安装。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5">
          {filteredContainers.map(container => {
            const isRunning = container.state === 'running';
            return (
              <div
                key={container.id}
                className="p-5 rounded-3xl bg-slate-900/75 border border-slate-800/90 hover:border-slate-700 transition-all flex flex-col xl:flex-row xl:items-center justify-between gap-5 shadow-lg"
              >
                {/* Left: Indicator, Name & Meta */}
                <div className="flex items-start space-x-4 min-w-0 flex-1">
                  <div className="pt-1.5 flex-shrink-0">
                    <div
                      className={`w-3.5 h-3.5 rounded-full ${
                        isRunning
                          ? 'bg-emerald-500 shadow-md shadow-emerald-500/50 animate-pulse ring-4 ring-emerald-500/20'
                          : 'bg-slate-600'
                      }`}
                    />
                  </div>

                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-bold text-white text-base font-mono truncate">{container.name}</h4>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${
                          isRunning
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {container.state}
                      </span>
                      {container.project && (
                        <span className="flex items-center text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">
                          <Layers className="w-3 h-3 mr-1" />
                          项目: {container.project}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-400 font-mono truncate">镜像: {container.image}</p>

                    {/* Ports mappings with 1-click web navigation */}
                    {container.portsMap && container.portsMap.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span className="text-[11px] text-slate-400 mr-1">Web 访问:</span>
                        {container.portsMap.map((p, idx) => (
                          <a
                            key={idx}
                            href={`http://${hostIP}:${p.hostPort}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 hover:text-sky-300 border border-sky-500/30 text-xs font-mono transition"
                            title={`打开服务: http://${hostIP}:${p.hostPort}`}
                          >
                            <span>
                              {p.hostPort} ➔ {p.containerPort}/{p.protocol}
                            </span>
                            <ExternalLink className="w-3 h-3 ml-0.5" />
                          </a>
                        ))}
                      </div>
                    ) : container.ports ? (
                      <p className="text-xs text-slate-400 font-mono truncate">端口映射: {container.ports}</p>
                    ) : null}
                  </div>
                </div>

                {/* Middle: Resource consumption (CPU / Memory) */}
                <div className="flex items-center space-x-6 px-4 py-2 rounded-2xl bg-slate-950/60 border border-slate-800/80 text-xs font-mono flex-shrink-0">
                  <div className="space-y-1">
                    <div className="flex items-center text-slate-400 space-x-1">
                      <Cpu className="w-3.5 h-3.5 text-sky-400" />
                      <span>CPU 使用率</span>
                    </div>
                    <div className="text-white font-bold">{container.cpuPerc || '0.00%'}</div>
                  </div>

                  <div className="w-[1px] h-8 bg-slate-800" />

                  <div className="space-y-1">
                    <div className="flex items-center text-slate-400 space-x-1">
                      <span>内存消耗</span>
                    </div>
                    <div className="text-white font-bold">{container.memUsage || '-'}</div>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center space-x-2 self-end xl:self-auto flex-shrink-0">
                  {!isRunning ? (
                    <button
                      onClick={() => handleContainerAction(container.id, 'start')}
                      disabled={actionLoading !== null}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md transition disabled:opacity-50"
                    >
                      <Play className="w-3.5 h-3.5 fill-white" />
                      <span>启动</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleContainerAction(container.id, 'stop')}
                      disabled={actionLoading !== null}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-950/50 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-500/30 text-xs font-semibold transition disabled:opacity-50"
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
                    <span>日志</span>
                  </button>

                  <button
                    onClick={() => setDeleteModalContainer(container)}
                    className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950/50 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-500/30 transition"
                    title="删除容器"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Terminal Logs Modal */}
      {activeLogContainer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl h-[75vh] flex flex-col rounded-3xl bg-[#0b0f19] border border-slate-800 shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Terminal className="w-4 h-4 text-sky-400" />
                <span className="font-bold text-sm text-white font-mono">实时运行日志</span>
                <span className="text-xs text-slate-400">({activeLogContainer})</span>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleCopyLogs}
                  className="flex items-center space-x-1 px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? '已复制' : '复制日志'}</span>
                </button>

                <button
                  onClick={() => handleOpenLogs(activeLogContainer)}
                  className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                  title="刷新日志"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${logsLoading ? 'animate-spin' : ''}`} />
                </button>

                <button
                  onClick={() => setActiveLogContainer(null)}
                  className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-xs font-semibold transition"
                >
                  关闭
                </button>
              </div>
            </div>

            <div className="flex-1 p-4 bg-black/90 overflow-y-auto font-mono text-xs text-emerald-400/90 leading-relaxed whitespace-pre-wrap select-text">
              {logsLoading ? (
                <div className="text-slate-400 flex items-center space-x-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>正在获取容器最新日志...</span>
                </div>
              ) : (
                logs || '暂无容器输出日志'
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModalContainer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-3 text-rose-400">
              <AlertCircle className="w-6 h-6" />
              <h3 className="text-base font-bold text-white">确认删除容器？</h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              确定要删除容器 <span className="font-mono font-bold text-white">"{deleteModalContainer.name}"</span> 吗？
              删除后该容器实例将被移除，已持久化到宿主机挂载目录的数据不受影响。
            </p>

            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-400 flex items-center space-x-2">
              <input
                type="checkbox"
                id="forceDel"
                checked={forceDelete}
                onChange={e => setForceDelete(e.target.checked)}
                className="rounded border-slate-700 text-rose-500 focus:ring-0"
              />
              <label htmlFor="forceDel" className="cursor-pointer">
                强制删除正在运行中的容器 (-f)
              </label>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setDeleteModalContainer(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-semibold transition"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={actionLoading !== null}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs text-white font-bold transition disabled:opacity-50"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
