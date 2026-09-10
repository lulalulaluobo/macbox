import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { Dashboard } from './pages/Dashboard';
import { Storage } from './pages/Storage';
import { Docker } from './pages/Docker';
import { Apps } from './pages/Apps';
import { TerminalPage } from './pages/TerminalPage';
import { Settings } from './pages/Settings';
import { LoginPage } from './pages/LoginPage';
import { SystemOverview, AppMetadata, NASUser } from './types';
import { api } from './api';
import { useTheme } from './theme';
import { Key, X, CheckCircle2, AlertCircle } from 'lucide-react';

export const App: React.FC = () => {
  useTheme();
  const [currentUser, setCurrentUser] = useState<NASUser | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'storage' | 'docker' | 'apps' | 'terminal' | 'settings'>('dashboard');
  const [overview, setOverview] = useState<SystemOverview | undefined>(undefined);
  const [apps, setApps] = useState<AppMetadata[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Self Change Password Modal State
  const [showChangePwdModal, setShowChangePwdModal] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changePwdLoading, setChangePwdLoading] = useState(false);
  const [changePwdMsg, setChangePwdMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Check auth session on load
  const checkAuth = async () => {
    const token = localStorage.getItem('macnas-auth-token');
    if (!token) {
      setCurrentUser(null);
      setAuthChecking(false);
      return;
    }
    try {
      const res = await api.getMe();
      setCurrentUser(res.user);
    } catch {
      localStorage.removeItem('macnas-auth-token');
      setCurrentUser(null);
    } finally {
      setAuthChecking(false);
    }
  };

  const refreshData = async () => {
    if (!currentUser) return;
    try {
      const [over, appList] = await Promise.all([
        api.getOverview(),
        api.getApps(),
      ]);
      setOverview(over);
      setApps(appList || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || '无法连接到 MacNAS 后端服务');
    }
  };

  useEffect(() => {
    checkAuth();

    const handleUnauthorized = () => {
      localStorage.removeItem('macnas-auth-token');
      setCurrentUser(null);
    };
    window.addEventListener('macnas-unauthorized', handleUnauthorized);
    return () => window.removeEventListener('macnas-unauthorized', handleUnauthorized);
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    refreshData();
    let timer = setInterval(refreshData, 10000);

    const handleVisibility = () => {
      if (document.hidden) {
        clearInterval(timer);
      } else {
        refreshData();
        timer = setInterval(refreshData, 10000);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [currentUser]);

  const handleLoginSuccess = (user: NASUser) => {
    setCurrentUser(user);
    setError(null);
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // Ignore logout failure
    }
    localStorage.removeItem('macnas-auth-token');
    setCurrentUser(null);
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oldPassword || !newPassword) {
      setChangePwdMsg({ type: 'error', text: '请填写所有密码输入框' });
      return;
    }
    if (newPassword.length < 6) {
      setChangePwdMsg({ type: 'error', text: '新密码长度至少需要 6 个字符' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setChangePwdMsg({ type: 'error', text: '两次输入的新密码不一致' });
      return;
    }

    setChangePwdLoading(true);
    setChangePwdMsg(null);
    try {
      await api.changePassword(oldPassword, newPassword);
      setChangePwdMsg({ type: 'success', text: '密码修改成功！下次登录请使用新密码' });
      setTimeout(() => {
        setShowChangePwdModal(false);
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setChangePwdMsg(null);
      }, 1500);
    } catch (err: any) {
      setChangePwdMsg({ type: 'error', text: err.message || '修改密码失败' });
    } finally {
      setChangePwdLoading(false);
    }
  };

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#090d16] text-slate-500">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-10 h-10 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-medium tracking-wide">正在加载 MacNAS 安全环境...</span>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-[#090d16] text-slate-900 dark:text-slate-100 transition-colors duration-200">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        vmStatus={overview?.vm}
        dockerReady={overview?.docker.ready}
        primaryIP={overview?.system.primaryIP}
        currentUser={currentUser}
        onLogout={handleLogout}
        onOpenChangePwd={() => setShowChangePwdModal(true)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-sm flex items-center justify-between">
            <span>警告: {error}</span>
            <button onClick={refreshData} className="underline text-xs hover:text-slate-900 dark:hover:text-white">重新连接</button>
          </div>
        )}

        {activeTab === 'dashboard' && (
          <Dashboard
            overview={overview}
            apps={apps}
            onRefresh={refreshData}
            onNavigateTab={setActiveTab}
          />
        )}

        {activeTab === 'storage' && (
          <Storage
            configDirty={overview?.configDirty}
            onRefreshOverview={refreshData}
          />
        )}

        {activeTab === 'docker' && <Docker />}

        {activeTab === 'apps' && <Apps />}

        {activeTab === 'terminal' && <TerminalPage />}

        {activeTab === 'settings' && (
          <Settings
            primaryIP={overview?.system.primaryIP}
            currentUser={currentUser}
            onCurrentUserUpdated={(updated) => setCurrentUser(updated)}
          />
        )}
      </main>

      {/* Self Change Password Modal */}
      {showChangePwdModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-xl bg-sky-50 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">修改个人登录密码</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">当前账户: {currentUser.username}</p>
                </div>
              </div>
              <button
                onClick={() => setShowChangePwdModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {changePwdMsg && (
              <div className={`p-3 rounded-xl text-xs flex items-center space-x-2 ${
                changePwdMsg.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                  : 'bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300'
              }`}>
                {changePwdMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                <span>{changePwdMsg.text}</span>
              </div>
            )}

            <form onSubmit={handleChangePasswordSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">原密码</label>
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder="请输入当前原密码"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">新密码</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="请输入至少 6 位新密码"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">确认新密码</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="请再次输入新密码"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
                  required
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowChangePwdModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={changePwdLoading}
                  className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold shadow-xs transition disabled:opacity-50"
                >
                  {changePwdLoading ? '保存中...' : '确认修改'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <footer className="border-t border-slate-200/80 dark:border-slate-800/60 py-6 text-center text-xs text-slate-500">
        <p>MacNAS MVP v0.1 · 磁盘 → Linux VM → Docker → NAS共享 → Web管理</p>
      </footer>
    </div>
  );
};
