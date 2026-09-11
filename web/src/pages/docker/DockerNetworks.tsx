import React, { useState, useEffect } from 'react';
import { Network, Zap, Plus, Trash2, Check, RefreshCw, AlertCircle, Globe } from 'lucide-react';
import { DockerNetwork } from '../../types';
import { REGISTRY_PRESETS } from './types';
import { api } from '../../api';

export const DockerNetworks: React.FC = () => {
  const [networks, setNetworks] = useState<DockerNetwork[]>([]);
  const [mirrors, setMirrors] = useState<string[]>([]);
  const [newMirror, setNewMirror] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingMirrors, setSavingMirrors] = useState(false);
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [nets, mirs] = await Promise.all([
        api.getDockerNetworks().catch(() => []),
        api.getRegistryMirrors().catch(() => ({ mirrors: [] })),
      ]);
      setNetworks(nets || []);
      setMirrors(mirs.mirrors || []);
    } catch (err) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddPreset = (url: string) => {
    if (mirrors.includes(url)) return;
    setMirrors(prev => [...prev, url]);
  };

  const handleAddCustom = () => {
    const url = newMirror.trim();
    if (!url) return;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      setAlertMsg({ type: 'error', text: '镜像源地址必须以 http:// 或 https:// 开头' });
      return;
    }
    if (mirrors.includes(url)) {
      setAlertMsg({ type: 'error', text: '该镜像加速地址已存在' });
      return;
    }
    setMirrors(prev => [...prev, url]);
    setNewMirror('');
  };

  const handleRemoveMirror = (index: number) => {
    setMirrors(prev => prev.filter((_, i) => i !== index));
  };

  const handleSaveMirrors = async () => {
    setSavingMirrors(true);
    try {
      await api.setRegistryMirrors(mirrors);
      setAlertMsg({ type: 'success', text: 'Docker 镜像加速源已成功保存并重新加载守护进程！' });
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `保存失败: ${err.message}` });
    } finally {
      setSavingMirrors(false);
    }
  };

  return (
    <div className="h-full space-y-3 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
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

      {/* Section 1: Docker Registry Acceleration */}
      <details className="group rounded-[20px] border border-slate-200/90 bg-white shadow-xs dark:border-slate-800/90 dark:bg-slate-900/80">
        <summary className="flex cursor-pointer list-none items-center justify-between p-3.5 [&::-webkit-details-marker]:hidden">
          <div className="flex items-center space-x-3">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-2 text-amber-600 dark:text-amber-400">
              <Zap className="h-4 w-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">镜像加速设置</h3>
          </div>
          <span className="text-xs font-semibold text-sky-600 dark:text-sky-400">展开设置 ›</span>
        </summary>

        <div className="space-y-3 border-t border-slate-100 px-3.5 pb-3.5 pt-3 dark:border-slate-800">
          <div className="flex justify-end">
          <button
            onClick={handleSaveMirrors}
            disabled={savingMirrors}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-md shadow-amber-500/20 transition disabled:opacity-50"
          >
            {savingMirrors ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            <span>保存并生效</span>
          </button>
          </div>

        {/* Presets */}
        <div className="hidden">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">快速添加预设加速源:</span>
          <div className="flex flex-wrap gap-2">
            {REGISTRY_PRESETS.map(p => {
              const added = mirrors.includes(p.url);
              return (
                <button
                  key={p.url}
                  onClick={() => handleAddPreset(p.url)}
                  disabled={added}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition flex items-center space-x-1.5 ${
                    added
                      ? 'bg-slate-100 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700 shadow-xs'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{p.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Current Active Mirrors List */}
        <div className="space-y-2 pt-2">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">当前已生效加速列表:</span>
          {mirrors.length === 0 ? (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-xs text-slate-500">
              当前暂未配置第三方镜像加速源，Docker 将使用官方源拉取。
            </div>
          ) : (
            <div className="space-y-2">
              {mirrors.map((m, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 text-xs font-mono"
                >
                  <div className="flex items-center space-x-2 text-slate-800 dark:text-slate-200">
                    <Globe className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                    <span>{m}</span>
                  </div>
                  <button
                    onClick={() => handleRemoveMirror(idx)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:text-slate-500 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition"
                    title="移除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add custom mirror */}
          <div className="flex space-x-2 pt-1">
            <input
              type="text"
              placeholder="输入自定义加速源 URL，例如: https://dockerproxy.net"
              value={newMirror}
              onChange={e => setNewMirror(e.target.value)}
              className="flex-1 px-3.5 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-amber-500 transition"
            />
            <button
              onClick={handleAddCustom}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 text-xs font-semibold border border-slate-200 dark:border-slate-700 transition"
            >
              添加
            </button>
          </div>
        </div>
        </div>
      </details>

      {/* Section 2: Docker Networks List */}
      <div className="space-y-3 rounded-[20px] border border-slate-200/90 bg-white p-4 shadow-xs dark:border-slate-800/90 dark:bg-slate-900/80">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
              <Network className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Docker 虚拟网络</h3>
            </div>
          </div>

          <button
            onClick={loadData}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200/80 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 dark:border-slate-700 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4">网络名称</th>
                <th className="py-3 px-4">Network ID</th>
                <th className="py-3 px-4">驱动 (Driver)</th>
                <th className="py-3 px-4">范围 (Scope)</th>
                <th className="py-3 px-4">类型</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono">
              {networks.map(net => (
                <tr key={net.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition">
                  <td className="py-3 px-4 font-bold text-slate-900 dark:text-white font-mono">{net.name}</td>
                  <td className="py-3 px-4 text-slate-500 dark:text-slate-400">{net.id.slice(0, 12)}</td>
                  <td className="py-3 px-4 text-sky-600 dark:text-sky-400">{net.driver}</td>
                  <td className="py-3 px-4 text-slate-500 dark:text-slate-400">{net.scope}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        net.name.includes('default')
                          ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700/60'
                      }`}
                    >
                      {net.name.includes('default') ? 'Compose 子网' : '系统原生'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
