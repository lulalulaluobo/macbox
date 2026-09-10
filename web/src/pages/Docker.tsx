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
    { id: 'compose', label: 'Compose', icon: <Layers className="w-4 h-4" /> },
    { id: 'images', label: '本地镜像', icon: <Disc3 className="w-4 h-4" /> },
    { id: 'networks', label: '网络与加速', icon: <Network className="w-4 h-4" /> },
  ];

  return (
    <div className="flex flex-col md:flex-row gap-6 items-start min-h-[calc(100vh-140px)]">
      {/* Secondary Sidebar (FnOS Style Sidebar Navigation) */}
      <div className="w-full md:w-56 flex-shrink-0 bg-slate-900/80 border border-slate-800/90 rounded-3xl p-3 shadow-xl backdrop-blur-md sticky top-6">
        <div className="px-3 py-2.5 mb-2 border-b border-slate-800/80">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
            <h3 className="font-extrabold text-sm text-white tracking-wide">Docker 工作台</h3>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5 font-mono">MacNAS Engine</p>
        </div>

        <nav className="space-y-1">
          {navItems.map(item => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/20 font-bold'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <span className={isActive ? 'text-white' : 'text-slate-400'}>{item.icon}</span>
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${
                      isActive ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-400'
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
      <div className="flex-1 min-w-0 w-full">
        {activeTab === 'overview' && <DockerOverview />}
        {activeTab === 'containers' && <DockerContainers />}
        {activeTab === 'compose' && <DockerCompose />}
        {activeTab === 'images' && <DockerImages />}
        {activeTab === 'networks' && <DockerNetworks />}
      </div>
    </div>
  );
};
export default Docker;
