import React, { useState, useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  Terminal as TerminalIcon, Folder, FolderPlus, Upload, RefreshCw, ArrowLeft,
  Download, Trash2, Edit3, Copy, Check, FileText, Film, Image, Music, Archive,
  Code, Maximize2, Minimize2, CornerDownRight, Play,
  PanelLeftClose, PanelLeft, X, Save, Crown, User
} from 'lucide-react';
import { api } from '../api';
import { FileItem } from '../types';
import { TerminalInputBar } from './terminal/TerminalInputBar';

export const TerminalPage: React.FC = () => {
  // Terminal State
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [loginUser, setLoginUser] = useState<'root' | 'default'>('default');

  // File System State
  const [currentPath, setCurrentPath] = useState<string>('/data');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // File Modals
  const [showMkdirModal, setShowMkdirModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [uploading, setUploading] = useState(false);

  // File View / Edit Modal
  const [editingFile, setEditingFile] = useState<{ path: string; name: string; content: string } | null>(null);
  const [savingFile, setSavingFile] = useState(false);

  // Drag & drop upload
  const [isDragging, setIsDragging] = useState(false);

  // Quick Shortcuts
  const shortcuts = [
    { label: 'NAS 根数据', path: '/data', icon: Folder },
    { label: '影音媒体', path: '/data/media', icon: Film },
    { label: '下载中心', path: '/data/downloads', icon: Download },
    { label: 'Docker 数据', path: '/data/appdata', icon: Code },
    { label: '用户主目录', path: '/home/macnas.linux', icon: Folder },
    { label: '系统配置', path: '/etc', icon: FileText },
  ];

  // Quick Command Presets for Terminal
  const quickCommands = [
    { label: 'Docker 容器', cmd: 'docker ps\n' },
    { label: '磁盘空间', cmd: 'df -h /data\n' },
    { label: '系统负载', cmd: 'top -b -n 1 | head -n 15\n' },
    { label: 'Samba 状态', cmd: 'systemctl status smbd --no-pager\n' },
    { label: '系统内核', cmd: 'uname -a\n' },
  ];

  // Initialize Terminal WebSocket
  const initTerminal = (userToUse?: 'root' | 'default') => {
    if (!terminalRef.current) return;

    if (xtermInstance.current) {
      xtermInstance.current.dispose();
    }
    if (wsRef.current) {
      wsRef.current.close();
    }

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#090d16',
        foreground: '#e2e8f0',
        cursor: '#38bdf8',
        selectionBackground: 'rgba(56, 189, 248, 0.3)',
        black: '#0f172a',
        red: '#f43f5e',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#d946ef',
        cyan: '#06b6d4',
        white: '#f8fafc',
        brightBlack: '#475569',
        brightRed: '#fb7185',
        brightGreen: '#34d399',
        brightYellow: '#fbbf24',
        brightBlue: '#60a5fa',
        brightMagenta: '#e879f9',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermInstance.current = term;
    fitAddonRef.current = fitAddon;

    const targetUser = userToUse || loginUser;

    // WebSocket connection with user param
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/terminal/ws?user=${targetUser}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      const userBadge = targetUser === 'root' ? '\x1b[1;33m[👑 root 超级管理员]\x1b[0;36m' : '\x1b[1;32m[👤 普通用户 (macnas)]\x1b[0;36m';
      term.write(`\r\n\x1b[36m[MacNAS] 已以 ${userBadge} 身份成功连接到 Linux 虚拟机交互终端！\x1b[0m\r\n\r\n`);
      // Send initial size
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        ws.send(JSON.stringify({ type: 'resize', rows: dims.rows, cols: dims.cols }));
      }
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        term.write(event.data);
      } else {
        term.write(new Uint8Array(event.data));
      }
    };

    ws.onclose = () => {
      setConnected(false);
      term.write('\r\n\x1b[33m[MacNAS] 终端连接已断开。\x1b[0m\r\n');
    };

    ws.onerror = () => {
      setConnected(false);
      term.write('\r\n\x1b[31m[MacNAS] 终端连接异常。\x1b[0m\r\n');
    };

    // Forward user keystrokes to WS
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Resize handler
    const handleResize = () => {
      try {
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', rows: dims.rows, cols: dims.cols }));
        }
      } catch (e) {
        // ignore
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  };

  const handleSwitchUser = (newUser: 'root' | 'default') => {
    setLoginUser(newUser);
    initTerminal(newUser);
  };

  useEffect(() => {
    api.getTerminalSettings()
      .then((settings) => {
        const u: 'root' | 'default' = settings.defaultLoginUser === 'root' ? 'root' : 'default';
        setLoginUser(u);
        initTerminal(u);
      })
      .catch(() => {
        initTerminal('default');
      });

    loadFiles(currentPath);

    return () => {
      if (wsRef.current) wsRef.current.close();
      if (xtermInstance.current) xtermInstance.current.dispose();
    };
  }, []);

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
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const parent = '/' + parts.join('/');
    loadFiles(parent === '' ? '/' : parent);
  };

  // Create Folder
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
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
      });
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `打开文件失败: ${err.message}` });
    }
  };

  // Save File
  const handleSaveFile = async () => {
    if (!editingFile) return;
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
    if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) {
      return <Archive className="w-4 h-4 text-amber-400 shrink-0" />;
    }
    if (['sh', 'py', 'go', 'js', 'ts', 'yaml', 'yml', 'json', 'conf'].includes(ext)) {
      return <Code className="w-4 h-4 text-cyan-400 shrink-0" />;
    }
    return <FileText className="w-4 h-4 text-slate-400 shrink-0" />;
  };

  return (
    <div className={`space-y-4 ${fullscreen ? 'fixed inset-0 z-50 bg-[#090d16] p-4 flex flex-col' : ''}`}>
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

      {/* Main Split Layout: Left File System, Right Web Terminal */}
      <div className={`grid ${showSidebar ? 'grid-cols-1 lg:grid-cols-12' : 'grid-cols-1'} gap-4 ${fullscreen ? 'flex-1 min-h-0' : 'min-h-[620px]'}`}>
        {/* Left Side: Integrated File System Explorer */}
        {showSidebar && (
          <div className="lg:col-span-5 flex flex-col rounded-2xl bg-slate-900/80 border border-slate-800/80 shadow-xl overflow-hidden">
            {/* Header & Quick Shortcuts */}
            <div className="p-4 border-b border-slate-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Folder className="w-4 h-4 text-sky-400" />
                  <span className="font-bold text-white text-sm">虚拟机文件系统</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <button
                    onClick={() => setShowMkdirModal(true)}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center space-x-1 transition"
                    title="新建文件夹"
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">新建</span>
                  </button>
                  <label className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center space-x-1 cursor-pointer transition">
                    <Upload className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">上传</span>
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => handleFileUpload(e.target.files)}
                      disabled={uploading}
                    />
                  </label>
                  <button
                    onClick={() => loadFiles(currentPath)}
                    disabled={filesLoading}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
                    title="刷新列表"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${filesLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Quick Path Shortcuts */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {shortcuts.map((sc) => (
                  <button
                    key={sc.path}
                    onClick={() => loadFiles(sc.path)}
                    className={`px-2 py-1 rounded-md text-[11px] font-medium border transition flex items-center space-x-1 ${
                      currentPath === sc.path
                        ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 font-bold'
                        : 'bg-slate-800/60 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border-slate-700/60'
                    }`}
                  >
                    <sc.icon className="w-3 h-3" />
                    <span>{sc.label}</span>
                  </button>
                ))}
              </div>

              {/* Breadcrumb Path Bar */}
              <div className="flex items-center space-x-1 text-xs bg-slate-950/60 p-2 rounded-xl border border-slate-800/80 overflow-x-auto font-mono">
                <button
                  onClick={handleNavigateUp}
                  disabled={currentPath === '/'}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-30 transition shrink-0"
                  title="返回上一级"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                </button>
                <div className="flex items-center space-x-1 text-slate-300 truncate">
                  <span
                    onClick={() => loadFiles('/')}
                    className="cursor-pointer hover:text-sky-400 font-bold"
                  >
                    /
                  </span>
                  {currentPath.split('/').filter(Boolean).map((seg, idx, arr) => {
                    const segPath = '/' + arr.slice(0, idx + 1).join('/');
                    return (
                      <React.Fragment key={segPath}>
                        <span className="text-slate-600">/</span>
                        <span
                          onClick={() => loadFiles(segPath)}
                          className={`cursor-pointer hover:text-sky-400 truncate ${
                            idx === arr.length - 1 ? 'text-white font-bold' : 'text-slate-400'
                          }`}
                        >
                          {seg}
                        </span>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* File List Table / Area */}
            <div
              className={`flex-1 overflow-y-auto max-h-[460px] p-2 space-y-1 relative ${
                isDragging ? 'border-2 border-dashed border-sky-500 bg-sky-500/5' : ''
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                handleFileUpload(e.dataTransfer.files);
              }}
            >
              {uploading && (
                <div className="p-3 bg-sky-500/10 border border-sky-500/30 rounded-xl text-center text-xs text-sky-300">
                  文件上传写入中...
                </div>
              )}

              {filesLoading && files.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">正在扫描文件系统...</div>
              ) : files.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">该目录下暂无文件</div>
              ) : (
                files.map((file) => (
                  <div
                    key={file.path}
                    className="group flex items-center justify-between p-2 rounded-xl hover:bg-slate-800/60 transition text-xs"
                  >
                    <div
                      onClick={() => (file.isDir ? loadFiles(file.path) : handleViewFile(file))}
                      className="flex items-center space-x-2.5 min-w-0 flex-1 cursor-pointer"
                    >
                      {getFileIcon(file)}
                      <span className={`truncate ${file.isDir ? 'text-slate-200 font-medium group-hover:text-sky-300' : 'text-slate-300'}`}>
                        {file.name}
                      </span>
                    </div>

                    {/* Metadata & Hover Actions */}
                    <div className="flex items-center space-x-2 text-slate-500 shrink-0">
                      <span className="text-[11px] font-mono hidden sm:inline">{file.sizeFormatted}</span>

                      {/* Action buttons */}
                      <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {file.isDir ? (
                          <button
                            onClick={() => handleOpenInTerminal(file.path)}
                            className="p-1 rounded hover:bg-sky-500/20 text-slate-400 hover:text-sky-300 transition"
                            title="在终端中打开 (cd)"
                          >
                            <TerminalIcon className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => handleViewFile(file)}
                              className="p-1 rounded hover:bg-sky-500/20 text-slate-400 hover:text-sky-300 transition"
                              title="查看/编辑文件"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <a
                              href={api.getFileDownloadUrl(file.path)}
                              download={file.name}
                              className="p-1 rounded hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-300 transition"
                              title="下载文件"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                          </>
                        )}
                        <button
                          onClick={() => handleCopyPath(file.path)}
                          className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition"
                          title="复制绝对路径"
                        >
                          {copiedPath === file.path ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => handleDelete(file)}
                          className="p-1 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition"
                          title="删除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Bottom Quick Terminal Switcher */}
            <div className="p-3 border-t border-slate-800/80 bg-slate-950/40 flex items-center justify-between text-[11px] text-slate-400">
              <span>当前路径: <code className="text-sky-400 font-mono">{currentPath}</code></span>
              <button
                onClick={() => handleOpenInTerminal(currentPath)}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-sky-600 hover:text-white text-slate-300 flex items-center space-x-1 transition font-medium"
              >
                <CornerDownRight className="w-3 h-3" />
                <span>终端切入此目录</span>
              </button>
            </div>
          </div>
        )}

        {/* Right Side: Interactive Web Terminal */}
        <div className={`${showSidebar ? 'lg:col-span-7' : 'w-full'} flex flex-col rounded-2xl bg-slate-900/90 border border-slate-800/80 shadow-xl overflow-hidden`}>
          {/* Terminal Top Toolbar */}
          <div className="p-3.5 border-b border-slate-800/80 bg-slate-950/70 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setShowSidebar(!showSidebar)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                title={showSidebar ? '折叠文件树' : '展开文件树'}
              >
                {showSidebar ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
              </button>

              <div className="flex items-center space-x-2">
                <span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                <span className="text-xs font-bold text-white">Lima Linux VM Shell</span>
                <span className="text-[11px] font-mono text-slate-400">({connected ? '已连接' : '未连接'})</span>
              </div>

              {/* Login Identity Badge & Fast Switcher */}
              <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-lg bg-slate-800/80 border border-slate-700/80 text-xs">
                <span className="text-slate-400 text-[11px]">身份:</span>
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
                      <span>root (超级用户)</span>
                    </>
                  ) : (
                    <>
                      <User className="w-3 h-3 text-sky-400" />
                      <span>普通用户</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Quick Command Buttons */}
            <div className="flex items-center space-x-1.5 overflow-x-auto">
              {quickCommands.map((qc) => (
                <button
                  key={qc.label}
                  onClick={() => sendToTerminal(qc.cmd)}
                  disabled={!connected}
                  className="px-2 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-[11px] font-mono transition flex items-center space-x-1 disabled:opacity-40"
                >
                  <Play className="w-2.5 h-2.5 text-sky-400" />
                  <span>{qc.label}</span>
                </button>
              ))}

              <button
                onClick={() => xtermInstance.current?.clear()}
                className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] transition"
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
            className={`flex-1 p-3 bg-[#090d16] ${fullscreen ? 'h-full' : 'h-[440px]'} overflow-hidden font-mono`}
          />

          {/* Bottom Text Input & Action Keys Helper Bar */}
          <TerminalInputBar
            onSendRaw={(data) => {
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(data);
              }
            }}
            disabled={!connected}
          />
        </div>
      </div>

      {/* Modal: Create Folder */}
      {showMkdirModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <FolderPlus className="w-4 h-4 text-sky-400" />
              <span>新建文件夹</span>
            </h3>
            <p className="text-xs text-slate-400">
              将在目录 <code className="text-sky-300">{currentPath}</code> 下创建新文件夹：
            </p>
            <form onSubmit={handleCreateFolder} className="space-y-4">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="例如: documents 或 backup"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-sky-500"
                autoFocus
              />
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowMkdirModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-medium"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!newFolderName.trim()}
                  className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold disabled:opacity-50"
                >
                  创建
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: View / Edit File */}
      {editingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-3xl rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4 flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <Edit3 className="w-4 h-4 text-sky-400" />
                <span className="font-bold text-white text-sm">{editingFile.name}</span>
                <span className="text-xs text-slate-500 font-mono">({editingFile.path})</span>
              </div>
              <button
                onClick={() => setEditingFile(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <textarea
              value={editingFile.content}
              onChange={(e) => setEditingFile({ ...editingFile, content: e.target.value })}
              className="flex-1 w-full min-h-[360px] p-4 rounded-xl bg-[#090d16] border border-slate-800 font-mono text-xs text-slate-200 focus:outline-none focus:border-sky-500 resize-none leading-relaxed"
              spellCheck={false}
            />

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-slate-500">支持直接在线修改文件并写回虚拟机文件系统</span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setEditingFile(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-medium"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveFile}
                  disabled={savingFile}
                  className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center space-x-1.5 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savingFile ? '保存中...' : '保存更改'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
