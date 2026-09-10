import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { Dashboard } from './pages/Dashboard';
import { Storage } from './pages/Storage';
import { Docker } from './pages/Docker';
import { Apps } from './pages/Apps';
import { TerminalPage } from './pages/TerminalPage';
import { Settings } from './pages/Settings';
import { SystemOverview, AppMetadata } from './types';
import { api } from './api';
import { useTheme } from './theme';

export const App: React.FC = () => {
  useTheme();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'storage' | 'docker' | 'apps' | 'terminal' | 'settings'>('dashboard');
  const [overview, setOverview] = useState<SystemOverview | undefined>(undefined);
  const [apps, setApps] = useState<AppMetadata[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshData = async () => {
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
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-[#090d16] text-slate-900 dark:text-slate-100 transition-colors duration-200">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        vmStatus={overview?.vm}
        dockerReady={overview?.docker.ready}
        primaryIP={overview?.system.primaryIP}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-center justify-between">
            <span>警告: {error}</span>
            <button onClick={refreshData} className="underline text-xs hover:text-white">重新连接</button>
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

        {activeTab === 'settings' && <Settings primaryIP={overview?.system.primaryIP} />}
      </main>

      <footer className="border-t border-slate-800/60 py-6 text-center text-xs text-slate-500">
        <p>MacNAS MVP v0.1 · 磁盘 → Linux VM → Docker → NAS共享 → Web管理</p>
      </footer>
    </div>
  );
};
