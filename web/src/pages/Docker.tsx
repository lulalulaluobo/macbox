import React, { useState } from 'react';
import { LayoutDashboard, Box, Layers, Disc3, Network } from 'lucide-react';
import { DockerOverview } from './docker/DockerOverview';
import { DockerContainers } from './docker/DockerContainers';
import { DockerCompose } from './docker/DockerCompose';
import { DockerImages } from './docker/DockerImages';
import { DockerNetworks } from './docker/DockerNetworks';

type DockerTab = 'overview' | 'containers' | 'compose' | 'images' | 'networks';

export const Docker: React.FC = () => {
  const [activeTab, setActiveTab] = useState<DockerTab>('overview');

  const navItems: { id: DockerTab; label: string; icon: React.ReactNode; badge?: string }[] = [
    { id: 'overview', label: '概览', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'containers', label: '容器', icon: <Box className="w-4 h-4" /> },
    { id: 'compose', label: '编排', icon: <Layers className="w-4 h-4" /> },
    { id: 'images', label: '镜像', icon: <Disc3 className="w-4 h-4" /> },
    { id: 'networks', label: '网络', icon: <Network className="w-4 h-4" /> },
  ];

  return (
    <div className="mx-auto flex h-[calc(100dvh-152px)] min-h-[500px] w-full max-w-6xl flex-col gap-2.5 overflow-hidden sm:h-[calc(100dvh-160px)]">
      <div className="w-full shrink-0 rounded-[22px] border border-slate-200/90 bg-white p-2 shadow-xs dark:border-slate-800 dark:bg-slate-900/80">
        <nav className="grid grid-cols-5 gap-1">
          {navItems.map(item => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-1.5 text-[10px] font-bold transition-all sm:flex-row sm:gap-2 sm:text-xs ${
                  isActive
                    ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20 font-bold'
                    : 'text-slate-600 hover:text-slate-950 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <span className={isActive ? 'text-white' : 'text-slate-500 dark:text-slate-400'}>{item.icon}</span>
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${
                      isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Main Workspace Area */}
      <div className="min-h-0 w-full flex-1 overflow-hidden">
        {activeTab === 'overview' && <DockerOverview onNavigateTab={setActiveTab} />}
        {activeTab === 'containers' && <DockerContainers />}
        {activeTab === 'compose' && <DockerCompose />}
        {activeTab === 'images' && <DockerImages />}
        {activeTab === 'networks' && <DockerNetworks />}
      </div>
    </div>
  );
};
export default Docker;
