import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Folder, HardDrive, MoreHorizontal, Pencil, ShieldCheck, Star, Trash2, Upload, AlertTriangle, X } from 'lucide-react';
import { DiskInfo, FileItem, LocalMount, TrashItem } from '../../types';
import { api } from '../../api';
import { ClipboardState, TextPreviewState, getFileType } from './filemanager/types';
import { FileToolbar } from './filemanager/FileToolbar';
import { FileGridView } from './filemanager/FileGridView';
import { FileListView } from './filemanager/FileListView';
import { TrashView } from './filemanager/TrashView';
import { BatchActionBar } from './filemanager/BatchActionBar';
import { FilePreviewModal } from './filemanager/FilePreviewModal';
import { FileModals } from './filemanager/FileModals';
import { FileActionSheet } from './filemanager/FileActionSheet';

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
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches ? 'list' : 'grid'
  );

  // Multi-Selection State
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [actionItem, setActionItem] = useState<FileItem | null>(null);

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
  const [viewingFavorites, setViewingFavorites] = useState(false);
  const [favoriteItems, setFavoriteItems] = useState<FileItem[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(false);

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

  const [localMounts, setLocalMounts] = useState<LocalMount[]>([]);
  const [storageDisks, setStorageDisks] = useState<DiskInfo[]>([]);
  const [discoveredDrivePaths, setDiscoveredDrivePaths] = useState<string[]>([]);
  const [diskNames, setDiskNames] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('macnas_disk_display_names') || '{}');
    } catch {
      return {};
    }
  });

  const loadFiles = async (targetPath: string) => {
    setLoading(true);
    try {
      const res = await api.listFiles(targetPath);
      setFiles(res.items || []);
      setCurrentPath(res.path);
      if (res.path === '/data') {
        const discovered = (res.items || [])
          .filter((item) => item.isDir && /^(volume|disk|storage)[-_ ]?\d/i.test(item.name))
          .map((item) => item.path);
        if (discovered.length > 0) setDiscoveredDrivePaths(discovered);
      }
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `读取文件夹失败: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFiles(currentPath);
    setSelectedPaths(new Set());
    setSelectionMode(false);
    setActionItem(null);
  }, [currentPath]);

  useEffect(() => {
    Promise.all([
      api.getLocalMounts().catch(() => ({ mounts: [], recommended: [] })),
      api.getDisks().catch(() => ({ disks: [], managedDisks: [], selectedDisk: '' })),
    ]).then(([mountsResult, disksResult]) => {
      setLocalMounts(mountsResult.mounts || []);
      setStorageDisks(disksResult.disks || []);
    });
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
    if (currentPath === '/data' && discoveredDrivePaths.includes(item.path)) {
      return false;
    }
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
    if (selectionMode) {
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(item.path)) next.delete(item.path);
        else next.add(item.path);
        return next;
      });
      return;
    }

    if (item.isDir) {
      setViewingFavorites(false);
      setViewingTrash(false);
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
  const handleOpenRename = (item: FileItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
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
    setSelectionMode(false);
    setAlertMsg({ type: 'success', text: `已复制 ${paths.length} 个项目到剪贴板，请前往目标文件夹点击粘贴` });
  };

  const handleCopyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setAlertMsg({ type: 'success', text: '路径已复制' });
    } catch {
      setAlertMsg({ type: 'error', text: '复制路径失败，请检查浏览器剪贴板权限' });
    }
  };

  const handleCut = (paths: string[], e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (paths.length === 0) return;
    setClipboard({ action: 'cut', items: paths });
    setSelectedPaths(new Set());
    setSelectionMode(false);
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

  const loadFavoriteItems = async () => {
    setFavoritesLoading(true);
    try {
      const parentPaths = Array.from(new Set(favorites.map((path) => {
        const parts = path.split('/').filter(Boolean);
        parts.pop();
        return `/${parts.join('/')}` || '/';
      })));
      const listings = await Promise.all(parentPaths.map((path) => api.listFiles(path).catch(() => ({ items: [] as FileItem[] }))));
      const itemMap = new Map(listings.flatMap((listing) => listing.items || []).map((item) => [item.path, item]));
      setFavoriteItems(favorites.map((path) => itemMap.get(path)).filter((item): item is FileItem => Boolean(item)));
    } finally {
      setFavoritesLoading(false);
    }
  };

  const openFavorites = () => {
    setViewingTrash(false);
    setSelectionMode(false);
    setSelectedPaths(new Set());
    setViewingFavorites(true);
    loadFavoriteItems();
  };

  useEffect(() => {
    if (viewingFavorites) loadFavoriteItems();
  }, [favorites]);

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
  const handleOpenDelete = (item: FileItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
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
      setSelectionMode(false);
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
      setSelectionMode(false);
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

  const primaryDisk = storageDisks.find((disk) => disk.isSelected);
  const secondaryDisks = storageDisks.filter((disk) => disk.isSecondary && !disk.isSelected);
  const secondaryDiskOptions = secondaryDisks.map((disk) => ({
    id: disk.identifier,
    path: `/data/${disk.secondaryTarget || 'volume2-ssd'}`,
  }));
  const secondaryMountOptions = localMounts
    .filter((mount) => mount.enabled && !mount.guestTarget.includes('/') && (mount.guestTarget.toLowerCase().includes('volume') || mount.name.includes('存储空间') || mount.name.includes('硬盘')))
    .map((mount) => ({ id: `mount-${mount.id}`, path: `/data/${mount.guestTarget}` }))
    .filter((mount) => !secondaryDiskOptions.some((disk) => disk.path === mount.path));
  const discoveredOptions = discoveredDrivePaths
    .map((path) => ({ id: `folder-${path}`, path }))
    .filter((drive) => !secondaryDiskOptions.some((disk) => disk.path === drive.path) && !secondaryMountOptions.some((mount) => mount.path === drive.path));
  const secondaryOptions = [...secondaryDiskOptions, ...secondaryMountOptions, ...discoveredOptions]
    .filter((drive, index, all) => all.findIndex((candidate) => candidate.path === drive.path) === index);
  const driveOptions = [
    {
      id: primaryDisk?.identifier || 'primary',
      defaultName: '硬盘 1',
      path: '/data',
    },
    ...secondaryOptions.map((disk, index) => ({
      id: disk.id,
      defaultName: `硬盘 ${index + 2}`,
      path: disk.path,
    })),
  ];
  const activeDriveId = [...driveOptions]
    .sort((a, b) => b.path.length - a.path.length)
    .find((drive) => currentPath === drive.path || currentPath.startsWith(`${drive.path}/`))?.id;

  const handleRenameDrive = (driveId: string, currentName: string) => {
    const nextName = window.prompt('修改硬盘显示名称', currentName)?.trim();
    if (!nextName) return;
    const updated = { ...diskNames, [driveId]: nextName };
    setDiskNames(updated);
    localStorage.setItem('macnas_disk_display_names', JSON.stringify(updated));
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-2.5 overflow-hidden"
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

      <section className={`${selectionMode ? 'hidden' : 'flex'} relative shrink-0 items-stretch gap-2 rounded-[22px] border border-slate-200/80 bg-white p-2 dark:border-slate-800 dark:bg-slate-900/80`}>
        <div className="mobile-chip-row flex min-w-0 flex-1 gap-2 overflow-x-auto">
          {driveOptions.map((drive) => {
            const name = diskNames[drive.id] || drive.defaultName;
            const active = !viewingTrash && !viewingFavorites && activeDriveId === drive.id;
            return (
              <div key={drive.id} className={`flex min-w-[128px] shrink-0 items-center rounded-2xl border px-2 transition sm:min-w-[150px] ${active ? 'border-sky-200 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/15' : 'border-transparent bg-slate-50 dark:bg-slate-800/50'}`}>
                <button type="button" onClick={() => { setViewingTrash(false); setViewingFavorites(false); setCurrentPath(drive.path); }} className="flex min-h-12 min-w-0 flex-1 items-center gap-2 text-left">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${active ? 'bg-white text-sky-500 dark:bg-slate-800' : 'bg-white text-slate-400 dark:bg-slate-800'}`}><HardDrive className="h-4 w-4" /></span>
                  <span className={`truncate text-xs font-bold ${active ? 'text-sky-700 dark:text-sky-300' : 'text-slate-700 dark:text-slate-200'}`}>{name}</span>
                </button>
                <button type="button" onClick={() => handleRenameDrive(drive.id, name)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-sky-500 dark:hover:bg-slate-800" aria-label={`重命名${name}`}><Pencil className="h-3.5 w-3.5" /></button>
              </div>
            );
          })}
        </div>

        <details className="group relative shrink-0">
          <summary className="flex h-full min-h-12 w-12 cursor-pointer list-none flex-col items-center justify-center rounded-2xl bg-slate-50 text-[9px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-300"><MoreHorizontal className="h-5 w-5" /><span className="mt-0.5">更多</span></summary>
          <div className="absolute right-0 top-[calc(100%+8px)] z-40 max-h-[min(360px,55dvh)] w-[min(300px,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <button type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); openFavorites(); }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-xs text-slate-700 hover:bg-amber-50 hover:text-amber-700 dark:text-slate-200 dark:hover:bg-amber-500/10"><Star className="h-4 w-4 fill-amber-400 text-amber-400" /><span className="flex-1">收藏</span><span className="text-[10px] text-slate-400">{favorites.length}</span></button>
            <button type="button" onClick={() => { setViewingFavorites(false); setViewingTrash(true); loadTrash(); }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-xs text-slate-700 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-200 dark:hover:bg-rose-500/10"><Trash2 className="h-4 w-4 text-rose-500" /><span className="flex-1">回收站</span><span className="text-[10px] text-slate-400">{trashItems.length}</span></button>
            {localMounts.filter((mount) => mount.enabled && !secondaryOptions.some((drive) => drive.path === `/data/${mount.guestTarget}`)).map((mount) => <button key={mount.id} type="button" onClick={() => { setViewingTrash(false); setViewingFavorites(false); setCurrentPath(`/data/${mount.guestTarget}`); }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"><HardDrive className="h-4 w-4 text-cyan-500" /><span className="truncate">{mount.name}</span></button>)}
            <button type="button" onClick={() => setHideSystemFiles(!hideSystemFiles)} className="mt-1 flex min-h-11 w-full items-center gap-3 border-t border-slate-100 px-3 pt-1 text-left text-xs text-slate-700 dark:border-slate-800 dark:text-slate-200"><ShieldCheck className={`h-4 w-4 ${hideSystemFiles ? 'text-emerald-500' : 'text-amber-500'}`} /><span className="flex-1">系统目录</span><span className="text-[10px] text-slate-400">{hideSystemFiles ? '隐藏' : '显示'}</span></button>
          </div>
        </details>
      </section>

      {/* Main Content Area */}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5">
        {/* Alert Banner */}
        {alertMsg && (
          <div className={`fixed left-1/2 top-20 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center justify-between gap-3 rounded-full border bg-white/95 px-4 py-2.5 text-xs shadow-xl backdrop-blur dark:bg-slate-900/95 ${
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
          <div className="fixed left-1/2 top-20 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-amber-300 bg-white/95 px-4 py-2.5 text-xs text-amber-700 shadow-xl backdrop-blur dark:bg-slate-900/95 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>您已开启系统保护目录显示。请注意：<strong className="underline">appdata</strong> 包含各 Docker 容器的 SQLite 数据库与持久化卷，误删可能导致容器损坏！</span>
          </div>
        )}

        {/* Action Toolbar */}
        {viewingFavorites ? (
          <section className="flex min-h-14 shrink-0 items-center gap-3 rounded-[22px] border border-slate-200/80 bg-white px-3 dark:border-slate-800 dark:bg-slate-900/80">
            <button type="button" onClick={() => setViewingFavorites(false)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" aria-label="返回文件列表"><ArrowLeft className="h-4 w-4" /></button>
            <Star className="h-5 w-5 shrink-0 fill-amber-400 text-amber-400" />
            <div className="min-w-0 flex-1"><h2 className="text-sm font-bold text-slate-900 dark:text-white">收藏</h2><p className="text-[11px] text-slate-400">{favoriteItems.length} 个文件与文件夹</p></div>
          </section>
        ) : <FileToolbar
          currentPath={currentPath}
          searchQuery={searchQuery}
          sortBy={sortBy}
          sortOrder={sortOrder}
          viewMode={viewMode}
          selectionMode={selectionMode}
          selectedCount={selectedPaths.size}
          totalCount={filteredFiles.length}
          loading={loading}
          uploading={uploading}
          uploadProgress={uploadProgress}
          clipboard={clipboard}
          fileInputRef={fileInputRef}
          onGoUp={handleGoUp}
          onSearchChange={setSearchQuery}
          onSortChange={(by, order) => {
            setSortBy(by);
            setSortOrder(order);
          }}
          onViewModeChange={setViewMode}
          onToggleSelectionMode={() => {
            setSelectionMode((active) => !active);
            setSelectedPaths(new Set());
          }}
          onSelectAll={handleSelectAll}
          onOpenMkdir={() => setShowMkdirModal(true)}
          onFileChange={handleFileChange}
          onRefresh={() => loadFiles(currentPath)}
          onPaste={handlePaste}
          onClearClipboard={() => setClipboard(null)}
        />}

        {/* File View Container */}
        <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain rounded-[22px] border border-slate-200/80 bg-white p-3 [-webkit-overflow-scrolling:touch] [contain:strict] dark:border-slate-800/80 dark:bg-slate-900/60 sm:p-4">
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
          ) : viewingFavorites ? (
            favoritesLoading ? (
              <div className="flex flex-col items-center justify-center space-y-3 py-24 text-slate-400"><div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" /><p className="text-xs">正在读取收藏…</p></div>
            ) : favoriteItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center space-y-3 py-24 text-center text-slate-400"><Star className="h-12 w-12" /><p className="text-sm font-semibold text-slate-700 dark:text-slate-300">还没有收藏</p><p className="text-xs">在文件或文件夹的三点菜单中添加收藏</p></div>
            ) : viewMode === 'grid' ? (
              <FileGridView files={favoriteItems} selectionMode={false} selectedPaths={selectedPaths} onItemClick={handleItemClick} onToggleSelect={toggleSelectItem} onOpenActions={(item, event) => { event.stopPropagation(); setActionItem(item); }} />
            ) : (
              <FileListView files={favoriteItems} selectionMode={false} selectedPaths={selectedPaths} onItemClick={handleItemClick} onToggleSelect={toggleSelectItem} onOpenActions={(item, event) => { event.stopPropagation(); setActionItem(item); }} />
            )
          ) : loading ? (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400 space-y-3">
              <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs">加载文件列表中...</p>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400 space-y-4">
              <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500">
                <Folder className="w-12 h-12 stroke-[1.5]" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">当前目录为空</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">可点击上方上传或新建文件夹</p>
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold shadow-md shadow-sky-500/20 transition"
              >
                立即上传文件
              </button>
            </div>
          ) : viewMode === 'grid' ? (
            <FileGridView
              files={filteredFiles}
              selectionMode={selectionMode}
              selectedPaths={selectedPaths}
              onItemClick={handleItemClick}
              onToggleSelect={toggleSelectItem}
              onOpenActions={(item, event) => {
                event.stopPropagation();
                setActionItem(item);
              }}
            />
          ) : (
            <FileListView
              files={filteredFiles}
              selectionMode={selectionMode}
              selectedPaths={selectedPaths}
              onItemClick={handleItemClick}
              onToggleSelect={toggleSelectItem}
              onOpenActions={(item, event) => {
                event.stopPropagation();
                setActionItem(item);
              }}
            />
          )}
        </div>

        {/* Floating Multi-Selection Action Bar */}
        <BatchActionBar
          visible={selectionMode && !viewingTrash}
          selectedCount={!viewingTrash ? selectedPaths.size : 0}
          onCopy={() => handleCopy(Array.from(selectedPaths))}
          onCut={() => handleCut(Array.from(selectedPaths))}
          onDelete={() => {
            setDeleteTarget(null);
            setShowDeleteModal(true);
          }}
        />
      </div>

      <FileActionSheet
        item={actionItem}
        isFavorite={!!actionItem && favorites.includes(actionItem.path)}
        onClose={() => setActionItem(null)}
        onToggleFavorite={() => {
          if (actionItem) toggleFavorite(actionItem.path);
          setActionItem(null);
        }}
        onCopy={() => {
          if (actionItem) handleCopy([actionItem.path]);
          setActionItem(null);
        }}
        onCopyPath={() => {
          if (actionItem) handleCopyPath(actionItem.path);
          setActionItem(null);
        }}
        onCut={() => {
          if (actionItem) handleCut([actionItem.path]);
          setActionItem(null);
        }}
        onRename={() => {
          if (actionItem) handleOpenRename(actionItem);
          setActionItem(null);
        }}
        onDelete={() => {
          if (actionItem) handleOpenDelete(actionItem);
          setActionItem(null);
        }}
      />

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
