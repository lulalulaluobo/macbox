import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Cloud, Folder, HardDrive, MoreHorizontal, Pencil, ShieldCheck, Star, Trash2, Upload, AlertTriangle, X } from 'lucide-react';
import { CloudMount, DiskInfo, FileItem, LocalMount } from '../../types';
import { api } from '../../api';
import { TextPreviewState, getFileType } from './filemanager/types';
import { FileToolbar } from './filemanager/FileToolbar';
import { FileGridView } from './filemanager/FileGridView';
import { FileListView } from './filemanager/FileListView';
import { TrashView } from './filemanager/TrashView';
import { BatchActionBar } from './filemanager/BatchActionBar';
import { FilePreviewModal } from './filemanager/FilePreviewModal';
import { FileModals } from './filemanager/FileModals';
import { FileActionSheet } from './filemanager/FileActionSheet';
import { DriveDetailModal } from './filemanager/DriveDetailModal';
import type { DriveDetailInfo } from './filemanager/DriveDetailModal';
import { CloudDriveView } from './filemanager/CloudDriveView';
import { CloudMountModal } from './filemanager/CloudMountModal';
import { ArchiveModal } from './filemanager/ArchiveModal';
import { ConflictPolicy, TransferDestinationModal, TransferOperation } from './filemanager/TransferDestinationModal';
import { useFileSelection } from './filemanager/useFileSelection';
import { useFavorites } from './filemanager/useFavorites';
import { useFileNavigation } from './filemanager/useFileNavigation';
import { useFileUpload } from './filemanager/useFileUpload';
import { useTrash } from './filemanager/useTrash';

interface FileManagerProps {
  initialPath?: string;
}

