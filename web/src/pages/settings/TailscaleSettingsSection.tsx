import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Globe, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../../api';
import type { RemoteAction, TailscaleStatus } from '../../types/remote';

const panel = 'rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900';
const button = 'min-h-10 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50';
const primary = `${button} bg-sky-500 text-white border-transparent dark:border-transparent`;
const labels: Record<TailscaleStatus['state'], string> = {
  notInstalled: '尚未开启', vmStopped: '系统未开', needsLogin: '等待登录', needsApproval: '等待批准',
  connecting: '连接中', connected: '已连接', paused: '已暂停', expired: '登录过期', unavailable: '暂未就绪',
};

interface Entry { name: string; url: string }

function guestURL(raw: string, guestIP: string, remoteIP: string, docker = false): string | null {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (!docker && url.hostname !== guestIP && url.hostname !== remoteIP) return null;
    url.hostname = remoteIP;
    return url.toString();
  } catch { return null; }
}

export function TailscaleSettingsSection() {
  const [status, setStatus] = useState<TailscaleStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [jobMessage, setJobMessage] = useState('');
  const [error, setError] = useState('');
  const [entriesError, setEntriesError] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [copied, setCopied] = useState('');
  const [port, setPort] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const mounted = useRef(false);
  const polling = useRef(false);
  const jobID = useRef('');
  const actionRef = useRef('');

  const refresh = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      if (jobID.current) {
        const job = await api.getJob(jobID.current);
        if (!mounted.current) return;
        setJobMessage(job.message || '处理中');
        if (job.status !== 'running') {
          jobID.current = ''; setJobMessage('');
          if (job.status !== 'succeeded') setError(job.error || '操作未完成，请重试');
        }
      }
      const next = await api.getTailscale();
      if (mounted.current) setStatus(next);
    } catch (e) {
      if (mounted.current) setError(actionRef.current === 'pause' || actionRef.current === 'logout'
        ? '连接已断开，请从本机打开后台' : (e as Error).message);
    } finally { polling.current = false; }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    // Recover a running install after navigating away or refreshing the page.
    void api.getJobs().then(({ jobs }) => {
      const job = jobs.find(j => j.kind.startsWith('remote.') && j.status === 'running');
      if (mounted.current && job) { jobID.current = job.id; setJobMessage(job.message || '处理中'); }
    }).catch(() => {});
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 5000);
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { mounted.current = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    if (status?.state !== 'connected' || !status.ip) { setEntries([]); return; }
    const remoteIP = status.ip;
    void Promise.all([api.getApps(), api.getServiceShortcuts(), api.getVMNetwork()]).then(([apps, shortcuts, network]) => {
      if (cancelled) return;
      const found: Entry[] = [];
      for (const app of apps.filter(a => a.installed && a.status === 'running')) {
        const url = guestURL(app.webUrl, network.ip, remoteIP);
        if (url) found.push({ name: app.name, url });
      }
      for (const shortcut of shortcuts.shortcuts.filter(s => s.enabled)) {
        const url = guestURL(shortcut.url, network.ip, remoteIP, shortcut.source === 'docker');
        if (url && !found.some(e => e.url === url)) found.push({ name: shortcut.name, url });
      }
      setEntries(found); setEntriesError('');
    }).catch(() => { if (!cancelled) setEntriesError('应用入口未能读取，请刷新重试'); });
    return () => { cancelled = true; };
  }, [status?.state, status?.ip, refreshKey]);

  async function run(action: RemoteAction | 'start') {
    if (pending || jobID.current || status?.busy) return;
    if (action === 'pause' && !window.confirm('暂停远程访问？\n远程连接会断开，登录仍保留。\n恢复时请从本机或局域网打开后台。')) return;
    if (action === 'logout' && !window.confirm('退出设备登录？\n远程连接会断开，下次需重新授权。\n应用和数据会保留。')) return;
    setPending(true); setError(''); actionRef.current = action;
    try {
      const result = action === 'start' ? await api.startVM() : await api.setTailscale(action);
      if (mounted.current) { jobID.current = result.jobId; setJobMessage(action === 'install' ? '正在安装官方客户端' : '处理中'); }
      await refresh();
    } catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { if (mounted.current) setPending(false); }
  }

  async function copy(value: string) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value);
      else {
        const field = document.createElement('textarea'); field.value = value;
        field.style.position = 'fixed'; field.style.opacity = '0'; document.body.appendChild(field); field.select();
        const success = document.execCommand('copy'); field.remove(); if (!success) throw new Error('copy');
      }
      setCopied(value); window.setTimeout(() => { if (mounted.current) setCopied(''); }, 2000);
    } catch { setError('复制失败，请选中地址手动复制'); }
  }

  const busy = pending || !!jobMessage || !!status?.busy;
  const online = status?.state === 'connected';
  const serviceURL = online && status.ip && /^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535
    ? `http://${status.ip}:${Number(port)}` : '';
  function addressRow(name: string, url: string) {
    return <div key={url} className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-800">
      <div className="min-w-0 flex-1"><p className="text-sm font-medium">{name}</p><p className="mt-1 break-all font-mono text-xs text-slate-500 select-all">{url}</p></div>
      <button className={button} onClick={() => void copy(url)} aria-label={`复制${name}地址`}>{copied === url ? <Check className="h-4 w-4"/> : <Copy className="h-4 w-4"/>}复制</button>
      <a className={button} href={url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4"/>打开</a>
    </div>;
  }
  return <div className="space-y-4">
    <section className={`${panel} space-y-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3"><Globe className="h-5 w-5 text-sky-500"/><div><h3 className="font-semibold">远程访问</h3><p className="mt-1 text-xs text-slate-500">通过 Tailscale 在外面访问</p></div></div>
        <span className={`rounded-full px-3 py-1 text-xs ${online ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>{status ? labels[status.state] || '暂未就绪' : '检测中'}</span>
      </div>
      <p role="status" className="text-sm text-slate-600 dark:text-slate-300">{status?.message || '正在读取连接状态'}</p>
      <ol className="grid gap-3 sm:grid-cols-3 text-xs text-slate-500"><li>1. 开启远程访问</li><li>2. 登录账号并授权</li><li>3. 用获准的设备访问</li></ol>
      {(status?.deviceName || status?.ip) && <dl className="grid gap-4 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-slate-500">设备名称</dt><dd className="mt-1 break-all">{status.deviceName || 'MacBox'}</dd></div>
        <div><dt className="text-xs text-slate-500">所属网络</dt><dd className="mt-1 break-all">{status.networkName || '等待登录'}</dd></div>
        <div><dt className="text-xs text-slate-500">远程地址</dt><dd className="mt-1 flex items-center gap-2 font-mono">{status.ip || '等待地址'}{status.ip && <button onClick={() => void copy(status.ip!)} aria-label="复制远程地址">{copied === status.ip ? <Check className="h-4 w-4"/> : <Copy className="h-4 w-4"/>}</button>}</dd></div>
      </dl>}
      <div className="flex flex-wrap gap-3">
        {status?.state === 'vmStopped' && <button disabled={busy} className={primary} onClick={() => void run('start')}>启动系统</button>}
        {status?.state === 'notInstalled' && <button disabled={busy} className={primary} onClick={() => void run('install')}>开启访问</button>}
        {status?.authURL && <a className={primary} href={status.authURL} target="_blank" rel="noopener noreferrer">登录账号<ExternalLink className="h-4 w-4"/></a>}
        {status?.installed && !online && status.state !== 'needsApproval' && !status.authURL && <button disabled={busy} className={primary} onClick={() => void run('connect')}>{status.state === 'paused' ? '恢复访问' : '登录账号'}</button>}
        {status?.state === 'needsApproval' && <a className={primary} href="https://login.tailscale.com/admin/machines" target="_blank" rel="noopener noreferrer">批准设备<ExternalLink className="h-4 w-4"/></a>}
        {online && <button disabled={busy} className={button} onClick={() => void run('pause')}>暂停访问</button>}
        {status?.installed && status.state !== 'needsLogin' && <button disabled={busy} className={`${button} text-rose-500`} onClick={() => void run('logout')}>退出登录</button>}
        <button disabled={pending} className={button} onClick={() => { setError(''); setRefreshKey(k => k + 1); void refresh(); }}><RefreshCw className="h-4 w-4"/>刷新状态</button>
      </div>
      {busy && <p role="status" className="flex items-center gap-2 text-sm text-sky-500"><Loader2 className="h-4 w-4 animate-spin"/>{jobMessage || '处理中'}</p>}
      {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
      {status?.health?.map(message => <p key={message} className="text-sm text-amber-600">{message}</p>)}
    </section>
    {online && <section className={`${panel} space-y-4`}><h3 className="font-semibold">访问入口</h3>
      <p className="text-xs text-slate-500">访问设备需连接同一网络</p>
      {status.consoleReady && status.consoleURL ? addressRow('MacBox 后台', status.consoleURL) : <p role="status" className="text-sm text-amber-600">后台入口准备中，请稍后刷新</p>}
      {entries.map(entry => addressRow(entry.name, entry.url))}
      {entriesError && <p role="alert" className="text-sm text-rose-500">{entriesError}</p>}
      {!entries.length && !entriesError && <p className="text-xs text-slate-500">安装并启动应用后会显示入口</p>}
      <div className="border-t border-slate-100 pt-4 dark:border-slate-800"><label htmlFor="remote-service-port" className="text-sm font-medium">其他服务</label><p className="mt-1 text-xs text-slate-500">填写服务端口，生成访问地址</p><input id="remote-service-port" inputMode="numeric" placeholder="例如 3000" value={port} onChange={e => setPort(e.target.value)} className="mt-3 w-full max-w-xs rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-slate-700"/>{serviceURL && <div className="mt-3">{addressRow('服务入口', serviceURL)}</div>}</div>
    </section>}
    <section className={`${panel} space-y-3`}><h3 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-emerald-500"/>使用提示</h3>
      <p className="text-xs leading-6 text-slate-500">仅获准的设备可以访问。<br/>请在官方页面完成账号登录。<br/>MacBox 不收集你的账号密码。<br/>后台仍需使用 MacBox 账号登录。<br/>应用和数据会在升级后保留。<br/>Mac 和运行系统需保持开启。<br/>命令安装的服务需允许其他设备连接。</p>
      <a href="https://tailscale.com/download" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-500">下载客户端<ExternalLink className="h-3 w-3"/></a>
    </section>
  </div>;
}
