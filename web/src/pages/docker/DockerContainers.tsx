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
  X,
  Sparkles,
} from 'lucide-react';
import { ContainerInfo } from '../../types';
import { api } from '../../api';
import { ContainerTerminalModal } from './ContainerTerminalModal';

interface DockerContainersProps {
  onOpenTerminalWithLogs?: (payload: { containerName: string; logs: string }) => void;
}

const MAX_LOGS_FOR_AI = 60_000;

export const DockerContainers: React.FC<DockerContainersProps> = ({ onOpenTerminalWithLogs }) => {
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<'all' | 'running' | 'stopped'>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Terminal Modal
  const [activeTerminalContainer, setActiveTerminalContainer] = useState<string | null>(null);

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
    const poll = () => { if (!document.hidden) loadContainers(); };
    const interval = setInterval(poll, 5000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', poll);
    };
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

  const sendLogsToTerminal = (containerName: string, rawLogs: string) => {
    const cleaned = rawLogs.replace(/(?:\u001b)?\[[0-9;]*m/g, '').trim();
    if (!cleaned) {
      setAlertMsg({ type: 'error', text: '当前容器没有可发送的日志' });
      return;
    }
    const clipped = cleaned.length > MAX_LOGS_FOR_AI
      ? `[MacNAS] 日志过长，已保留最后 ${MAX_LOGS_FOR_AI.toLocaleString()} 个字符。\n\n${cleaned.slice(-MAX_LOGS_FOR_AI)}`
      : cleaned;
    onOpenTerminalWithLogs?.({
      containerName,
      logs: `[MacNAS 容器日志] ${containerName}\n以下为最近容器输出，请先分析问题再提出或执行修复：\n\n${clipped}`,
    });
    setActiveLogContainer(null);
    setAlertMsg({ type: 'success', text: `已将 ${containerName} 的日志放入 Web 终端输入框，请选择 AI 并发送` });
  };

  const handleSendLogsToTerminal = async (id: string, containerName: string) => {
    setLogsLoading(true);
    try {
      const res = await api.getContainerLogs(id, 200);
      sendLogsToTerminal(containerName, res.logs || '');
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `获取容器日志失败: ${err.message}` });
    } finally {
      setLogsLoading(false);
    }
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
  const readableLogs = logs.replace(/(?:\u001b)?\[[0-9;]*m/g, '');

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5 overflow-hidden">
      {/* Alert Banner */}
      {alertMsg && (
        <div
          className={`fixed left-1/2 top-20 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center justify-between gap-3 rounded-full border bg-white/95 px-4 py-2.5 text-xs shadow-xl backdrop-blur dark:bg-slate-900/95 ${
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
      <div className="flex shrink-0 flex-col gap-2 rounded-[20px] border border-slate-200/80 bg-white p-2 shadow-xs dark:border-slate-800 dark:bg-slate-900/80 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center space-x-2">
          {/* Segmented Filter */}
          <div className="grid w-full grid-cols-3 rounded-2xl bg-slate-100 p-1 text-[10px] font-semibold dark:bg-slate-800/70 sm:w-auto sm:text-xs">
            <button
              onClick={() => setFilter('all')}
              className={`whitespace-nowrap rounded-xl px-2 py-1.5 transition sm:px-3 ${
                filter === 'all'
                  ? 'bg-white dark:bg-sky-500 text-slate-900 dark:text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              全部 ({containers.length})
            </button>
            <button
              onClick={() => setFilter('running')}
              className={`whitespace-nowrap rounded-xl px-2 py-1.5 transition sm:px-3 ${
                filter === 'running'
                  ? 'bg-emerald-500 text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              运行中 ({containers.filter(c => c.state === 'running').length})
            </button>
            <button
              onClick={() => setFilter('stopped')}
              className={`whitespace-nowrap rounded-xl px-2 py-1.5 transition sm:px-3 ${
                filter === 'stopped'
                  ? 'bg-slate-600 text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              已停止 ({containers.filter(c => c.state !== 'running').length})
            </button>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          {/* Search box */}
          <div className="relative min-w-0 flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="搜索容器名称、镜像或端口..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="min-h-9 w-full rounded-xl border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-xs text-slate-900 shadow-xs transition placeholder:text-slate-400 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white sm:w-64"
            />
          </div>

          <button
            onClick={loadContainers}
            className="p-2 rounded-xl bg-white hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 shadow-xs transition"
            title="刷新容器"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Containers List */}
      {filteredContainers.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-[22px] border border-dashed border-slate-200 bg-white p-8 text-center shadow-xs dark:border-slate-800 dark:bg-slate-900/60">
          <Box className="w-12 h-12 text-slate-400 dark:text-slate-600 mx-auto" />
          <h3 className="text-base font-bold text-slate-700 dark:text-slate-300">暂无容器实例</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">可通过编排或应用中心部署</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-0.5 [-webkit-overflow-scrolling:touch]">
          {filteredContainers.map(container => {
            const isRunning = container.state === 'running';
            return (
              <div
                key={container.id}
                className="flex flex-col justify-between gap-3 rounded-[20px] border border-slate-200 bg-white p-3 shadow-xs transition-all hover:border-slate-300 dark:border-slate-800/90 dark:bg-slate-900/75 dark:hover:border-slate-700 md:flex-row md:items-center"
              >
                {/* Left: Indicator, Name & Meta */}
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="pt-1.5 flex-shrink-0">
                    <div
                      className={`w-3.5 h-3.5 rounded-full ${
                        isRunning
                          ? 'bg-emerald-500 shadow-md shadow-emerald-500/50 animate-pulse ring-4 ring-emerald-500/20'
                          : 'bg-slate-400 dark:bg-slate-600'
                      }`}
                    />
                  </div>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-bold text-slate-900 dark:text-white text-base font-mono truncate">{container.name}</h4>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${
                          isRunning
                            ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {container.state}
                      </span>
                      {container.project && (
                        <span className="flex items-center text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20 font-mono">
                          <Layers className="w-3 h-3 mr-1" />
                          项目: {container.project}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">镜像: {container.image}</p>

                    {/* Ports mappings with 1-click web navigation */}
                    {container.portsMap && container.portsMap.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-1">Web 访问:</span>
                        {container.portsMap.map((p, idx) => (
                          <a
                            key={idx}
                            href={`http://${hostIP}:${p.hostPort}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-lg bg-sky-50 dark:bg-sky-500/10 hover:bg-sky-100 dark:hover:bg-sky-500/20 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-500/30 text-xs font-mono transition"
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
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">端口: {container.ports}</p>
                    ) : null}
                  </div>
                </div>

                {/* Middle: Resource consumption (CPU / Memory) */}
                <div className="hidden shrink-0 items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs dark:border-slate-800/80 dark:bg-slate-950/60 lg:flex">
                  <div className="space-y-0.5">
                    <div className="flex items-center text-slate-500 dark:text-slate-400 space-x-1">
                      <Cpu className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
                      <span>CPU 使用率</span>
                    </div>
                    <div className="text-slate-900 dark:text-white font-bold">{container.cpuPerc || '0.00%'}</div>
                  </div>

                  <div className="w-[1px] h-8 bg-slate-200 dark:bg-slate-800" />

                  <div className="space-y-0.5">
                    <div className="flex items-center text-slate-500 dark:text-slate-400 space-x-1">
                      <span>内存消耗</span>
                    </div>
                    <div className="text-slate-900 dark:text-white font-bold">{container.memUsage || '-'}</div>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex shrink-0 items-center gap-1.5 self-end md:self-auto">
                  {!isRunning ? (
                    <button
                      onClick={() => handleContainerAction(container.id, 'start')}
                      disabled={actionLoading !== null}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition disabled:opacity-50"
                    >
                      <Play className="w-3.5 h-3.5 fill-white" />
                      <span className="hidden sm:inline">启动</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleContainerAction(container.id, 'stop')}
                      disabled={actionLoading !== null}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-600 dark:bg-slate-800 dark:hover:bg-rose-950/50 dark:text-slate-300 dark:hover:text-rose-300 border border-slate-200 hover:border-rose-300 dark:border-slate-700 text-xs font-semibold transition disabled:opacity-50"
                    >
                      <Square className="w-3 h-3" />
                      <span className="hidden sm:inline">停止</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleContainerAction(container.id, 'restart')}
                    disabled={actionLoading !== null}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-xs font-semibold transition disabled:opacity-50"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">重启</span>
                  </button>

                  <button
                    onClick={() => handleOpenLogs(container.id)}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 dark:bg-sky-500/10 dark:hover:bg-sky-500/20 text-sky-600 dark:text-sky-300 border border-sky-200 dark:border-sky-500/30 text-xs font-semibold transition"
                    title="查看容器日志"
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">日志</span>
                  </button>

                  <button
                    onClick={() => handleSendLogsToTerminal(container.id, container.name || container.id)}
                    disabled={logsLoading}
                    className="flex items-center space-x-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-100 disabled:opacity-50 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/20"
                    title="获取最近 200 行日志并放入 Web 终端输入框"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">AI</span>
                  </button>

                  {isRunning && (
                    <button
                      onClick={() => setActiveTerminalContainer(container.name || container.id)}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-teal-50 hover:bg-teal-100 dark:bg-teal-500/10 dark:hover:bg-teal-500/20 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-500/30 text-xs font-semibold transition shadow-xs"
                      title="进入容器内部终端"
                    >
                      <Terminal className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">终端</span>
                    </button>
                  )}

                  <button
                    onClick={() => setDeleteModalContainer(container)}
                    className="p-2 rounded-xl bg-slate-100 hover:bg-rose-50 dark:bg-slate-800 dark:hover:bg-rose-950/50 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 border border-slate-200 hover:border-rose-200 dark:border-slate-700 transition"
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
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-0 sm:p-4">
          <div className="terminal-dark-preserve flex h-[100dvh] w-full flex-col overflow-hidden bg-[#0b0f19] shadow-2xl sm:h-[88dvh] sm:max-w-4xl sm:rounded-2xl sm:border sm:border-slate-800">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/90 px-3 py-2.5 sm:px-5 sm:py-3.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400">
                  <Terminal className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <span className="block text-sm font-bold text-white">容器日志</span>
                  <span className="block truncate font-mono text-[10px] text-slate-400">{activeLogContainer}</span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  onClick={handleCopyLogs}
                  className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-slate-800 px-3 text-xs text-slate-300 transition hover:bg-slate-700"
                  aria-label={copied ? '日志已复制' : '复制日志'}
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">{copied ? '已复制' : '复制日志'}</span>
                </button>

                <button
                  onClick={() => sendLogsToTerminal(activeLogContainer, logs)}
                  disabled={logsLoading || !logs}
                  className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-violet-500 px-3 text-xs font-semibold text-white transition hover:bg-violet-400 disabled:opacity-40"
                  title="关闭日志并将内容放入 Web 终端输入框"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">发给终端 AI</span>
                </button>

                <button
                  onClick={() => handleOpenLogs(activeLogContainer)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 text-slate-300 transition hover:bg-slate-700"
                  title="刷新日志"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${logsLoading ? 'animate-spin' : ''}`} />
                </button>

                <button
                  onClick={() => setActiveLogContainer(null)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 text-slate-300 transition hover:bg-slate-700 hover:text-white"
                  aria-label="关闭日志"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto whitespace-pre-wrap break-words bg-black/90 p-3 font-mono text-[11px] leading-5 text-emerald-400/90 select-text [-webkit-overflow-scrolling:touch] sm:p-4 sm:text-xs sm:leading-relaxed">
              {logsLoading ? (
                <div className="text-slate-400 flex items-center space-x-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>正在获取容器最新日志...</span>
                </div>
              ) : (
                readableLogs || '暂无容器输出日志'
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModalContainer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-3 text-rose-500">
              <AlertCircle className="w-6 h-6" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">确认删除容器？</h3>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              确定要删除容器 <span className="font-mono font-bold text-slate-900 dark:text-white">"{deleteModalContainer.name}"</span> 吗？
              删除后该容器实例将被移除，已持久化到宿主机挂载目录的数据不受影响。
            </p>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 flex items-center space-x-2">
              <input
                type="checkbox"
                id="forceDel"
                checked={forceDelete}
                onChange={e => setForceDelete(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 text-rose-500 focus:ring-0"
              />
              <label htmlFor="forceDel" className="cursor-pointer">
                强制删除正在运行中的容器 (-f)
              </label>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setDeleteModalContainer(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs text-slate-700 dark:text-slate-300 font-semibold transition"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={actionLoading !== null}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs text-white font-bold transition disabled:opacity-50 shadow-xs"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Container Interactive Terminal Modal */}
      {activeTerminalContainer && (
        <ContainerTerminalModal
          containerName={activeTerminalContainer}
          onClose={() => setActiveTerminalContainer(null)}
        />
      )}
    </div>
  );
};
