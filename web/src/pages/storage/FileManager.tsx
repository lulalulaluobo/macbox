import React, { useState, useEffect } from 'react';
import { ArrowLeft, Star, Upload } from 'lucide-react';
import { CloudMount, DiskInfo, FileItem, LocalMount } from '../../types';
import { api } from '../../api';
import { FileToolbar } from './filemanager/FileToolbar';
import { FileContentView } from './filemanager/FileContentView';
import { BatchActionBar } from './filemanager/BatchActionBar';
import { CloudDriveView } from './filemanager/CloudDriveView';
import { FileManagerModals } from './filemanager/FileManagerModals';
import { FileDriveSwitcher } from './filemanager/FileDriveSwitcher';
import { useStorageDriveOptions } from './filemanager/useStorageDriveOptions';
import type { ConflictPolicy } from './filemanager/TransferDestinationModal';
import { useFileSelection } from './filemanager/useFileSelection';
import { useFavorites } from './filemanager/useFavorites';
import { useFileNavigation } from './filemanager/useFileNavigation';
import { useFileUpload } from './filemanager/useFileUpload';
import { useFileOperations } from './filemanager/useFileOperations';
import { useTrash } from './filemanager/useTrash';
import { useFilePreviews } from './filemanager/useFilePreviews';
import { useFileMarquee } from './filemanager/useFileMarquee';
import { useFileActions } from './filemanager/useFileActions';
import { useFileDragAndDrop } from './filemanager/useFileDragAndDrop';
import { FileManagerAlerts } from './filemanager/FileManagerAlerts';

interface FileManagerProps {
  initialPath?: string;
}

