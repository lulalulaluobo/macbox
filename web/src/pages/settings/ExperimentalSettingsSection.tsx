import React, { useCallback, useEffect, useState } from 'react';
import { FlaskConical, RefreshCw, ShieldAlert, TerminalSquare } from 'lucide-react';
import { api } from '../../api';
import type { AppleComposeBridge, DockerEngineInfo } from '../../types';

interface ExperimentalSettingsSectionProps {
  onAlert: (alert: { type: 'success' | 'error'; text: string }) => void;
}

export const ExperimentalSettingsSection: React.FC<ExperimentalSettingsSectionProps> = ({ onAlert }) => {
  const [bridge, setBridge] = useState<AppleComposeBridge | null>(null);
  const [engine, setEngine] = useState<DockerEngineInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, e] = await Promise.all([
        api.getAppleComposeBridge().catch(() => null),
        api.getDockerEngine().catch(() => null),
      ]);
      setBridge(b);
      setEngine(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async () => {
    if (!bridge) return;
    setSaving(true);
    try {
      const next = await api.setAppleComposeBridge(!bridge.enabled);
      setBridge(next);
      onAlert({
        type: 'success',
        text: next.enabled
          ? next.mockerInstalled
            ? 'mocker Compose 兼容层已开启'
            : '兼容层已开启，但未检测到 mocker，请先在终端安装：brew tap us/tap && brew install mocker'
          : 'mocker Compose 兼容层已关闭',
      });
    } catch (error: any) {
      onAlert({ type: 'error', text: `保存实验性功能失败：${error.message}` });
    } finally {
      setSaving(false);
    }
  };

  const appleActive = engine?.source === 'apple';
  const mockerMissing = bridge !== null && !bridge.mockerInstalled;

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl border border-rose-200 bg-white/90 shadow-[0_18px_48px_-32px_rgba(244,63,94,0.4)] dark:border-rose-900/60 dark:bg-slate-900/85">
        <div className="border-b border-rose-100 bg-[linear-gradient(120deg,#fff1f2_0%,#ffffff_62%,#fff7ed_100%)] px-5 py-5 dark:border-rose-900/50 dark:bg-[linear-gradient(120deg,#3f1d2b_0%,#111827_62%,#2a1a10_100%)] sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-rose-200 bg-rose-100 text-rose-600 dark:border-rose-800 dark:bg-rose-500/15 dark:text-rose-300"><FlaskConical className="h-5 w-5" /></div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Apple container Compose 兼容层（mocker）</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                默认关闭。开启后在 Apple container 引擎下通过第三方 mocker CLI 提供 docker compose 能力（应用商店部署、Compose 项目页）。
              </p>
            </div>
          </div>
        </div>
        <div className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3.5 dark:border-slate-800 dark:bg-slate-950/35">
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-800 dark:text-slate-100">
                {loading ? '读取状态中…' : bridge?.enabled ? '已开启' : '未开启'}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                <span>mocker CLI：{bridge?.mockerInstalled ? bridge.mockerPath || '已安装' : '未检测到'}</span>
                <span>当前引擎：{engine ? (engine.source === 'none' ? '无可用 Docker 引擎' : engine.source === 'apple' ? 'Apple container' : engine.source === 'host' ? `宿主引擎 · ${engine.engine?.name || ''}` : 'Lima 虚拟机') : '未知'}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void load()} disabled={loading || saving} className="inline-flex min-h-10 items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />刷新
              </button>
              <button type="button" onClick={() => void toggle()} disabled={loading || saving || !bridge} className={`inline-flex min-h-10 items-center rounded-2xl px-5 text-sm font-bold text-white shadow-sm transition disabled:cursor-wait disabled:opacity-50 ${bridge?.enabled ? 'bg-slate-500 hover:bg-slate-600 shadow-slate-500/20' : 'bg-rose-500 hover:bg-rose-600 shadow-rose-500/20'}`}>
                {saving ? '保存中…' : bridge?.enabled ? '关闭兼容层' : '开启兼容层'}
              </button>
            </div>
          </div>

          {mockerMissing && (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-200">
              <TerminalSquare className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                未检测到 mocker。请在 Mac 终端执行 <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono dark:bg-amber-900/40">brew tap us/tap &amp;&amp; brew install mocker</code> 后点击上方「刷新」。
              </span>
            </div>
          )}
          {!mockerMissing && bridge?.enabled && !appleActive && (
            <div className="flex items-start gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-3.5 py-3 text-xs leading-5 text-sky-800 dark:border-sky-900/70 dark:bg-sky-950/25 dark:text-sky-200">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>当前存在可用的 Docker 引擎，Compose 仍走 Docker 原路径；该兼容层只在切换到 Apple container 引擎时生效。</span>
            </div>
          )}

          <ul className="space-y-1.5 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3.5 text-[11px] leading-5 text-slate-500 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-400">
            <li>· 仅在容器引擎为 Apple container（无宿主 / 虚拟机 Docker 引擎时自动回退）时生效。</li>
            <li>· mocker 是社区第三方 CLI（github.com/us/mocker），MacBox 仅调用其命令行；升级 mocker 可能影响兼容性。</li>
            <li>· Compose 项目数据存放于 ~/MacBox/data，与 Docker / 虚拟机模式的数据相互隔离。</li>
            <li>· mocker 的 compose ls 不支持 JSON，项目运行状态由容器状态推断，可能有偏差。</li>
            <li>· 挂载 /var/run/docker.sock 的模板（如 Dockge、Portainer）在 mocker 下不可用；应用商店模板未逐一验证。</li>
          </ul>
        </div>
      </section>
    </div>
  );
};
