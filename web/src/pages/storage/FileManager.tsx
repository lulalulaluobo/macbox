import React, { useState, useEffect, useRef } from 'react';
import {
  Folder, FileText, Film, Image, Music, Download, Trash2, Edit3,
  Eye, EyeOff, X, Save, AlertTriangle, ShieldCheck, Play,
  ZoomIn, ZoomOut, RotateCw, ChevronRight, FolderPlus, Upload, Grid, List, Search, ArrowLeft, RefreshCw,
  Copy, Scissors, Clipboard, Star, CheckSquare, Square, RotateCcw, Volume2, VolumeX
} from 'lucide-react';
import { FileItem, LocalMount, TrashItem } from '../../types';
import { api } from '../../api';

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
  const [clipboard, setClipboard] = useState<{ action: 'copy' | 'cut'; items: string[] } | null>(null);

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

  const [textPreview, setTextPreview] = useState<{ item: FileItem; content: string } | null>(null);
  const [savingText, setSavingText] = useState(false);

  // Categories (fnOS Style)
  const categories = [
    { name: '全部存储', path: '/data', icon: Folder, color: 'text-sky-400' },
    { name: '影视媒体', path: '/data/media', icon: Film, color: 'text-violet-400' },
    { name: '离线下载', path: '/data/downloads', icon: Download, color: 'text-amber-400' },
    { name: '照片图库', path: '/data/photos', icon: Image, color: 'text-emerald-400' },
    { name: '个人文档', path: '/data/files', icon: FileText, color: 'text-blue-400' },
    { name: 'Mac 直通空间', path: '/mnt/macnas-mounts', icon: HardDriveIcon, color: 'text-cyan-400' },
  ];

  function HardDriveIcon(props: any) {
    return (
      <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="22" y1="12" x2="2" y2="12"></line>
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path>
        <line x1="6" y1="16" x2="6.01" y2="16"></line>
        <line x1="10" y1="16" x2="10.01" y2="16"></line>
      </svg>
    );
  }

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

  // Type helper
  const getFileType = (ext: string): 'video' | 'image' | 'audio' | 'text' | 'archive' | 'other' => {
    const videoExts = ['mp4', 'mkv', 'webm', 'mov', 'avi', 'flv', 'wmv'];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
    const audioExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'];
    const textExts = ['txt', 'md', 'json', 'yaml', 'yml', 'xml', 'conf', 'ini', 'sh', 'log', 'css', 'html', 'js', 'ts'];
    const archiveExts = ['zip', 'tar', 'gz', 'bz2', '7z', 'rar'];

    if (videoExts.includes(ext)) return 'video';
    if (imageExts.includes(ext)) return 'image';
    if (audioExts.includes(ext)) return 'audio';
    if (textExts.includes(ext)) return 'text';
    if (archiveExts.includes(ext)) return 'archive';
    return 'other';
  };

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
    } catch (err: any) {
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

  const handleEmptyTrash = async () => {
    if (!confirm('确定要清空回收站吗？回收站内的所有文件将彻底永久丢失！')) return;
    try {
      const res = await api.emptyTrash();
      setAlertMsg({ type: 'success', text: res.message });
      loadTrash();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `清空回收站失败: ${err.message}` });
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
      <div className="w-full lg:w-64 shrink-0 space-y-4">
        <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800/60">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">快速分类导航</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 font-semibold">飞牛风</span>
          </div>

          <nav className="space-y-1">
            {categories.map((cat) => {
              const active = !viewingTrash && currentPath === cat.path;
              const Icon = cat.icon;
              return (
                <button
                  key={cat.path}
                  onClick={() => {
                    setViewingTrash(false);
                    setCurrentPath(cat.path);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition ${
                    active
                      ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30 font-semibold'
                      : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 truncate">
                    <Icon className={`w-4 h-4 ${cat.color} shrink-0`} />
                    <span className="truncate">{cat.name}</span>
                  </div>
                  {active && <ChevronRight className="w-3.5 h-3.5 text-sky-400 shrink-0" />}
                </button>
              );
            })}

            {/* Trash Bin Nav Item */}
            <button
              onClick={() => {
                setViewingTrash(true);
                loadTrash();
              }}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition ${
                viewingTrash
                  ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30 font-semibold'
                  : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
              }`}
            >
              <div className="flex items-center space-x-2.5 truncate">
                <Trash2 className="w-4 h-4 text-rose-400 shrink-0" />
                <span className="truncate">回收站</span>
              </div>
              {trashItems.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-500/20 text-rose-300 font-mono font-bold">
                  {trashItems.length}
                </span>
              )}
            </button>
          </nav>

          {/* Favorites (Starred) Section */}
          <div className="pt-2 border-t border-slate-800/60">
            <div className="flex items-center justify-between pb-1.5 px-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">我的收藏</span>
              <span className="text-[10px] text-amber-400 font-mono">{favorites.length} 项</span>
            </div>
            {favorites.length === 0 ? (
              <p className="text-[11px] text-slate-500 italic px-2 py-1">点击文件或目录的 ⭐ 即可添加收藏</p>
            ) : (
              <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                {favorites.map((favPath) => {
                  const favBase = favPath.split('/').pop() || favPath;
                  return (
                    <div
                      key={favPath}
                      className="group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs hover:bg-slate-800/60 text-slate-300 hover:text-white transition cursor-pointer"
                      onClick={() => {
                        setViewingTrash(false);
                        setCurrentPath(favPath);
                      }}
                    >
                      <div className="flex items-center space-x-2 truncate" title={favPath}>
                        <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />
                        <span className="truncate">{favBase}</span>
                      </div>
                      <button
                        onClick={(e) => toggleFavorite(favPath, e)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-500 hover:text-rose-400"
                        title="取消收藏"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {localMounts.filter((m) => m.enabled).length > 0 && (
            <div className="pt-2 border-t border-slate-800/60">
              <div className="flex items-center justify-between pb-1.5 px-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Mac 本地直通目录</span>
                <span className="text-[10px] text-cyan-400 font-mono">VirtioFS</span>
              </div>
              <div className="space-y-1">
                {localMounts.filter((m) => m.enabled).map((m) => {
                  const targetPath = `/data/${m.guestTarget}`;
                  const active = !viewingTrash && (currentPath === targetPath || currentPath.startsWith(targetPath + '/'));
                  return (
                    <button
                      key={m.id}
                      onClick={() => {
                        setViewingTrash(false);
                        setCurrentPath(targetPath);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition ${
                        active
                          ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-semibold'
                          : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center space-x-2 truncate">
                        <HardDriveIcon className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        <span className="truncate">{m.name}</span>
                      </div>
                      <div className="flex items-center space-x-1 shrink-0">
                        <span className={`text-[9px] px-1 py-0.2 rounded font-mono ${
                          m.writable ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-400'
                        }`}>
                          {m.writable ? '读写' : '只读'}
                        </span>
                        {active && <ChevronRight className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Protection Info Card */}
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-2.5">
          <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>系统安全防线</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            默认隐藏 <code className="text-amber-300 font-mono text-[10px]">lost+found</code> 与 <code className="text-amber-300 font-mono text-[10px]">appdata</code> 核心容器运行目录，防止小白误删。
          </p>
          <button
            onClick={() => setHideSystemFiles(!hideSystemFiles)}
            className={`w-full py-2 px-3 rounded-xl text-xs font-medium border flex items-center justify-center space-x-1.5 transition ${
              hideSystemFiles
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
                : 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
            }`}
          >
            {hideSystemFiles ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{hideSystemFiles ? '系统目录已隐藏 (保护中)' : '已显示系统目录 (警告)'}</span>
          </button>
        </div>
      </div>

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
        <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Breadcrumbs & Navigation */}
          <div className="flex items-center space-x-2 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
            <button
              onClick={handleGoUp}
              disabled={currentPath === '/' || currentPath === '/data'}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 disabled:opacity-30 disabled:pointer-events-none transition"
              title="返回上一级"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <button
              onClick={() => setCurrentPath('/data')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                currentPath === '/data' ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:text-white'
              }`}
            >
              NAS 数据
            </button>

            {pathParts.map((part, index) => {
              const isLast = index === pathParts.length - 1;
              return (
                <div key={index} className="flex items-center space-x-1 shrink-0">
                  <span className="text-slate-600 text-xs">/</span>
                  <button
                    onClick={() => navigateToPart(index)}
                    className={`px-2 py-1 rounded-lg text-xs font-mono transition ${
                      isLast
                        ? 'font-bold text-sky-400 bg-sky-500/10'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                    }`}
                  >
                    {part}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Right Toolbar Controls */}
          <div className="flex items-center space-x-2 shrink-0">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="搜索文件..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-36 md:w-44 pl-8 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500 transition"
              />
            </div>

            {/* Sort Order */}
            <select
              value={`${sortBy}-${sortOrder}`}
              onChange={(e) => {
                const [by, order] = e.target.value.split('-') as [any, any];
                setSortBy(by);
                setSortOrder(order);
              }}
              className="px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-sky-500 transition"
            >
              <option value="name-asc">按名称 (A-Z)</option>
              <option value="name-desc">按名称 (Z-A)</option>
              <option value="size-desc">按大小 (大到小)</option>
              <option value="mtime-desc">按时间 (最新)</option>
            </select>

            {/* View Mode Toggle */}
            <div className="flex items-center bg-slate-950 p-0.5 rounded-xl border border-slate-800">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-lg transition ${viewMode === 'grid' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'}`}
                title="网格视图"
              >
                <Grid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-lg transition ${viewMode === 'list' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'}`}
                title="列表视图"
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* New Folder */}
            <button
              onClick={() => setShowMkdirModal(true)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center space-x-1.5 transition"
            >
              <FolderPlus className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden sm:inline">新建</span>
            </button>

            {/* Upload File */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-lg shadow-sky-600/20 transition disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{uploading ? '上传中...' : '上传'}</span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              multiple
              className="hidden"
            />

            {/* Refresh */}
            <button
              onClick={() => loadFiles(currentPath)}
              className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition"
              title="刷新"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Upload Progress Bar */}
        {uploading && (
          <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-300 text-xs flex items-center justify-between animate-pulse">
            <div className="flex items-center space-x-2">
              <Upload className="w-4 h-4 animate-bounce" />
              <span>{uploadProgress || '正在上传文件，请稍候...'}</span>
            </div>
          </div>
        )}

        {/* Clipboard Paste Banner */}
        {clipboard && (
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg animate-in fade-in">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-xl bg-amber-500/20 text-amber-300 shrink-0">
                {clipboard.action === 'copy' ? <Copy className="w-4 h-4" /> : <Scissors className="w-4 h-4" />}
              </div>
              <div>
                <span className="font-bold text-white text-xs">
                  剪贴板：已{clipboard.action === 'copy' ? '复制' : '剪切'} {clipboard.items.length} 个项目
                </span>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  当前目标目录：<code className="text-amber-300 font-mono">{currentPath}</code>，点击右侧按钮即可粘贴放入。
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2 self-end sm:self-center shrink-0">
              <button
                onClick={handlePaste}
                className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center space-x-1.5 shadow-md shadow-amber-500/20 transition"
              >
                <Clipboard className="w-3.5 h-3.5" />
                <span>粘贴到当前目录</span>
              </button>
              <button
                onClick={() => setClipboard(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
                title="清除剪贴板"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* File View Container */}
        <div className="flex-1 p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 min-h-[480px]">
          {viewingTrash ? (
            /* TRASH VIEW */
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center space-x-2">
                    <Trash2 className="w-5 h-5 text-rose-400" />
                    <span>回收站 (暂存删除项目)</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    被删除的文件与目录先移入回收站保护。您可以随时一键安全还原到原目录；清空后将无法恢复。
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={loadTrash}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center space-x-1.5 transition"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${trashLoading ? 'animate-spin' : ''}`} />
                    <span>刷新</span>
                  </button>
                  <button
                    onClick={handleEmptyTrash}
                    disabled={trashItems.length === 0}
                    className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center space-x-1.5 shadow-lg shadow-rose-600/20 transition disabled:opacity-40"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>清空回收站</span>
                  </button>
                </div>
              </div>

              {trashLoading ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-2">
                  <RefreshCw className="w-6 h-6 text-rose-400 animate-spin" />
                  <p className="text-xs">正在读取回收站清单...</p>
                </div>
              ) : trashItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-3">
                  <div className="p-4 rounded-2xl bg-slate-800/40 text-slate-600">
                    <Trash2 className="w-12 h-12" />
                  </div>
                  <p className="text-sm font-semibold text-slate-300">回收站是空的</p>
                  <p className="text-xs text-slate-500">所有删除的文件都会先保存在这里，防止误删破坏</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 uppercase font-mono text-[10px]">
                        <th className="pb-3 font-semibold pl-2">项目名称</th>
                        <th className="pb-3 font-semibold">原存储路径</th>
                        <th className="pb-3 font-semibold">大小</th>
                        <th className="pb-3 font-semibold">删除时间</th>
                        <th className="pb-3 font-semibold text-right pr-2">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {trashItems.map((it) => (
                        <tr key={it.id} className="hover:bg-slate-800/40 transition">
                          <td className="py-3 pl-2 font-medium text-slate-200">
                            <div className="flex items-center space-x-2">
                              {it.isDir ? <Folder className="w-4 h-4 text-amber-400 shrink-0" /> : <FileText className="w-4 h-4 text-slate-400 shrink-0" />}
                              <span className="truncate max-w-xs">{it.name}</span>
                            </div>
                          </td>
                          <td className="py-3 text-slate-400 font-mono text-[11px] max-w-xs truncate" title={it.originalPath}>
                            {it.originalPath}
                          </td>
                          <td className="py-3 text-slate-400 font-mono text-[11px]">
                            {it.isDir ? '文件夹' : it.sizeFormatted}
                          </td>
                          <td className="py-3 text-slate-400 font-mono text-[11px]">
                            {it.deletedAtString}
                          </td>
                          <td className="py-3 text-right pr-2">
                            <button
                              onClick={() => handleRestoreTrash([it.id])}
                              className="px-3 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center space-x-1 ml-auto transition"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>还原</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400 space-y-3">
              <RefreshCw className="w-8 h-8 text-sky-400 animate-spin" />
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
            /* GRID VIEW */
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4">
              {filteredFiles.map((item) => {
                const type = getFileType(item.ext);
                const isDir = item.isDir;
                const isImage = !isDir && type === 'image';
                const isVideo = !isDir && type === 'video';
                const isAudio = !isDir && type === 'audio';
                const isSelected = selectedPaths.has(item.path);
                const isFav = favorites.includes(item.path);

                return (
                  <div
                    key={item.path}
                    onClick={() => handleItemClick(item)}
                    className={`group relative p-3.5 rounded-2xl bg-slate-950/60 hover:bg-slate-800/80 border transition-all flex flex-col justify-between cursor-pointer hover:shadow-xl hover:shadow-sky-500/5 ${
                      isSelected
                        ? 'border-sky-500 bg-sky-500/10 ring-1 ring-sky-500/40'
                        : 'border-slate-800/80 hover:border-sky-500/40'
                    }`}
                  >
                    {/* Top Left Selection Checkbox */}
                    <div
                      className={`absolute top-2.5 left-2.5 z-20 transition-opacity ${
                        isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                      onClick={(e) => toggleSelectItem(item.path, e)}
                    >
                      <div className={`p-1 rounded-md transition ${isSelected ? 'text-sky-400' : 'text-slate-400 hover:text-white bg-slate-900/80'}`}>
                        {isSelected ? <CheckSquare className="w-4 h-4 fill-sky-500/20" /> : <Square className="w-4 h-4" />}
                      </div>
                    </div>

                    {/* Top Right Action Menu */}
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-0.5 z-20 bg-slate-900/95 rounded-lg p-1 shadow-lg border border-slate-700/60">
                      {/* Star / Favorite */}
                      <button
                        onClick={(e) => toggleFavorite(item.path, e)}
                        className="p-1 text-slate-400 hover:text-amber-400 rounded hover:bg-slate-800 transition"
                        title={isFav ? '取消收藏' : '收藏'}
                      >
                        <Star className={`w-3 h-3 ${isFav ? 'text-amber-400 fill-amber-400' : ''}`} />
                      </button>
                      {/* Copy */}
                      <button
                        onClick={(e) => handleCopy([item.path], e)}
                        className="p-1 text-slate-400 hover:text-sky-400 rounded hover:bg-slate-800 transition"
                        title="复制"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      {/* Cut */}
                      <button
                        onClick={(e) => handleCut([item.path], e)}
                        className="p-1 text-slate-400 hover:text-amber-400 rounded hover:bg-slate-800 transition"
                        title="剪切 (移动)"
                      >
                        <Scissors className="w-3 h-3" />
                      </button>
                      {/* Rename */}
                      <button
                        onClick={(e) => handleOpenRename(item, e)}
                        className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition"
                        title="重命名"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                      {!isDir && (
                        <a
                          href={api.getFileDownloadUrl(item.path)}
                          onClick={(e) => e.stopPropagation()}
                          download
                          className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition"
                          title="下载"
                        >
                          <Download className="w-3 h-3" />
                        </a>
                      )}
                      {/* Delete */}
                      <button
                        onClick={(e) => handleOpenDelete(item, e)}
                        className="p-1 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800 transition"
                        title="移入回收站"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Thumbnail / Icon */}
                    <div className="h-28 rounded-xl bg-slate-900/90 flex items-center justify-center overflow-hidden relative border border-slate-800/50 mb-2.5">
                      {isDir ? (
                        <Folder className="w-12 h-12 text-amber-400/90 fill-amber-400/20 group-hover:scale-105 transition-transform" />
                      ) : isImage ? (
                        <img
                          src={api.getFileRawUrl(item.path)}
                          alt={item.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          loading="lazy"
                        />
                      ) : isVideo ? (
                        <div className="flex flex-col items-center justify-center space-y-1 text-violet-400">
                          <Film className="w-10 h-10 group-hover:scale-105 transition-transform" />
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-500/20 uppercase font-semibold">{item.ext}</span>
                        </div>
                      ) : isAudio ? (
                        <div className="flex flex-col items-center justify-center space-y-1 text-pink-400">
                          <Music className="w-10 h-10 group-hover:scale-105 transition-transform" />
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-pink-500/20 uppercase font-semibold">{item.ext}</span>
                        </div>
                      ) : type === 'text' ? (
                        <div className="flex flex-col items-center justify-center space-y-1 text-sky-400">
                          <FileText className="w-10 h-10 group-hover:scale-105 transition-transform" />
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-500/20 uppercase font-semibold">{item.ext || 'txt'}</span>
                        </div>
                      ) : (
                        <FileText className="w-10 h-10 text-slate-400 group-hover:scale-105 transition-transform" />
                      )}

                      {/* Play Badge for Videos */}
                      {isVideo && (
                        <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="p-2 rounded-full bg-violet-600/90 text-white shadow-lg">
                            <Play className="w-4 h-4 fill-white" />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Metadata */}
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-slate-200 truncate group-hover:text-sky-300 transition-colors" title={item.name}>
                        {item.name}
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                        <span>{isDir ? '文件夹' : item.sizeFormatted}</span>
                        <span>{item.mtimeString.split(' ')[0]}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* LIST VIEW */
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase font-mono text-[10px]">
                    <th className="w-8 pb-3 pl-2">
                      <button onClick={handleSelectAll} className="p-0.5 text-slate-400 hover:text-white" title="全选 / 反选">
                        {selectedPaths.size > 0 && selectedPaths.size === filteredFiles.length ? (
                          <CheckSquare className="w-3.5 h-3.5 text-sky-400 fill-sky-500/20" />
                        ) : (
                          <Square className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </th>
                    <th className="pb-3 font-semibold">名称</th>
                    <th className="pb-3 font-semibold">大小</th>
                    <th className="pb-3 font-semibold">类型</th>
                    <th className="pb-3 font-semibold">最后修改</th>
                    <th className="pb-3 font-semibold text-right pr-2">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {filteredFiles.map((item) => {
                    const isDir = item.isDir;
                    const type = getFileType(item.ext);
                    const isSelected = selectedPaths.has(item.path);
                    const isFav = favorites.includes(item.path);
                    return (
                      <tr
                        key={item.path}
                        onClick={() => handleItemClick(item)}
                        className={`group cursor-pointer transition-colors ${
                          isSelected ? 'bg-sky-500/10' : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="w-8 py-2.5 pl-2" onClick={(e) => toggleSelectItem(item.path, e)}>
                          <div className="p-0.5 text-slate-400 hover:text-white">
                            {isSelected ? (
                              <CheckSquare className="w-3.5 h-3.5 text-sky-400 fill-sky-500/20" />
                            ) : (
                              <Square className="w-3.5 h-3.5" />
                            )}
                          </div>
                        </td>
                        <td className="py-2.5">
                          <div className="flex items-center space-x-2.5 truncate max-w-sm">
                            <button
                              onClick={(e) => toggleFavorite(item.path, e)}
                              className="text-slate-500 hover:text-amber-400 shrink-0"
                              title={isFav ? '取消收藏' : '收藏'}
                            >
                              <Star className={`w-3.5 h-3.5 ${isFav ? 'text-amber-400 fill-amber-400' : 'opacity-0 group-hover:opacity-100'}`} />
                            </button>
                            {isDir ? (
                              <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                            ) : type === 'video' ? (
                              <Film className="w-4 h-4 text-violet-400 shrink-0" />
                            ) : type === 'image' ? (
                              <Image className="w-4 h-4 text-emerald-400 shrink-0" />
                            ) : type === 'audio' ? (
                              <Music className="w-4 h-4 text-pink-400 shrink-0" />
                            ) : type === 'text' ? (
                              <FileText className="w-4 h-4 text-sky-400 shrink-0" />
                            ) : (
                              <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                            )}
                            <span className="font-medium text-slate-200 group-hover:text-sky-300 truncate">
                              {item.name}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 text-slate-400 font-mono text-[11px]">
                          {isDir ? '--' : item.sizeFormatted}
                        </td>
                        <td className="py-2.5 text-slate-400">
                          {isDir ? '文件夹' : item.ext.toUpperCase() || '文件'}
                        </td>
                        <td className="py-2.5 text-slate-400 font-mono text-[11px]">
                          {item.mtimeString}
                        </td>
                        <td className="py-2.5 text-right pr-2">
                          <div className="flex items-center justify-end space-x-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={(e) => handleCopy([item.path], e)}
                              className="p-1 rounded-lg text-slate-400 hover:text-sky-400 hover:bg-slate-800 transition"
                              title="复制"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => handleCut([item.path], e)}
                              className="p-1 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition"
                              title="剪切 (移动)"
                            >
                              <Scissors className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => handleOpenRename(item, e)}
                              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                              title="重命名"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            {!isDir && (
                              <a
                                href={api.getFileDownloadUrl(item.path)}
                                download
                                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                                title="下载"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </a>
                            )}
                            <button
                              onClick={(e) => handleOpenDelete(item, e)}
                              className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
                              title="移入回收站"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Floating Multi-Selection Action Bar */}
        {selectedPaths.size > 0 && !viewingTrash && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 border border-sky-500/40 rounded-2xl shadow-2xl px-5 py-3 backdrop-blur-md flex items-center space-x-3 text-xs animate-in slide-in-from-bottom-5">
            <div className="flex items-center space-x-2 pr-3 border-r border-slate-700">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
              <span className="font-bold text-white">已选择 {selectedPaths.size} 项</span>
            </div>
            <button
              onClick={() => handleCopy(Array.from(selectedPaths))}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium flex items-center space-x-1.5 transition"
            >
              <Copy className="w-3.5 h-3.5 text-sky-400" />
              <span>复制</span>
            </button>
            <button
              onClick={() => handleCut(Array.from(selectedPaths))}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium flex items-center space-x-1.5 transition"
            >
              <Scissors className="w-3.5 h-3.5 text-amber-400" />
              <span>剪切 (移动)</span>
            </button>
            <button
              onClick={() => {
                setDeleteTarget(null);
                setShowDeleteModal(true);
              }}
              className="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 font-medium flex items-center space-x-1.5 transition"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              <span>移入回收站</span>
            </button>
            <button
              onClick={() => setSelectedPaths(new Set())}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="取消选择"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* PREVIEW MODALS */}
      {/* ========================================================================= */}

      {/* 1. Video Player Modal */}
      {videoPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
          <div className="w-full max-w-4xl rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl flex flex-col space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center space-x-2 truncate">
                <Film className="w-4 h-4 text-violet-400 shrink-0" />
                <span className="font-bold text-white text-sm truncate">{videoPreview.name}</span>
                <span className="text-xs text-slate-500 font-mono shrink-0">({videoPreview.sizeFormatted})</span>
              </div>
              <div className="flex items-center space-x-2 shrink-0">
                <button
                  onClick={() => {
                    if (videoRef.current) {
                      const next = !videoMuted;
                      videoRef.current.muted = next;
                      setVideoMuted(next);
                      if (!next) videoRef.current.volume = 1.0;
                    }
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1 border transition ${
                    videoMuted
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30'
                      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25'
                  }`}
                  title="切换静音/开启声音"
                >
                  {videoMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                  <span>{videoMuted ? '点击开启声音' : `音量 ${Math.round(videoVolume * 100)}%`}</span>
                </button>
                <a
                  href={api.getFileDownloadUrl(videoPreview.path)}
                  download
                  className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center space-x-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>下载</span>
                </a>
                <button
                  onClick={() => setVideoPreview(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="relative rounded-xl overflow-hidden bg-black flex items-center justify-center max-h-[70vh]">
              <video
                ref={videoRef}
                src={api.getFileRawUrl(videoPreview.path)}
                controls
                autoPlay
                playsInline
                onVolumeChange={(e) => {
                  const el = e.target as HTMLVideoElement;
                  setVideoVolume(el.volume);
                  setVideoMuted(el.muted);
                }}
                className="w-full h-auto max-h-[70vh] rounded-xl"
              >
                您的浏览器不支持流式播放此视频。
              </video>
            </div>
          </div>
        </div>
      )}

      {/* 2. Image Lightbox Modal */}
      {imagePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
          <div className="w-full max-w-5xl rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl flex flex-col space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <Image className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-white text-sm">{imagePreview.name}</span>
                <span className="text-xs text-slate-500 font-mono">({imagePreview.sizeFormatted})</span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setImageZoom((prev) => Math.max(0.5, prev - 0.25))}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                  title="缩小"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setImageZoom((prev) => Math.min(3, prev + 0.25))}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                  title="放大"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setImageRotate((prev) => (prev + 90) % 360)}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                  title="旋转"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
                <a
                  href={api.getFileDownloadUrl(imagePreview.path)}
                  download
                  className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center space-x-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>下载</span>
                </a>
                <button
                  onClick={() => setImagePreview(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="relative rounded-xl overflow-hidden bg-black/60 flex items-center justify-center min-h-[400px] max-h-[70vh]">
              <img
                src={api.getFileRawUrl(imagePreview.path)}
                alt={imagePreview.name}
                style={{
                  transform: `scale(${imageZoom}) rotate(${imageRotate}deg)`,
                  transition: 'transform 0.2s ease',
                }}
                className="max-w-full max-h-[68vh] object-contain select-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* 3. Audio Player Modal */}
      {audioPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Music className="w-5 h-5 text-pink-400" />
                <span className="font-bold text-white text-sm truncate">{audioPreview.name}</span>
              </div>
              <button
                onClick={() => setAudioPreview(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col items-center space-y-3">
              <div className="w-16 h-16 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center animate-pulse">
                <Music className="w-8 h-8" />
              </div>
              <span className="text-xs text-slate-400 font-mono">{audioPreview.sizeFormatted}</span>
              <audio
                src={api.getFileRawUrl(audioPreview.path)}
                controls
                autoPlay
                className="w-full mt-2"
              >
                您的浏览器不支持在线音频播放。
              </audio>
            </div>
          </div>
        </div>
      )}

      {/* 4. Text / Code Editor Modal */}
      {textPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
          <div className="w-full max-w-3xl rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4 flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-sky-400" />
                <span className="font-bold text-white text-sm">{textPreview.item.name}</span>
                <span className="text-xs text-slate-500 font-mono">({textPreview.item.path})</span>
              </div>
              <button
                onClick={() => setTextPreview(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <textarea
              value={textPreview.content}
              onChange={(e) => setTextPreview({ ...textPreview, content: e.target.value })}
              className="flex-1 w-full min-h-[380px] p-4 rounded-xl bg-[#090d16] border border-slate-800 font-mono text-xs text-slate-200 focus:outline-none focus:border-sky-500 resize-none leading-relaxed"
              spellCheck={false}
            />

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-slate-500">在线修改保存后直接写入 NAS 存储空间</span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setTextPreview(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-medium"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveText}
                  disabled={savingText}
                  className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center space-x-1.5 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savingText ? '保存中...' : '保存更改'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* CRUD MODALS */}
      {/* ========================================================================= */}

      {/* 1. Mkdir Modal */}
      {showMkdirModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white text-sm flex items-center space-x-2">
                <FolderPlus className="w-4 h-4 text-sky-400" />
                <span>新建文件夹</span>
              </h3>
              <button onClick={() => setShowMkdirModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateFolder} className="space-y-4">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="例如: 电影 或 备份"
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

      {/* 2. Rename Modal */}
      {showRenameModal && renameItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white text-sm flex items-center space-x-2">
                <Edit3 className="w-4 h-4 text-sky-400" />
                <span>重命名</span>
              </h3>
              <button onClick={() => setShowRenameModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRenameConfirm} className="space-y-4">
              <input
                type="text"
                value={renameNewName}
                onChange={(e) => setRenameNewName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-sky-500"
                autoFocus
              />
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowRenameModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-medium"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!renameNewName.trim() || renameNewName === renameItem.name}
                  className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold disabled:opacity-50"
                >
                  确认更改
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Delete / Move to Trash Modal */}
      {showDeleteModal && (deleteTarget || selectedPaths.size > 0) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3">
              <div className="p-3 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">删除文件确认</h3>
                <p className="text-xs text-slate-400">建议优先移入回收站，可随时安全还原</p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs">
              <span className="text-slate-400">即将处理: </span>
              {deleteTarget ? (
                <>
                  <strong className="text-white font-mono">{deleteTarget.name}</strong>
                  <p className="text-[10px] text-slate-500 font-mono mt-1 truncate">{deleteTarget.path}</p>
                </>
              ) : (
                <strong className="text-white">已勾选的 {selectedPaths.size} 个项目</strong>
              )}
            </div>

            <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-200 text-xs flex items-start space-x-2">
              <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <span>
                <strong>回收站机制</strong>: 移入回收站后文件暂存于 <code className="text-sky-300 font-mono">/data/.trash</code>，点击侧边栏回收站即可一键找回。
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-medium transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handlePermanentDeleteConfirm}
                disabled={deleting}
                className="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-semibold transition disabled:opacity-50"
              >
                彻底抹除
              </button>
              <button
                type="button"
                onClick={handleMoveToTrashConfirm}
                disabled={deleting}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-lg shadow-sky-600/25 flex items-center justify-center space-x-1.5 transition disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{deleting ? '处理中...' : '移入回收站 (推荐)'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
