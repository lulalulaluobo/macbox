import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Download,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Folder,
  Sliders,
  FileCode,
  ExternalLink,
  HardDrive,
  Globe,
} from 'lucide-react';
import { AppMetadata, InstallCustomConfig } from '../../types';
import { api } from '../../api';

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

  // Deploy States
  const [installStatus, setInstallStatus] = useState<'idle' | 'installing' | 'done' | 'error'>('idle');
  const [installLogs, setInstallLogs] = useState<string[]>([]);
  const [installError, setInstallError] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!app) return;
    setInstallStatus('idle');
    setInstallLogs([]);
    setInstallError(null);
    setUseYamlMode(false);

    const load = async () => {
      setLoadingConfig(true);
      try {
        const fullMeta = await api.getAppConfig(app.id);
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
        setConfigData(app);
      } finally {
        setLoadingConfig(false);
      }
    };

    load();
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

  const handleStartDeploy = async () => {
    setInstallStatus('installing');
    setInstallLogs([`🚀 正在连接 MacNAS 应用引擎并提交定制参数...`]);

    const payload: InstallCustomConfig = {
      portsMap,
      volumesMap,
      envMap,
      customYaml: useYamlMode ? customYaml : undefined,
    };

    try {
      const response = await fetch(`/api/apps/${app.id}/install/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok || !response.body) {
        throw new Error(response.statusText || '请求失败');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamCompleted = false;
      let streamFailed = false;

      const processStreamLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        if (trimmed.startsWith('data:')) {
          const dataStr = trimmed.slice(5).trim();
          if (dataStr) {
            setInstallLogs(prev => [...prev, dataStr]);
          }
        } else if (trimmed === 'event: done') {
          streamCompleted = true;
          setInstallStatus('done');
        } else if (trimmed === 'event: error') {
          streamFailed = true;
          setInstallStatus('error');
          setInstallError('安装过程遇到错误，请查看控制台日志');
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          processStreamLine(line);
        }
      }

      buffer += decoder.decode();
      processStreamLine(buffer);

      if (!streamCompleted && !streamFailed) {
        setInstallStatus('done');
      }
    } catch (err: any) {
      setInstallError(err.message || '安装网络中断');
      setInstallStatus('error');
    }
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
            <div className="space-y-3 sm:space-y-5">
              {/* App Description Banner */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 dark:border-slate-800/80 dark:bg-slate-950/50 dark:text-slate-300 sm:p-4">
                {currentMeta.description}
              </div>

              {/* Toggle Advanced YAML Mode */}
              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/40">
                <div className="flex min-w-0 items-center gap-2 text-slate-700 dark:text-slate-300">
                  <FileCode className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                  <span className="font-semibold">YAML 高级模式</span>
                </div>
                <button
                  type="button"
                  onClick={() => setUseYamlMode(!useYamlMode)}
                  className={`shrink-0 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                    useYamlMode
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {useYamlMode ? '返回表单' : '打开编辑器'}
                </button>
              </div>

              {useYamlMode ? (
                /* Advanced Mode: Direct YAML Editor */
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300">
                    docker-compose.yaml 源码微调
                  </label>
                  <textarea
                    value={customYaml}
                    onChange={e => setCustomYaml(e.target.value)}
                    spellCheck={false}
                    className="h-[55dvh] w-full resize-none rounded-2xl border border-slate-800 bg-[#06090e] p-4 font-mono text-xs leading-relaxed text-emerald-400/90 focus:border-indigo-500 focus:outline-none sm:h-80"
                  />
                </div>
              ) : (
                /* Guided Form Mode */
                <div className="space-y-3 sm:space-y-5">
                  {/* 1. Ports Configuration */}
                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60 sm:p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2 text-xs font-bold text-slate-900 dark:text-white">
                        <Globe className="w-4 h-4 text-sky-500 dark:text-sky-400" />
                        <span>网络端口</span>
                      </div>
                      <span className="hidden text-[11px] text-slate-500 dark:text-slate-400 sm:inline">
                        宿主机 ➔ 容器内部
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {currentMeta.ports && currentMeta.ports.length > 0 ? (
                        currentMeta.ports.map(p => {
                          const cPortStr = p.containerPort.toString();
                          const currentVal = portsMap[cPortStr] ?? p.hostPort;
                          return (
                            <div
                              key={cPortStr}
                              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800/80 text-xs shadow-xs"
                            >
                              <div>
                                <span className="font-semibold text-slate-800 dark:text-slate-200">
                                  {p.description || `端口 ${p.containerPort}`}
                                </span>
                                <span className="text-[11px] text-slate-500 font-mono block">
                                  容器端口: {p.containerPort}/{p.protocol}
                                </span>
                              </div>

                              <div className="flex items-center space-x-2">
                                <span className="text-xs text-slate-500 dark:text-slate-400">宿主机端口:</span>
                                <input
                                  type="number"
                                  min={1024}
                                  max={65535}
                                  value={currentVal}
                                  onChange={e =>
                                    setPortsMap({
                                      ...portsMap,
                                      [cPortStr]: parseInt(e.target.value) || p.hostPort,
                                    })
                                  }
                                  className="w-24 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-mono text-center text-xs focus:outline-none focus:border-sky-500"
                                />
                              </div>
                            </div>
                          );
                        })
                      ) : currentMeta.port > 0 ? (
                        <div className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 text-xs shadow-xs">
                          <span className="text-slate-800 dark:text-slate-200">WebUI 主服务访问端口:</span>
                          <input
                            type="number"
                            min={1024}
                            max={65535}
                            value={portsMap[currentMeta.port.toString()] ?? currentMeta.port}
                            onChange={e =>
                              setPortsMap({
                                ...portsMap,
                                [currentMeta.port.toString()]:
                                  parseInt(e.target.value) || currentMeta.port,
                              })
                            }
                            className="w-24 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-mono text-center text-xs focus:outline-none focus:border-sky-500"
                          />
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">该应用无外部公开端口映射</p>
                      )}
                    </div>
                  </div>

                  {/* 2. Volumes / Storage Directory Configuration */}
                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60 sm:p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2 text-xs font-bold text-slate-900 dark:text-white">
                        <HardDrive className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                        <span>存储路径</span>
                      </div>
                      <span className="hidden text-[11px] text-slate-500 dark:text-slate-400 sm:inline">
                        支持物理外接硬盘路径
                      </span>
                    </div>

                    <div className="space-y-3">
                      {currentMeta.volumes && currentMeta.volumes.length > 0 ? (
                        currentMeta.volumes.map((v, idx) => {
                          const currentHost = volumesMap[v.container] ?? v.host;
                          return (
                            <div
                              key={idx}
                              className="p-3.5 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800/80 space-y-2 text-xs shadow-xs"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-slate-800 dark:text-slate-200">
                                  {v.description || `挂载点 ${idx + 1}`}
                                </span>
                                <span className="text-[11px] text-slate-500 font-mono">
                                  容器内: {v.container}
                                </span>
                              </div>

                              <div className="flex items-center space-x-2">
                                <input
                                  type="text"
                                  value={currentHost}
                                  onChange={e =>
                                    setVolumesMap({
                                      ...volumesMap,
                                      [v.container]: e.target.value,
                                    })
                                  }
                                  className="flex-1 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                                  placeholder="/data/appdata/..."
                                />
                              </div>

                              {/* Quick Presets for External Hard Drive */}
                              {(v.container === '/media' ||
                                v.container === '/music' ||
                                v.container === '/downloads' ||
                                v.container === '/data') && (
                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                  <span className="text-[11px] text-slate-500">快捷预设:</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setVolumesMap({
                                        ...volumesMap,
                                        [v.container]: `/data/mnt/disk4${v.container}`,
                                      })
                                    }
                                    className="text-[11px] px-2 py-0.5 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 dark:bg-indigo-500/10 dark:hover:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/20 transition font-mono"
                                  >
                                    使用 2TB 硬盘
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setVolumesMap({
                                        ...volumesMap,
                                        [v.container]: v.host,
                                      })
                                    }
                                    className="text-[11px] px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-400 transition font-mono border border-slate-200 dark:border-slate-700"
                                  >
                                    恢复默认
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <p className="text-xs text-slate-500">该应用无挂载持久卷</p>
                      )}
                    </div>
                  </div>

                  {/* 3. Environment Variables */}
                  {currentMeta.env && currentMeta.env.length > 0 && (
                    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60 sm:p-5">
                      <div className="flex items-center space-x-2 text-xs font-bold text-slate-900 dark:text-white">
                        <Folder className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                        <span>环境变量</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {currentMeta.env.map(e => {
                          const currentVal = envMap[e.key] ?? e.value;
                          return (
                            <div
                              key={e.key}
                              className="p-3 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800/80 space-y-1.5 text-xs shadow-xs"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-mono font-bold text-slate-800 dark:text-slate-300">{e.key}</span>
                                <span className="text-[10px] text-slate-500">{e.description}</span>
                              </div>
                              <input
                                type="text"
                                value={currentVal}
                                onChange={ev =>
                                  setEnvMap({
                                    ...envMap,
                                    [e.key]: ev.target.value,
                                  })
                                }
                                className="w-full px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Live Terminal Progress Mode */
            <div className="space-y-4">
              {installStatus === 'installing' && (
                <div className="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/30 text-sky-300 text-xs flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
                    <span className="font-semibold">
                      正在拉取 Docker 镜像并部署启动，请观察实时控制台...
                    </span>
                  </div>
                  <span className="font-mono text-[11px] opacity-75">SSE 实时流</span>
                </div>
              )}

              {installStatus === 'done' && (
                <div className="p-4 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs space-y-2 shadow-lg">
                  <div className="flex items-center space-x-2 font-bold text-sm">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    <span>应用已成功部署并上线！</span>
                  </div>
                  <p className="text-xs text-emerald-200/90">
                    Web 访问地址:{' '}
                    <a
                      href={webAccessUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-white underline font-bold ml-1"
                    >
                      {webAccessUrl}
                    </a>
                  </p>
                  <p className="text-[11px] text-emerald-200/75">
                    部署日志已保留。请先查看或复制初始化信息，确认完成后再手动关闭窗口。
                  </p>
                </div>
              )}

              {installStatus === 'error' && (
                <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs space-y-1">
                  <div className="flex items-center space-x-2 font-bold text-sm">
                    <AlertCircle className="w-5 h-5 text-rose-400" />
                    <span>部署遇到异常:</span>
                  </div>
                  <p className="font-mono">{installError}</p>
                </div>
              )}

              {/* Terminal View */}
              <div className="bg-[#070a10] rounded-2xl p-4 border border-slate-800 font-mono text-xs text-emerald-400/90 h-80 overflow-y-auto space-y-1 shadow-inner select-text leading-relaxed">
                {installLogs.map((line, idx) => (
                  <div key={idx} className="whitespace-pre-wrap break-all">
                    {line}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
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
                  onClick={handleStartDeploy}
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
                  onClick={handleStartDeploy}
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
