import React, { useState } from 'react';
import {
  LayoutDashboard,
  HardDrive,
  Box,
  Grid,
  Activity,
  Terminal,
  Settings,
  Sun,
  Moon,
  User,
  LogOut,
  Crown,
  Key,
} from 'lucide-react';
import { VMStatus, NASUser } from '../types';
import { useTheme } from '../theme';

interface NavbarProps {
  activeTab: 'dashboard' | 'storage' | 'docker' | 'apps' | 'terminal' | 'settings';
  setActiveTab: (tab: 'dashboard' | 'storage' | 'docker' | 'apps' | 'terminal' | 'settings') => void;
  vmStatus?: VMStatus;
  dockerReady?: boolean;
  primaryIP?: string;
  currentUser?: NASUser | null;
  onLogout?: () => void;
  onOpenChangePwd?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  vmStatus,
  dockerReady,
  currentUser,
  onLogout,
  onOpenChangePwd,
}) => {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const { isDark, toggleTheme } = useTheme();

  const navItems = [
    { id: 'dashboard' as const, label: '首页', icon: LayoutDashboard },
    { id: 'storage' as const, label: '存储', icon: HardDrive },
    { id: 'docker' as const, label: 'Docker', icon: Box },
    { id: 'apps' as const, label: '应用', icon: Grid },
    { id: 'terminal' as const, label: '终端', icon: Terminal },
    { id: 'settings' as const, label: '设置', icon: Settings },
  ];

  const getVMStatusColor = () => {
    if (!vmStatus) return 'bg-slate-400 dark:bg-slate-500';
    switch (vmStatus.status) {
      case 'Running':
        return 'bg-emerald-500';
      case 'Stopped':
        return 'bg-amber-500';
      default:
        return 'bg-slate-400 dark:bg-slate-500';
    }
  };

  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-white/85 dark:bg-[#090d16]/85 border-b border-slate-200/80 dark:border-slate-800/80 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-2">
          {/* Brand */}
          <div className="flex items-center space-x-3 cursor-pointer shrink-0" onClick={() => setActiveTab('dashboard')}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20 text-white font-bold text-xl">
              🍎
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-slate-900 via-slate-800 to-sky-600 dark:from-white dark:via-slate-200 dark:to-sky-400 bg-clip-text text-transparent">
                  MacNAS
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
                  MVP v0.1
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Mac mini 家庭服务器</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center space-x-1 bg-slate-100/90 dark:bg-slate-900/60 p-1.5 rounded-2xl border border-slate-200/90 dark:border-slate-800/60 shadow-xs shrink-0">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-200 shrink-0 ${
                    isActive
                      ? 'bg-sky-500 text-white shadow-md shadow-sky-500/25 font-semibold'
                      : 'text-slate-600 hover:text-slate-950 hover:bg-white dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-500 dark:text-slate-400'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Status Indicators, Theme Toggle & User */}
          <div className="flex items-center space-x-2 sm:space-x-2.5 shrink-0">

            {/* Lima VM Status */}
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 text-xs font-medium text-slate-700 dark:text-slate-300">
              <span className={`w-2 h-2 rounded-full ${getVMStatusColor()} animate-pulse`} />
              <span>VM: {vmStatus?.status || '检测中'}</span>
            </div>

            {/* Docker Status */}
            <div className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 text-xs font-medium text-slate-700 dark:text-slate-300">
              <Activity className={`w-3.5 h-3.5 ${dockerReady ? 'text-emerald-500' : 'text-slate-400'}`} />
              <span>Docker {dockerReady ? '就绪' : '离线'}</span>
            </div>

            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              title={isDark ? '切换至明亮模式 (白天)' : '切换至暗黑模式 (夜间)'}
              className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700/60 text-slate-700 dark:text-slate-300 transition active:scale-95 shadow-xs"
            >
              {isDark ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-medium hidden xl:inline">日间</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-sky-500" />
                  <span className="text-xs font-medium hidden xl:inline">夜间</span>
                </>
              )}
            </button>

            {/* Current User Capsule */}
            {currentUser && (
              <div className="relative">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700/60 text-slate-700 dark:text-slate-200 transition active:scale-95 shadow-xs"
                >
                  <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white text-[11px] font-bold">
                    {currentUser.username.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-xs font-semibold max-w-[80px] truncate">{currentUser.username}</span>
                  {currentUser.role === 'admin' ? (
                    <span title="超级管理员"><Crown className="w-3.5 h-3.5 text-amber-500" /></span>
                  ) : (
                    <User className="w-3.5 h-3.5 text-slate-400" />
                  )}
                </button>

                {/* Dropdown Menu */}
                {showUserMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowUserMenu(false)}
                    />
                    <div className="absolute right-0 mt-2 w-48 py-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl z-50 text-xs animate-fadeIn">
                      <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
                        <p className="font-semibold text-slate-900 dark:text-white truncate">{currentUser.displayName || currentUser.username}</p>
                        <p className="text-[11px] text-slate-500 flex items-center space-x-1 mt-0.5">
                          {currentUser.role === 'admin' ? (
                            <span className="text-amber-500 flex items-center">
                              <Crown className="w-3 h-3 mr-1" /> 超级管理员
                            </span>
                          ) : (
                            <span>普通用户</span>
                          )}
                        </p>
                      </div>

                      {onOpenChangePwd && (
                        <button
                          onClick={() => {
                            setShowUserMenu(false);
                            onOpenChangePwd();
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center space-x-2"
                        >
                          <Key className="w-3.5 h-3.5 text-slate-400" />
                          <span>修改个人密码</span>
                        </button>
                      )}

                      {onLogout && (
                        <button
                          onClick={() => {
                            setShowUserMenu(false);
                            onLogout();
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 dark:text-rose-400 flex items-center space-x-2"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>退出登录</span>
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
