import React, { useState, useEffect, useRef } from 'react';
import {
  Folder, FileText, Film, Image, Music, Archive,
  Code, HardDrive, Star,
} from 'lucide-react';
import { api } from '../api';
import { FileItem, TerminalPrefill } from '../types';
import { TerminalInputBar } from './terminal/TerminalInputBar';
import { TerminalFileBrowser } from './terminal/TerminalFileBrowser';
import type { TerminalShortcut } from './terminal/TerminalFileBrowser';
import { TerminalFileModals } from './terminal/TerminalFileModals';
import type { TerminalEditingFile } from './terminal/TerminalFileModals';
import { TerminalToolbar } from './terminal/TerminalToolbar';
import { TerminalViewport } from './terminal/TerminalViewport';
import { useTerminalSession } from './terminal/useTerminalSession';
import { useTerminalLayout } from './terminal/useTerminalLayout';

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
      return window.localStorage.getItem('macbox_terminal_show_hidden') === 'true';
    } catch {
      return false;
    }
  });
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [favoritePaths, setFavoritePaths] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = JSON.parse(window.localStorage.getItem('macbox_terminal_favorite_paths') || '[]');
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
    ...(loginUser === 'root' ? [{ label: '根目录', path: '/', icon: HardDrive }] : []),
    { label: 'MacBox', path: '/data', icon: Folder },
    { label: 'Docker', path: '/data/appdata', icon: Code },
  ];

  // The VM root is a browse-only view. Mutating operations continue to be
  // anchored to the MacBox data disk by the backend safe-mutation layer.
  const isVMSystemPath = currentPath !== '/data' && !currentPath.startsWith('/data/');

  const favoriteShortcuts: TerminalShortcut[] = favoritePaths.map((path) => ({
    label: path.split('/').filter(Boolean).pop() || path,
    path,
    icon: Star,
  }));

  const aiCommands = [
    {
      label: 'Codex',
      title: '在当前终端启动 Codex YOLO 模式',
      command: 'codex --yolo',
    },
  ];

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
      window.localStorage.setItem('macbox_terminal_favorite_paths', JSON.stringify(favoritePaths));
    } catch {
      // 收藏仅作为快捷入口，浏览器无法写入时不影响文件管理功能。
    }
  }, [favoritePaths]);

  useEffect(() => {
    try {
      window.localStorage.setItem('macbox_terminal_show_hidden', String(showHiddenFiles));
    } catch {
      // 隐藏文件显示偏好无法保存时，不影响当前页面的切换。
    }
  }, [showHiddenFiles]);

  useTerminalLayout({ terminalRef, fitAddonRef, wsRef, layoutKey: `${showSidebar}:${fullscreen}` });

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
    if (window.matchMedia('(max-width: 1023px)').matches) {
      setShowSidebar(false);
    }
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
      setAlertMsg({ type: 'error', text: 'VM 系统目录仅支持浏览，请切换到 MacBox 数据根目录后操作' });
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
      setAlertMsg({ type: 'error', text: 'VM 系统目录仅支持浏览，请切换到 MacBox 数据根目录后上传' });
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
    <div className={`terminal-page flex h-full min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden ${fullscreen ? 'fixed inset-0 z-[70] bg-[#090d16] p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))]' : 'w-full'}`}>
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

      {/* File system is loaded and shown only when requested. */}
      <div className={`flex min-h-0 flex-1 flex-col gap-4 overflow-hidden ${showSidebar ? 'lg:flex-row' : ''}`}>
        {/* Mobile: file system replaces the terminal. Desktop: file system remains a left sidebar. */}
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
            onClose={() => setShowSidebar(false)}
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
        <div className={`terminal-dark-preserve order-2 h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-slate-800/80 bg-[#090d16] ${showSidebar ? 'hidden lg:flex lg:w-auto lg:flex-1' : 'flex flex-1'}`}>
          <TerminalToolbar
            showSidebar={showSidebar}
            connected={connected}
            sessionClosed={sessionClosed}
            sessionId={sessionId}
            loginUser={loginUser}
            fullscreen={fullscreen}
            commands={aiCommands}
            onToggleSidebar={() => {
              const next = !showSidebar;
              setShowSidebar(next);
              if (next && files.length === 0) void loadFiles(currentPath);
            }}
            onReconnect={handleReconnect}
            onCloseSession={handleCloseSession}
            onSwitchUser={() => handleSwitchUser(loginUser === 'root' ? 'default' : 'root')}
            onSendCommand={(command) => sendToTerminal(`${command}\n`)}
            onClear={() => xtermInstance.current?.clear()}
            onToggleFullscreen={() => setFullscreen((current) => !current)}
          />

          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <TerminalViewport terminalRef={terminalRef} />
          </div>

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
