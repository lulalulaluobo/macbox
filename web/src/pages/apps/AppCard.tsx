import React from 'react';
import {
  Film,
  RefreshCw,
  Folder,
  ExternalLink,
  Play,
  Square,
  RotateCw,
  Trash2,
  Terminal,
  Download,
  Cloud,
  Shield,
  Activity,
  Music,
  Sliders,
  Box,
  Layers,
  Sparkles,
  Settings,
} from 'lucide-react';
import { AppMetadata } from '../../types';

interface AppCardProps {
  app: AppMetadata;
  actionLoading: string | null;
  onInstall: (app: AppMetadata) => void;
  onAction: (id: string, action: 'start' | 'stop' | 'restart' | 'uninstall') => void;
  onViewLogs: (id: string) => void;
  onOpenTerminal?: (containerName: string) => void;
  onDeleteCustom?: (id: string) => void;
}

export const AppCard: React.FC<AppCardProps> = ({
  app,
  actionLoading,
  onInstall,
  onAction,
  onViewLogs,
  onOpenTerminal,
  onDeleteCustom,
}) => {
  const isInstalled = app.installed;
  const isRunning = app.status === 'running';

  const renderIcon = (iconName: string) => {
    switch (iconName.toLowerCase()) {
      case 'film':
      case 'video':
        return <Film className="w-6 h-6 text-sky-400" />;
      case 'refresh-cw':
      case 'sync':
        return <RefreshCw className="w-6 h-6 text-indigo-400" />;
      case 'folder':
      case 'file':
        return <Folder className="w-6 h-6 text-amber-400" />;
      case 'download':
        return <Download className="w-6 h-6 text-emerald-400" />;
      case 'cloud':
        return <Cloud className="w-6 h-6 text-cyan-400" />;
      case 'shield':
      case 'lock':
        return <Shield className="w-6 h-6 text-teal-400" />;
      case 'activity':
      case 'heartbeat':
        return <Activity className="w-6 h-6 text-rose-400" />;
      case 'music':
      case 'audio':
        return <Music className="w-6 h-6 text-fuchsia-400" />;
      case 'sliders':
      case 'tool':
      case 'tools':
        return <Sliders className="w-6 h-6 text-amber-400" />;
      case 'box':
      case 'docker':
        return <Box className="w-6 h-6 text-sky-400" />;
      case 'layers':
      case 'compose':
        return <Layers className="w-6 h-6 text-violet-400" />;
      default:
        return <Box className="w-6 h-6 text-sky-400" />;
    }
  };

  const getSourceBadge = () => {
    if (app.source === 'custom') {
      return (
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center space-x-1">
          <Sparkles className="w-2.5 h-2.5" />
          <span>自定义</span>
        </span>
      );
    }
    if (app.source === 'community') {
      return (
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center space-x-1">
          <Layers className="w-2.5 h-2.5" />
          <span>社区拓展</span>
        </span>
      );
    }
    return (
      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">
        官方精选
      </span>
    );
  };

  return (
    <div
      className={`p-5 rounded-2xl border transition-all flex flex-col justify-between space-y-4 ${
        isRunning
          ? 'bg-white dark:bg-slate-900/85 border-sky-400/80 dark:border-sky-500/40 shadow-xs hover:shadow-md'
          : 'bg-white dark:bg-slate-900/60 border-slate-200/90 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700/80 shadow-xs hover:shadow-md'
      }`}
    >
      <div className="space-y-3.5">
        {/* Top Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-50 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/80 flex items-center justify-center shadow-xs flex-shrink-0">
              {renderIcon(app.icon)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white truncate max-w-[150px]" title={app.name}>
                  {app.name}
                </h3>
                {app.version && (
                  <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                    {app.version.startsWith('v') ? app.version : `v${app.version}`}
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2 mt-1">
                {getSourceBadge()}
                <span className="text-[10px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 px-2 py-0.5 rounded-full">
                  {app.category || '实用工具'}
                </span>
              </div>
            </div>
          </div>

          <span
            className={`text-[11px] px-2.5 py-1 rounded-full font-semibold flex-shrink-0 ${
              isRunning
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30 flex items-center space-x-1.5'
                : isInstalled
                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-800/80 dark:text-slate-400 border border-slate-200 dark:border-slate-700/50'
            }`}
          >
            {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
            <span>{isRunning ? '运行中' : isInstalled ? '已停止' : '未安装'}</span>
          </span>
        </div>

        {/* Description */}
        <p className="text-xs text-slate-600 dark:text-slate-300/90 leading-relaxed line-clamp-2 min-h-[32px]" title={app.description}>
          {app.description}
        </p>

        {/* Live Address when running */}
        {isRunning && (
          <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
            <div className="min-w-0 flex-1 mr-2">
              <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-medium">WebUI 访问入口:</span>
              <a
                href={app.webUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-mono font-semibold text-sky-600 dark:text-sky-400 hover:underline truncate block"
              >
                {app.webUrl}
              </a>
            </div>
            <a
              href={app.webUrl}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500 text-sky-600 hover:text-white transition flex-shrink-0"
              title="新标签页打开"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        )}

        <details className="group rounded-xl bg-slate-50/80 dark:bg-slate-950/40">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between px-3 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <span>端口与部署详情</span>
            <span className="text-sky-600 group-open:hidden dark:text-sky-400">查看</span>
            <span className="hidden group-open:block">收起</span>
          </summary>
          <div className="space-y-2 border-t border-slate-200/70 p-2.5 dark:border-slate-800/70">
        {/* Volumes & Ports Preview */}
        <div className="space-y-1.5 bg-slate-50 dark:bg-slate-950/50 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800/60 font-mono text-[11px]">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 font-sans text-[10px]">
            <span>默认端口: <strong className="font-mono text-slate-700 dark:text-slate-300 font-bold">{app.port}</strong></span>
            <span>挂载目录: <strong className="font-mono text-slate-700 dark:text-slate-300 font-bold">{app.volumes?.length || 0} 处</strong></span>
          </div>
          {app.volumes && app.volumes.length > 0 && (
            <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate space-y-0.5 pt-1 border-t border-slate-200/80 dark:border-slate-800/50">
              {app.volumes.slice(0, 2).map((v, i) => (
                <div key={i} className="flex justify-between truncate" title={`${v.host} -> ${v.container}`}>
                  <span className="text-slate-600 dark:text-slate-400 truncate max-w-[55%]">{v.host}</span>
                  <span className="text-slate-600 dark:text-slate-400 truncate max-w-[42%] text-right">→ {v.container}</span>
                </div>
              ))}
              {app.volumes.length > 2 && (
                <div className="text-[9px] text-slate-400 text-center">... 还有 {app.volumes.length - 2} 项目录映射</div>
              )}
            </div>
          )}
        </div>
          </div>
        </details>
      </div>

      {/* Bottom Actions */}
      <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80">
        {!isInstalled ? (
          <div className="flex items-center space-x-2">
            <button
              onClick={() => onInstall(app)}
              className="flex-1 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold shadow-lg shadow-sky-500/20 transition flex items-center justify-center space-x-2"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>配置并安装应用</span>
            </button>
            {app.source === 'custom' && onDeleteCustom && (
              <button
                onClick={() => onDeleteCustom(app.id)}
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 border border-slate-700/80 transition"
                title="删除此自定义模板"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-1.5">
            {/* Open Button */}
            {isRunning && (
              <a
                href={app.webUrl}
                target="_blank"
                rel="noreferrer"
                className="flex-1 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold text-center flex items-center justify-center space-x-1 shadow-md transition"
              >
                <span>打开</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            {/* Start / Stop */}
            {!isRunning ? (
              <button
                onClick={() => onAction(app.id, 'start')}
                disabled={actionLoading !== null}
                className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center space-x-1 transition disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>启动</span>
              </button>
            ) : (
              <button
                onClick={() => onAction(app.id, 'stop')}
                disabled={actionLoading !== null}
                className="p-2 rounded-xl bg-slate-800 hover:bg-rose-900/40 text-slate-300 hover:text-rose-300 border border-slate-700 text-xs font-medium transition disabled:opacity-50"
                title="停止服务"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Restart */}
            <button
              onClick={() => onAction(app.id, 'restart')}
              disabled={actionLoading !== null}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200/80 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 dark:border-slate-700 text-xs font-medium transition disabled:opacity-50"
              title="重启服务"
            >
              <RotateCw className={`w-3.5 h-3.5 ${actionLoading === `restart-${app.id}` ? 'animate-spin' : ''}`} />
            </button>

            {/* Reconfigure / Modify ports and volumes */}
            <button
              onClick={() => onInstall(app)}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200/80 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 dark:border-slate-700 text-xs font-medium transition"
              title="修改端口/存储挂载并重新部署"
            >
              <Settings className="w-3.5 h-3.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white" />
            </button>

            {/* View Logs */}
            <button
              onClick={() => onViewLogs(app.id)}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200/80 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 dark:border-slate-700 text-xs font-medium transition"
              title="查看实时应用日志"
            >
              <Terminal className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
            </button>

            {/* Container Interactive Terminal */}
            {isRunning && onOpenTerminal && (
              <button
                onClick={() => onOpenTerminal(`macnas-${app.id}`)}
                className="p-2 rounded-xl bg-slate-100 hover:bg-teal-50 text-slate-600 hover:text-teal-600 border border-slate-200 dark:bg-slate-800 dark:hover:bg-teal-950/60 dark:text-slate-300 dark:hover:text-teal-300 dark:border-slate-700 text-xs font-medium transition"
                title="进入应用容器内部终端 (docker exec)"
              >
                <Terminal className="w-3.5 h-3.5 text-teal-500 dark:text-teal-400" />
              </button>
            )}

            {/* Uninstall */}
            <button
              onClick={() => onAction(app.id, 'uninstall')}
              disabled={actionLoading !== null}
              className="p-2 rounded-xl bg-slate-100 hover:bg-rose-50 text-slate-500 hover:text-rose-600 border border-slate-200 hover:border-rose-200 dark:bg-slate-800 dark:hover:bg-rose-950/60 dark:text-slate-400 dark:hover:text-rose-400 dark:border-slate-700 text-xs font-medium transition disabled:opacity-50"
              title="卸载应用"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
