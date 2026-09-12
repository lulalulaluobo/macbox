import React from 'react';
import { FileCode, Folder, Globe, HardDrive } from 'lucide-react';
import type { AppMetadata } from '../../types';

interface AppInstallFormProps {
  meta: AppMetadata;
  portsMap: Record<string, number>;
  volumesMap: Record<string, string>;
  envMap: Record<string, string>;
  useYamlMode: boolean;
  customYaml: string;
  onPortsMapChange: (value: Record<string, number>) => void;
  onVolumesMapChange: (value: Record<string, string>) => void;
  onEnvMapChange: (value: Record<string, string>) => void;
  onYamlModeChange: (value: boolean) => void;
  onCustomYamlChange: (value: string) => void;
}

export const AppInstallForm: React.FC<AppInstallFormProps> = ({
  meta,
  portsMap,
  volumesMap,
  envMap,
  useYamlMode,
  customYaml,
  onPortsMapChange,
  onVolumesMapChange,
  onEnvMapChange,
  onYamlModeChange,
  onCustomYamlChange,
}) => (
  <div className="space-y-3 sm:space-y-5">
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 dark:border-slate-800/80 dark:bg-slate-950/50 dark:text-slate-300 sm:p-4">{meta.description}</div>

    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/40">
      <div className="flex min-w-0 items-center gap-2 text-slate-700 dark:text-slate-300"><FileCode className="h-4 w-4 text-indigo-500 dark:text-indigo-400" /><span className="font-semibold">YAML 高级模式</span></div>
      <button type="button" onClick={() => onYamlModeChange(!useYamlMode)} className={`shrink-0 rounded-xl px-3 py-2 text-xs font-semibold transition ${useYamlMode ? 'bg-indigo-600 text-white shadow-md' : 'border border-slate-200 bg-white text-slate-700 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-white'}`}>{useYamlMode ? '返回表单' : '打开编辑器'}</button>
    </div>

    {useYamlMode ? (
      <div className="space-y-2"><label className="text-xs font-semibold text-slate-300">docker-compose.yaml 源码微调</label><textarea value={customYaml} onChange={(event) => onCustomYamlChange(event.target.value)} spellCheck={false} className="h-[55dvh] w-full resize-none rounded-2xl border border-slate-800 bg-[#06090e] p-4 font-mono text-xs leading-relaxed text-emerald-400/90 focus:border-indigo-500 focus:outline-none sm:h-80" /></div>
    ) : (
      <div className="space-y-3 sm:space-y-5">
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60 sm:p-5">
          <div className="flex items-center justify-between"><div className="flex items-center space-x-2 text-xs font-bold text-slate-900 dark:text-white"><Globe className="h-4 w-4 text-sky-500 dark:text-sky-400" /><span>网络端口</span></div><span className="hidden text-[11px] text-slate-500 dark:text-slate-400 sm:inline">宿主机 ➔ 容器内部</span></div>
          <div className="space-y-2.5">
            {meta.ports && meta.ports.length > 0 ? meta.ports.map((port) => {
              const containerPort = port.containerPort.toString();
              const currentValue = portsMap[containerPort] ?? port.hostPort;
              return <div key={containerPort} className="flex flex-col justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-xs dark:border-slate-800/80 dark:bg-slate-900/80 sm:flex-row sm:items-center"><div><span className="font-semibold text-slate-800 dark:text-slate-200">{port.description || `端口 ${port.containerPort}`}</span><span className="block font-mono text-[11px] text-slate-500">容器端口: {port.containerPort}/{port.protocol}</span></div><div className="flex items-center space-x-2"><span className="text-xs text-slate-500 dark:text-slate-400">宿主机端口:</span><input type="number" min={1024} max={65535} value={currentValue} onChange={(event) => onPortsMapChange({ ...portsMap, [containerPort]: parseInt(event.target.value, 10) || port.hostPort })} className="w-24 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-center font-mono text-xs text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></div></div>;
            }) : meta.port > 0 ? (
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-xs dark:border-slate-800 dark:bg-slate-900/80"><span className="text-slate-800 dark:text-slate-200">WebUI 主服务访问端口:</span><input type="number" min={1024} max={65535} value={portsMap[meta.port.toString()] ?? meta.port} onChange={(event) => onPortsMapChange({ ...portsMap, [meta.port.toString()]: parseInt(event.target.value, 10) || meta.port })} className="w-24 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-center font-mono text-xs text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></div>
            ) : <p className="text-xs text-slate-500">该应用无外部公开端口映射</p>}
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60 sm:p-5">
          <div className="flex items-center justify-between"><div className="flex items-center space-x-2 text-xs font-bold text-slate-900 dark:text-white"><HardDrive className="h-4 w-4 text-indigo-500 dark:text-indigo-400" /><span>存储路径</span></div><span className="hidden text-[11px] text-slate-500 dark:text-slate-400 sm:inline">支持物理外接硬盘路径</span></div>
          <div className="space-y-3">
            {meta.volumes && meta.volumes.length > 0 ? meta.volumes.map((volume, index) => {
              const currentHost = volumesMap[volume.container] ?? volume.host;
              const supportsPreset = ['/media', '/music', '/downloads', '/data'].includes(volume.container);
              return <div key={index} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3.5 text-xs shadow-xs dark:border-slate-800/80 dark:bg-slate-900/80"><div className="flex items-center justify-between"><span className="font-semibold text-slate-800 dark:text-slate-200">{volume.description || `挂载点 ${index + 1}`}</span><span className="font-mono text-[11px] text-slate-500">容器内: {volume.container}</span></div><div className="flex items-center space-x-2"><input type="text" value={currentHost} onChange={(event) => onVolumesMapChange({ ...volumesMap, [volume.container]: event.target.value })} className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white" placeholder="/data/appdata/..." /></div>{supportsPreset && <div className="flex flex-wrap items-center gap-2 pt-1"><span className="text-[11px] text-slate-500">快捷预设:</span><button type="button" onClick={() => onVolumesMapChange({ ...volumesMap, [volume.container]: `/data/mnt/disk4${volume.container}` })} className="rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-mono text-[11px] text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-indigo-500/20">使用 2TB 硬盘</button><button type="button" onClick={() => onVolumesMapChange({ ...volumesMap, [volume.container]: volume.host })} className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600 transition hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700">恢复默认</button></div>}</div>;
            }) : <p className="text-xs text-slate-500">该应用无挂载持久卷</p>}
          </div>
        </div>

        {meta.env && meta.env.length > 0 && <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60 sm:p-5"><div className="flex items-center space-x-2 text-xs font-bold text-slate-900 dark:text-white"><Folder className="h-4 w-4 text-emerald-500 dark:text-emerald-400" /><span>环境变量</span></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{meta.env.map((entry) => <div key={entry.key} className="space-y-1.5 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-xs dark:border-slate-800/80 dark:bg-slate-900/80"><div className="flex items-center justify-between"><span className="font-mono font-bold text-slate-800 dark:text-slate-300">{entry.key}</span><span className="text-[10px] text-slate-500">{entry.description}</span></div><input type="text" value={envMap[entry.key] ?? entry.value} onChange={(event) => onEnvMapChange({ ...envMap, [entry.key]: event.target.value })} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></div>)}</div></div>}
      </div>
    )}
  </div>
);
