import React, { useState, useEffect, useRef } from 'react';
import {
  Folder, RefreshCw, FileText, Film, Image, Music, Archive,
  Code, HardDrive, Maximize2, Minimize2, Star,
  PanelLeftClose, PanelLeft, X, Crown, User
} from 'lucide-react';
import { api } from '../api';
import { FileItem, TerminalPrefill } from '../types';
import { TerminalInputBar } from './terminal/TerminalInputBar';
import { TerminalFileBrowser } from './terminal/TerminalFileBrowser';
import type { TerminalShortcut } from './terminal/TerminalFileBrowser';
import { TerminalFileModals } from './terminal/TerminalFileModals';
import type { TerminalEditingFile } from './terminal/TerminalFileModals';
import { useTerminalSession } from './terminal/useTerminalSession';

interface TerminalPageProps {
  prefill?: TerminalPrefill | null;
}

export const TerminalPage: React.FC<TerminalPageProps> = ({ prefill = null }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const {
    xtermInstance,
    fitAddonRef,
    wsRef,
    connected,
    sessionId,
    sessionClosed,
    loginUser,
    switchUser,
    reconnect,
    closeSession,
    sendRaw,
  } = useTerminalSession({ terminalRef });
  const [fullscreen, setFullscreen] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);

  // File System State
  const [currentPath, setCurrentPath] = useState<string>('/data');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [showHiddenFiles, setShowHiddenFiles] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('macnas_terminal_show_hidden') === 'true';
    } catch {
      return false;
    }
  });
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [favoritePaths, setFavoritePaths] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = JSON.parse(window.localStorage.getItem('macnas_terminal_favorite_paths') || '[]');
      if (!Array.isArray(saved)) return [];
      return Array.from(new Set(saved.filter((value): value is string => (
        typeof value === 'string' && value.startsWith('/')
      ))));
    } catch {
      return [];
    }
  });

  // File Modals
  const [showMkdirModal, setShowMkdirModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [uploading, setUploading] = useState(false);

  // File View / Edit Modal
  const [editingFile, setEditingFile] = useState<TerminalEditingFile | null>(null);
  const [savingFile, setSavingFile] = useState(false);

  // Drag & drop upload
  const [isDragging, setIsDragging] = useState(false);

  // Quick Shortcuts
  const rootShortcuts: TerminalShortcut[] = [
    ...(loginUser === 'root' ? [{ label: 'VM 根目录', path: '/', icon: HardDrive }] : []),
    { label: 'NAS 根目录', path: '/data', icon: Folder },
    { label: 'Docker 目录', path: '/data/appdata', icon: Code },
  ];

  // The VM root is a browse-only view. Mutating operations continue to be
  // anchored to the NAS data disk by the backend safe-mutation layer.
  const isVMSystemPath = currentPath !== '/data' && !currentPath.startsWith('/data/');

  const favoriteShortcuts: TerminalShortcut[] = favoritePaths.map((path) => ({
    label: path.split('/').filter(Boolean).pop() || path,
    path,
    icon: Star,
  }));

  const aiCommands = [
    {
      label: 'Codex',
      title: '启动 Codex 高权限模式（跳过审批和沙箱）',
      command: 'codex --dangerously-bypass-approvals-and-sandbox',
    },
    {
      label: 'Claude',
      title: '启动 Claude 高权限模式（跳过权限确认）',
      command: 'claude --dangerously-skip-permissions',
    },
    {
      label: 'Anti Gravity',
      title: '启动 Anti Gravity 高权限模式（跳过权限确认）',
      command: 'agy --dangerously-skip-permissions',
    },
  ];

  const aiCommandForUser = (command: string, user: 'root' | 'default') => {
    if (user !== 'root') return `${command}\n`;

    // Claude's GLM provider is configured in root's Claude settings. A plain
    // `sudo -iu macnasctl` changes HOME and makes Claude fall back to the
    // official login flow. Read only the provider settings as root, drop to
    // macnasctl in the same process, then launch Claude with the same model
    // configuration and no root privileges.
    if (command === 'claude --dangerously-skip-permissions') {
      return `python3 -c 'import json,os,pwd; u=pwd.getpwnam("macnasctl"); s=json.load(open("/root/.claude/settings.json")); e={k:v for k,v in os.environ.items() if k in ("PATH","TERM","COLORTERM","LANG","LC_ALL","TZ","NO_COLOR","FORCE_COLOR")}; e.update({str(k):str(v) for k,v in s.get("env",{}).items()}); e.update({"HOME":u.pw_dir,"USER":u.pw_name,"LOGNAME":u.pw_name,"SHELL":"/bin/bash","PWD":u.pw_dir,"CLAUDE_CONFIG_DIR":os.path.join(u.pw_dir,".claude")}); os.chdir(u.pw_dir); os.initgroups(u.pw_name,u.pw_gid); os.setgid(u.pw_gid); os.setuid(u.pw_uid); os.execvpe("claude",["claude","--dangerously-skip-permissions"],e)'\n`;
    }

    return `sudo -iu macnasctl -- bash -lc 'exec ${command}'\n`;
  };

  const handleSwitchUser = (newUser: 'root' | 'default') => {
    if (newUser !== 'root' && isVMSystemPath) {
      setCurrentPath('/data');
      if (showSidebar) void loadFiles('/data');
    }
    switchUser(newUser);
  };

  const handleReconnect = () => reconnect();

  const handleCloseSession = () => closeSession();

  useEffect(() => {
    try {
      window.localStorage.setItem('macnas_terminal_favorite_paths', JSON.stringify(favoritePaths));
    } catch {
      // 收藏仅作为快捷入口，浏览器无法写入时不影响文件管理功能。
    }
  }, [favoritePaths]);

  useEffect(() => {
    try {
      window.localStorage.setItem('macnas_terminal_show_hidden', String(showHiddenFiles));
    } catch {
      // 隐藏文件显示偏好无法保存时，不影响当前页面的切换。
    }
  }, [showHiddenFiles]);

  // Fit terminal when sidebar toggles or fullscreen changes
  useEffect(() => {
    const timer = setTimeout(() => {
      if (fitAddonRef.current && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          fitAddonRef.current.fit();
          const dims = fitAddonRef.current.proposeDimensions();
          if (dims) {
            wsRef.current.send(JSON.stringify({ type: 'resize', rows: dims.rows, cols: dims.cols }));
          }
        } catch (e) {
          // ignore
        }
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [showSidebar, fullscreen]);

  // The input/shortcut bar changes height when the viewport or multiline mode
  // changes. Keep xterm fitted to the remaining grid row so its last line is
  // never painted underneath the helper bar.
  useEffect(() => {
    const element = terminalRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (!fitAddonRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        try {
          fitAddonRef.current.fit();
          const dims = fitAddonRef.current.proposeDimensions();
          if (dims) {
            wsRef.current.send(JSON.stringify({ type: 'resize', rows: dims.rows, cols: dims.cols }));
          }
        } catch {
          // The terminal may be disposing while the layout observer fires.
        }
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Load File List
  const loadFiles = async (targetPath: string) => {
    setFilesLoading(true);
    try {
      const res = await api.listFiles(targetPath);
      setFiles(res.items || []);
      setCurrentPath(res.path || targetPath);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `读取目录失败: ${err.message}` });
    } finally {
      setFilesLoading(false);
    }
  };

  const visibleFiles = showHiddenFiles
    ? files
    : files.filter((file) => !file.name.startsWith('.'));

  // Send command to live terminal
  const sendToTerminal = (cmd: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(cmd);
      if (xtermInstance.current) {
        xtermInstance.current.focus();
      }
    }
  };

  // Open directory in terminal
  const handleOpenInTerminal = (path: string) => {
    sendToTerminal(`cd "${path}"\n`);
  };

  // Navigate Up
  const handleNavigateUp = () => {
    if (currentPath === '/' || currentPath === '') return;
    if (loginUser !== 'root' && currentPath === '/data') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const parent = '/' + parts.join('/');
    loadFiles(parent === '' ? '/' : parent);
  };

  // Create Folder
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isVMSystemPath) {
      setAlertMsg({ type: 'error', text: 'VM 系统目录仅支持浏览，请切换到 NAS 根目录后操作' });
      return;
    }
    if (!newFolderName.trim()) return;
    const target = currentPath === '/' ? `/${newFolderName.trim()}` : `${currentPath}/${newFolderName.trim()}`;
    try {
      await api.createFolder(target);
      setAlertMsg({ type: 'success', text: `文件夹 ${newFolderName} 创建成功` });
      setShowMkdirModal(false);
      setNewFolderName('');
      loadFiles(currentPath);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `创建文件夹失败: ${err.message}` });
    }
  };

  // Delete Path
  const handleDelete = async (item: FileItem) => {
    const isOk = window.confirm(`确认删除 ${item.isDir ? '文件夹' : '文件'}「${item.name}」吗？操作无法恢复！`);
    if (!isOk) return;

    try {
      await api.deleteFile(item.path);
      setAlertMsg({ type: 'success', text: `已删除 ${item.name}` });
      loadFiles(currentPath);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `删除失败: ${err.message}` });
    }
  };

  // View/Edit File
  const handleViewFile = async (item: FileItem) => {
    try {
      const res = await api.readFile(item.path);
      setEditingFile({
        path: item.path,
        name: item.name,
        content: res.content || '',
        readOnly: isVMSystemPath,
      });
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `打开文件失败: ${err.message}` });
    }
  };

  // Save File
  const handleSaveFile = async () => {
    if (!editingFile || editingFile.readOnly) return;
    setSavingFile(true);
    try {
      await api.writeFile(editingFile.path, editingFile.content);
      setAlertMsg({ type: 'success', text: `文件 ${editingFile.name} 保存成功！` });
      setEditingFile(null);
      loadFiles(currentPath);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `保存文件失败: ${err.message}` });
    } finally {
      setSavingFile(false);
    }
  };

  // Upload File
  const handleFileUpload = async (filesToUpload: FileList | null) => {
    if (!filesToUpload || filesToUpload.length === 0) return;
    if (isVMSystemPath) {
      setAlertMsg({ type: 'error', text: 'VM 系统目录仅支持浏览，请切换到 NAS 根目录后上传' });
      return;
    }
    setUploading(true);
    try {
      for (let i = 0; i < filesToUpload.length; i++) {
        await api.uploadFile(filesToUpload[i], currentPath);
      }
      setAlertMsg({ type: 'success', text: `成功上传 ${filesToUpload.length} 个文件！` });
      loadFiles(currentPath);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `上传失败: ${err.message}` });
    } finally {
      setUploading(false);
    }
  };

  // Copy Path
  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  const handleToggleFavorite = (path: string) => {
    setFavoritePaths((prev) => {
      const isFavorite = prev.includes(path);
      const next = isFavorite ? prev.filter((item) => item !== path) : [...prev, path];
      setAlertMsg({
        type: 'success',
        text: isFavorite ? `已取消收藏 ${path}` : `已收藏 ${path}，可从上方快捷目录进入`,
      });
      return next;
    });
  };

  // File Icon Helper
  const getFileIcon = (item: FileItem) => {
    if (item.isDir) {
      return <Folder className="w-4 h-4 text-sky-400 shrink-0" />;
    }
    const ext = item.ext;
    if (['mp4', 'mkv', 'avi', 'mov', 'wmv'].includes(ext)) {
      return <Film className="w-4 h-4 text-purple-400 shrink-0" />;
    }
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(ext)) {
      return <Image className="w-4 h-4 text-emerald-400 shrink-0" />;
    }
    if (['mp3', 'flac', 'wav', 'aac', 'm4a'].includes(ext)) {
      return <Music className="w-4 h-4 text-pink-400 shrink-0" />;
    }
    if (ext === 'zip') {
      return <Archive className="w-4 h-4 text-amber-400 shrink-0" />;
    }
    if (['sh', 'py', 'go', 'js', 'ts', 'yaml', 'yml', 'json', 'conf'].includes(ext)) {
      return <Code className="w-4 h-4 text-cyan-400 shrink-0" />;
    }
    return <FileText className="w-4 h-4 text-slate-400 shrink-0" />;
  };

  return (
    <div className={`terminal-page flex h-full min-h-0 min-w-0 flex-1 flex-col gap-4 ${showSidebar ? 'overflow-y-auto overscroll-contain lg:overflow-hidden' : 'overflow-hidden'} ${fullscreen ? 'fixed inset-0 z-[70] bg-[#090d16] p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))]' : 'w-full'}`}>
      {/* Alert Banner */}
      {alertMsg && (
        <div className={`p-3.5 rounded-xl text-sm flex items-center justify-between shadow ${
          alertMsg.type === 'success'
            ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
            : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
        }`}>
          <span>{alertMsg.text}</span>
          <button onClick={() => setAlertMsg(null)} className="text-xs opacity-70 hover:opacity-100">关闭</button>
        </div>
      )}

      {/* Terminal first; file system is loaded and shown only when requested. */}
      <div className={`flex min-h-0 flex-col gap-4 ${showSidebar ? 'flex-none lg:flex-row lg:flex-1 lg:overflow-hidden' : 'flex-1'}`}>
        {/* Left Side: Integrated File System Explorer (mobile: stacked below; desktop: left sidebar) */}
        {showSidebar && (
          <TerminalFileBrowser
            currentPath={currentPath}
            files={files}
            visibleFiles={visibleFiles}
            filesLoading={filesLoading}
            uploading={uploading}
            isDragging={isDragging}
            isVMSystemPath={isVMSystemPath}
            showHiddenFiles={showHiddenFiles}
            favoritePaths={favoritePaths}
            copiedPath={copiedPath}
            rootShortcuts={rootShortcuts}
            favoriteShortcuts={favoriteShortcuts}
            loginUser={loginUser}
            onOpenMkdir={() => setShowMkdirModal(true)}
            onUpload={handleFileUpload}
            onRefresh={() => loadFiles(currentPath)}
            onToggleHidden={() => setShowHiddenFiles((visible) => !visible)}
            onNavigate={loadFiles}
            onNavigateUp={handleNavigateUp}
            onSetDragging={setIsDragging}
            onOpenInTerminal={handleOpenInTerminal}
            onToggleFavorite={handleToggleFavorite}
            onViewFile={handleViewFile}
            onDelete={handleDelete}
            onCopyPath={handleCopyPath}
            getFileIcon={getFileIcon}
          />
        )}

        {/* Right Side: Interactive Web Terminal */}
        <div className={`terminal-dark-preserve order-1 grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl border border-slate-800/80 bg-[#090d16] ${showSidebar ? 'min-h-[520px] flex-none lg:order-2 lg:min-h-0 lg:w-auto lg:flex-1' : 'min-h-0 flex-1'}`}>
          {/* Terminal Top Toolbar */}
          <div className="flex flex-col gap-2.5 border-b border-slate-800/80 bg-[#0d121f] p-3 sm:flex-row sm:items-center sm:justify-between sm:p-3.5">
            <div className="flex min-w-0 items-center gap-2">
              <button
                onClick={() => {
                  const next = !showSidebar;
                  setShowSidebar(next);
                  if (next && files.length === 0) loadFiles(currentPath);
                }}
                className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-700"
                title={showSidebar ? '收起文件系统' : '展开文件系统'}
              >
                {showSidebar ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
                <span>{showSidebar ? '收起文件' : '文件系统'}</span>
              </button>

              <div className="flex min-w-0 items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                <span className="truncate text-xs font-bold text-white">终端</span>
                <span className="shrink-0 text-[11px] text-slate-400">{connected ? '已连接' : '未连接'}</span>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={handleReconnect}
                  className="flex min-h-8 items-center gap-1 rounded-lg bg-slate-800 px-2 text-[11px] font-semibold text-slate-200 transition hover:bg-sky-600"
                  title="清除旧会话并重新连接虚拟机终端"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{sessionClosed ? '重开' : '重连'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleCloseSession()}
                  disabled={!connected && !sessionId}
                  className="flex min-h-8 items-center gap-1 rounded-lg bg-slate-800 px-2 text-[11px] font-semibold text-rose-300 transition hover:bg-rose-900/60 disabled:opacity-40"
                  title="关闭当前终端会话"
                >
                  <X className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">关闭</span>
                </button>
              </div>

              {/* Login Identity Badge & Fast Switcher */}
              <div className="ml-auto flex shrink-0 items-center rounded-lg border border-slate-700/80 bg-slate-800/80 p-0.5 text-xs sm:ml-0">
                <button
                  onClick={() => handleSwitchUser(loginUser === 'root' ? 'default' : 'root')}
                  className={`flex items-center space-x-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition ${
                    loginUser === 'root'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                      : 'bg-sky-500/20 text-sky-300 border border-sky-500/40 hover:bg-sky-500/30'
                  }`}
                  title="点击即切换当前终端身份并重新连入"
                >
                  {loginUser === 'root' ? (
                    <>
                      <Crown className="w-3 h-3 text-amber-400" />
                      <span>root</span>
                    </>
                  ) : (
                    <>
                      <User className="w-3 h-3 text-sky-400" />
                      <span>用户</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Quick Command Buttons */}
            <div className="flex w-full items-center gap-1.5 overflow-x-auto pb-0.5 sm:w-auto">
              <span className="shrink-0 px-1 text-[10px] font-bold uppercase tracking-wide text-violet-300" title="以下命令会跳过 AI 工具的安全审批，请仅在可信环境使用">
                AI 高权限
              </span>
              {aiCommands.map((ai) => (
                <button
                  key={ai.label}
                  onClick={() => sendToTerminal(aiCommandForUser(ai.command, loginUser))}
                  disabled={!connected}
                  className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-violet-500/30 bg-violet-500/15 px-2 py-1 text-[11px] font-semibold text-violet-200 transition hover:bg-violet-500/25 disabled:opacity-40"
                  title={ai.title}
                >
                  <Code className="h-2.5 w-2.5 text-violet-300" />
                  <span>{ai.label}</span>
                </button>
              ))}

              <button
                onClick={() => xtermInstance.current?.clear()}
                className="shrink-0 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-[11px] text-slate-300 transition hover:bg-slate-700"
                title="清屏"
              >
                清屏
              </button>

              <button
                onClick={() => setFullscreen(!fullscreen)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                title={fullscreen ? '退出全屏' : '全屏终端'}
              >
                {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Terminal Canvas Container */}
          <div
            ref={terminalRef}
            className="h-full min-h-0 min-w-0 overflow-hidden bg-[#090d16] p-3 font-mono"
          />

          {/* Bottom Text Input & Action Keys Helper Bar */}
          <TerminalInputBar
            onSendRaw={sendRaw}
            disabled={!connected}
            prefill={prefill}
          />
        </div>
      </div>

      <TerminalFileModals
        showMkdirModal={showMkdirModal}
        currentPath={currentPath}
        newFolderName={newFolderName}
        editingFile={editingFile}
        savingFile={savingFile}
        onNewFolderNameChange={setNewFolderName}
        onCloseMkdir={() => setShowMkdirModal(false)}
        onCreateFolder={handleCreateFolder}
        onCloseEditor={() => setEditingFile(null)}
        onEditContent={(content) => setEditingFile((file) => file ? { ...file, content } : file)}
        onSaveFile={handleSaveFile}
      />
    </div>
  );
};
