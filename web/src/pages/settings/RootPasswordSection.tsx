import React from 'react';
import { Check, Crown, Eye, EyeOff, RefreshCw } from 'lucide-react';

interface RootPasswordSectionProps {
  password: string;
  confirmPassword: string;
  saving: boolean;
  visible: boolean;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onToggleVisibility: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

export const RootPasswordSection: React.FC<RootPasswordSectionProps> = ({
  password,
  confirmPassword,
  saving,
  visible,
  onPasswordChange,
  onConfirmPasswordChange,
  onToggleVisibility,
  onSubmit,
}) => (
  <div className="max-w-2xl space-y-6 rounded-3xl border border-slate-800/80 bg-slate-900/70 p-6 shadow-xl">
    <div className="flex items-start space-x-3.5">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/15 text-amber-300"><Crown className="h-6 w-6" /></div>
      <div>
        <h3 className="text-lg font-bold text-white">管理密码</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">修改系统最高权限账号的密码 <code>su -</code> 可在命令窗口中切换账号。<br />远程登录不使用此密码。<br />远程登录请使用密钥。</p>
      </div>
    </div>

    <form onSubmit={onSubmit} className="space-y-4 pt-2">
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-slate-300">新密码</label>
        <div className="relative">
          <input type={visible ? 'text' : 'password'} value={password} onChange={(event) => onPasswordChange(event.target.value)} placeholder="输入新密码" className="w-full rounded-xl border border-slate-800 bg-slate-950 py-2.5 pl-3.5 pr-10 font-mono text-sm text-white focus:border-sky-500 focus:outline-none" />
          <button type="button" onClick={onToggleVisibility} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300" aria-label={visible ? "隐藏密码" : "显示密码"}>
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-slate-300">确认密码</label>
        <input type={visible ? 'text' : 'password'} value={confirmPassword} onChange={(event) => onConfirmPasswordChange(event.target.value)} placeholder="再次输入新密码" className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 font-mono text-sm text-white focus:border-sky-500 focus:outline-none" />
      </div>

      <div className="space-y-1 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3.5 text-xs leading-relaxed text-amber-200/90">
        <p className="font-semibold text-amber-300">安全提醒</p>
        <p>此账号可修改整个运行系统。<br />请妥善保存密码。<br />建议混用字母、数字和符号。</p>
      </div>

      <div className="pt-2">
        <button type="submit" disabled={saving || !password || password !== confirmPassword} className="flex items-center space-x-2 rounded-xl bg-amber-500 px-6 py-2.5 text-xs font-bold text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40">
          {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          <span>保存密码</span>
        </button>
      </div>
    </form>
  </div>
);
