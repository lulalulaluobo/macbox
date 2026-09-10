import React, { useState } from 'react';
import { LayoutDashboard, HardDrive, Box, Grid, Check, Copy, Activity, Terminal } from 'lucide-react';
import { VMStatus } from '../types';

interface NavbarProps {
  activeTab: 'dashboard' | 'storage' | 'docker' | 'apps' | 'terminal';
  setActiveTab: (tab: 'dashboard' | 'storage' | 'docker' | 'apps' | 'terminal') => void;
  vmStatus?: VMStatus;
  dockerReady?: boolean;
  primaryIP?: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  vmStatus,
  dockerReady,
  primaryIP,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyIP = () => {
    if (primaryIP) {
      navigator.clipboard.writeText(primaryIP);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const navItems = [
    { id: 'dashboard' as const, label: '首页', icon: LayoutDashboard },
    { id: 'storage' as const, label: '存储', icon: HardDrive },
    { id: 'docker' as const, label: 'Docker', icon: Box },
    { id: 'apps' as const, label: '应用', icon: Grid },
    { id: 'terminal' as const, label: '终端', icon: Terminal },
  ];

  const getVMStatusColor = () => {
    if (!vmStatus) return 'bg-slate-500';
    switch (vmStatus.status) {
      case 'Running':
        return 'bg-emerald-500';
      case 'Stopped':
        return 'bg-amber-500';
      default:
        return 'bg-slate-500';
    }
  };

  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-[#090d16]/80 border-b border-slate-800/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand */}
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setActiveTab('dashboard')}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20 text-white font-bold text-xl">
              🍎
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-200 to-sky-400">
                  MacNAS
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  MVP v0.1
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">Mac mini 家庭服务器</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex space-x-1 sm:space-x-2 bg-slate-900/60 p-1.5 rounded-2xl border border-slate-800/60">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? 'bg-sky-500 text-white shadow-md shadow-sky-500/25'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Status Indicators & IP */}
          <div className="flex items-center space-x-3">
            {/* IP Pill */}
            {primaryIP && (
              <button
                onClick={handleCopyIP}
                title="点击复制局域网 IP"
                className="hidden md:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-800/70 hover:bg-slate-800 border border-slate-700/60 text-xs text-slate-300 font-mono transition"
              >
                <span>{primaryIP}</span>
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
              </button>
            )}

            {/* Lima VM Status */}
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-800/50 border border-slate-700/50 text-xs font-medium">
              <span className={`w-2 h-2 rounded-full ${getVMStatusColor()} animate-pulse`} />
              <span className="text-slate-300">VM: {vmStatus?.status || '检测中'}</span>
            </div>

            {/* Docker Status */}
            <div className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-800/50 border border-slate-700/50 text-xs font-medium">
              <Activity className={`w-3.5 h-3.5 ${dockerReady ? 'text-emerald-400' : 'text-slate-500'}`} />
              <span className="text-slate-300">Docker {dockerReady ? '就绪' : '离线'}</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
