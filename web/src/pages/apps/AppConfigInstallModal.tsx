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

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim();
            if (dataStr) {
              setInstallLogs(prev => [...prev, dataStr]);
            }
          } else if (trimmed.startsWith('event: done')) {
            setInstallStatus('done');
            onSuccess();
          } else if (trimmed.startsWith('event: error')) {
            setInstallStatus('error');
            setInstallError('安装过程遇到错误，请查看控制台日志');
          }
        }
      }

      if (installStatus === 'installing') {
        setInstallStatus('done');
        onSuccess();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl h-[88vh] flex flex-col rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-950/70 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3.5">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/10 text-sky-400 border border-sky-500/20 flex items-center justify-center font-bold">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-extrabold text-base text-white">{currentMeta.name}</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                  v{currentMeta.version}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  {currentMeta.category}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                部署前环境与存储路径自定义配置向导
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={installStatus === 'installing'}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 p-6 overflow-y-auto space-y-5">
          {loadingConfig ? (
            <div className="h-64 flex items-center justify-center space-x-2 text-slate-400 text-xs">
              <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
              <span>正在读取应用环境配置模板...</span>
            </div>
          ) : installStatus === 'idle' ? (
            <div className="space-y-5">
              {/* App Description Banner */}
              <div className="p-4 rounded-2xl bg-slate-950/50 border border-slate-800/80 text-xs text-slate-300 leading-relaxed">
                {currentMeta.description}
              </div>

              {/* Toggle Advanced YAML Mode */}
              <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-800/40 border border-slate-800 text-xs">
                <div className="flex items-center space-x-2 text-slate-300">
                  <FileCode className="w-4 h-4 text-indigo-400" />
                  <span>高级模式：直接编辑 Docker Compose YAML 源码</span>
                </div>
                <button
                  type="button"
                  onClick={() => setUseYamlMode(!useYamlMode)}
                  className={`px-3 py-1 rounded-xl text-xs font-semibold transition ${
                    useYamlMode
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
                  }`}
                >
                  {useYamlMode ? '已开启 YAML 模式' : '切换为 YAML 模式'}
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
                    className="w-full h-80 p-4 font-mono text-xs text-emerald-400/90 bg-[#06090e] border border-slate-800 rounded-2xl resize-none focus:outline-none focus:border-indigo-500 leading-relaxed"
                  />
                </div>
              ) : (
                /* Guided Form Mode */
                <div className="space-y-5">
                  {/* 1. Ports Configuration */}
                  <div className="p-5 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2 text-xs font-bold text-white">
                        <Globe className="w-4 h-4 text-sky-400" />
                        <span>网络端口映射设置 (Port Bindings)</span>
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono">
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
                              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-slate-900/80 border border-slate-800/80 text-xs"
                            >
                              <div>
                                <span className="font-semibold text-slate-200">
                                  {p.description || `端口 ${p.containerPort}`}
                                </span>
                                <span className="text-[11px] text-slate-500 font-mono block">
                                  容器端口: {p.containerPort}/{p.protocol}
                                </span>
                              </div>

                              <div className="flex items-center space-x-2">
                                <span className="text-xs text-slate-400">宿主机端口:</span>
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
                                  className="w-24 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono text-center text-xs focus:outline-none focus:border-sky-500"
                                />
                              </div>
                            </div>
                          );
                        })
                      ) : currentMeta.port > 0 ? (
                        <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs">
                          <span className="text-slate-200">WebUI 主服务访问端口:</span>
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
                            className="w-24 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono text-center text-xs focus:outline-none focus:border-sky-500"
                          />
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">该应用无外部公开端口映射</p>
                      )}
                    </div>
                  </div>

                  {/* 2. Volumes / Storage Directory Configuration */}
                  <div className="p-5 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2 text-xs font-bold text-white">
                        <HardDrive className="w-4 h-4 text-indigo-400" />
                        <span>数据存储挂载路径 (Volumes & Mount Paths)</span>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        支持指定外部物理挂载硬盘路径
                      </span>
                    </div>

                    <div className="space-y-3">
                      {currentMeta.volumes && currentMeta.volumes.length > 0 ? (
                        currentMeta.volumes.map((v, idx) => {
                          const currentHost = volumesMap[v.container] ?? v.host;
                          return (
                            <div
                              key={idx}
                              className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800/80 space-y-2 text-xs"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-slate-200">
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
                                  className="flex-1 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                                  placeholder="/data/appdata/..."
                                />
                              </div>

                              {/* Quick Presets for External Hard Drive */}
                              {(v.container === '/media' ||
                                v.container === '/music' ||
                                v.container === '/downloads' ||
                                v.container === '/data') && (
                                <div className="flex items-center space-x-2 pt-1">
                                  <span className="text-[11px] text-slate-500">快捷预设:</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setVolumesMap({
                                        ...volumesMap,
                                        [v.container]: `/data/mnt/disk4${v.container}`,
                                      })
                                    }
                                    className="text-[11px] px-2 py-0.5 rounded bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 transition font-mono"
                                  >
                                    映射至 2TB 物理硬盘 (/data/mnt/disk4{v.container})
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setVolumesMap({
                                        ...volumesMap,
                                        [v.container]: v.host,
                                      })
                                    }
                                    className="text-[11px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 transition font-mono"
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
                    <div className="p-5 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3">
                      <div className="flex items-center space-x-2 text-xs font-bold text-white">
                        <Folder className="w-4 h-4 text-emerald-400" />
                        <span>关键环境变量参数 (Environment)</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {currentMeta.env.map(e => {
                          const currentVal = envMap[e.key] ?? e.value;
                          return (
                            <div
                              key={e.key}
                              className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80 space-y-1.5 text-xs"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-mono font-bold text-slate-300">{e.key}</span>
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
                                className="w-full px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
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
        <div className="px-6 py-4 bg-slate-950/70 border-t border-slate-800 flex items-center justify-between">
          <span className="text-xs text-slate-500 font-mono">
            {installStatus === 'idle'
              ? `预计 WebUI 端口: ${mainHostPort || '默认'}`
              : installStatus === 'installing'
              ? '部署中，正在下载镜像...'
              : '操作完成'}
          </span>

          <div className="flex items-center space-x-3">
            {installStatus === 'idle' && (
              <>
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                >
                  取消
                </button>
                <button
                  onClick={handleStartDeploy}
                  className="flex items-center space-x-2 px-5 py-2 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-sky-500/20 transition"
                >
                  <Download className="w-4 h-4" />
                  <span>立即定制安装应用</span>
                </button>
              </>
            )}

            {installStatus === 'installing' && (
              <button
                disabled
                className="px-5 py-2 rounded-xl bg-slate-800 text-slate-400 text-xs font-semibold cursor-not-allowed flex items-center space-x-2"
              >
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>正在安装部署中...</span>
              </button>
            )}

            {installStatus === 'done' && (
              <>
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                >
                  关闭
                </button>
                <a
                  href={webAccessUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center space-x-1.5 px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/25 transition"
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
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
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
