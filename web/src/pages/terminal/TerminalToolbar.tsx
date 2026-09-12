import React from 'react';
import { Code, Crown, Maximize2, Minimize2, PanelLeft, PanelLeftClose, RefreshCw, User, X } from 'lucide-react';

export interface TerminalAICommand {
  label: string;
  title: string;
  command: string;
}

interface TerminalToolbarProps {
  showSidebar: boolean;
  connected: boolean;
  sessionClosed: boolean;
  sessionId: string | null;
  loginUser: 'root' | 'default';
  fullscreen: boolean;
  commands: TerminalAICommand[];
  onToggleSidebar: () => void;
  onReconnect: () => void;
  onCloseSession: () => void | Promise<void>;
  onSwitchUser: () => void;
  onSendCommand: (command: string) => void;
  onClear: () => void;
  onToggleFullscreen: () => void;
}

export const TerminalToolbar: React.FC<TerminalToolbarProps> = ({
  showSidebar,
  connected,
  sessionClosed,
  sessionId,
  loginUser,
  fullscreen,
  commands,
  onToggleSidebar,
  onReconnect,
  onCloseSession,
  onSwitchUser,
  onSendCommand,
  onClear,
  onToggleFullscreen,
}) => (
  <div className="flex flex-col gap-2.5 border-b border-slate-800/80 bg-[#0d121f] p-3 sm:flex-row sm:items-center sm:justify-between sm:p-3.5">
    <div className="flex min-w-0 items-center gap-2">
      <button onClick={onToggleSidebar} className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-700" title={showSidebar ? '收起文件系统' : '展开文件系统'}>
        {showSidebar ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}<span>{showSidebar ? '收起文件' : '文件系统'}</span>
      </button>

      <div className="flex min-w-0 items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${connected ? 'animate-pulse bg-emerald-500' : 'bg-rose-500'}`} /><span className="truncate text-xs font-bold text-white">终端</span><span className="shrink-0 text-[11px] text-slate-400">{connected ? '已连接' : '未连接'}</span></div>

      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={onReconnect} className="flex min-h-8 items-center gap-1 rounded-lg bg-slate-800 px-2 text-[11px] font-semibold text-slate-200 transition hover:bg-sky-600" title="清除旧会话并重新连接虚拟机终端"><RefreshCw className="h-3.5 w-3.5" /><span className="hidden sm:inline">{sessionClosed ? '重开' : '重连'}</span></button>
        <button type="button" onClick={() => void onCloseSession()} disabled={!connected && !sessionId} className="flex min-h-8 items-center gap-1 rounded-lg bg-slate-800 px-2 text-[11px] font-semibold text-rose-300 transition hover:bg-rose-900/60 disabled:opacity-40" title="关闭当前终端会话"><X className="h-3.5 w-3.5" /><span className="hidden sm:inline">关闭</span></button>
      </div>

      <div className="ml-auto flex shrink-0 items-center rounded-lg border border-slate-700/80 bg-slate-800/80 p-0.5 text-xs sm:ml-0">
        <button onClick={onSwitchUser} className={`flex items-center space-x-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition ${loginUser === 'root' ? 'border border-amber-500/40 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' : 'border border-sky-500/40 bg-sky-500/20 text-sky-300 hover:bg-sky-500/30'}`} title="点击即切换当前终端身份并重新连入">
          {loginUser === 'root' ? <><Crown className="h-3 w-3 text-amber-400" /><span>root</span></> : <><User className="h-3 w-3 text-sky-400" /><span>用户</span></>}
        </button>
      </div>
    </div>

    <div className="flex w-full items-center gap-1.5 overflow-x-auto pb-0.5 sm:w-auto">
      <span className="shrink-0 px-1 text-[10px] font-bold uppercase tracking-wide text-violet-300" title="以下命令会跳过 AI 工具的安全审批，请仅在可信环境使用">AI 高权限</span>
      {commands.map((item) => <button key={item.label} onClick={() => onSendCommand(item.command)} disabled={!connected} className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-violet-500/30 bg-violet-500/15 px-2 py-1 text-[11px] font-semibold text-violet-200 transition hover:bg-violet-500/25 disabled:opacity-40" title={item.title}><Code className="h-2.5 w-2.5 text-violet-300" /><span>{item.label}</span></button>)}
      <button onClick={onClear} className="shrink-0 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-[11px] text-slate-300 transition hover:bg-slate-700" title="清屏">清屏</button>
      <button onClick={onToggleFullscreen} className="rounded-lg bg-slate-800 p-1.5 text-slate-300 transition hover:bg-slate-700" title={fullscreen ? '退出全屏' : '全屏终端'}>{fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}</button>
    </div>
  </div>
);