export const FileManager: React.FC<FileManagerProps> = ({ initialPath = '/data' }) => {
  const [actionItem, setActionItem] = useState<FileItem | null>(null);

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

  const [archiveItem, setArchiveItem] = useState<FileItem | null>(null);

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

  const {
    previewProps,
    handleItemClick,
  } = useFilePreviews({
    selectionMode,
    onToggleSelection: toggleSelectItem,
    onOpenDirectory: (path) => {
      setViewingFavorites(false);
      setViewingTrash(false);
      setCurrentPath(path);
    },
    onSuccess: (text) => setAlertMsg({ type: 'success', text }),
    onError: (text) => setAlertMsg({ type: 'error', text }),
    onReload: () => loadFiles(currentPath),
  });

  const {
    fileListRef,
    marquee,
    marqueeJustFinishedRef,
    handlePointerDown: handleFileListPointerDown,
  } = useFileMarquee({ setSelectionMode, setSelectedPaths });

  const {
    transferRequest,
    setTransferRequest,
    showMkdirModal,
    setShowMkdirModal,
    newFolderName,
    setNewFolderName,
    showRenameModal,
    setShowRenameModal,
    renameItem,
    renameNewName,
    setRenameNewName,
    showDeleteModal,
    setShowDeleteModal,
    deleteTarget,
    setDeleteTarget,
    deleting,
    openTransfer,
    handleCreateFolder,
    handleOpenRename,
    handleRenameConfirm,
    handleTransferConfirm,
    handleOpenDelete,
    handleMoveToTrashConfirm,
    handlePermanentDeleteConfirm,
  } = useFileOperations({
    currentPath,
    selectedPaths,
    setSelectedPaths,
    setSelectionMode,
    loadFiles,
    loadTrash,
    onSuccess: (text) => setAlertMsg({ type: 'success', text }),
    onError: (text) => setAlertMsg({ type: 'error', text }),
  });

  const handleArchiveConfirm = async (operation: 'compress' | 'extract', format: 'zip', destination: string, conflictPolicy: ConflictPolicy) => {
    if (!archiveItem) return;
    const sourcePath = archiveItem.path;
    const res = await api.archiveFiles([sourcePath], operation, format, destination, conflictPolicy);
    setArchiveItem(null);
    setAlertMsg({ type: 'success', text: res.message });
    loadFiles(currentPath);
  };

  const { handleCopyPath, handleBatchDownload } = useFileActions({
    selectedPaths,
    onSuccess: (text) => setAlertMsg({ type: 'success', text }),
    onError: (text) => setAlertMsg({ type: 'error', text }),
  });

  const {
    dropTargetPath,
    handleItemDragStart,
    handleItemDragOver,
    handleItemDrop,
  } = useFileDragAndDrop({
    selectedPaths,
    setSelectedPaths,
    setSelectionMode,
    openTransfer,
  });

  const { driveOptions, activeDriveId, secondaryOptions } = useStorageDriveOptions({
    storageDisks,
    localMounts,
    discoveredDrivePaths,
    currentPath,
  });
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

      <FileDriveSwitcher
        selectionMode={selectionMode}
        currentPath={currentPath}
        driveOptions={driveOptions}
        activeDriveId={activeDriveId}
        activeCloudMountId={activeCloudMountId}
        diskNames={diskNames}
        cloudMounts={cloudMounts}
        favorites={favorites}
        localMounts={localMounts}
        secondaryPaths={secondaryOptions.map((drive) => drive.path)}
        trashCount={trashItems.length}
        viewingTrash={viewingTrash}
        viewingFavorites={viewingFavorites}
        hideSystemFiles={hideSystemFiles}
        onSelectDrive={(path) => {
          setActiveCloudMountId(null);
          setViewingTrash(false);
          setViewingFavorites(false);
          setCurrentPath(path);
        }}
        onSelectCloudMount={(id) => {
          setActiveCloudMountId(id);
          setViewingTrash(false);
          setViewingFavorites(false);
        }}
        onSelectFavorite={(path) => {
          setActiveCloudMountId(null);
          setViewingTrash(false);
          setViewingFavorites(false);
          setCurrentPath(path);
        }}
        onOpenDriveDetail={openDriveDetail}
        onOpenFavorites={() => { setViewingTrash(false); setSelectionMode(false); setSelectedPaths(new Set()); setViewingFavorites(true); }}
        onOpenTrash={() => {
          setViewingFavorites(false);
          setViewingTrash(true);
          loadTrash();
        }}
        onOpenCloudMount={() => setShowCloudMountModal(true)}
        onSelectLocalMount={(path) => {
          setActiveCloudMountId(null);
          setViewingTrash(false);
          setViewingFavorites(false);
          setCurrentPath(path);
        }}
        onToggleSystemFiles={() => setHideSystemFiles((visible) => !visible)}
      />

      {/* Main Content Area */}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5">
        <FileManagerAlerts
          alertMsg={alertMsg}
          hideSystemFiles={hideSystemFiles}
          onDismiss={() => setAlertMsg(null)}
        />

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

        <FileContentView
          fileListRef={fileListRef}
          onPointerDown={handleFileListPointerDown}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              if (marqueeJustFinishedRef.current) {
                marqueeJustFinishedRef.current = false;
                return;
              }
              setSelectedPaths(new Set());
            }
          }}
          marquee={marquee}
          viewingTrash={viewingTrash}
          viewingFavorites={viewingFavorites}
          favoritesLoading={favoritesLoading}
          favoriteItems={favoriteItems}
          filteredFiles={filteredFiles}
          loading={loading}
          loadingMore={loadingMore}
          hasMoreFiles={hasMoreFiles}
          viewMode={viewMode}
          selectionMode={selectionMode}
          selectedPaths={selectedPaths}
          dropTargetPath={dropTargetPath}
          trashItems={trashItems}
          trashLoading={trashLoading}
          trashSelectedIds={trashSelectedIds}
          currentPath={currentPath}
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
          onLoadMore={() => loadFiles(currentPath, true)}
          onUploadEmpty={() => fileInputRef.current?.click()}
          onRefreshTrash={loadTrash}
          onOpenEmptyTrash={() => setShowEmptyTrashModal(true)}
          onToggleTrashSelectAll={() => {
            if (trashSelectedIds.size === trashItems.length) {
              setTrashSelectedIds(new Set());
            } else {
              setTrashSelectedIds(new Set(trashItems.map((item) => item.id)));
            }
          }}
          onToggleTrashSelect={(id) => {
            const next = new Set(trashSelectedIds);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            setTrashSelectedIds(next);
          }}
          onPromptDeleteTrash={handlePromptDeleteTrash}
          onRestoreTrash={handleRestoreTrash}
          onClearTrashSelection={() => setTrashSelectedIds(new Set())}
        />
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

      <FileManagerModals
        driveDetail={{
          drive: detailDrive,
          onClose: () => setDetailDriveId(null),
          onSaveName: handleSaveDriveName,
        }}
        actionSheet={{
          item: actionItem,
          isFavorite: !!actionItem && favorites.includes(actionItem.path),
          allowFavorite: Boolean(actionItem?.isDir),
          onClose: () => setActionItem(null),
          onToggleFavorite: () => {
            if (actionItem) toggleFavorite(actionItem.path);
            setActionItem(null);
          },
          onCopy: () => {
            if (actionItem) openTransfer('copy', [actionItem.path]);
            setActionItem(null);
          },
          onCopyPath: () => {
            if (actionItem) handleCopyPath(actionItem.path);
            setActionItem(null);
          },
          onCut: () => {
            if (actionItem) openTransfer('move', [actionItem.path]);
            setActionItem(null);
          },
          onRename: () => {
            if (actionItem) handleOpenRename(actionItem);
            setActionItem(null);
          },
          onDelete: () => {
            if (actionItem) handleOpenDelete(actionItem);
            setActionItem(null);
          },
          onArchive: () => {
            setArchiveItem(actionItem);
            setActionItem(null);
          },
        }}
        preview={previewProps}
        operations={{
          showMkdirModal,
          newFolderName,
          onCloseMkdir: () => setShowMkdirModal(false),
          onNewFolderNameChange: setNewFolderName,
          onCreateFolder: handleCreateFolder,
          showRenameModal,
          renameItem,
          renameNewName,
          onCloseRename: () => setShowRenameModal(false),
          onRenameNewNameChange: setRenameNewName,
          onRenameConfirm: handleRenameConfirm,
          showDeleteModal,
          deleteTarget,
          selectedCount: selectedPaths.size,
          deleting,
          onCloseDelete: () => setShowDeleteModal(false),
          onPermanentDelete: handlePermanentDeleteConfirm,
          onMoveToTrash: handleMoveToTrashConfirm,
          showTrashDeleteModal,
          trashDeleteTarget,
          trashSelectedCount: trashSelectedIds.size,
          deletingTrash,
          onCloseTrashDelete: () => {
            setShowTrashDeleteModal(false);
            setTrashDeleteTarget(null);
          },
          onConfirmDeleteTrash: handleConfirmDeleteTrash,
          showEmptyTrashModal,
          trashItemsCount: trashItems.length,
          onCloseEmptyTrash: () => setShowEmptyTrashModal(false),
          onConfirmEmptyTrash: handleConfirmEmptyTrash,
        }}
        cloudMount={showCloudMountModal ? {
          onClose: () => setShowCloudMountModal(false),
          onMounted: (mount) => {
            setCloudMounts((current) => [...current.filter((item) => item.id !== mount.id), mount]);
            setShowCloudMountModal(false);
            setActiveCloudMountId(mount.id);
            setAlertMsg({ type: 'success', text: '夸克云盘已挂载' });
          },
        } : undefined}
        archive={{
          item: archiveItem,
          currentPath,
          onClose: () => setArchiveItem(null),
          onConfirm: handleArchiveConfirm,
        }}
        transfer={transferRequest ? {
          operation: transferRequest.operation,
          sourcePaths: transferRequest.paths,
          initialPath: transferRequest.initialPath,
          onClose: () => setTransferRequest(null),
          onConfirm: handleTransferConfirm,
        } : undefined}
      />
    </div>
  );
};
