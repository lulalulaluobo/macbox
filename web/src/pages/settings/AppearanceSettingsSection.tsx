import React from 'react';
import { CheckCircle2, Monitor, Moon, Palette, Sun } from 'lucide-react';
import type { ThemeMode } from '../../theme';

interface AppearanceSettingsSectionProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
}

const ThemeOption: React.FC<{
  active: boolean;
  title: string;
  description: string;
  actionLabel: string;
  icon: React.ReactNode;
  preview: React.ReactNode;
  onClick: () => void;
}> = ({ active, title, description, actionLabel, icon, preview, onClick }) => (
  <button type="button" onClick={onClick} className={`flex flex-col justify-between space-y-4 rounded-2xl border-2 p-5 text-left transition ${active ? 'border-sky-500 bg-slate-800/80 shadow-lg shadow-sky-500/10' : 'border-slate-800 bg-slate-800/40 hover:border-slate-700'}`}>
    <div className="space-y-3">
      {preview}
      <div>
        <div className="flex items-center justify-between">
          <span className="flex items-center space-x-1.5 text-sm font-bold text-white">{icon}<span>{title}</span></span>
          {active && <CheckCircle2 className="h-4 w-4 text-sky-400" />}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">{description}</p>
      </div>
    </div>
    <span className={`block rounded-lg px-3 py-1 text-center text-xs font-semibold ${active ? 'bg-sky-500 font-bold text-white' : 'bg-slate-700/60 text-slate-300'}`}>{active ? '当前已生效' : actionLabel}</span>
  </button>
);

export const AppearanceSettingsSection: React.FC<AppearanceSettingsSectionProps> = ({ theme, onThemeChange }) => (
  <div className="space-y-6 rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl">
    <div className="flex items-center justify-between border-b border-slate-800 pb-4">
      <div>
        <h3 className="flex items-center space-x-2 text-base font-bold text-white"><Palette className="h-5 w-5 text-indigo-400" /><span>外观与主题模式设置</span></h3>
        <p className="mt-1 text-xs text-slate-400">支持在明亮日间模式、极客夜间暗黑模式及跟随操作系统之间自由切换。</p>
      </div>
      <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 font-mono text-xs font-semibold text-slate-300">当前: {theme === 'dark' ? '🌙 夜间暗黑' : theme === 'light' ? '☀️ 日间浅色' : '💻 跟随系统'}</span>
    </div>

    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <ThemeOption
        active={theme === 'dark'}
        title="夜间暗黑模式 (Dark)"
        description="专为极客与夜间运维调校的深色美学，弱光护眼，专注沉浸。"
        actionLabel="选择夜间模式"
        icon={<Moon className="h-4 w-4 text-sky-400" />}
        onClick={() => onThemeChange('dark')}
        preview={<div className="flex h-24 w-full flex-col justify-between rounded-xl border border-slate-700/80 bg-[#090d16] p-2.5 shadow-inner"><div className="flex items-center justify-between border-b border-slate-800 pb-1.5"><div className="flex items-center space-x-1.5"><i className="h-2.5 w-2.5 rounded-full bg-rose-500" /><i className="h-2.5 w-2.5 rounded-full bg-amber-500" /><i className="h-2.5 w-2.5 rounded-full bg-emerald-500" /></div><i className="h-2 w-12 rounded bg-slate-800" /></div><div className="flex items-center space-x-2"><i className="flex h-6 w-6 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/20 text-[10px]">🍎</i><div className="flex-1 space-y-1"><i className="block h-2 w-16 rounded bg-slate-700" /><i className="block h-1.5 w-24 rounded bg-slate-800" /></div></div></div>}
      />
      <ThemeOption
        active={theme === 'light'}
        title="日间浅色模式 (Light)"
        description="清爽雅致的浅灰白底配色，强光办公清晰易读，典雅自然。"
        actionLabel="选择日间模式"
        icon={<Sun className="h-4 w-4 text-amber-400" />}
        onClick={() => onThemeChange('light')}
        preview={<div className="flex h-24 w-full flex-col justify-between rounded-xl border border-slate-300 bg-slate-100 p-2.5 shadow-inner"><div className="flex items-center justify-between border-b border-slate-200 pb-1.5"><div className="flex items-center space-x-1.5"><i className="h-2.5 w-2.5 rounded-full bg-rose-500" /><i className="h-2.5 w-2.5 rounded-full bg-amber-500" /><i className="h-2.5 w-2.5 rounded-full bg-emerald-500" /></div><i className="h-2 w-12 rounded bg-slate-300" /></div><div className="flex items-center space-x-2"><i className="flex h-6 w-6 items-center justify-center rounded-lg border border-sky-300 bg-sky-100 text-[10px]">🍎</i><div className="flex-1 space-y-1"><i className="block h-2 w-16 rounded bg-slate-400" /><i className="block h-1.5 w-24 rounded bg-slate-300" /></div></div></div>}
      />
      <ThemeOption
        active={theme === 'system'}
        title="跟随系统设置 (Auto)"
        description="智能跟随 Mac 或客户端系统的深浅色设置自动平滑过渡。"
        actionLabel="选择跟随系统"
        icon={<Monitor className="h-4 w-4 text-emerald-400" />}
        onClick={() => onThemeChange('system')}
        preview={<div className="flex h-24 w-full flex-col justify-between rounded-xl border border-slate-700/80 bg-gradient-to-r from-slate-900 to-slate-100 p-2.5 shadow-inner"><div className="flex items-center justify-between pb-1.5"><div className="flex items-center space-x-1.5"><i className="h-2.5 w-2.5 rounded-full bg-rose-500" /><i className="h-2.5 w-2.5 rounded-full bg-amber-500" /><i className="h-2.5 w-2.5 rounded-full bg-emerald-500" /></div><Monitor className="h-3.5 w-3.5 text-slate-400" /></div><div className="py-1 text-center"><span className="rounded bg-slate-800/80 px-2 py-0.5 font-mono text-[10px] font-bold text-sky-300">Auto (macOS)</span></div></div>}
      />
    </div>
  </div>
);
