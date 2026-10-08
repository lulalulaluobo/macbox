import { useEffect, useState } from 'react';
import { ArrowDownToLine, History, RefreshCw } from 'lucide-react';
import { api } from '../../api';
import type { ReleaseInfo, UpdateState, VersionInfo } from '../../types/update';

export function VersionManagementSection({ isAdmin }: { isAdmin: boolean }) {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [history, setHistory] = useState<UpdateState[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<'upgrade' | 'rollback' | null>(null);
  async function load() { try { setInfo(await api.getVersion()); if (isAdmin) setHistory((await api.getUpdateHistory()).history); } catch (e) { setError((e as Error).message); } }
  useEffect(() => { void load(); const timer = window.setInterval(load, 5000); return () => window.clearInterval(timer); }, [isAdmin]);
  const active = history.find(item => item.status === 'running');
  const rollback = history.find(item => item.status === 'succeeded' && item.canRollback);
  async function check() { setBusy(true); setError(''); try { setRelease(await api.checkUpdate()); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function run() { setBusy(true); setError(''); try { if (confirm === 'rollback') await api.rollbackUpdate(); else await api.startUpdate(); setConfirm(null); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">版本更新</h3><p className="mt-1 text-xs text-slate-500">显示当前正在使用的版本</p></div><span className="font-mono text-xl">{info?.version || '加载中'}</span></div>
    <p className="text-xs text-slate-500">{info?.arch} 构建编号 {info?.commit?.slice(0, 8)} {info?.builtAt && `· ${new Date(info.builtAt).toLocaleString()}`}</p>
    <div className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600 dark:bg-slate-800 dark:text-slate-300">只更新MacBox本身。<br />保留账号、设置、应用和文件。<br />下载后会检查更新包是否完整。<br />升级前会保存当前设置。<br />后台会短暂重启。<br />启动失败时自动恢复旧程序。<br />完成后请重新登录。</div>
    {info && !info.managed && <p className="text-sm text-amber-500">{info.message}</p>}
    {isAdmin && <div className="flex flex-wrap gap-3"><button disabled={busy || !!active} onClick={check} className="inline-flex items-center gap-2 border border-slate-200 dark:border-slate-700 px-4 py-2 rounded-xl text-sm disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`}/>检查更新</button>{release?.available && <button disabled={busy || !!active || !info?.managed} onClick={() => setConfirm('upgrade')} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-500 text-white text-sm disabled:opacity-50"><ArrowDownToLine className="h-4 w-4"/>立即升级 {release.version}</button>}{rollback && <button disabled={busy || !!active || !info?.managed} onClick={() => setConfirm('rollback')} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm disabled:opacity-50"><History className="h-4 w-4"/>恢复版本 {rollback.previousVersion}</button>}</div>}
    {release && <div className="space-y-2 text-sm"><p>{release.available ? `发现新版本：${release.version}` : release.version === info?.version ? "当前已是最新稳定版" : `官方稳定版${release.version}，当前无需升级`}</p><a href={release.url} target="_blank" rel="noreferrer" className="text-sky-500 underline">更新说明</a>{release.notes && <pre className="whitespace-pre-wrap font-sans text-xs leading-6 max-h-60 overflow-auto text-slate-500">{release.notes}</pre>}</div>}
    {active && <p role="status" className="text-sm text-sky-500">{active.message}后台重启时页面会暂时断开。<br />请稍后重新登录查看结果。</p>}
    {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
    {!!history.length && <div><h4 className="text-sm font-semibold mb-3">更新记录</h4><ul className="space-y-3">{history.map(item => <li key={item.id} className="border-t border-slate-100 dark:border-slate-800 pt-3 text-xs"><div className="flex justify-between gap-3"><span>{item.previousVersion} → {item.version}</span><time>{new Date(item.updatedAt).toLocaleString()}</time></div><p className="mt-1 text-slate-500">{item.message}</p>{item.error && <p className="mt-1 text-rose-500 break-words">{item.error}</p>}</li>)}</ul></div>}
    {confirm && <div role="dialog" aria-modal="true" aria-label="切换版本" className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"><div className="max-w-md rounded-2xl bg-white dark:bg-slate-900 p-6 space-y-4"><h4 className="font-semibold">{confirm === 'rollback' ? "恢复旧版" : "在线升级"}</h4><p className="text-sm leading-6 text-slate-500">{confirm === 'rollback' ? "恢复旧程序和升级前的设置。\n升级后修改的设置会被覆盖。\n保留系统磁盘、应用数据和文件。" : "后台将短暂重启。\n现有设置和数据会保留。\n完成后请重新登录。"}</p><div className="flex justify-end gap-3"><button disabled={busy} onClick={() => setConfirm(null)} className="px-4 py-2 text-sm">取消</button><button disabled={busy} onClick={run} className="rounded-xl bg-sky-500 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? "准备中" : confirm === 'rollback' ? '恢复旧版' : '开始升级'}</button></div></div></div>}
  </section>;
}
