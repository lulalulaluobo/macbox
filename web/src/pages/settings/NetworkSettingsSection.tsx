import { useEffect, useState } from 'react';
import { Check, Copy, Network, RefreshCw } from 'lucide-react';
import { api } from '../../api';
import type { NetworkStatus } from '../../types/update';

export function NetworkSettingsSection({ isAdmin, onRefresh }: { isAdmin: boolean; onRefresh?: () => void }) {
  const [network, setNetwork] = useState<NetworkStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  async function load() { try { setNetwork(await api.getVMNetwork()); } catch (e) { setError((e as Error).message); } }
  useEffect(() => { void load(); const timer = window.setInterval(load, 5000); return () => window.clearInterval(timer); }, []);
  async function setup() {
    setBusy(true); setError(''); setMessage("请在Mac上完成管理员授权。\n运行系统将重启一次。");
    try {
      const { jobId } = await api.setupVMNetwork();
      for (;;) {
        await new Promise(resolve => window.setTimeout(resolve, 2000));
        const job = await api.getJob(jobId); setMessage(job.message || "连接中");
        if (job.status === 'failed' || job.status === 'cancelled') throw new Error(job.error || "连接未完成");
        if (job.status === 'succeeded') break;
      }
      await load(); onRefresh?.(); setMessage("已连接");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-5">
    <div className="flex items-center gap-3"><Network className="h-5 w-5 text-sky-500"/><div><h3 className="font-semibold">网络连接</h3><p className="text-xs text-slate-500 mt-1">接入Mac所在网络，设备可直接访问</p></div></div>
    <dl className="grid gap-4 sm:grid-cols-3 text-sm"><div><dt className="text-slate-500 text-xs">连接方式</dt><dd className="mt-1">自动连接</dd></div><div><dt className="text-slate-500 text-xs">本机网卡</dt><dd className="mt-1 font-mono">{network?.interface || "待检测"}</dd></div><div><dt className="text-slate-500 text-xs">系统地址</dt><dd className="mt-1 flex items-center gap-2 font-mono">{network?.ip || "等待地址"}{network?.ip && <button aria-label="复制地址" onClick={async () => { try { await navigator.clipboard.writeText(network.ip); setCopied(true); } catch { setError("复制失败，请手动复制地址"); } }}>{copied ? <Check className="h-4 w-4"/> : <Copy className="h-4 w-4"/>}</button>}</dd></div></dl>
    <p role="status" className="text-sm text-slate-500">{network?.message || "检测中"}</p>
    <div className="rounded-xl bg-slate-50 p-4 text-xs leading-6 text-slate-600 dark:bg-slate-800 dark:text-slate-300">用命令安装的服务，需监听：<br /><code>0.0.0.0</code><br />访问时填写：<br /><code>http://系统地址:服务端口</code><br />应用使用运行系统对外开放的端口。<br />文件共享使用445端口。<br />路由器需允许设备互相访问。</div>
    {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}{message && <p role="status" className="whitespace-pre-line text-sm text-sky-500">{message}</p>}
    <div className="flex gap-3"><button onClick={load} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm inline-flex items-center gap-2"><RefreshCw className="h-4 w-4"/>刷新地址</button>{isAdmin && !network?.ready && <button disabled={busy} onClick={setup} className="px-4 py-2 rounded-xl bg-sky-500 text-white text-sm disabled:opacity-50">{busy ? "配置中" : "自动连接"}</button>}</div>
  </section>;
}
