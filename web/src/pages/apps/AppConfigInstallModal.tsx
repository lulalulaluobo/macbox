import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Download,
  RefreshCw,
  Sliders,
  ExternalLink,
} from 'lucide-react';
import { AppMetadata } from '../../types';
import { api } from '../../api';
import { useAppInstallStream } from './hooks/useAppInstallStream';
import { AppInstallForm } from './AppInstallForm';
import { AppInstallProgress } from './AppInstallProgress';
import { AppInstallResult } from './AppInstallResult';

interface AppConfigInstallModalProps {
  app: AppMetadata | null;
  onClose: () => void;
  onSuccess: () => void;
}

export const AppConfigInstallModal: React.FC<AppConfigInstallModalProps> = ({
  app,
  onClose,
  onSuccess,
}) => {
  const [configData, setConfigData] = useState<AppMetadata | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);

  // Customization States
  const [portsMap, setPortsMap] = useState<Record<string, number>>({});
  const [volumesMap, setVolumesMap] = useState<Record<string, string>>({});
  const [envMap, setEnvMap] = useState<Record<string, string>>({});
  const [useYamlMode, setUseYamlMode] = useState(false);
  const [customYaml, setCustomYaml] = useState('');

  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const configRequestIdRef = useRef(0);
  const { installStatus, installLogs, installError, startDeploy } = useAppInstallStream({
    appId: app?.id,
    portsMap,
    volumesMap,
    envMap,
    useYamlMode,
    customYaml,
  });

  useEffect(() => {
    const requestId = ++configRequestIdRef.current;
    if (!app) {
      setConfigData(null);
      setLoadingConfig(false);
      return;
    }

    setUseYamlMode(false);
    setConfigData(null);
    setLoadingConfig(true);

    const load = async () => {
      try {
        const fullMeta = await api.getAppConfig(app.id);
        if (configRequestIdRef.current !== requestId) return;
        setConfigData(fullMeta);

        // Initialize ports map
        const pMap: Record<string, number> = {};
        if (fullMeta.ports && fullMeta.ports.length > 0) {
          fullMeta.ports.forEach(p => {
            pMap[p.containerPort.toString()] = p.hostPort;
          });
        } else if (fullMeta.port > 0) {
          pMap[fullMeta.port.toString()] = fullMeta.port;
        }
        setPortsMap(pMap);

        // Initialize volumes map
        const vMap: Record<string, string> = {};
        if (fullMeta.volumes) {
          fullMeta.volumes.forEach(v => {
            vMap[v.container] = v.host;
          });
        }
        setVolumesMap(vMap);

        // Initialize env map
        const eMap: Record<string, string> = {};
        if (fullMeta.env) {
          fullMeta.env.forEach(e => {
            eMap[e.key] = e.value;
          });
        }
        setEnvMap(eMap);

        setCustomYaml(fullMeta.composeTemplate || '');
      } catch (err) {
        if (configRequestIdRef.current !== requestId) return;
        setConfigData(app);
      } finally {
        if (configRequestIdRef.current === requestId) setLoadingConfig(false);
      }
    };

    void load();
  }, [app]);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [installLogs]);

  if (!app) return null;

  const handleFinishedClose = () => {
    if (installStatus === 'done') {
      onSuccess();
    }
    onClose();
  };

  const currentMeta = configData || app;
  const hostIP = window.location.hostname;
  const mainHostPort = portsMap[currentMeta.port?.toString()] || currentMeta.port;
  const webAccessUrl = `http://${hostIP}:${mainHostPort}`;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/55 sm:items-center sm:p-4">
      <div className="flex h-[100dvh] w-full max-w-3xl flex-col overflow-hidden bg-white dark:bg-slate-900 sm:h-[min(88dvh,780px)] sm:rounded-3xl sm:border sm:border-slate-200 sm:shadow-2xl dark:sm:border-slate-800">
        {/* Modal Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950/70 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-500/20 bg-sky-500/10 font-bold text-sky-600 dark:text-sky-400">
              <Sliders className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-base font-extrabold text-slate-900 dark:text-white">{currentMeta.name}</h3>
                <span className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  v{currentMeta.version}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">安装配置 · {currentMeta.category}</p>
            </div>
          </div>

          <button
            onClick={installStatus === 'done' ? handleFinishedClose : onClose}
            disabled={installStatus === 'installing'}
            aria-label="关闭配置"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 sm:space-y-5 sm:p-6">
          {loadingConfig ? (
            <div className="h-64 flex items-center justify-center space-x-2 text-slate-400 text-xs">
              <RefreshCw className="w-4 h-4 animate-spin text-sky-500" />
              <span>正在读取配置模板...</span>
            </div>
          ) : installStatus === 'idle' ? (
            <AppInstallForm
              meta={currentMeta}
              portsMap={portsMap}
              volumesMap={volumesMap}
              envMap={envMap}
              useYamlMode={useYamlMode}
              customYaml={customYaml}
              onPortsMapChange={setPortsMap}
              onVolumesMapChange={setVolumesMap}
              onEnvMapChange={setEnvMap}
              onYamlModeChange={setUseYamlMode}
              onCustomYamlChange={setCustomYaml}
            />
          ) : (
            <div className="space-y-4">
              {installStatus === 'done' && <AppInstallResult webAccessUrl={webAccessUrl} />}
              <AppInstallProgress status={installStatus} logs={installLogs} error={installError} logsEndRef={logsEndRef} />
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 dark:border-slate-800 dark:bg-slate-950/70 sm:justify-between sm:px-6 sm:py-4">
          <span className="hidden text-xs text-slate-500 sm:inline">
            {installStatus === 'idle'
              ? `预计 WebUI 端口: ${mainHostPort || '默认'}`
              : installStatus === 'installing'
              ? '部署中，正在下载镜像...'
              : '操作完成'}
          </span>

          <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:gap-3">
            {installStatus === 'idle' && (
              <>
                <button
                  onClick={onClose}
                  className="min-h-11 rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  取消
                </button>
                <button
                  onClick={startDeploy}
                  className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 px-4 py-2 text-xs font-bold text-white transition hover:from-sky-500 hover:to-indigo-500 sm:flex-none sm:px-5"
                >
                  <Download className="w-4 h-4" />
                  <span>确认安装</span>
                </button>
              </>
            )}

            {installStatus === 'installing' && (
              <button
                disabled
                className="px-5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 text-xs font-semibold cursor-not-allowed flex items-center space-x-2"
              >
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>正在安装部署中...</span>
              </button>
            )}

            {installStatus === 'done' && (
              <>
                <button
                  onClick={handleFinishedClose}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 text-xs font-semibold transition"
                >
                  关闭并刷新应用列表
                </button>
                <a
                  href={webAccessUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center space-x-1.5 px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-md shadow-emerald-500/25 transition"
                >
                  <span>打开应用</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </>
            )}

            {installStatus === 'error' && (
              <>
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 text-xs font-semibold transition"
                >
                  关闭
                </button>
                <button
                  onClick={startDeploy}
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
  );
};
