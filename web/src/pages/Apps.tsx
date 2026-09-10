import React, { useState, useEffect } from 'react';
import {
  RefreshCw,
  Search,
  Plus,
  Layers,
  Sparkles,
  Server,
  PlayCircle,
  PackageCheck,
  CheckCircle2,
  AlertCircle,
  Terminal,
  Copy,
  Check,
  X,
  Store,
} from 'lucide-react';
import { AppMetadata } from '../types';
import { api } from '../api';
import { AppCard } from './apps/AppCard';
import { AppConfigInstallModal } from './apps/AppConfigInstallModal';
import { CustomAppModal } from './apps/CustomAppModal';
import { ContainerTerminalModal } from './docker/ContainerTerminalModal';

export const Apps: React.FC = () => {
  const [apps, setApps] = useState<AppMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals
  const [installingApp, setInstallingApp] = useState<AppMetadata | null>(null);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [activeTerminalContainer, setActiveTerminalContainer] = useState<string | null>(null);

  // Logs modal
  const [activeLogApp, setActiveLogApp] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [copiedLogs, setCopiedLogs] = useState(false);

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
  }, []);

  const handleSyncCommunity = async () => {
    setSyncing(true);
    try {
      const res = await api.syncAppStore();
      setAlertMsg({ type: 'success', text: `社区应用商城同步成功！共载入 ${res.count} 款精选拓展应用。` });
      await loadApps();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `同步社区源失败: ${err.message}` });
    } finally {
      setSyncing(false);
    }
  };

  const handleAppAction = async (id: string, action: 'start' | 'stop' | 'restart' | 'uninstall') => {
    if (action === 'uninstall') {
      if (!confirm(`确定要卸载应用 [${id}] 吗？容器将被移除，已有数据挂载目录与配置仍将完整保留。`)) return;
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

  const handleDeleteCustomApp = async (id: string) => {
    if (!confirm(`确定要从商城中移除自定义应用 [${id}] 吗？`)) return;
    try {
      await api.deleteCustomApp(id);
      setAlertMsg({ type: 'success', text: `自定义应用已成功删除` });
      await loadApps();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `删除失败: ${err.message}` });
    }
  };

  const handleViewLogs = async (id: string) => {
    setActiveLogApp(id);
    setLogsLoading(true);
    try {
      const res = await api.getAppLogs(id, 200);
      setLogs(res.logs || '暂无日志输出');
    } catch (err: any) {
      setLogs(`获取日志失败: ${err.message}`);
    } finally {
      setLogsLoading(false);
    }
  };

  const handleCopyLogs = () => {
    if (!logs) return;
    navigator.clipboard.writeText(logs);
    setCopiedLogs(true);
    setTimeout(() => setCopiedLogs(false), 2000);
  };

  // Categories list
  const categories = [
    { id: 'all', name: '全部' },
    { id: '影音娱乐', name: '影音娱乐' },
    { id: '私有云盘', name: '私有云盘' },
    { id: '文件存储', name: '文件存储' },
    { id: '下载工具', name: '下载工具' },
    { id: '网络工具', name: '网络工具' },
    { id: '系统运维', name: '系统运维' },
    { id: '实用工具', name: '实用工具' },
    { id: '智能家居', name: '智能家居' },
    { id: '我的自定义', name: '我的自定义' },
  ];

  // Filtering
  const filteredApps = apps.filter((app) => {
    // Category filter
    if (selectedCategory !== 'all') {
      if (selectedCategory === '我的自定义') {
        if (app.source !== 'custom' && app.category !== '我的自定义') return false;
      } else if (app.category !== selectedCategory) {
        return false;
      }
    }
    // Source filter
    if (selectedSource !== 'all') {
      if (selectedSource === 'builtin' && app.source && app.source !== 'builtin') return false;
      if (selectedSource === 'community' && app.source !== 'community') return false;
      if (selectedSource === 'custom' && app.source !== 'custom') return false;
    }
    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = app.name.toLowerCase().includes(q);
      const matchDesc = app.description.toLowerCase().includes(q);
      const matchPort = app.port.toString().includes(q);
      const matchId = app.id.toLowerCase().includes(q);
      if (!matchName && !matchDesc && !matchPort && !matchId) return false;
    }
    return true;
  });

  // Stats calculation
  const totalAppsCount = apps.length;
  const runningAppsCount = apps.filter((a) => a.status === 'running').length;
  const installedAppsCount = apps.filter((a) => a.installed).length;
  const customAppsCount = apps.filter((a) => a.source === 'custom').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <h2 className="text-2xl font-extrabold text-white tracking-tight">NAS 应用商城</h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20 font-medium">
              Docker 容器引擎
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            一键安装官方精选与社区生态应用。安装前自由定制宿主机端口、数据存储与外接盘映射；支持通过 Docker Compose 录入私有应用。
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={handleSyncCommunity}
            disabled={syncing}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition shadow-sm disabled:opacity-50"
            title="同步并加载开源社区开源应用商城"
          >
            <Layers className={`w-3.5 h-3.5 text-amber-400 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? '同步中...' : '同步社区源'}</span>
          </button>

          <button
            onClick={() => setShowCustomModal(true)}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold shadow-lg shadow-sky-500/25 transition"
          >
            <Plus className="w-4 h-4" />
            <span>导入 Compose 应用</span>
          </button>

          <button
            onClick={loadApps}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs border border-slate-700 transition"
            title="刷新商城列表"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex items-center space-x-3.5">
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
            <Store className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-black text-white">{totalAppsCount}</div>
            <div className="text-[11px] text-slate-400">商城可用项目</div>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex items-center space-x-3.5">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <PlayCircle className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-black text-emerald-400">{runningAppsCount}</div>
            <div className="text-[11px] text-slate-400">正在运行服务</div>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex items-center space-x-3.5">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <PackageCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-black text-indigo-300">{installedAppsCount}</div>
            <div className="text-[11px] text-slate-400">已部署安装</div>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex items-center space-x-3.5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-black text-amber-300">{customAppsCount}</div>
            <div className="text-[11px] text-slate-400">我的自定义 Compose</div>
          </div>
        </div>
      </div>

      {/* Alert Banner */}
      {alertMsg && (
        <div
          className={`p-4 rounded-xl text-xs flex items-center justify-between transition-all ${
            alertMsg.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center space-x-2">
            {alertMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
            <span>{alertMsg.text}</span>
          </div>
          <button onClick={() => setAlertMsg(null)} className="text-xs opacity-70 hover:opacity-100 ml-4">
            关闭
          </button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-3.5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="搜索应用名称、描述、端口 (如: jellyfin, 8096)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-sky-500 transition"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Source Filter Pills */}
          <div className="flex items-center space-x-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setSelectedSource('all')}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                selectedSource === 'all'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              全部来源
            </button>
            <button
              onClick={() => setSelectedSource('builtin')}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                selectedSource === 'builtin'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              官方精选
            </button>
            <button
              onClick={() => setSelectedSource('community')}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                selectedSource === 'community'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              社区商城
            </button>
            <button
              onClick={() => setSelectedSource('custom')}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                selectedSource === 'custom'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              我的自定义
            </button>
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex items-center space-x-1 overflow-x-auto pb-1 border-t border-slate-800/60 pt-2.5">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                selectedCategory === cat.id
                  ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20 font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Apps Grid */}
      {filteredApps.length === 0 ? (
        <div className="p-12 rounded-2xl bg-slate-900/40 border border-slate-800 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-800 mx-auto flex items-center justify-center text-slate-500">
            <Server className="w-6 h-6" />
          </div>
          <h4 className="text-base font-bold text-white">未找到匹配的应用</h4>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            未发现与当前分类或关键词匹配的应用。您可以尝试清空筛选条件，或点击右上角导入自定义 Docker Compose。
          </p>
          <div className="pt-2 flex justify-center space-x-3">
            {(selectedCategory !== 'all' || selectedSource !== 'all' || searchQuery) && (
              <button
                onClick={() => {
                  setSelectedCategory('all');
                  setSelectedSource('all');
                  setSearchQuery('');
                }}
                className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
              >
                重置所有筛选
              </button>
            )}
            <button
              onClick={() => setShowCustomModal(true)}
              className="px-4 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold transition"
            >
              导入自定义应用
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredApps.map((app) => (
            <AppCard
              key={app.id}
              app={app}
              actionLoading={actionLoading}
              onInstall={(target) => setInstallingApp(target)}
              onAction={handleAppAction}
              onViewLogs={handleViewLogs}
              onOpenTerminal={(cName) => setActiveTerminalContainer(cName)}
              onDeleteCustom={handleDeleteCustomApp}
            />
          ))}
        </div>
      )}

      {/* Config and Install Modal */}
      {installingApp && (
        <AppConfigInstallModal
          app={installingApp}
          onClose={() => setInstallingApp(null)}
          onSuccess={() => {
            setInstallingApp(null);
            loadApps();
          }}
        />
      )}

      {/* Custom App Import Modal */}
      <CustomAppModal
        isOpen={showCustomModal}
        onClose={() => setShowCustomModal(false)}
        onSuccess={() => {
          setShowCustomModal(false);
          setAlertMsg({ type: 'success', text: '自定义 Docker Compose 应用已成功加入商城！' });
          loadApps();
        }}
      />

      {/* Logs Modal */}
      {activeLogApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-4xl h-[78vh] flex flex-col rounded-2xl bg-[#0b0f19] border border-slate-800 shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <Terminal className="w-4 h-4 text-sky-400" />
                <span className="font-bold text-sm text-white font-mono">{activeLogApp} 应用运行日志</span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleViewLogs(activeLogApp)}
                  disabled={logsLoading}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center space-x-1 transition"
                  title="刷新日志"
                >
                  <RefreshCw className={`w-3 h-3 ${logsLoading ? 'animate-spin' : ''}`} />
                  <span>刷新</span>
                </button>
                <button
                  onClick={handleCopyLogs}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center space-x-1 transition"
                  title="复制日志"
                >
                  {copiedLogs ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedLogs ? '已复制' : '复制'}</span>
                </button>
                <button
                  onClick={() => setActiveLogApp(null)}
                  className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
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
