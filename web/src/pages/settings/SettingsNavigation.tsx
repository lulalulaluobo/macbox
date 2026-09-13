import React from 'react';
import { ArchiveRestore, Crown, Palette, Shield, Terminal, UserCheck, Users } from 'lucide-react';

export type SettingsSubTab = 'console_users' | 'users' | 'rootpwd' | 'ssh' | 'terminal' | 'appearance' | 'backup';

interface SettingsNavigationProps {
  activeSubTab: SettingsSubTab;
  onChange: (tab: SettingsSubTab) => void;
  isAdmin?: boolean;
}

const tabs: Array<{ id: SettingsSubTab; label: string; icon: React.ComponentType<{ className?: string }>; iconClassName?: string }> = [
  { id: 'console_users', label: 'MacBox 用户', icon: UserCheck },
  { id: 'users', label: '系统用户', icon: Users, iconClassName: 'text-slate-500' },
  { id: 'rootpwd', label: 'Root 密码', icon: Crown, iconClassName: 'text-amber-500' },
  { id: 'ssh', label: 'SSH', icon: Shield, iconClassName: 'text-teal-500' },
  { id: 'terminal', label: '终端', icon: Terminal, iconClassName: 'text-sky-500' },
  { id: 'appearance', label: '外观', icon: Palette, iconClassName: 'text-indigo-500' },
  { id: 'backup', label: '备份', icon: ArchiveRestore, iconClassName: 'text-emerald-500' },
];

export const SettingsNavigation: React.FC<SettingsNavigationProps> = ({ activeSubTab, onChange, isAdmin = false }) => (
  <div className={`grid grid-cols-3 gap-1 rounded-2xl border border-slate-200 bg-slate-100/80 p-1.5 text-xs font-semibold dark:border-slate-800 dark:bg-slate-900/70 ${isAdmin ? 'sm:grid-cols-7' : 'sm:grid-cols-6'}`}>
    {tabs.filter(({ id }) => id !== 'backup' || isAdmin).map(({ id, label, icon: Icon, iconClassName }) => (
      <button
        key={id}
        onClick={() => onChange(id)}
        className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 py-2 transition ${activeSubTab === id
          ? 'bg-sky-500 text-white shadow-md shadow-sky-500/25 font-semibold'
          : 'text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-white'
        }`}
      >
        <Icon className={`h-4 w-4 ${iconClassName || ''}`} />
        <span>{label}</span>
      </button>
    ))}
  </div>
);
