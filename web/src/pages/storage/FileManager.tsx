import React, { useState, useEffect, useRef } from 'react';
import {
  Folder, Film, Image, Download, FileText, Zap, Upload, AlertTriangle, X
} from 'lucide-react';
import { FileItem, LocalMount, TrashItem } from '../../types';
import { api } from '../../api';
import { CategoryItem, ClipboardState, TextPreviewState, getFileType } from './filemanager/types';
import { FileSidebar } from './filemanager/FileSidebar';
import { FileToolbar } from './filemanager/FileToolbar';
import { FileGridView } from './filemanager/FileGridView';
import { FileListView } from './filemanager/FileListView';
import { TrashView } from './filemanager/TrashView';
import { BatchActionBar } from './filemanager/BatchActionBar';
import { FilePreviewModal } from './filemanager/FilePreviewModal';
import { FileModals } from './filemanager/FileModals';

interface FileManagerProps {
  initialPath?: string;
}

export const FileManager: React.FC<FileManagerProps> = ({ initialPath = '/data' }) => {
  // Navigation State
  const [currentPath, setCurrentPath] = useState<string>(initialPath);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'mtime'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Multi-Selection State
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  // Clipboard State (Copy / Cut)
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);

  // Favorites State (Stored in localStorage)
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('macnas_file_favorites');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Trash View State
  const [viewingTrash, setViewingTrash] = useState<boolean>(false);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [trashLoading, setTrashLoading] = useState<boolean>(false);

  // Security: Hide system / container metadata folders by default (Benchmark fnOS)
  const [hideSystemFiles, setHideSystemFiles] = useState<boolean>(true);

  // Notifications
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);

  // Modals: CRUD
  const [showMkdirModal, setShowMkdirModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameItem, setRenameItem] = useState<FileItem | null>(null);
  const [renameNewName, setRenameNewName] = useState('');

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FileItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Trash Modals & Multi-select
  const [trashSelectedIds, setTrashSelectedIds] = useState<Set<string>>(new Set());
  const [showTrashDeleteModal, setShowTrashDeleteModal] = useState(false);
  const [trashDeleteTarget, setTrashDeleteTarget] = useState<TrashItem | null>(null);
  const [deletingTrash, setDeletingTrash] = useState(false);
  const [showEmptyTrashModal, setShowEmptyTrashModal] = useState(false);

  // Upload State
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Preview Modals
  const [videoPreview, setVideoPreview] = useState<FileItem | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoMuted, setVideoMuted] = useState(false);
  const [videoVolume, setVideoVolume] = useState(1.0);
  const [imagePreview, setImagePreview] = useState<FileItem | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imageRotate, setImageRotate] = useState(0);

  const [audioPreview, setAudioPreview] = useState<FileItem | null>(null);

  const [textPreview, setTextPreview] = useState<TextPreviewState | null>(null);
  const [savingText, setSavingText] = useState(false);

  // Categories (fnOS Style)
  const categories: CategoryItem[] = [
    { name: '全部存储 (空间1)', path: '/data', icon: Folder, color: 'text-sky-400' },
    { name: '影视媒体', path: '/data/media', icon: Film, color: 'text-violet-400' },
    { name: '离线下载', path: '/data/downloads', icon: Download, color: 'text-amber-400' },
    { name: '照片图库', path: '/data/photos', icon: Image, color: 'text-emerald-400' },
    { name: '个人文档', path: '/data/files', icon: FileText, color: 'text-blue-400' },
    { name: '存储空间 2 (高速固态)', path: '/data/volume2-ssd', icon: Zap, color: 'text-amber-400' },
    { name: 'Mac 直通空间', path: '/mnt/macnas-mounts', icon: Folder, color: 'text-cyan-400' },
  ];

  const [localMounts, setLocalMounts] = useState<LocalMount[]>([]);

  const loadFiles = async (targetPath: string) => {
    setLoading(true);
    try {
      const res = await api.listFiles(targetPath);
      setFiles(res.items || []);
      setCurrentPath(res.path);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `读取文件夹失败: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFiles(currentPath);
    setSelectedPaths(new Set());
  }, [currentPath]);

  useEffect(() => {
    api.getLocalMounts()
      .then((res) => setLocalMounts(res.mounts || []))
      .catch(() => setLocalMounts([]));
    loadTrash();
  }, []);

  useEffect(() => {
    if (videoPreview && videoRef.current) {
      videoRef.current.volume = 1.0;
      videoRef.current.muted = false;
      setVideoVolume(1.0);
      setVideoMuted(false);
      videoRef.current.play().catch(() => {});
    }
  }, [videoPreview]);

  // Breadcrumb path parts
  const pathParts = currentPath.split('/').filter(Boolean);

  const navigateToPart = (index: number) => {
    const newPath = '/' + pathParts.slice(0, index + 1).join('/');
    setCurrentPath(newPath);
  };

  const handleGoUp = () => {
    if (currentPath === '/' || currentPath === '/data') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const parentPath = '/' + parts.join('/');
    setCurrentPath(parentPath || '/');
  };

  // System folder filter logic
  const isSystemProtected = (name: string) => {
    if (name.startsWith('.')) return true;
    if (name === 'lost+found') return true;
    if (name === 'appdata' && (currentPath === '/data' || currentPath === '/')) return true;
    return false;
  };

  // Filtered & Sorted files
  const filteredFiles = files.filter((item) => {
    if (hideSystemFiles && isSystemProtected(item.name)) {
      return false;
    }
    if (searchQuery.trim()) {
      return item.name.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  }).sort((a, b) => {
    // Folders always come first
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;

    let compare = 0;
    if (sortBy === 'name') {
      compare = a.name.localeCompare(b.name);
    } else if (sortBy === 'size') {
      compare = a.size - b.size;
    } else if (sortBy === 'mtime') {
      compare = a.mtime - b.mtime;
    }
    return sortOrder === 'asc' ? compare : -compare;
  });

  // Open / Preview Item
  const handleItemClick = async (item: FileItem) => {
    if (item.isDir) {
      setCurrentPath(item.path);
      return;
    }

    const type = getFileType(item.ext);
    if (type === 'video') {
      setVideoPreview(item);
    } else if (type === 'image') {
      setImageZoom(1);
      setImageRotate(0);
      setImagePreview(item);
    } else if (type === 'audio') {
      setAudioPreview(item);
    } else if (type === 'text') {
      try {
        const res = await api.readFile(item.path);
        setTextPreview({ item, content: res.content || '' });
      } catch (err: any) {
        setAlertMsg({ type: 'error', text: `读取文本失败: ${err.message}` });
      }
    } else {
      // Direct Download for other types
      window.open(api.getFileDownloadUrl(item.path), '_blank');
    }
  };

  // Create Folder
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      const targetDir = currentPath === '/' ? `/${newFolderName.trim()}` : `${currentPath}/${newFolderName.trim()}`;
      await api.createFolder(targetDir);
      setShowMkdirModal(false);
      setNewFolderName('');
      setAlertMsg({ type: 'success', text: '文件夹创建成功' });
      loadFiles(currentPath);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `创建文件夹失败: ${err.message}` });
    }
  };

  // Rename
  const handleOpenRename = (item: FileItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameItem(item);
    setRenameNewName(item.name);
    setShowRenameModal(true);
  };

  const handleRenameConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameItem || !renameNewName.trim() || renameNewName === renameItem.name) {
      setShowRenameModal(false);
      return;
    }
    const parentDir = currentPath;
    const newPath = parentDir === '/' ? `/${renameNewName.trim()}` : `${parentDir}/${renameNewName.trim()}`;
    try {
      await api.renameFile(renameItem.path, newPath);
      setShowRenameModal(false);
      setRenameItem(null);
      setAlertMsg({ type: 'success', text: '重命名成功' });
      loadFiles(currentPath);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `重命名失败: ${err.message}` });
    }
  };

  // Multi-Selection
  const toggleSelectItem = (path: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedPaths.size === filteredFiles.length && filteredFiles.length > 0) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(filteredFiles.map((f) => f.path)));
    }
  };

  // Clipboard (Copy / Cut / Paste)
  const handleCopy = (paths: string[], e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (paths.length === 0) return;
    setClipboard({ action: 'copy', items: paths });
    setSelectedPaths(new Set());
    setAlertMsg({ type: 'success', text: `已复制 ${paths.length} 个项目到剪贴板，请前往目标文件夹点击粘贴` });
  };

  const handleCut = (paths: string[], e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (paths.length === 0) return;
    setClipboard({ action: 'cut', items: paths });
    setSelectedPaths(new Set());
    setAlertMsg({ type: 'success', text: `已剪切 ${paths.length} 个项目到剪贴板，请前往目标文件夹点击粘贴` });
  };

  const handlePaste = async () => {
    if (!clipboard || clipboard.items.length === 0) return;
    try {
      if (clipboard.action === 'copy') {
        const res = await api.copyFiles(clipboard.items, currentPath);
        setAlertMsg({ type: 'success', text: res.message });
      } else {
        const res = await api.moveFiles(clipboard.items, currentPath);
        setAlertMsg({ type: 'success', text: res.message });
      }
      setClipboard(null);
      loadFiles(currentPath);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `粘贴失败: ${err.message}` });
    }
  };

  // Favorites
  const toggleFavorite = (path: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setFavorites((prev) => {
      const next = prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path];
      try {
        localStorage.setItem('macnas_file_favorites', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // Trash Handlers
  const loadTrash = async () => {
    setTrashLoading(true);
    try {
      const res = await api.listTrash();
      setTrashItems(res.items || []);
    } catch {
      // ignore
    } finally {
      setTrashLoading(false);
    }
  };

  // Delete / Trash Modals
  const handleOpenDelete = (item: FileItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTarget(item);
    setShowDeleteModal(true);
  };

  const handleMoveToTrashConfirm = async () => {
    const targets = deleteTarget ? [deleteTarget.path] : Array.from(selectedPaths);
    if (targets.length === 0) return;
    setDeleting(true);
    try {
      const res = await api.moveToTrash(targets);
      setShowDeleteModal(false);
      setDeleteTarget(null);
      setSelectedPaths(new Set());
      setAlertMsg({ type: 'success', text: res.message });
      loadFiles(currentPath);
      loadTrash();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `移入回收站失败: ${err.message}` });
    } finally {
      setDeleting(false);
    }
  };

  const handlePermanentDeleteConfirm = async () => {
    const targets = deleteTarget ? [deleteTarget.path] : Array.from(selectedPaths);
    if (targets.length === 0) return;
    setDeleting(true);
    try {
      for (const p of targets) {
        await api.deleteFile(p);
      }
      setShowDeleteModal(false);
      setDeleteTarget(null);
      setSelectedPaths(new Set());
      setAlertMsg({ type: 'success', text: `已彻底删除 ${targets.length} 个项目` });
      loadFiles(currentPath);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `删除失败: ${err.message}` });
    } finally {
      setDeleting(false);
    }
  };

  const handleRestoreTrash = async (ids: string[]) => {
    try {
      const res = await api.restoreTrash(ids);
      setAlertMsg({ type: 'success', text: res.message });
      loadTrash();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `还原失败: ${err.message}` });
    }
  };

  const handlePromptDeleteTrash = (it?: TrashItem) => {
    if (it) {
      setTrashDeleteTarget(it);
    } else {
      setTrashDeleteTarget(null);
    }
    setShowTrashDeleteModal(true);
  };

  const handleConfirmDeleteTrash = async () => {
    const ids = trashDeleteTarget ? [trashDeleteTarget.id] : Array.from(trashSelectedIds);
    if (ids.length === 0) return;
    setDeletingTrash(true);
    try {
      const res = await api.deleteTrashItems(ids);
      setAlertMsg({ type: 'success', text: res.message });
      setShowTrashDeleteModal(false);
      setTrashDeleteTarget(null);
      setTrashSelectedIds(new Set());
      loadTrash();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `从回收站删除失败: ${err.message}` });
    } finally {
      setDeletingTrash(false);
    }
  };

  const handleConfirmEmptyTrash = async () => {
    setDeletingTrash(true);
    try {
      const res = await api.emptyTrash();
      setAlertMsg({ type: 'success', text: res.message });
      setShowEmptyTrashModal(false);
      setTrashSelectedIds(new Set());
      loadTrash();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `清空回收站失败: ${err.message}` });
    } finally {
      setDeletingTrash(false);
    }
  };

  // Save Text
  const handleSaveText = async () => {
    if (!textPreview) return;
    setSavingText(true);
    try {
      await api.writeFile(textPreview.item.path, textPreview.content);
      setAlertMsg({ type: 'success', text: '文件保存成功' });
      setTextPreview(null);
      loadFiles(currentPath);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `保存失败: ${err.message}` });
    } finally {
      setSavingText(false);
    }
  };

  // Upload Files
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadList = e.target.files;
    if (!uploadList || uploadList.length === 0) return;
    await doUploadFiles(Array.from(uploadList));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const doUploadFiles = async (fileArray: File[]) => {
    setUploading(true);
    let successCount = 0;
    try {
      for (let i = 0; i < fileArray.length; i++) {
        const f = fileArray[i];
        setUploadProgress(`正在上传 (${i + 1}/${fileArray.length}): ${f.name}`);
        await api.uploadFile(f, currentPath);
        successCount++;
      }
      setAlertMsg({ type: 'success', text: `成功上传 ${successCount} 个文件` });
      loadFiles(currentPath);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `上传过程中断: ${err.message}` });
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  };

  // Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await doUploadFiles(Array.from(e.dataTransfer.files));
    }
  };

  return (
    <div
      className="flex flex-col lg:flex-row gap-6 min-h-[680px]"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Dragging Overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-50 bg-sky-500/20 backdrop-blur-sm border-4 border-dashed border-sky-400 flex flex-col items-center justify-center pointer-events-none">
          <Upload className="w-16 h-16 text-sky-400 animate-bounce mb-3" />
          <p className="text-xl font-bold text-white">松开鼠标将文件上传到当前目录</p>
          <p className="text-sm text-sky-200 mt-1 font-mono">{currentPath}</p>
        </div>
      )}

      {/* Left Sidebar: Categories & Storage Info */}
      <FileSidebar
        categories={categories}
        currentPath={currentPath}
        viewingTrash={viewingTrash}
        trashCount={trashItems.length}
        favorites={favorites}
        localMounts={localMounts}
        hideSystemFiles={hideSystemFiles}
        onSelectCategory={(path) => {
          setViewingTrash(false);
          setCurrentPath(path);
        }}
        onOpenTrash={() => {
          setViewingTrash(true);
          loadTrash();
        }}
        onSelectFavorite={(path) => {
          setViewingTrash(false);
          setCurrentPath(path);
        }}
        onToggleFavorite={toggleFavorite}
        onSelectMount={(path) => {
          setViewingTrash(false);
          setCurrentPath(path);
        }}
        onToggleHideSystemFiles={() => setHideSystemFiles(!hideSystemFiles)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col space-y-4">
        {/* Alert Banner */}
        {alertMsg && (
          <div className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
            alertMsg.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : alertMsg.type === 'warning'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}>
            <span>{alertMsg.text}</span>
            <button onClick={() => setAlertMsg(null)} className="p-1 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {!hideSystemFiles && (
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>您已开启系统保护目录显示。请注意：<strong className="underline">appdata</strong> 包含各 Docker 容器的 SQLite 数据库与持久化卷，误删可能导致容器损坏！</span>
          </div>
        )}

        {/* Action Toolbar */}
        <FileToolbar
          currentPath={currentPath}
          pathParts={pathParts}
          searchQuery={searchQuery}
          sortBy={sortBy}
          sortOrder={sortOrder}
          viewMode={viewMode}
          loading={loading}
          uploading={uploading}
          uploadProgress={uploadProgress}
          clipboard={clipboard}
          fileInputRef={fileInputRef}
          onNavigateToPart={navigateToPart}
          onGoUp={handleGoUp}
          onGoHome={() => setCurrentPath('/data')}
          onSearchChange={setSearchQuery}
          onSortChange={(by, order) => {
            setSortBy(by);
            setSortOrder(order);
          }}
          onViewModeChange={setViewMode}
          onOpenMkdir={() => setShowMkdirModal(true)}
          onFileChange={handleFileChange}
          onRefresh={() => loadFiles(currentPath)}
          onPaste={handlePaste}
          onClearClipboard={() => setClipboard(null)}
        />

        {/* File View Container */}
        <div className="flex-1 p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 min-h-[480px]">
          {viewingTrash ? (
            <TrashView
              trashItems={trashItems}
              trashLoading={trashLoading}
              trashSelectedIds={trashSelectedIds}
              onRefreshTrash={loadTrash}
              onOpenEmptyTrash={() => setShowEmptyTrashModal(true)}
              onToggleSelectAll={() => {
                if (trashSelectedIds.size === trashItems.length) {
                  setTrashSelectedIds(new Set());
                } else {
                  setTrashSelectedIds(new Set(trashItems.map((x) => x.id)));
                }
              }}
              onToggleSelect={(id) => {
                const next = new Set(trashSelectedIds);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                setTrashSelectedIds(next);
              }}
              onPromptDeleteTrash={handlePromptDeleteTrash}
              onRestoreTrash={handleRestoreTrash}
              onClearSelection={() => setTrashSelectedIds(new Set())}
            />
          ) : loading ? (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400 space-y-3">
              <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs">加载文件列表中...</p>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400 space-y-4">
              <div className="p-4 rounded-2xl bg-slate-800/50 text-slate-500">
                <Folder className="w-12 h-12 stroke-[1.5]" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-300">当前目录为空</p>
                <p className="text-xs text-slate-500 mt-1">您可以点击上方上传文件或新建文件夹，也可直接把文件拖拽到此窗口</p>
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition"
              >
                立即上传文件
              </button>
            </div>
          ) : viewMode === 'grid' ? (
            <FileGridView
              files={filteredFiles}
              selectedPaths={selectedPaths}
              favorites={favorites}
              onItemClick={handleItemClick}
              onToggleSelect={toggleSelectItem}
              onToggleFavorite={toggleFavorite}
              onCopy={handleCopy}
              onCut={handleCut}
              onOpenRename={handleOpenRename}
              onOpenDelete={handleOpenDelete}
            />
          ) : (
            <FileListView
              files={filteredFiles}
              selectedPaths={selectedPaths}
              favorites={favorites}
              onSelectAll={handleSelectAll}
              onItemClick={handleItemClick}
              onToggleSelect={toggleSelectItem}
              onToggleFavorite={toggleFavorite}
              onCopy={handleCopy}
              onCut={handleCut}
              onOpenRename={handleOpenRename}
              onOpenDelete={handleOpenDelete}
            />
          )}
        </div>

        {/* Floating Multi-Selection Action Bar */}
        <BatchActionBar
          selectedCount={!viewingTrash ? selectedPaths.size : 0}
          onCopy={() => handleCopy(Array.from(selectedPaths))}
          onCut={() => handleCut(Array.from(selectedPaths))}
          onDelete={() => {
            setDeleteTarget(null);
            setShowDeleteModal(true);
          }}
          onClearSelection={() => setSelectedPaths(new Set())}
        />
      </div>

      {/* Preview Modals */}
      <FilePreviewModal
        videoPreview={videoPreview}
        videoRef={videoRef}
        videoMuted={videoMuted}
        videoVolume={videoVolume}
        onCloseVideo={() => setVideoPreview(null)}
        onToggleMute={() => {
          if (videoRef.current) {
            const next = !videoMuted;
            videoRef.current.muted = next;
            setVideoMuted(next);
            if (!next) videoRef.current.volume = 1.0;
          }
        }}
        onVolumeChange={(e) => {
          const el = e.target as HTMLVideoElement;
          setVideoVolume(el.volume);
          setVideoMuted(el.muted);
        }}
        imagePreview={imagePreview}
        imageZoom={imageZoom}
        imageRotate={imageRotate}
        onCloseImage={() => setImagePreview(null)}
        onZoomIn={() => setImageZoom((prev) => Math.min(3, prev + 0.25))}
        onZoomOut={() => setImageZoom((prev) => Math.max(0.5, prev - 0.25))}
        onRotate={() => setImageRotate((prev) => (prev + 90) % 360)}
        audioPreview={audioPreview}
        onCloseAudio={() => setAudioPreview(null)}
        textPreview={textPreview}
        savingText={savingText}
        onCloseText={() => setTextPreview(null)}
        onTextContentChange={(content) => {
          if (textPreview) {
            setTextPreview({ ...textPreview, content });
          }
        }}
        onSaveText={handleSaveText}
      />

      {/* Operation Modals */}
      <FileModals
        showMkdirModal={showMkdirModal}
        newFolderName={newFolderName}
        onCloseMkdir={() => setShowMkdirModal(false)}
        onNewFolderNameChange={setNewFolderName}
        onCreateFolder={handleCreateFolder}
        showRenameModal={showRenameModal}
        renameItem={renameItem}
        renameNewName={renameNewName}
        onCloseRename={() => setShowRenameModal(false)}
        onRenameNewNameChange={setRenameNewName}
        onRenameConfirm={handleRenameConfirm}
        showDeleteModal={showDeleteModal}
        deleteTarget={deleteTarget}
        selectedCount={selectedPaths.size}
        deleting={deleting}
        onCloseDelete={() => setShowDeleteModal(false)}
        onPermanentDelete={handlePermanentDeleteConfirm}
        onMoveToTrash={handleMoveToTrashConfirm}
        showTrashDeleteModal={showTrashDeleteModal}
        trashDeleteTarget={trashDeleteTarget}
        trashSelectedCount={trashSelectedIds.size}
        deletingTrash={deletingTrash}
        onCloseTrashDelete={() => {
          setShowTrashDeleteModal(false);
          setTrashDeleteTarget(null);
        }}
        onConfirmDeleteTrash={handleConfirmDeleteTrash}
        showEmptyTrashModal={showEmptyTrashModal}
        trashItemsCount={trashItems.length}
        onCloseEmptyTrash={() => setShowEmptyTrashModal(false)}
        onConfirmEmptyTrash={handleConfirmEmptyTrash}
      />
    </div>
  );
};
