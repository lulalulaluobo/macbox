import React, { useEffect, useState } from 'react';
import { Key, User, ArrowRight, Sun, Moon, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { api } from '../api';
import { NASUser } from '../types';
import { useTheme } from '../theme';

interface LoginPageProps {
  onLoginSuccess: (user: NASUser) => void;
}

const DEFAULT_ADMIN_USERNAME = 'admin';

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const { isDark, toggleTheme } = useTheme();
  const [username, setUsername] = useState(DEFAULT_ADMIN_USERNAME);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAuthStatus()
      .then((res) => {
        setSetupRequired(res.setupRequired);
        if (res.setupRequired) {
          setUsername(DEFAULT_ADMIN_USERNAME);
          setPassword('');
          setConfirmPassword('');
        }
      })
      .catch(() => setSetupRequired(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const setupMode = setupRequired === true;
    if (!username.trim() || !password) {
      setError('请输入用户名和登录密码');
      return;
    }
    if (setupMode && new TextEncoder().encode(password).length < 12) {
      setError('管理员密码至少需要 12 个字节，请设置更强的密码');
      return;
    }
    if (setupMode && password !== confirmPassword) {
      setError('两次输入的管理员密码不一致');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (setupMode) {
        await api.setupAdmin(username.trim(), password);
        setSetupRequired(false);
      }
      const res = await api.login(username.trim(), password, rememberMe);
      onLoginSuccess(res.user);
    } catch (err: any) {
      setError(err.message || '登录失败，请检查用户名或密码');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sora-login-page relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-[#f8fbfd] px-4 py-8 text-slate-900 transition-colors duration-300 dark:bg-[#0b1624] dark:text-slate-100 sm:py-10">
      {/* Quiet sky shapes keep the page airy without competing with the form. */}
      <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-[#e5f7ff] dark:bg-sky-500/10 sm:-right-10 sm:-top-16" />
      <div className="pointer-events-none absolute -right-2 top-14 h-36 w-36 rounded-full bg-[#fff1df] dark:bg-orange-500/10" />
      <div className="pointer-events-none absolute -left-24 bottom-[-4rem] h-72 w-72 rounded-full bg-[#eef9f1] dark:bg-emerald-500/10" />
      <div className="sora-cloud pointer-events-none absolute left-[9%] top-[18%] h-8 w-28 rounded-full bg-white/80 dark:bg-white/5" />

      {/* Top right theme switcher */}
      <div className="absolute right-4 top-4 z-20 sm:right-8 sm:top-8">
        <button
          onClick={toggleTheme}
          title={isDark ? '切换到日间模式' : '切换到夜间模式'}
          className="flex min-h-10 items-center gap-2 rounded-full border border-slate-200/80 bg-white/90 px-3.5 text-xs font-bold text-slate-700 shadow-sm backdrop-blur-md transition hover:bg-white dark:border-slate-700/80 dark:bg-slate-800/90 dark:text-slate-300"
        >
          {isDark ? (
            <>
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              <span>日间模式</span>
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5 text-sky-500" />
              <span>夜间模式</span>
            </>
          )}
        </button>
      </div>

      {/* Main Login Card */}
      <div className="w-full max-w-md relative z-10">
        <div className="rounded-[28px] border border-[#e8edf3] bg-white/95 p-6 shadow-[0_16px_42px_-24px_rgba(36,50,74,0.4)] backdrop-blur-xl transition-all dark:border-slate-700 dark:bg-slate-900/90 dark:shadow-black/40 sm:p-10">
          {/* Logo & Brand */}
          <div className="flex flex-col items-center text-center mb-8">
            <div
              className="sora-login-mark mb-4 flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-[1.65rem] border-2 border-[#f4b35f] bg-[#fff1df] text-[2.65rem] shadow-[0_10px_22px_-14px_rgba(234,138,30,0.7)] transition-transform hover:-rotate-6"
              aria-hidden="true"
            >
              🥕
            </div>
            <h1 className="text-2xl font-black tracking-tight text-[#24324a] dark:text-white">
              MacNAS 控制台
            </h1>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-600 dark:text-rose-300 text-xs flex items-center space-x-2 animate-fadeIn">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
              <span>{error}</span>
            </div>
          )}

          {setupRequired && (
            <div className="mb-6 rounded-xl border border-sky-200 bg-sky-50 p-3.5 text-xs text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300">
              首次使用请现场创建管理员账号和密码。密码至少 12 个字节，初始化只允许在运行 MacNAS 的 Mac 本机完成。
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {setupRequired ? '管理员账号' : '账号名称'}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入用户名"
                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50/60 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-800/60 dark:text-white"
                  autoFocus
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {setupRequired ? '设置管理员密码' : '登录密码'}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Key className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50/60 pl-10 pr-10 text-sm text-slate-900 placeholder-slate-400 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-800/60 dark:text-white"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {setupRequired && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  确认管理员密码
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Key className="w-4 h-4" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="请再次输入密码"
                    className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50/60 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-800/60 dark:text-white"
                    required
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center space-x-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-700 text-sky-500 focus:ring-sky-400"
                />
                <span>保持登录状态</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#ee8b2b] text-sm font-bold text-white shadow-md shadow-[#ee8b2b]/25 transition hover:bg-[#d97706] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <span>{setupRequired ? '正在初始化…' : '正在验证登录…'}</span>
              ) : (
                <>
                  <span>{setupRequired ? '初始化并进入控制台' : '进入管理控制台'}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

        </div>

      </div>
    </div>
  );
};