export const FileManager: React.FC<FileManagerProps> = ({ initialPath = '/data' }) => {
  const [actionItem, setActionItem] = useState<FileItem | null>(null);

  // Copy/move destination picker
  const [transferRequest, setTransferRequest] = useState<{ operation: TransferOperation; paths: string[]; initialPath: string } | null>(null);

  const [viewingFavorites, setViewingFavorites] = useState(false);
  const { favorites, favoriteItems, favoritesLoading, toggleFavorite } = useFavorites({ enabled: viewingFavorites });

  // Trash View State
  const [viewingTrash, setViewingTrash] = useState<boolean>(false);

  // Security: Hide system / container metadata folders by default (Benchmark fnOS)
  const [hideSystemFiles, setHideSystemFiles] = useState<boolean>(true);

  // Notifications
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);

  const {
    trashItems,
    trashLoading,
    trashSelectedIds,
    setTrashSelectedIds,
    showTrashDeleteModal,
    setShowTrashDeleteModal,
    trashDeleteTarget,
    setTrashDeleteTarget,
    deletingTrash,
    showEmptyTrashModal,
    setShowEmptyTrashModal,
    loadTrash,
    handleRestoreTrash,
    handlePromptDeleteTrash,
    handleConfirmDeleteTrash,
    handleConfirmEmptyTrash,
  } = useTrash({
    onSuccess: (text) => setAlertMsg({ type: 'success', text }),
    onError: (text) => setAlertMsg({ type: 'error', text }),
  });

  const {
    currentPath,
    setCurrentPath,
    files,
    loading,
    loadingMore,
    hasMoreFiles,
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    viewMode,
    setViewMode,
    discoveredDrivePaths,
    loadFiles,
    handleGoUp,
  } = useFileNavigation({
    initialPath,
    onError: (text) => setAlertMsg({ type: 'error', text }),
  });

  const {
    uploading,
    uploadProgress,
    fileInputRef,
    isDragging,
    handleFileChange,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useFileUpload({
    targetPath: currentPath,
    onSuccess: (text) => setAlertMsg({ type: 'success', text }),
    onError: (text) => setAlertMsg({ type: 'error', text }),
    onReload: () => loadFiles(currentPath),
  });

  // Modals: CRUD
  const [showMkdirModal, setShowMkdirModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameItem, setRenameItem] = useState<FileItem | null>(null);
  const [renameNewName, setRenameNewName] = useState('');

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FileItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [archiveItem, setArchiveItem] = useState<FileItem | null>(null);

  const fileListRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeActiveRef = useRef(false);
  const marqueeJustFinishedRef = useRef(false);
  const draggedPathsRef = useRef<string[]>([]);

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
  const [cloudMounts, setCloudMounts] = useState<CloudMount[]>([]);
  const [activeCloudMountId, setActiveCloudMountId] = useState<string | null>(() => {
    try { return localStorage.getItem('macnas_active_cloud_mount') || null; } catch { return null; }
  });
  const [showCloudMountModal, setShowCloudMountModal] = useState(false);
  const [diskNames, setDiskNames] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('macnas_disk_display_names') || '{}');
    } catch {
      return {};
    }
  });

  useEffect(() => {
    setSelectedPaths(new Set());
    setSelectionMode(false);
    setActionItem(null);
  }, [currentPath]);

  useEffect(() => {
    Promise.all([
      api.getLocalMounts().catch(() => ({ mounts: [], recommended: [] })),
      api.getDisks().catch(() => ({ disks: [], managedDisks: [], selectedDisk: '' })),
      api.getCloudMounts().catch(() => ({ mounts: [] as CloudMount[] })),
    ]).then(([mountsResult, disksResult, cloudResult]) => {
      setLocalMounts(mountsResult.mounts || []);
      setStorageDisks(disksResult.disks || []);
      setCloudMounts(cloudResult.mounts || []);
    });
    loadTrash();
  }, []);

  useEffect(() => {
    try {
      if (activeCloudMountId) localStorage.setItem('macnas_active_cloud_mount', activeCloudMountId);
      else localStorage.removeItem('macnas_active_cloud_mount');
    } catch {}
  }, [activeCloudMountId]);

  useEffect(() => {
    if (videoPreview && videoRef.current) {
      videoRef.current.volume = 1.0;
      videoRef.current.muted = false;
      setVideoVolume(1.0);
      setVideoMuted(false);
      videoRef.current.play().catch(() => {});
    }
  }, [videoPreview]);

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

  const {
    selectedPaths,
    setSelectedPaths,
    selectionMode,
    setSelectionMode,
    toggleSelectItem,
    handleSelectAll,
    handleLongPress,
  } = useFileSelection({ filteredFiles });

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
      // Use a same-page download instead of opening a new tab. This keeps the
      // authenticated response in the browser download flow on mobile.
      const link = document.createElement('a');
      link.href = api.getFileDownloadUrl(item.path);
      link.download = item.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  };

  const handleArchiveConfirm = async (operation: 'compress' | 'extract', format: 'zip', destination: string, conflictPolicy: ConflictPolicy) => {
    if (!archiveItem) return;
    const sourcePath = archiveItem.path;
    const res = await api.archiveFiles([sourcePath], operation, format, destination, conflictPolicy);
    setArchiveItem(null);
    setAlertMsg({ type: 'success', text: res.message });
    loadFiles(currentPath);
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

  // Copy / move destination picker
  const openTransfer = (operation: TransferOperation, paths: string[], initialPath = currentPath, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (paths.length === 0) return;
    setTransferRequest({ operation, paths, initialPath });
  };

  const handleTransferConfirm = async (destination: string, conflictPolicy: ConflictPolicy) => {
    if (!transferRequest) return;
    const result = transferRequest.operation === 'copy'
      ? await api.copyFiles(transferRequest.paths, destination, conflictPolicy)
      : await api.moveFiles(transferRequest.paths, destination, conflictPolicy);
    setTransferRequest(null);
    setSelectedPaths(new Set());
    setSelectionMode(false);
    setAlertMsg({ type: 'success', text: result.message });
    loadFiles(currentPath);
  };

  const handleCopyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setAlertMsg({ type: 'success', text: '路径已复制' });
    } catch {
      setAlertMsg({ type: 'error', text: '复制路径失败，请检查浏览器剪贴板权限' });
    }
  };

  const handleBatchDownload = () => {
    const paths = Array.from(selectedPaths);
    if (paths.length === 0) return;
    const link = document.createElement('a');
    link.href = api.getBatchDownloadUrl(paths);
    link.download = 'MacNAS-批量下载.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const openFavorites = () => {
    setViewingTrash(false);
    setSelectionMode(false);
    setSelectedPaths(new Set());
    setViewingFavorites(true);
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

  const handleItemDragStart = (item: FileItem, event: React.DragEvent<HTMLDivElement>) => {
    const paths = selectedPaths.has(item.path) ? Array.from(selectedPaths) : [item.path];
    draggedPathsRef.current = paths;
    setSelectionMode(true);
    setSelectedPaths(new Set(paths));
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', JSON.stringify(paths));
  };

  const handleItemDragOver = (item: FileItem, event: React.DragEvent<HTMLDivElement>) => {
    if (!item.isDir || draggedPathsRef.current.length === 0) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetPath(item.path);
  };

  const handleItemDrop = (item: FileItem, event: React.DragEvent<HTMLDivElement>) => {
    if (!item.isDir || draggedPathsRef.current.length === 0) return;
    event.preventDefault();
    const paths = draggedPathsRef.current;
    draggedPathsRef.current = [];
    setDropTargetPath(null);
    openTransfer('move', paths, item.path);
  };

  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);

  const finishMarquee = () => {
    if (!marqueeActiveRef.current || !fileListRef.current || !marquee) return;
    const left = Math.min(marquee.startX, marquee.currentX);
    const right = Math.max(marquee.startX, marquee.currentX);
    const top = Math.min(marquee.startY, marquee.currentY);
    const bottom = Math.max(marquee.startY, marquee.currentY);
    const selected = Array.from(fileListRef.current.querySelectorAll<HTMLElement>('[data-file-item]')).filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top;
    }).map((element) => element.dataset.filePath).filter((path): path is string => Boolean(path));
    setSelectionMode(true);
    setSelectedPaths(new Set(selected));
    marqueeJustFinishedRef.current = true;
    marqueeActiveRef.current = false;
    marqueeStartRef.current = null;
    setMarquee(null);
  };

  useEffect(() => {
    if (!marquee) return;
    const handlePointerMove = (event: PointerEvent) => setMarquee((current) => current ? { ...current, currentX: event.clientX, currentY: event.clientY } : current);
    const handlePointerUp = () => finishMarquee();
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => { window.removeEventListener('pointermove', handlePointerMove); window.removeEventListener('pointerup', handlePointerUp); };
  }, [marquee]);

  const handleFileListPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-file-item]') || target.closest('button')) return;
    marqueeActiveRef.current = true;
    marqueeStartRef.current = { x: event.clientX, y: event.clientY };
    setMarquee({ startX: event.clientX, startY: event.clientY, currentX: event.clientX, currentY: event.clientY });
    event.preventDefault();
  };

  const primaryDisk = storageDisks.find((disk) => disk.isSelected);
  const secondaryDisks = storageDisks.filter((disk) => disk.isSecondary && !disk.isSelected);
  // 后端的 secondaryTarget 可能已是绝对路径（/data/...），也可能是 guest 内相对路径，
  // 统一成 VM 内绝对路径，避免出现 /data//data/... 这类非法路径导致去重失效。
  const toGuestPath = (target?: string | null, fallback = 'volume2-ssd') => {
    const t = (target || '').trim() || fallback;
    return t.startsWith('/') ? t : `/data/${t}`;
  };
  const secondaryDiskOptions = secondaryDisks.map((disk) => ({
    id: disk.identifier,
    path: toGuestPath(disk.secondaryTarget),
  }));
  const secondaryMountOptions = localMounts
    .filter((mount) => mount.enabled && mount.category === 'volume2')
    .map((mount) => ({ id: `mount-${mount.id}`, path: `/data/${mount.guestTarget}` }))
    .filter((mount) => !secondaryDiskOptions.some((disk) => disk.path === mount.path));
  const discoveredOptions = discoveredDrivePaths
    .map((path) => ({ id: `folder-${path}`, path }))
    .filter((drive) => !secondaryDiskOptions.some((disk) => disk.path === drive.path) && !secondaryMountOptions.some((mount) => mount.path === drive.path));
  // Ordinary host-folder passthroughs are directories inside the owning NAS
  // volume, not additional disks. Keep only the dedicated secondary volume
  // and discovered storage roots in the drive switcher; the regular mapped
  // folder remains visible at its configured /data path.
  const secondaryOptions = [...secondaryDiskOptions, ...secondaryMountOptions, ...discoveredOptions]
    .filter((drive, index, all) => all.findIndex((candidate) => candidate.path === drive.path) === index);
  const driveOptions = [
    {
      id: primaryDisk?.identifier || 'primary',
      defaultName: '硬盘 1',
      path: '/data',
      detail: {
        kind: '主存储',
        // 不拼接 Mac 侧挂载点：APFS 系统卷挂载点（如 /System/Volumes/*）对用户是噪音
        source: primaryDisk?.name,
        total: primaryDisk?.totalSizeString,
        used: primaryDisk?.usedSpaceString,
        free: primaryDisk?.freeSpaceString,
        usedPercent: primaryDisk?.usedPercent,
        fileSystem: primaryDisk?.fileSystem,
      } as DriveDetailInfo,
    },
    ...secondaryOptions.map((disk, index) => {
      const matchedDisk = secondaryDisks.find((d) => toGuestPath(d.secondaryTarget) === disk.path);
      const matchedMount = localMounts.find((m) => m.enabled && toGuestPath(m.guestTarget) === disk.path);
      return {
        id: disk.id,
        defaultName: matchedMount?.name || `硬盘 ${index + 2}`,
        path: disk.path,
        detail: {
          kind: matchedDisk ? '扩展存储' : matchedMount ? '本机目录直通' : '已发现目录',
          source: matchedDisk?.name ?? matchedMount?.hostPath,
          total: matchedDisk?.totalSizeString,
          used: matchedDisk?.usedSpaceString,
          free: matchedDisk?.freeSpaceString,
          usedPercent: matchedDisk?.usedPercent,
          fileSystem: matchedDisk?.fileSystem,
          writable: matchedMount?.writable,
          description: matchedMount?.description,
        } as DriveDetailInfo,
      };
    }),
  ];
  const activeDriveId = [...driveOptions]
    .sort((a, b) => b.path.length - a.path.length)
    .find((drive) => currentPath === drive.path || currentPath.startsWith(`${drive.path}/`))?.id;
  const activeCloudMount = cloudMounts.find((mount) => mount.id === activeCloudMountId) || null;

  // 硬盘详情弹窗：铅笔按钮展示容量/映射路径等信息，名称可顺带修改
  const [detailDriveId, setDetailDriveId] = useState<string | null>(null);
  const detailDrive = detailDriveId
    ? driveOptions
        .map((drive) => ({ ...drive, name: diskNames[drive.id] || drive.defaultName }))
        .find((drive) => drive.id === detailDriveId) || null
    : null;
  const openDriveDetail = (driveId: string) => {
    setDetailDriveId(driveId);
  };
  const handleSaveDriveName = (driveId: string, nextName: string) => {
    const updated = { ...diskNames, [driveId]: nextName };
    setDiskNames(updated);
    localStorage.setItem('macnas_disk_display_names', JSON.stringify(updated));
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-2.5 overflow-hidden"
      onDragOver={activeCloudMount ? undefined : handleDragOver}
      onDragLeave={activeCloudMount ? undefined : handleDragLeave}
      onDrop={activeCloudMount ? undefined : handleDrop}
    >
      {/* Dragging Overlay */}
      {isDragging && !activeCloudMount && (
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
                <button type="button" onClick={() => { setActiveCloudMountId(null); setViewingTrash(false); setViewingFavorites(false); setCurrentPath(drive.path); }} className="flex min-h-12 min-w-0 flex-1 items-center gap-2 text-left">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${active ? 'bg-white text-sky-500 dark:bg-slate-800' : 'bg-white text-slate-400 dark:bg-slate-800'}`}><HardDrive className="h-4 w-4" /></span>
                  <span className={`truncate text-xs font-bold ${active ? 'text-sky-700 dark:text-sky-300' : 'text-slate-700 dark:text-slate-200'}`}>{name}</span>
                </button>
                <button type="button" onClick={() => openDriveDetail(drive.id)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-sky-500 dark:hover:bg-slate-800" aria-label={`查看${name}详情`}><Pencil className="h-3.5 w-3.5" /></button>
              </div>
            );
          })}
          {cloudMounts.map((mount) => {
            const active = !viewingTrash && !viewingFavorites && activeCloudMountId === mount.id;
            return <button key={mount.id} type="button" onClick={() => { setActiveCloudMountId(mount.id); setViewingTrash(false); setViewingFavorites(false); }} className={`flex min-h-12 min-w-[150px] shrink-0 items-center gap-2 rounded-2xl border px-3 text-left transition ${active ? 'border-sky-200 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/15' : 'border-transparent bg-slate-50 dark:bg-slate-800/50'}`}><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${active ? 'bg-white text-sky-500 dark:bg-slate-800' : 'bg-white text-slate-400 dark:bg-slate-800'}`}><Cloud className="h-4 w-4" /></span><span className={`truncate text-xs font-bold ${active ? 'text-sky-700 dark:text-sky-300' : 'text-slate-700 dark:text-slate-200'}`}>{mount.name}</span></button>;
          })}
          {favorites.map((favoritePath) => {
            const favoriteName = favoritePath.split('/').filter(Boolean).pop() || favoritePath;
            const active = !viewingTrash && !viewingFavorites && (currentPath === favoritePath || currentPath.startsWith(`${favoritePath}/`));
            return <button key={favoritePath} type="button" onClick={() => { setActiveCloudMountId(null); setViewingTrash(false); setViewingFavorites(false); setCurrentPath(favoritePath); }} className={`flex min-h-12 min-w-[140px] shrink-0 items-center gap-2 rounded-2xl border px-3 text-left transition ${active ? 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10' : 'border-transparent bg-slate-50 dark:bg-slate-800/50'}`} title={favoritePath}><Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-400" /><span className={`truncate text-xs font-bold ${active ? 'text-amber-700 dark:text-amber-300' : 'text-slate-700 dark:text-slate-200'}`}>{favoriteName}</span></button>;
          })}
        </div>

        <details className="group relative shrink-0">
          <summary className="flex h-full min-h-12 w-12 cursor-pointer list-none flex-col items-center justify-center rounded-2xl bg-slate-50 text-[9px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-300"><MoreHorizontal className="h-5 w-5" /><span className="mt-0.5">更多</span></summary>
          <div className="absolute right-0 top-[calc(100%+8px)] z-40 max-h-[min(360px,55dvh)] w-[min(300px,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <button type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); openFavorites(); }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-xs text-slate-700 hover:bg-amber-50 hover:text-amber-700 dark:text-slate-200 dark:hover:bg-amber-500/10"><Star className="h-4 w-4 fill-amber-400 text-amber-400" /><span className="flex-1">收藏</span><span className="text-[10px] text-slate-400">{favorites.length}</span></button>
            <button type="button" onClick={() => { setViewingFavorites(false); setViewingTrash(true); loadTrash(); }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-xs text-slate-700 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-200 dark:hover:bg-rose-500/10"><Trash2 className="h-4 w-4 text-rose-500" /><span className="flex-1">回收站</span><span className="text-[10px] text-slate-400">{trashItems.length}</span></button>
            <button type="button" onClick={() => setShowCloudMountModal(true)} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-xs text-slate-700 hover:bg-sky-50 hover:text-sky-700 dark:text-slate-200 dark:hover:bg-sky-500/10"><Cloud className="h-4 w-4 text-sky-500" /><span className="flex-1">挂载云盘</span><span className="text-[10px] text-slate-400">夸克</span></button>
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

        {activeCloudMount ? <CloudDriveView
          mount={activeCloudMount}
          onBack={() => setActiveCloudMountId(null)}
          onRemoved={() => {
            setCloudMounts((current) => current.filter((mount) => mount.id !== activeCloudMount.id));
            setActiveCloudMountId(null);
          }}
        /> : <>
        {/* Action Toolbar */}
        {viewingFavorites ? (
          <section className="flex min-h-14 shrink-0 items-center gap-3 rounded-[22px] border border-slate-200/80 bg-white px-3 dark:border-slate-800 dark:bg-slate-900/80">
            <button type="button" onClick={() => setViewingFavorites(false)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" aria-label="返回文件列表"><ArrowLeft className="h-4 w-4" /></button>
            <Star className="h-5 w-5 shrink-0 fill-amber-400 text-amber-400" />
            <div className="min-w-0 flex-1"><h2 className="text-sm font-bold text-slate-900 dark:text-white">收藏的文件夹</h2><p className="text-[11px] text-slate-400">{favoriteItems.length} 个文件夹</p></div>
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
        />}

        {/* File View Container */}
        <div ref={fileListRef} onPointerDown={handleFileListPointerDown} onClick={(event) => { if (event.target === event.currentTarget) { if (marqueeJustFinishedRef.current) { marqueeJustFinishedRef.current = false; return; } setSelectedPaths(new Set()); } }} className={`relative min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain rounded-[22px] border border-slate-200/80 bg-white p-3 [-webkit-overflow-scrolling:touch] [contain:strict] dark:border-slate-800/80 dark:bg-slate-900/60 sm:p-4 ${marquee ? 'select-none' : ''}`}>
          {marquee && <div className="pointer-events-none fixed z-[70] border border-sky-500 bg-sky-400/20" style={{ left: Math.min(marquee.startX, marquee.currentX), top: Math.min(marquee.startY, marquee.currentY), width: Math.abs(marquee.currentX - marquee.startX), height: Math.abs(marquee.currentY - marquee.startY) }} />}
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
              <div className="flex flex-col items-center justify-center space-y-3 py-24 text-center text-slate-400"><Star className="h-12 w-12" /><p className="text-sm font-semibold text-slate-700 dark:text-slate-300">还没有收藏文件夹</p><p className="text-xs">只能在文件夹的三点菜单中添加收藏</p></div>
            ) : viewMode === 'grid' ? (
              <FileGridView files={favoriteItems} selectionMode={false} selectedPaths={selectedPaths} onItemClick={handleItemClick} onToggleSelect={toggleSelectItem} onOpenActions={(item, event) => { event.stopPropagation(); setActionItem(item); }} onLongPress={handleLongPress} onDragStart={handleItemDragStart} onDragOver={handleItemDragOver} onDrop={handleItemDrop} dropTargetPath={dropTargetPath} />
            ) : (
              <FileListView files={favoriteItems} selectionMode={false} selectedPaths={selectedPaths} onItemClick={handleItemClick} onToggleSelect={toggleSelectItem} onOpenActions={(item, event) => { event.stopPropagation(); setActionItem(item); }} onLongPress={handleLongPress} onDragStart={handleItemDragStart} onDragOver={handleItemDragOver} onDrop={handleItemDrop} dropTargetPath={dropTargetPath} />
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
              onLongPress={handleLongPress}
              onDragStart={handleItemDragStart}
              onDragOver={handleItemDragOver}
              onDrop={handleItemDrop}
              dropTargetPath={dropTargetPath}
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
              onLongPress={handleLongPress}
              onDragStart={handleItemDragStart}
              onDragOver={handleItemDragOver}
              onDrop={handleItemDrop}
              dropTargetPath={dropTargetPath}
            />
          )}
          {!viewingTrash && !viewingFavorites && hasMoreFiles && !loading && (
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => loadFiles(currentPath, true)}
              className="mx-auto mt-3 flex min-h-10 items-center justify-center rounded-xl bg-slate-100 px-5 text-xs font-semibold text-slate-600 disabled:opacity-60 dark:bg-slate-800 dark:text-slate-300"
            >
              {loadingMore ? '正在加载…' : '加载更多'}
            </button>
          )}
        </div>

        {/* Floating Multi-Selection Action Bar */}
        <BatchActionBar
          visible={selectionMode && !viewingTrash}
          selectedCount={!viewingTrash ? selectedPaths.size : 0}
          onCopy={() => openTransfer('copy', Array.from(selectedPaths))}
          onCut={() => openTransfer('move', Array.from(selectedPaths))}
          onDownload={handleBatchDownload}
          onDelete={() => {
            setDeleteTarget(null);
            setShowDeleteModal(true);
          }}
        />
        </>}
      </div>

      <DriveDetailModal
        drive={detailDrive}
        onClose={() => setDetailDriveId(null)}
        onSaveName={handleSaveDriveName}
      />

      <FileActionSheet
        item={actionItem}
        isFavorite={!!actionItem && favorites.includes(actionItem.path)}
        allowFavorite={Boolean(actionItem?.isDir)}
        onClose={() => setActionItem(null)}
        onToggleFavorite={() => {
          if (actionItem) toggleFavorite(actionItem.path);
          setActionItem(null);
        }}
        onCopy={() => {
          if (actionItem) openTransfer('copy', [actionItem.path]);
          setActionItem(null);
        }}
        onCopyPath={() => {
          if (actionItem) handleCopyPath(actionItem.path);
          setActionItem(null);
        }}
        onCut={() => {
          if (actionItem) openTransfer('move', [actionItem.path]);
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
        onArchive={() => {
          setArchiveItem(actionItem);
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
      {showCloudMountModal && <CloudMountModal
        onClose={() => setShowCloudMountModal(false)}
        onMounted={(mount) => {
          setCloudMounts((current) => [...current.filter((item) => item.id !== mount.id), mount]);
          setShowCloudMountModal(false);
          setActiveCloudMountId(mount.id);
          setAlertMsg({ type: 'success', text: '夸克云盘已挂载' });
        }}
      />}
      <ArchiveModal
        item={archiveItem}
        currentPath={currentPath}
        onClose={() => setArchiveItem(null)}
        onConfirm={handleArchiveConfirm}
      />
      {transferRequest && <TransferDestinationModal operation={transferRequest.operation} sourcePaths={transferRequest.paths} initialPath={transferRequest.initialPath} onClose={() => setTransferRequest(null)} onConfirm={handleTransferConfirm} />}
    </div>
  );
};
