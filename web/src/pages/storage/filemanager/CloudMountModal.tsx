import React, { useEffect, useState } from 'react';
import { Check, Cloud, ExternalLink, LoaderCircle, QrCode, RefreshCw, X } from 'lucide-react';
import { api } from '../../../api';
import { CloudMount } from '../../../types';

interface CloudMountModalProps {
  onClose: () => void;
  onMounted: (mount: CloudMount) => void;
}

export const CloudMountModal: React.FC<CloudMountModalProps> = ({ onClose, onMounted }) => {
  const [loginId, setLoginId] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'pending' | 'connected' | 'expired' | 'error'>('idle');
  const [account, setAccount] = useState('');
  const [name, setName] = useState('夸克网盘');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const beginLogin = async () => {
    setStatus('loading');
    setMessage('');
    try {
      const result = await api.beginQuarkQRLogin();
      setLoginId(result.loginId);
      setStatus('pending');
    } catch (err: any) {
      setStatus('error');
      setMessage(err.message || "未能生成登录码，请重试");
    }
  };

  useEffect(() => {
    if (!loginId || status !== 'pending') return;
    const poll = async () => {
      try {
        const result = await api.pollQuarkQRLogin(loginId);
        if (result.status === 'connected') {
          setAccount(result.account || "网盘账号");
          setStatus('connected');
        } else if (result.status === 'expired') {
          setStatus('expired');
        } else if (result.message) {
          setMessage(result.message);
        }
      } catch (err: any) {
        setMessage(err.message || "未能确认登录状态，请重试");
      }
    };
    poll();
    const timer = window.setInterval(poll, 2200);
    return () => window.clearInterval(timer);
  }, [loginId, status]);

  const mount = async () => {
    setSaving(true);
    try {
      const result = await api.createQuarkMountFromQR(loginId, name.trim() || '夸克网盘');
      onMounted(result.mount);
    } catch (err: any) {
      setStatus('error');
      setMessage(err.message || "网盘未能连接，请重试");
    } finally {
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
    <section className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:p-7">
      <header className="flex items-start gap-3 border-b border-slate-100 pb-4 dark:border-slate-800"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-500 dark:bg-sky-500/10"><Cloud className="h-6 w-6" /></span><div className="min-w-0 flex-1"><h2 className="text-lg font-bold text-slate-900 dark:text-white">添加网盘</h2><p className="mt-1 text-xs text-slate-500">手机扫码即可连接网盘</p></div><button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800" aria-label="关闭"><X className="h-5 w-5" /></button></header>

      <div className="mt-5 rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60">
        {status === 'idle' || status === 'loading' || status === 'error' ? <div className="flex flex-col items-center py-5 text-center"><QrCode className="mb-3 h-12 w-12 text-sky-500" /><h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">扫码登录</h3><p className="mt-1 max-w-xs text-xs leading-5 text-slate-500">打开夸克App扫码并确认。<br />连接后网盘会显示在文件页。</p><button type="button" onClick={beginLogin} disabled={status === 'loading'} className="mt-4 flex min-h-10 items-center gap-2 rounded-xl bg-sky-500 px-4 text-xs font-semibold text-white disabled:opacity-60">{status === 'loading' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}扫码登录</button>{message && <p className="mt-3 text-xs text-rose-500">{message}</p>}</div> : status === 'pending' ? <div className="flex flex-col items-center text-center"><div className="rounded-2xl bg-white p-3 shadow-sm dark:bg-slate-900"><img src={api.getQuarkQRImageUrl(loginId)} alt="扫码登录" className="h-56 w-56" /></div><p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-100">请用夸克App扫码</p><p className="mt-1 text-xs text-slate-500">等待确认</p>{message && <p className="mt-2 max-w-xs text-[11px] text-amber-600">{message}</p>}<button type="button" onClick={beginLogin} className="mt-3 flex items-center gap-1 text-xs text-sky-600"><RefreshCw className="h-3.5 w-3.5" />重新生成</button></div> : status === 'expired' ? <div className="flex flex-col items-center py-7 text-center"><RefreshCw className="mb-3 h-10 w-10 text-amber-500" /><p className="text-sm font-semibold text-slate-800 dark:text-slate-100">已过期</p><button type="button" onClick={beginLogin} className="mt-4 rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold text-white">重新生成</button></div> : <div className="flex flex-col items-center py-4 text-center"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><Check className="h-6 w-6" /></span><p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-100">已授权</p><p className="mt-1 text-xs text-slate-500">{account}</p><label className="mt-5 w-full text-left text-xs font-medium text-slate-600 dark:text-slate-300">网盘名称<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-sky-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" /></label><button type="button" onClick={mount} disabled={saving} className="mt-4 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-sky-500 text-xs font-semibold text-white disabled:opacity-60">{saving && <LoaderCircle className="h-4 w-4 animate-spin" />}添加网盘</button></div>}
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-xl border border-slate-100 px-3 py-2.5 text-[11px] leading-5 text-slate-500 dark:border-slate-800"><ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /><span>请在夸克官方页面登录。<br />MacBox不保存手机号和登录密码。<br />也不保存短信验证码。<br />当前使用手机扫码确认授权。</span></div>
    </section>
  </div>;
};
