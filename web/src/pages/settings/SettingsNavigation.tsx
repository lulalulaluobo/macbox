import React from 'react';
import { ArchiveRestore, Crown, Globe, LayoutDashboard, Network, Palette, RefreshCw, Shield, Terminal, UserCheck, Users } from 'lucide-react';

export type SettingsSubTab = 'overview' | 'network' | 'remote' | 'updates' | 'console_users' | 'users' | 'rootpwd' | 'ssh' | 'terminal' | 'appearance' | 'backup';

interface SettingsNavigationProps {
  activeSubTab: SettingsSubTab;
  onChange: (tab: SettingsSubTab) => void;
  isAdmin?: boolean;
}

export const settingsTabs: Array<{ id: SettingsSubTab; label: string; icon: React.ComponentType<{ className?: string }>; iconClassName?: string; advanced?: boolean; admin?: boolean }> = [
  { id: 'overview', label: '常用设置', icon: LayoutDashboard },
  { id: 'network', label: "网络连接", icon: Network },
  { id: 'remote', label: '远程访问', icon: Globe, admin: true },
  { id: 'updates', label: '版本更新', icon: RefreshCw },
  { id: 'console_users', label: "后台账号", icon: UserCheck },
  { id: 'users', label: "系统账号", icon: Users, advanced: true, admin: true },
  { id: 'rootpwd', label: "管理密码", icon: Crown, advanced: true, admin: true },
  { id: 'ssh', label: "远程登录", icon: Shield, advanced: true, admin: true },
  { id: 'terminal', label: "命令窗口", icon: Terminal, advanced: true, admin: true },
  { id: 'appearance', label: '外观', icon: Palette, iconClassName: 'text-indigo-500' },
  { id: 'backup', label: "备份恢复", icon: ArchiveRestore, admin: true },
];

export const SettingsNavigation: React.FC<SettingsNavigationProps> = ({ activeSubTab, onChange, isAdmin = false }) => (
  <nav aria-label="设置分类" className="space-y-3">
    {[false, true].map(advanced => {
      const tabs = settingsTabs.filter(tab => !!tab.advanced === advanced && (!tab.admin || isAdmin));
      return !!tabs.length && <div key={String(advanced)} className="flex flex-wrap items-center gap-2">
        {advanced && <span className="text-xs text-slate-400 mr-1">高级设置</span>}
        {tabs.map(({ id, label, icon: Icon }) => <button key={id} aria-current={activeSubTab === id ? 'page' : undefined} onClick={() => onChange(id)} className={`min-h-10 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition ${activeSubTab === id ? 'bg-sky-500 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800'}`}><Icon className="h-4 w-4"/>{label}</button>)}
      </div>;
    })}
  </nav>
);
