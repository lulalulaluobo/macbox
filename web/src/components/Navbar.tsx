import React, { useState } from 'react';
import {
  LayoutDashboard,
  HardDrive,
  Box,
  Grid,
  Terminal,
  Settings,
  Sun,
  Moon,
  User,
  LogOut,
  Crown,
  Key,
  MoreHorizontal,
  Share2,
  ChevronRight,
} from 'lucide-react';
import { VMStatus, ConsoleUser } from '../types';
import { useTheme } from '../theme';

interface NavbarProps {
  activeTab: 'dashboard' | 'storage' | 'docker' | 'apps' | 'terminal' | 'settings' | 'storage_settings' | 'smb_sharing';
  setActiveTab: (tab: 'dashboard' | 'storage' | 'docker' | 'apps' | 'terminal' | 'settings' | 'storage_settings' | 'smb_sharing') => void;
  vmStatus?: VMStatus;
  dockerReady?: boolean;
  primaryIP?: string;
  currentUser?: ConsoleUser | null;
  onLogout?: () => void;
  onOpenChangePwd?: () => void;
}

type NavTab = NavbarProps['activeTab'];

const primaryNavItems = [
  { id: 'dashboard' as const, label: '首页', icon: LayoutDashboard },
  { id: 'storage' as const, label: '文件', icon: HardDrive },
  { id: 'docker' as const, label: 'Docker', icon: Box },
  { id: 'apps' as const, label: '应用', icon: Grid },
];

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  vmStatus,
  currentUser,
  onLogout,
  onOpenChangePwd,
}) => {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const { isDark, toggleTheme } = useTheme();

  const navigate = (tab: NavTab) => {
    setActiveTab(tab);
    setShowUserMenu(false);
    setShowMore(false);
  };

  const vmRunning = vmStatus?.status === 'Running';
  // 高亮归属：「更多」只代表存储设置/SMB/终端三个入口；settings 在桌面端由
  // 「设置」按钮独自高亮。移动端没有独立设置按钮，settings 时仍由「更多」承担，
  // 因此该场景的高亮用 md: 前缀在桌面端取消。
  const moreItemsActive = activeTab === 'storage_settings' || activeTab === 'smb_sharing' || activeTab === 'terminal';

  return (
    <>
      {activeTab === 'dashboard' && <header className="sora-navbar sticky top-0 z-40 border-b border-slate-200/70 bg-white/82 backdrop-blur-xl transition-colors dark:border-slate-800/70 dark:bg-[#090d16]/82">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:min-h-[68px] sm:px-6">
          <button type="button" className="group flex min-h-11 items-center gap-2.5 text-left" onClick={() => navigate('dashboard')} aria-label="返回首页">
            <span className="flex h-9 w-9 items-center justify-center rounded-[13px] bg-[#ff7d9a] shadow-sm shadow-[#ff7d9a]/20 transition-transform group-hover:-rotate-3">
              <img src="/icons/macbox-mark.svg" alt="" className="h-7 w-7 rounded-[9px] object-cover" />
            </span>
            <span>
              <span className="block text-[17px] font-black leading-5 tracking-tight text-[#24324a] dark:text-white">MacBox</span>
            </span>
          </button>

          <div className="flex items-center gap-2">
            <div className={`flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[11px] font-bold ${vmRunning ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'}`}>
              <span className={`h-2 w-2 rounded-full ${vmRunning ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <span>{vmRunning ? '运行中' : vmStatus?.status || '检查中'}</span>
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              title={isDark ? '切换至明亮模式' : '切换至夜间模式'}
              className="flex min-h-10 min-w-10 items-center justify-center rounded-full border border-slate-200/80 bg-white text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              {isDark ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-sky-500" />}
            </button>

            {currentUser && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex min-h-10 items-center gap-2 rounded-full border border-slate-200/80 bg-white px-2.5 text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  aria-expanded={showUserMenu}
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#fff0bd] text-[11px] font-black text-[#6d5a35]">{currentUser.username.charAt(0).toUpperCase()}</span>
                  <span className="hidden max-w-24 truncate text-xs font-semibold sm:block">{currentUser.displayName || currentUser.username}</span>
                </button>

                {showUserMenu && (
                  <>
                    <button type="button" className="fixed inset-0 z-40 cursor-default" onClick={() => setShowUserMenu(false)} aria-label="关闭账户菜单" />
                    <div className="absolute right-0 z-50 mt-2 w-52 rounded-2xl border border-slate-200 bg-white p-2 text-xs shadow-xl dark:border-slate-800 dark:bg-slate-900">
                      <div className="border-b border-slate-100 px-2 py-2.5 dark:border-slate-800">
                        <p className="truncate font-bold text-slate-900 dark:text-white">{currentUser.displayName || currentUser.username}</p>
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                          {currentUser.role === 'admin' ? <><Crown className="h-3 w-3 text-amber-500" />超级管理员</> : <><User className="h-3 w-3" />普通用户</>}
                        </p>
                      </div>
                      <button type="button" onClick={() => navigate('terminal')} className="mt-1 flex min-h-10 w-full items-center gap-2 rounded-xl px-2.5 text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"><Terminal className="h-4 w-4" />打开终端</button>
                      {onOpenChangePwd && <button type="button" onClick={() => { setShowUserMenu(false); onOpenChangePwd(); }} className="mt-1 flex min-h-10 w-full items-center gap-2 rounded-xl px-2.5 text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"><Key className="h-4 w-4" />修改密码</button>}
                      {onLogout && <button type="button" onClick={() => { setShowUserMenu(false); onLogout(); }} className="flex min-h-10 w-full items-center gap-2 rounded-xl px-2.5 text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30"><LogOut className="h-4 w-4" />退出登录</button>}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>}

      <nav className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 gap-1 border-t border-slate-200/90 bg-white/96 px-2 pb-[calc(6px+env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-10px_30px_-22px_rgba(36,50,74,0.55)] backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/96 sm:px-[max(1rem,calc((100vw-720px)/2))] md:flex md:justify-center" aria-label="主导航">
        {primaryNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button type="button" key={item.id} onClick={() => navigate(item.id)} className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-[18px] px-1 text-[10px] font-bold transition sm:flex-row sm:gap-2 sm:text-xs ${isActive ? 'bg-[#fff0f4] text-[#bd5e78] dark:bg-rose-500/15 dark:text-rose-300' : 'text-[#8b9aaa] hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'}`}>
              <Icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-[#ff7d9a]' : 'text-current'}`} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
        <button type="button" onClick={() => navigate('settings')} className={`hidden min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-[18px] px-1 text-[10px] font-bold transition md:flex md:flex-row md:gap-2 md:text-xs ${activeTab === 'settings' ? 'bg-[#fff0f4] text-[#bd5e78] dark:bg-rose-500/15 dark:text-rose-300' : 'text-[#8b9aaa] hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'}`}>
          <Settings className="h-[18px] w-[18px]" />
          <span>设置</span>
        </button>
        <div className="relative flex">
          <button type="button" onClick={() => setShowMore(!showMore)} aria-expanded={showMore} className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-[18px] px-1 text-[10px] font-bold transition sm:flex-row sm:gap-2 sm:text-xs ${moreItemsActive ? 'bg-[#fff0f4] text-[#bd5e78] dark:bg-rose-500/15 dark:text-rose-300' : activeTab === 'settings' ? 'bg-[#fff0f4] text-[#bd5e78] dark:bg-rose-500/15 dark:text-rose-300 md:bg-transparent md:text-[#8b9aaa] md:dark:bg-transparent md:dark:text-slate-400' : 'text-[#8b9aaa] hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'}`}>
            <MoreHorizontal className="h-[19px] w-[19px]" />
            <span>更多</span>
          </button>
          {showMore && (
            <>
              <button type="button" className="fixed inset-0 z-[60] hidden cursor-default md:block" onClick={() => setShowMore(false)} aria-label="关闭更多功能" />
              <div className="absolute bottom-[calc(100%+12px)] right-0 z-[70] hidden w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl md:block dark:border-slate-800 dark:bg-slate-900">
                {[
                  { id: 'storage_settings' as const, label: '存储设置', detail: '磁盘、容量与目录直通', icon: HardDrive },
                  { id: 'smb_sharing' as const, label: 'SMB 共享', detail: '局域网文件共享', icon: Share2 },
                  { id: 'terminal' as const, label: 'Web 终端', detail: '管理 Linux 虚拟机', icon: Terminal },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <button type="button" key={item.id} onClick={() => navigate(item.id)} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-500 dark:bg-sky-500/10"><Icon className="h-[18px] w-[18px]" /></span>
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-slate-900 dark:text-white">{item.label}</span>
                        <span className="block text-[11px] text-slate-500">{item.detail}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </nav>

      {showMore && (
        <div className="fixed inset-0 z-[60] md:hidden" role="dialog" aria-modal="true" aria-label="更多功能">
          <button type="button" className="absolute inset-0 bg-slate-950/25 backdrop-blur-[2px]" onClick={() => setShowMore(false)} aria-label="关闭更多功能" />
          <section className="absolute inset-x-0 bottom-0 rounded-t-[28px] bg-white px-4 pb-[calc(20px+env(safe-area-inset-bottom))] pt-3 shadow-2xl dark:bg-slate-900">
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
            <div className="mb-3 px-1">
              <h2 className="text-lg font-black text-slate-900 dark:text-white">更多</h2>
              <p className="mt-0.5 text-xs text-slate-500">存储、共享与系统工具</p>
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              {[
                { id: 'storage_settings' as const, label: '存储设置', detail: '磁盘、容量与目录直通', icon: HardDrive },
                { id: 'smb_sharing' as const, label: 'SMB 共享', detail: '局域网文件共享', icon: Share2 },
                { id: 'terminal' as const, label: 'Web 终端', detail: '管理 Linux 虚拟机', icon: Terminal },
                { id: 'settings' as const, label: '系统设置', detail: '用户、安全与外观', icon: Settings },
              ].map((item) => {
                const Icon = item.icon;
                return <button type="button" key={item.id} onClick={() => navigate(item.id)} className="flex min-h-16 w-full items-center gap-3 border-b border-slate-100 px-3 text-left last:border-b-0 dark:border-slate-800">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-500 dark:bg-sky-500/10"><Icon className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-slate-900 dark:text-white">{item.label}</span><span className="block text-xs text-slate-500">{item.detail}</span></span>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </button>;
              })}
            </div>
          </section>
        </div>
      )}
    </>
  );
};
