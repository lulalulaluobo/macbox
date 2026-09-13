import React, { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { Dashboard } from './pages/Dashboard';
import { LoginPage } from './pages/LoginPage';
import { SystemOverview, ConsoleUser, TerminalPrefill } from './types';
import { api } from './api';
import { useTheme } from './theme';
import { Key, X, CheckCircle2, AlertCircle } from 'lucide-react';

const Storage = lazy(() => import('./pages/Storage').then(({ Storage }) => ({ default: Storage })));
const Docker = lazy(() => import('./pages/Docker').then(({ Docker }) => ({ default: Docker })));
const Apps = lazy(() => import('./pages/Apps').then(({ Apps }) => ({ default: Apps })));
const TerminalPage = lazy(() => import('./pages/TerminalPage').then(({ TerminalPage }) => ({ default: TerminalPage })));
const Settings = lazy(() => import('./pages/Settings').then(({ Settings }) => ({ default: Settings })));
const StorageSettings = lazy(() => import('./pages/storage/StorageSettings').then(({ StorageSettings }) => ({ default: StorageSettings })));
const InitializationWizard = lazy(() => import('./pages/InitializationWizard').then(({ InitializationWizard }) => ({ default: InitializationWizard })));

export const App: React.FC = () => {
  useTheme();
  const [currentUser, setCurrentUser] = useState<ConsoleUser | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'storage' | 'docker' | 'apps' | 'terminal' | 'settings' | 'storage_settings' | 'smb_sharing'>('dashboard');
  const [overview, setOverview] = useState<SystemOverview | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [swUpdateReady, setSwUpdateReady] = useState(false);
  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const terminalPrefillSequence = useRef(0);
  const [terminalPrefill, setTerminalPrefill] = useState<TerminalPrefill | null>(null);

  // Self Change Password Modal State
  const [showChangePwdModal, setShowChangePwdModal] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changePwdLoading, setChangePwdLoading] = useState(false);
	const [changePwdMsg, setChangePwdMsg] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);

  // Check auth session on load
  const checkAuth = async () => {
    try {
      const res = await api.getMe();
      setCurrentUser(res.user);
    } catch {
      setCurrentUser(null);
    } finally {
      setAuthChecking(false);
    }
  };

  const refreshData = async () => {
    if (!currentUser) return;
    try {
      const over = await api.getOverview();
      setOverview(over);
      setError(null);
    } catch (err: any) {
      setError(err.message || '无法连接到 MacBox 后端服务');
    }
  };

  const needsInitialization = overview?.initializationRequired === true || overview?.vm.status === 'NotCreated';
  const navigate = (tab: typeof activeTab) => {
    if (needsInitialization && tab !== 'dashboard' && tab !== 'storage_settings') return;
    setActiveTab(tab);
  };

  const openTerminalWithContainerLogs = ({ containerName, logs }: { containerName: string; logs: string }) => {
    terminalPrefillSequence.current += 1;
    setTerminalPrefill({
      id: terminalPrefillSequence.current,
      source: containerName,
      text: logs,
    });
    setActiveTab('terminal');
  };

  useEffect(() => {
    if (needsInitialization && activeTab !== 'dashboard' && activeTab !== 'storage_settings') {
      setActiveTab('dashboard');
    }
  }, [needsInitialization, activeTab]);

  useEffect(() => {
    checkAuth();

    const handleSWUpdate = (event: Event) => {
      const registration = (event as CustomEvent<{ registration?: ServiceWorkerRegistration }>).detail?.registration;
      if (registration) {
        swRegistrationRef.current = registration;
        setSwUpdateReady(true);
      }
    };
    window.addEventListener('macbox-sw-update', handleSWUpdate);

    const handleUnauthorized = () => {
      setCurrentUser(null);
    };
    window.addEventListener('macbox-unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('macbox-unauthorized', handleUnauthorized);
      window.removeEventListener('macbox-sw-update', handleSWUpdate);
    };
  }, []);

  const applySWUpdate = () => {
    const waiting = swRegistrationRef.current?.waiting;
    if (!waiting) return;

    const handleControllerChange = () => window.location.reload();
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange, { once: true });
    waiting.postMessage({ type: 'SKIP_WAITING' });
  };

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

  // The desktop sidecar can take a moment to become reachable after the
  // window opens. Keep the UI in a connection state until the first complete
  // overview arrives instead of rendering a misleading empty dashboard.
  useEffect(() => {
    if (!currentUser || overview) return;
    const retryTimer = window.setInterval(() => void refreshData(), 2000);
    return () => window.clearInterval(retryTimer);
  }, [currentUser, overview]);

	const handleLoginSuccess = (user: ConsoleUser, warning?: string) => {
		setCurrentUser(user);
		setError(warning || null);
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // Ignore logout failure
    }
    setCurrentUser(null);
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oldPassword || !newPassword) {
      setChangePwdMsg({ type: 'error', text: '请填写所有密码输入框' });
      return;
    }
	if (Array.from(newPassword).length < 8) {
	  setChangePwdMsg({ type: 'error', text: '新密码长度至少需要 8 个字符' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setChangePwdMsg({ type: 'error', text: '两次输入的新密码不一致' });
      return;
    }

    setChangePwdLoading(true);
    setChangePwdMsg(null);
    try {
		const result = await api.changePassword(oldPassword, newPassword);
		if (result.warning) {
			setChangePwdMsg({ type: 'warning', text: `${result.message}。${result.warning}` });
			return;
		}
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
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-50 dark:bg-[#090d16] text-slate-500">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-10 h-10 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-medium tracking-wide">正在加载 MacBox 安全环境...</span>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className={`macbox-app-shell sora-app-shell flex flex-col bg-slate-50 dark:bg-[#090d16] text-slate-900 dark:text-slate-100 transition-colors duration-200 ${activeTab === 'terminal' ? 'h-[100dvh] min-h-0 overflow-hidden' : 'min-h-[100dvh]'}`}>
      <Navbar
        activeTab={activeTab}
        setActiveTab={navigate}
        vmStatus={overview?.vm}
        dockerReady={overview?.docker.ready}
        primaryIP={overview?.system.primaryIP}
        currentUser={currentUser}
        onLogout={handleLogout}
        onOpenChangePwd={() => setShowChangePwdModal(true)}
      />

      {swUpdateReady && (
        <div className="pwa-update-banner mx-auto mt-3 flex max-w-7xl items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-900 shadow-sm dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-100" role="status">
          <span>新版本已经准备好，更新后即可使用最新功能。</span>
          <button type="button" onClick={applySWUpdate} className="shrink-0 rounded-xl bg-sky-500 px-3 py-2 font-bold text-white transition hover:bg-sky-600">立即更新</button>
        </div>
      )}

      <div className={`mx-auto flex min-h-0 w-full max-w-6xl min-w-0 flex-1 ${activeTab === 'terminal' ? 'h-full' : ''}`}>
        <main className={`sora-app-content min-w-0 flex-1 px-3 ${activeTab === 'terminal'
          ? 'terminal-app-content flex h-full min-h-0 flex-col overflow-hidden pb-[calc(76px+env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pt-4'
          : (activeTab === 'dashboard' || activeTab === 'storage' || activeTab === 'docker')
            ? 'pb-[calc(76px+env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pt-4'
            : 'pb-32 pt-5 sm:px-6 sm:pb-32 sm:pt-8'
        }`}>
        {error && overview && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-sm flex items-center justify-between">
            <span>警告: {error}</span>
            <button onClick={refreshData} className="underline text-xs hover:text-slate-900 dark:hover:text-white">重新连接</button>
          </div>
        )}

        <PageLoadBoundary key={activeTab}>
          <Suspense fallback={<PageLoadingState />}>
          {activeTab === 'dashboard' && !overview && (
            <ConnectionState error={error} onRetry={refreshData} />
          )}

          {activeTab === 'dashboard' && overview && needsInitialization && (
            <InitializationWizard overview={overview} onRefresh={refreshData} onOpenStorageSettings={() => setActiveTab('storage_settings')} />
          )}

          {activeTab === 'dashboard' && overview && !needsInitialization && (
            <Dashboard overview={overview} onRefresh={refreshData} onNavigateTab={navigate} isAdmin={currentUser.role === 'admin'} />
          )}

          {activeTab === 'storage' && (
            <Storage />
          )}

          {activeTab === 'docker' && <Docker onOpenTerminalWithLogs={openTerminalWithContainerLogs} primaryIP={overview?.system.primaryIP} />}

          {activeTab === 'apps' && <Apps />}

          {activeTab === 'terminal' && <TerminalPage prefill={terminalPrefill} />}

          {activeTab === 'storage_settings' && <StorageSettings mode="storage" configDirty={overview?.configDirty} onRefreshOverview={refreshData} />}

          {activeTab === 'smb_sharing' && <StorageSettings mode="smb" configDirty={overview?.configDirty} onRefreshOverview={refreshData} />}

          {activeTab === 'settings' && (
            <Settings
              primaryIP={overview?.system.primaryIP}
              currentUser={currentUser}
              onCurrentUserUpdated={(updated) => setCurrentUser(updated)}
            />
          )}
          </Suspense>
        </PageLoadBoundary>
        </main>
      </div>

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
				  : changePwdMsg.type === 'warning'
				  ? 'bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300'
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
                  placeholder="请输入至少 8 位新密码"
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

    </div>
  );
};

interface ConnectionStateProps {
  error: string | null;
  onRetry: () => Promise<void> | void;
}

const ConnectionState: React.FC<ConnectionStateProps> = ({ error, onRetry }) => (
  <div className="mx-auto flex min-h-[calc(100dvh-180px)] w-full max-w-2xl items-center justify-center px-2 py-8">
    <section className="w-full rounded-[28px] border border-sky-100 bg-white p-6 text-center shadow-[0_20px_60px_-42px_rgba(15,118,170,0.45)] dark:border-slate-800 dark:bg-slate-900 sm:p-10">
      <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${error ? 'bg-rose-50 text-rose-500 dark:bg-rose-500/10 dark:text-rose-300' : 'bg-sky-50 text-sky-500 dark:bg-sky-500/10 dark:text-sky-300'}`}>
        {error ? <AlertCircle className="h-6 w-6" /> : <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />}
      </div>
      <h1 className="mt-5 text-lg font-black text-slate-950 dark:text-white">{error ? '正在等待 MacBox 后台' : '正在连接 MacBox'}</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">{error ? '后台服务暂时没有返回状态，系统会自动重试。请确认 MacBox 后台仍在运行。' : '正在读取虚拟机和本机环境状态…'}</p>
      {error && <p className="mt-3 break-words text-xs text-rose-600 dark:text-rose-300">{error}</p>}
      <button type="button" onClick={() => void onRetry()} className="mt-6 inline-flex min-h-11 items-center justify-center rounded-2xl bg-sky-500 px-5 text-sm font-bold text-white shadow-sm shadow-sky-500/20 transition hover:bg-sky-600">重新连接</button>
    </section>
  </div>
);

const PageLoadingState: React.FC = () => (
  <div className="flex min-h-[calc(100dvh-220px)] items-center justify-center">
    <div className="flex flex-col items-center gap-3 text-slate-500 dark:text-slate-400">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
      <span className="text-sm">正在加载页面…</span>
    </div>
  </div>
);

interface PageLoadBoundaryState {
  error: Error | null;
}

class PageLoadBoundary extends React.Component<React.PropsWithChildren, PageLoadBoundaryState> {
  state: PageLoadBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PageLoadBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[MacBox] 页面渲染失败', error, errorInfo);
  }

  private isChunkLoadError() {
    const message = this.state.error?.message || '';
    return this.state.error?.name === 'ChunkLoadError'
      || /failed to fetch dynamically imported module|importing a module script failed|loading chunk .* failed/i.test(message);
  }

  render() {
    if (this.state.error) {
      const isChunkLoadError = this.isChunkLoadError();
      return (
        <div className="flex min-h-[calc(100dvh-220px)] items-center justify-center px-4">
          <section className="w-full max-w-lg rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-sm dark:border-rose-900/70 dark:bg-slate-900">
            <AlertCircle className="mx-auto h-8 w-8 text-rose-500" />
            <h2 className="mt-4 text-lg font-bold text-slate-900 dark:text-white">
              {isChunkLoadError ? '页面资源加载失败' : '页面运行异常'}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
              {isChunkLoadError
                ? '页面版本资源可能未加载完整，请刷新页面后重试。'
                : '页面组件发生异常，请刷新页面后重试；如果问题持续，请保留控制台错误信息。'}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-2xl bg-sky-500 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-sky-600"
            >
              重新加载页面
            </button>
          </section>
        </div>
      );
    }

    return this.props.children;
  }
}
