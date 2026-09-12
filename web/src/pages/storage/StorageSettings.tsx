import React, { useState, useEffect } from 'react';
import {
  HardDrive, Check, CheckCircle2, AlertCircle, RefreshCw, RotateCw,
  X, Film, DownloadCloud, Image, FolderPlus, Folder, Lock, Unlock, Zap, ArrowLeft, FolderOpen
} from 'lucide-react';
import { DiskInfo, ManagedDisk, SambaStatus, LocalMount, LocalMountCandidate, LocalMountHealth, SMBShare, FileItem } from '../../types';
import { api } from '../../api';
import { SMBSharingSection } from './settings/SMBSharingSection';
import { LocalMountSection } from './settings/LocalMountSection';
import { StorageDiskSection } from './settings/StorageDiskSection';

export interface StorageSettingsProps {
  configDirty?: boolean;
  onRefreshOverview?: () => void;
  mode?: 'storage' | 'smb';
}

export const StorageSettings: React.FC<StorageSettingsProps> = ({ configDirty, onRefreshOverview, mode = 'storage' }) => {
  const [disks, setDisks] = useState<DiskInfo[]>([]);
  const [managedDisks, setManagedDisks] = useState<ManagedDisk[]>([]);
  const [selectedDiskId, setSelectedDiskId] = useState<string>('');
  const [isExternalActive, setIsExternalActive] = useState<boolean>(false);
  const [dataPath, setDataPath] = useState<string>('');
  const [samba, setSamba] = useState<SambaStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // SMB Multi-Share States
  const [showShareModal, setShowShareModal] = useState(false);
  const [editingShare, setEditingShare] = useState<SMBShare | null>(null);
  const [shareFormName, setShareFormName] = useState('');
  const [shareFormPath, setShareFormPath] = useState('');
  const [shareFormComment, setShareFormComment] = useState('');
  const [shareFormWritable, setShareFormWritable] = useState(true);
  const [shareFormGuestOk, setShareFormGuestOk] = useState(true);
  const [shareFormEnabled, setShareFormEnabled] = useState(true);
  const [shareFormDiskSource, setShareFormDiskSource] = useState<'primary' | 'secondary' | 'passthrough' | 'custom'>('custom');
  const [shareActionLoading, setShareActionLoading] = useState<string | null>(null);
  const [copiedShareId, setCopiedShareId] = useState<string | null>(null);
  const [restartingSamba, setRestartingSamba] = useState(false);
  const [showSharePathPicker, setShowSharePathPicker] = useState(false);
  const [sharePickerPath, setSharePickerPath] = useState('/data');
  const [sharePickerFolders, setSharePickerFolders] = useState<FileItem[]>([]);
  const [sharePickerLoading, setSharePickerLoading] = useState(false);

  // Local Mounts (VirtioFS)
  const [localMounts, setLocalMounts] = useState<LocalMount[]>([]);
  const [, setRecommendedMounts] = useState<LocalMount[]>([]);
  const [mountCandidates, setMountCandidates] = useState<LocalMountCandidate[]>([]);
  const [mountHealth, setMountHealth] = useState<LocalMountHealth[]>([]);
  const [showAddMountModal, setShowAddMountModal] = useState(false);
  const [showMountManager, setShowMountManager] = useState(false);
  const [newMountPath, setNewMountPath] = useState('');
  const [newMountName, setNewMountName] = useState('');
  const [newMountCategory, setNewMountCategory] = useState<'media' | 'downloads' | 'pictures' | 'custom'>('media');
  const [newMountGuestTarget, setNewMountGuestTarget] = useState('media/MacMedia');
  const [newMountWritable, setNewMountWritable] = useState(false);
  const [mountsLoading, setMountsLoading] = useState(false);

  // External Disk Bind Modal
  const [showBindModal, setShowBindModal] = useState(false);
  const [bindingDisk, setBindingDisk] = useState<DiskInfo | null>(null);
  const [bindSizeGB, setBindSizeGB] = useState<number>(10);
  const [bindLoading, setBindLoading] = useState(false);
  const [showUnbindConfirm, setShowUnbindConfirm] = useState(false);
  const [unbindLoading, setUnbindLoading] = useState(false);
  const [restartPrompt, setRestartPrompt] = useState(false);
  const [restartingVM, setRestartingVM] = useState(false);

  // Secondary Volume Modal
  const [showSecondaryModal, setShowSecondaryModal] = useState(false);
  const [secondaryTargetDisk, setSecondaryTargetDisk] = useState<DiskInfo | null>(null);
  const [secondaryCustomDir, setSecondaryCustomDir] = useState('');
  const [bindingSecondary, setBindingSecondary] = useState(false);
  const [scanningSecondaryPath, setScanningSecondaryPath] = useState(false);

  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [storageRes, sambaRes, mountsRes] = await Promise.all([
        api.getDisks(),
        api.getSambaStatus(),
        api.getLocalMounts().catch(() => ({ mounts: [], recommended: [], candidates: [], health: [] })),
      ]);
      setDisks(storageRes.disks || []);
      setManagedDisks(storageRes.managedDisks || []);
      setSelectedDiskId(storageRes.selectedDisk || '');
      setIsExternalActive(storageRes.isExternalActive || false);
      setDataPath(storageRes.dataPath || '');
      setSamba(sambaRes);
      setLocalMounts(mountsRes.mounts || []);
      setRecommendedMounts(mountsRes.recommended || []);
      setMountCandidates(mountsRes.candidates || []);
      setMountHealth(mountsRes.health || []);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `加载存储数据失败: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const refreshMountData = async () => {
    try {
      const mountsRes = await api.getLocalMounts();
      setLocalMounts(mountsRes.mounts || []);
      setRecommendedMounts(mountsRes.recommended || []);
      setMountCandidates(mountsRes.candidates || []);
      setMountHealth(mountsRes.health || []);
    } catch {
      // Keep the mutation response visible if a follow-up probe is unavailable.
    }
  };

  const handleOpenBindModal = (disk: DiskInfo) => {
    setBindingDisk(disk);
    // This is a sparse image for /data, not a reservation of the whole disk.
    // Keep the default small because host folders configured as VirtioFS
    // passthrough mounts remain on macOS and do not consume this image.
    setBindSizeGB(10);
    setShowBindModal(true);
  };

  const handleConfirmBind = async () => {
    if (!bindingDisk) return;
    setBindLoading(true);
    try {
      const res = await api.bindStorage(bindingDisk.identifier, bindingDisk.mountPoint, bindSizeGB);
      setAlertMsg({ type: 'success', text: res.message });
      setShowBindModal(false);
      setRestartPrompt(true);
      loadData();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `绑定外接盘失败: ${err.message}` });
    } finally {
      setBindLoading(false);
    }
  };

  const handleUnbind = async () => {
    setUnbindLoading(true);
    try {
      const res = await api.unbindStorage();
      setAlertMsg({ type: 'success', text: res.message });
      setShowUnbindConfirm(false);
      setRestartPrompt(true);
      loadData();
      if (onRefreshOverview) onRefreshOverview();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `解除绑定失败: ${err.message}` });
    } finally {
      setUnbindLoading(false);
    }
  };

  const handleOpenSecondaryModal = (disk: DiskInfo) => {
    setSecondaryTargetDisk(disk);
    setSecondaryCustomDir(disk.recommendedTargetDir || '');
    setShowSecondaryModal(true);
  };

  const handleRescanSecondaryPath = async () => {
    if (!secondaryTargetDisk) return;
    setScanningSecondaryPath(true);
    try {
      const storageRes = await api.getDisks();
      const refreshedDisk = (storageRes.disks || []).find(
        (disk) => disk.identifier === secondaryTargetDisk.identifier
      );
      setDisks(storageRes.disks || []);
      if (!refreshedDisk) {
        throw new Error('未重新扫描到这块磁盘，请确认磁盘仍已挂载');
      }
      setSecondaryTargetDisk(refreshedDisk);
      setSecondaryCustomDir(refreshedDisk.recommendedTargetDir || '');
      if (!refreshedDisk.recommendedTargetDir) {
        throw new Error('未找到可用的本机存储目录，请先在 macOS 中挂载可写的数据卷');
      }
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `扫描本机存储目录失败: ${err.message}` });
    } finally {
      setScanningSecondaryPath(false);
    }
  };

  const handleConfirmBindSecondary = async () => {
    if (!secondaryTargetDisk) return;
    setBindingSecondary(true);
    try {
      const res = await api.bindSecondaryDisk(
        secondaryTargetDisk.identifier,
        secondaryTargetDisk.mountPoint,
        secondaryCustomDir,
        'volume2-ssd'
      );
      setAlertMsg({ type: 'success', text: res.message });
      setShowSecondaryModal(false);
      setSecondaryTargetDisk(null);
      setRestartPrompt(true);
      loadData();
      if (onRefreshOverview) onRefreshOverview();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `挂载扩展盘失败: ${err.message}` });
    } finally {
      setBindingSecondary(false);
    }
  };

  const handleUnbindSecondary = async () => {
    if (!confirm('确定要解除存储空间 2 (扩展盘) 的挂载吗？')) return;
    try {
      const res = await api.unbindSecondaryDisk();
      setAlertMsg({ type: 'success', text: res.message });
      setRestartPrompt(true);
      loadData();
      if (onRefreshOverview) onRefreshOverview();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `解除挂载失败: ${err.message}` });
    }
  };

  const handleToggleMount = async (id: string) => {
    try {
      const res = await api.toggleLocalMount(id);
      setLocalMounts(res.mounts);
      setRecommendedMounts(res.recommended);
      void refreshMountData();
      setRestartPrompt(true);
      setAlertMsg({ type: 'success', text: res.message });
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `操作失败: ${err.message}` });
    }
  };

  const handleToggleMountWritable = async (id: string, writable: boolean) => {
    try {
      const res = await api.toggleLocalMountWritable(id, writable);
      setLocalMounts(res.mounts);
      setRecommendedMounts(res.recommended);
      void refreshMountData();
      setAlertMsg({ type: 'success', text: res.message });
      onRefreshOverview?.();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `切换权限失败: ${err.message}` });
    }
  };

  const handleDeleteMount = async (id: string, name: string) => {
    if (!confirm(`确定要移除「${name}」的直通挂载配置吗？（您的 Mac 本地原始文件不会受到任何影响）`)) return;
    try {
      const res = await api.deleteLocalMount(id);
      setLocalMounts(res.mounts);
      setRecommendedMounts(res.recommended);
      void refreshMountData();
      setRestartPrompt(true);
      setAlertMsg({ type: 'success', text: res.message });
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `删除失败: ${err.message}` });
    }
  };

  const selectMountCandidate = (candidate: LocalMountCandidate) => {
    if (!candidate.available || candidate.configured) return;
    setNewMountPath(candidate.hostPath);
    setNewMountName(candidate.name);
    if (candidate.category === 'media' || candidate.category === 'downloads' || candidate.category === 'pictures' || candidate.category === 'custom') {
      setNewMountCategory(candidate.category);
      const targetName = candidate.name || '本机直通';
      setNewMountGuestTarget(candidate.category === 'media' ? `media/${targetName}` : candidate.category === 'downloads' ? `downloads/${targetName}` : candidate.category === 'pictures' ? `photos/${targetName}` : `shared/${targetName}`);
    }
  };

  const handleAddCustomMount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMountPath.trim()) {
      setAlertMsg({ type: 'error', text: '请先填写一个 Mac 本地文件夹路径。' });
      return;
    }
    setMountsLoading(true);
    try {
      let targetSub = newMountGuestTarget.trim().replace(/^\/data\/?/, '').replace(/^\/+/, '');
      if (!targetSub) {
        targetSub = newMountCategory === 'media' ? `media/${newMountName.trim() || 'MacMedia'}` : newMountCategory === 'downloads' ? `downloads/${newMountName.trim() || 'MacDownloads'}` : newMountCategory === 'pictures' ? `photos/${newMountName.trim() || 'MacPhotos'}` : `shared/${newMountName.trim() || 'Folder'}`;
      }

      const res = await api.addLocalMount({
        name: newMountName.trim() || newMountPath.split('/').pop() || '本地直通',
        hostPath: newMountPath.trim(),
        guestTarget: targetSub,
        category: newMountCategory,
        writable: newMountWritable,
        enabled: true,
      });
      setLocalMounts(res.mounts);
      setRecommendedMounts(res.recommended);
      void refreshMountData();
      setShowAddMountModal(false);
      setNewMountPath('');
      setNewMountName('');
      setNewMountGuestTarget('media/MacMedia');
      setRestartPrompt(true);
      setAlertMsg({ type: 'success', text: `已成功添加本地直通目录，请重启 VM 生效！` });
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `添加直通失败: ${err.message}` });
    } finally {
      setMountsLoading(false);
    }
  };

  const handleRestartVM = async () => {
    setRestartingVM(true);
    try {
      await api.restartVM();
      setAlertMsg({ type: 'success', text: '正在重启虚拟机以挂载新数据盘，请稍候约 30 秒...' });
      setRestartPrompt(false);
      onRefreshOverview?.();
      setTimeout(() => {
        loadData();
        setRestartingVM(false);
      }, 5000);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `重启虚拟机失败: ${err.message}` });
      setRestartingVM(false);
    }
  };

  const handleCopyShareAddress = (address: string, id: string) => {
    navigator.clipboard.writeText(address);
    setCopiedShareId(id);
    setTimeout(() => setCopiedShareId(null), 2000);
  };

  const handleOpenAddShare = () => {
    setEditingShare(null);
    setShareFormName('');
    setShareFormPath('');
    setShareFormComment('');
    setShareFormDiskSource('custom');
    setShareFormWritable(true);
    setShareFormGuestOk(true);
    setShareFormEnabled(true);
    setShowShareModal(true);
  };

  const loadSharePickerFolders = async (path: string) => {
    setSharePickerLoading(true);
    try {
      const res = await api.listFiles(path);
      setSharePickerPath(res.path || path);
      setSharePickerFolders((res.items || []).filter((item) => item.isDir));
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `读取目录失败: ${err.message}` });
    } finally {
      setSharePickerLoading(false);
    }
  };

  const openSharePathPicker = () => {
    const startPath = shareFormPath || '/data';
    setShowSharePathPicker(true);
    loadSharePickerFolders(startPath);
  };

  const confirmSharePickerPath = () => {
    setShareFormPath(sharePickerPath);
    const matchedTarget = samba?.availableTargets?.find((target) =>
      sharePickerPath === target.path || sharePickerPath.startsWith(`${target.path}/`)
    );
    setShareFormDiskSource((matchedTarget?.source as typeof shareFormDiskSource) || (sharePickerPath.startsWith('/data') ? 'primary' : 'custom'));
    if (!shareFormName.trim()) {
      const leaf = sharePickerPath.split('/').filter(Boolean).pop() || 'MacNAS';
      setShareFormName(leaf.replace(/[^a-zA-Z0-9_-]/g, '-') || 'MacNAS');
    }
    setShowSharePathPicker(false);
  };

  const handleOpenEditShare = (share: SMBShare) => {
    setEditingShare(share);
    setShareFormName(share.name);
    setShareFormPath(share.path);
    setShareFormComment(share.comment || '');
    setShareFormWritable(share.writable);
    setShareFormGuestOk(share.guestOk);
    setShareFormEnabled(share.enabled);
    setShareFormDiskSource((share.diskSource as any) || 'custom');
    setShowShareModal(true);
  };

  const handleSaveShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shareFormName.trim() || !shareFormPath.trim()) return;

    setShareActionLoading('save');
    try {
      await api.addOrUpdateSMBShare({
        id: editingShare?.id,
        name: shareFormName.trim(),
        path: shareFormPath.trim(),
        comment: shareFormComment.trim(),
        writable: shareFormWritable,
        guestOk: shareFormGuestOk,
        enabled: shareFormEnabled,
        diskSource: shareFormDiskSource,
      });

      const updatedSamba = await api.getSambaStatus();
      setSamba(updatedSamba);
      setAlertMsg({ type: 'success', text: `SMB 共享 [${shareFormName.trim()}] 配置已成功保存并即时生效！` });
      setShowShareModal(false);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `保存共享失败: ${err.message}` });
    } finally {
      setShareActionLoading(null);
    }
  };

  const handleToggleShare = async (share: SMBShare) => {
    setShareActionLoading(`toggle-${share.id}`);
    try {
      await api.toggleSMBShare(share.id);
      const updatedSamba = await api.getSambaStatus();
      setSamba(updatedSamba);
      setAlertMsg({ type: 'success', text: `共享 [${share.name}] 已${share.enabled ? '暂停' : '开启'}` });
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `切换共享状态失败: ${err.message}` });
    } finally {
      setShareActionLoading(null);
    }
  };

  const handleDeleteShare = async (share: SMBShare) => {
    if (!confirm(`确定要删除 SMB 共享 [${share.name}] 吗？这仅取消局域网共享，不会影响真实文件。`)) {
      return;
    }
    setShareActionLoading(`delete-${share.id}`);
    try {
      await api.deleteSMBShare(share.id);
      const updatedSamba = await api.getSambaStatus();
      setSamba(updatedSamba);
      setAlertMsg({ type: 'success', text: `共享 [${share.name}] 已删除` });
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `删除共享失败: ${err.message}` });
    } finally {
      setShareActionLoading(null);
    }
  };

  const handleRestartSamba = async () => {
    setRestartingSamba(true);
    try {
      await api.restartSMBService();
      const updatedSamba = await api.getSambaStatus();
      setSamba(updatedSamba);
      setAlertMsg({ type: 'success', text: 'Samba 服务已重新加载配置并平滑重启！' });
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `重启 Samba 失败: ${err.message}` });
    } finally {
      setRestartingSamba(false);
    }
  };

  const handleToggleSMBService = async (enable: boolean) => {
    setShareActionLoading('service-toggle');
    try {
      await api.toggleSMBService(enable);
      const updatedSamba = await api.getSambaStatus();
      setSamba(updatedSamba);
      setAlertMsg({ type: 'success', text: `Samba 服务已${enable ? '启动' : '停止'}` });
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `操作 Samba 服务失败: ${err.message}` });
    } finally {
      setShareActionLoading(null);
    }
  };

  return (
    <div className="space-y-4 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white sm:text-2xl">{mode === 'smb' ? 'SMB 共享' : '存储'}</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{mode === 'smb' ? '共享目录与访问权限' : '磁盘与本机目录'}</p>
        </div>
        <button
          onClick={loadData}
          aria-label="刷新存储状态"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Alert Banner */}
      {alertMsg && (
        <div className={`p-4 rounded-xl text-sm flex items-center justify-between ${
          alertMsg.type === 'success'
            ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
            : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
        }`}>
          <div className="flex items-center space-x-2">
            {alertMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span>{alertMsg.text}</span>
          </div>
          <button onClick={() => setAlertMsg(null)} className="text-xs opacity-70 hover:opacity-100">关闭</button>
        </div>
      )}

      {/* Restart VM Alert Banner */}
      {mode === 'storage' && (restartPrompt || configDirty) && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm flex items-center justify-between shadow-lg">
          <div className="flex items-center space-x-2.5">
            <RotateCw className="w-4 h-4 text-amber-400 shrink-0" />
            <span>数据盘挂载或直通配置已变更！需要重启 Linux 虚拟机以重新加载挂载生效。</span>
          </div>
          <button
            onClick={handleRestartVM}
            disabled={restartingVM}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow transition flex items-center space-x-1 shrink-0"
          >
            <RotateCw className={`w-3.5 h-3.5 ${restartingVM ? 'animate-spin' : ''}`} />
            <span>{restartingVM ? '重启中...' : '立即重启 VM'}</span>
          </button>
        </div>
      )}

      <SMBSharingSection
        visible={mode === 'smb'}
        samba={samba}
        shareActionLoading={shareActionLoading}
        copiedShareId={copiedShareId}
        restartingSamba={restartingSamba}
        onOpenAddShare={handleOpenAddShare}
        onRestartSamba={handleRestartSamba}
        onToggleSMBService={handleToggleSMBService}
        onCopyShareAddress={handleCopyShareAddress}
        onToggleShare={handleToggleShare}
        onOpenEditShare={handleOpenEditShare}
        onDeleteShare={handleDeleteShare}
      />

      {mode !== 'smb' && (
        <LocalMountSection
          localMounts={localMounts}
          mountHealth={mountHealth}
          showManager={showMountManager}
          onOpenManager={() => setShowMountManager(true)}
          onCloseManager={() => setShowMountManager(false)}
          onOpenAdd={() => { setShowMountManager(false); setNewMountGuestTarget('media/MacMedia'); setShowAddMountModal(true); }}
          onDeleteMount={handleDeleteMount}
          onToggleMountWritable={handleToggleMountWritable}
          onToggleMount={handleToggleMount}
        />
      )}

      <StorageDiskSection
        visible={mode !== 'smb'}
        loading={loading}
        disks={disks}
        managedDisks={managedDisks}
        selectedDiskId={selectedDiskId}
        isExternalActive={isExternalActive}
        dataPath={dataPath}
        onOpenBindModal={handleOpenBindModal}
        onOpenSecondaryModal={handleOpenSecondaryModal}
        onRequestUnbind={() => setShowUnbindConfirm(true)}
        onUnbindSecondary={handleUnbindSecondary}
      />

      {/* Add / Edit SMB Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 dark:bg-black/75 sm:items-center sm:p-4">
          <div className="h-[100dvh] w-full max-w-xl space-y-5 overflow-y-auto bg-white p-4 dark:bg-slate-900 sm:h-auto sm:max-h-[90dvh] sm:rounded-3xl sm:border sm:border-slate-200 sm:p-6 sm:shadow-2xl dark:sm:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  {editingShare ? '编辑 SMB 共享' : '新增 SMB 共享目录'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowShareModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveShare} className="space-y-4">
              {/* Share Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  共享服务名称 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={shareFormName}
                  onChange={(e) => setShareFormName(e.target.value)}
                  placeholder="例如：硬盘2或MediaShare"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder:text-slate-400 text-sm font-mono focus:outline-none focus:border-sky-500 transition"
                />
              </div>

              {/* Target Path */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  共享目录 <span className="text-rose-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={openSharePathPicker}
                  className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-left transition hover:border-sky-300 hover:bg-sky-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-sky-600"
                >
                  <FolderOpen className="h-5 w-5 shrink-0 text-sky-500" />
                  <span className={`min-w-0 flex-1 truncate font-mono text-sm ${shareFormPath ? 'text-slate-900 dark:text-white' : 'text-slate-400'}`}>
                    {shareFormPath || '点击选择 NAS 中的文件夹'}
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-sky-600 dark:text-sky-400">选择</span>
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">备注说明</label>
                <input
                  type="text"
                  value={shareFormComment}
                  onChange={(e) => setShareFormComment(e.target.value)}
                  placeholder="例如: 家庭相册"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder:text-slate-400 text-xs focus:outline-none focus:border-sky-500"
                />
              </div>

              {/* Permissions & Auth Selector */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/70 space-y-3">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">权限与安全控制</span>

                {/* Read-Write vs Read-Only */}
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShareFormWritable(true)}
                    className={`p-3 rounded-xl border text-left transition flex items-start space-x-2 ${
                      shareFormWritable
                        ? 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-300 dark:border-emerald-500/40 text-emerald-800 dark:text-white'
                        : 'bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/60 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <Unlock className={`w-4 h-4 mt-0.5 ${shareFormWritable ? 'text-emerald-500 dark:text-emerald-400' : 'text-slate-400'}`} />
                    <div>
                      <span className="text-xs font-bold block">读写模式 (RW)</span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 block mt-0.5">允许上传与修改</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShareFormWritable(false)}
                    className={`p-3 rounded-xl border text-left transition flex items-start space-x-2 ${
                      !shareFormWritable
                        ? 'bg-amber-50 dark:bg-amber-500/15 border-amber-300 dark:border-amber-500/40 text-amber-800 dark:text-white'
                        : 'bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/60 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <Lock className={`w-4 h-4 mt-0.5 ${!shareFormWritable ? 'text-amber-500 dark:text-amber-400' : 'text-slate-400'}`} />
                    <div>
                      <span className="text-xs font-bold block">只读模式 (RO)</span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 block mt-0.5">仅浏览与下载</span>
                    </div>
                  </button>
                </div>

                {/* Guest Access Toggle */}
                <label className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/60 border border-slate-200 dark:border-slate-700 transition cursor-pointer">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">允许匿名免密直接访问 (Guest OK)</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={shareFormGuestOk}
                    onChange={(e) => setShareFormGuestOk(e.target.checked)}
                    className="w-4 h-4 text-sky-500 rounded border-slate-300 dark:border-slate-700 focus:ring-0 cursor-pointer"
                  />
                </label>

                {/* Enabled Toggle */}
                <label className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/60 border border-slate-200 dark:border-slate-700 transition cursor-pointer">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">立即启用此项共享 (Enabled)</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={shareFormEnabled}
                    onChange={(e) => setShareFormEnabled(e.target.checked)}
                    className="w-4 h-4 text-emerald-500 rounded border-slate-300 dark:border-slate-700 focus:ring-0 cursor-pointer"
                  />
                </label>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowShareModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold transition"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={shareActionLoading === 'save'}
                  className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold shadow-xs transition flex items-center space-x-1.5 disabled:opacity-50"
                >
                  {shareActionLoading === 'save' ? (
                    <>
                      <RotateCw className="w-3.5 h-3.5 animate-spin" />
                      <span>正在应用...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>{editingShare ? '保存修改' : '确认创建'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showSharePathPicker && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="选择共享目录">
          <section className="flex h-[82dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] bg-white dark:bg-slate-900 sm:h-[min(680px,85dvh)] sm:rounded-3xl sm:border sm:border-slate-200 dark:sm:border-slate-700">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">选择共享目录</h3>
                <p className="mt-0.5 truncate font-mono text-[11px] text-sky-600 dark:text-sky-400">{sharePickerPath}</p>
              </div>
              <button type="button" onClick={() => setShowSharePathPicker(false)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300" aria-label="关闭目录选择">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-4 py-2 dark:border-slate-800">
              <button
                type="button"
                disabled={sharePickerPath === '/'}
                onClick={() => {
                  const parent = sharePickerPath.split('/').slice(0, -1).join('/') || '/';
                  loadSharePickerFolders(parent);
                }}
                className="flex min-h-10 items-center gap-1.5 rounded-xl bg-slate-100 px-3 text-xs font-semibold text-slate-700 disabled:opacity-40 dark:bg-slate-800 dark:text-slate-200"
              >
                <ArrowLeft className="h-4 w-4" />
                上一级
              </button>
              <span className="min-w-0 flex-1 truncate text-right text-xs text-slate-400">点击文件夹继续进入</span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
              {sharePickerLoading ? (
                <div className="flex h-32 items-center justify-center gap-2 text-sm text-slate-400"><RefreshCw className="h-4 w-4 animate-spin" />读取目录…</div>
              ) : sharePickerFolders.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center gap-2 text-sm text-slate-400"><FolderOpen className="h-7 w-7" />当前目录没有子文件夹</div>
              ) : (
                sharePickerFolders.map((folder) => (
                  <button key={folder.path} type="button" onClick={() => loadSharePickerFolders(folder.path)} className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-sky-50 dark:hover:bg-slate-800">
                    <Folder className="h-6 w-6 shrink-0 fill-sky-500/15 text-sky-500" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{folder.name}</span>
                    <span className="text-slate-300">›</span>
                  </button>
                ))
              )}
            </div>

            <footer className="grid shrink-0 grid-cols-[auto_1fr] gap-2 border-t border-slate-200 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 dark:border-slate-800 dark:bg-slate-900">
              <button type="button" onClick={() => setShowSharePathPicker(false)} className="min-h-11 rounded-xl bg-slate-100 px-4 text-sm font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">取消</button>
              <button type="button" onClick={confirmSharePickerPath} className="min-h-11 rounded-xl bg-sky-500 px-4 text-sm font-bold text-white">选择当前目录</button>
            </footer>
          </section>
        </div>
      )}

      {/* External Disk Bind Modal */}
      {showBindModal && bindingDisk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">绑定外接 SSD 为 NAS 数据盘</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{bindingDisk.name} ({bindingDisk.deviceNode})</p>
                </div>
              </div>
              <button
                onClick={() => setShowBindModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs text-slate-700 dark:text-slate-300">
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">挂载目录:</span>
                  <span className="font-mono text-sky-600 dark:text-sky-300 font-semibold">{bindingDisk.mountPoint || '自动识别'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">可用空闲容量:</span>
                  <span className="font-mono text-slate-900 dark:text-white font-semibold">{bindingDisk.freeSpaceString || bindingDisk.totalSizeString}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  NAS 本地数据盘上限 (GiB)
                </label>
                <p className="mb-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                  这是外接盘上的稀疏镜像最大容量，仅用于未直通的应用配置、持久化数据和缓存。通过“本机目录直通”映射的文件仍留在 Mac 原目录，不占用此镜像。建议 10 GiB，纯测试可填写 5 GiB。
                </p>
                <div className="flex items-center space-x-3">
                  <input
                    type="number"
                    min={5}
                    max={20000}
                    value={bindSizeGB}
                    onChange={(e) => setBindSizeGB(parseInt(e.target.value) || 10)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-sm font-mono focus:outline-none focus:border-sky-500 transition"
                  />
                  <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">GiB</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowBindModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmBind}
                disabled={bindLoading}
                className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold shadow-xs transition flex items-center space-x-1.5 disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{bindLoading ? '正在绑定...' : '确认绑定为数据盘'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {showUnbindConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm dark:bg-black/75" role="presentation">
          <div className="w-full max-w-md space-y-5 rounded-3xl border border-rose-200 bg-white p-6 shadow-2xl dark:border-rose-900/60 dark:bg-slate-900" role="dialog" aria-modal="true" aria-labelledby="unbind-storage-title">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 id="unbind-storage-title" className="text-base font-black text-slate-900 dark:text-white">解除主盘绑定？</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">当前外接镜像无法访问，MacNAS 将移除外接盘链接并恢复本机内部数据盘备份。</p>
              </div>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-200">
              外接盘原始数据不会被删除；恢复完成后需要返回主页重新初始化虚拟机。
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setShowUnbindConfirm(false)} disabled={unbindLoading} className="min-h-11 rounded-2xl border border-slate-200 px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">取消</button>
              <button type="button" onClick={() => void handleUnbind()} disabled={unbindLoading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-rose-500 px-5 text-sm font-bold text-white transition hover:bg-rose-600 disabled:cursor-wait disabled:opacity-60">
                {unbindLoading && <RefreshCw className="h-4 w-4 animate-spin" />}
                {unbindLoading ? '正在恢复…' : '确认解除并恢复'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Custom Local Mount Modal */}
      {showAddMountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                  <FolderPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">添加 Mac 本地直通目录</h3>
                </div>
              </div>
              <button
                onClick={() => setShowAddMountModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddCustomMount} className="space-y-4 text-xs">
              <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-3 dark:border-sky-900/60 dark:bg-sky-500/10">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-bold text-slate-800 dark:text-slate-100">选择本机目录</p>
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">显示常用本机目录；外接盘或网络盘请在下方填写路径</p>
                  </div>
                  <FolderOpen className="h-4 w-4 text-sky-500" />
                </div>
                <div className="mt-2 grid max-h-36 gap-2 overflow-y-auto sm:grid-cols-2">
                  {mountCandidates.filter((candidate) => candidate.available).map((candidate) => (
                    <button
                      key={candidate.hostPath}
                      type="button"
                      disabled={candidate.configured}
                      onClick={() => selectMountCandidate(candidate)}
                      className={`rounded-xl border px-3 py-2 text-left transition ${candidate.configured ? 'cursor-not-allowed border-slate-200 bg-slate-100/80 text-slate-400 dark:border-slate-800 dark:bg-slate-800/60' : newMountPath === candidate.hostPath ? 'border-sky-400 bg-white text-sky-700 shadow-sm dark:bg-slate-900 dark:text-sky-300' : 'border-white bg-white/80 text-slate-700 hover:border-sky-300 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200'}`}
                    >
                      <span className="block truncate text-xs font-bold">{candidate.name}{candidate.configured ? ' · 已配置' : ''}</span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-slate-500" title={candidate.hostPath}>{candidate.hostPath}</span>
                    </button>
                  ))}
                </div>
                {mountCandidates.every((candidate) => !candidate.available) && <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">未扫描到可读的常用目录，请确认磁盘已挂载或使用下方高级路径。</p>}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Mac 本地文件夹 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={newMountPath}
                  onChange={(e) => setNewMountPath(e.target.value)}
                  placeholder="例如：/Users/你的用户名/Downloads"
                  className="w-full rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-sky-500/50 dark:bg-sky-500/10 dark:text-white"
                />
                <p className="mt-1.5 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                  已选择的目录会以 VirtioFS 直通到 Linux；文件仍保留在 Mac 原位置，不会复制进 NAS 镜像。未扫描到的目录可在此填写绝对路径。
                </p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  展示名称 (可选)
                </label>
                <input
                  type="text"
                  value={newMountName}
                  onChange={(e) => setNewMountName(e.target.value)}
                  placeholder="例如: 蓝光影院"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-sky-500 transition"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  分类与挂载目标
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => { setNewMountCategory('media'); setNewMountGuestTarget(`media/${newMountName.trim() || 'MacMedia'}`); }}
                    className={`p-2.5 rounded-xl border text-center transition flex flex-col items-center space-y-1 ${
                      newMountCategory === 'media'
                        ? 'bg-sky-50 dark:bg-sky-500/20 border-sky-400 text-sky-700 dark:text-sky-300 font-bold'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <Film className="w-4 h-4" />
                    <span className="text-[11px]">影音 (/media)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setNewMountCategory('downloads'); setNewMountGuestTarget(`downloads/${newMountName.trim() || 'MacDownloads'}`); }}
                    className={`p-2.5 rounded-xl border text-center transition flex flex-col items-center space-y-1 ${
                      newMountCategory === 'downloads'
                        ? 'bg-sky-50 dark:bg-sky-500/20 border-sky-400 text-sky-700 dark:text-sky-300 font-bold'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <DownloadCloud className="w-4 h-4" />
                    <span className="text-[11px]">下载 (/downloads)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setNewMountCategory('pictures'); setNewMountGuestTarget(`photos/${newMountName.trim() || 'MacPhotos'}`); }}
                    className={`p-2.5 rounded-xl border text-center transition flex flex-col items-center space-y-1 ${
                      newMountCategory === 'pictures'
                        ? 'bg-sky-50 dark:bg-sky-500/20 border-sky-400 text-sky-700 dark:text-sky-300 font-bold'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <Image className="w-4 h-4" />
                    <span className="text-[11px]">照片 (/photos)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setNewMountCategory('custom'); setNewMountGuestTarget(`shared/${newMountName.trim() || 'Folder'}`); }}
                    className={`p-2.5 rounded-xl border text-center transition flex flex-col items-center space-y-1 ${
                      newMountCategory === 'custom'
                        ? 'bg-sky-50 dark:bg-sky-500/20 border-sky-400 text-sky-700 dark:text-sky-300 font-bold'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <Folder className="w-4 h-4" />
                    <span className="text-[11px]">通用 (/shared)</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">NAS 目标目录（VM 内） <span className="text-rose-500">*</span></label>
                <input type="text" value={newMountGuestTarget} onChange={(e) => setNewMountGuestTarget(e.target.value)} placeholder="例如：/data/macdownload/download" className="w-full rounded-xl border border-violet-300 bg-violet-50 px-4 py-3 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20 dark:border-violet-500/50 dark:bg-violet-500/10 dark:text-white" />
                <p className="mt-1.5 text-[11px] leading-5 text-slate-500 dark:text-slate-400">可填写 /data 下任意自定义目录；例如 /data/macdownload/download。系统会拒绝 /data 之外的路径。</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 block">写入权限</span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {newMountWritable ? '允许容器写入文件' : '开启只读保护 (推荐)'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setNewMountWritable(!newMountWritable)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    newMountWritable ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-500/40' : 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/40'
                  }`}
                >
                  {newMountWritable ? '读写模式' : '只读保护'}
                </button>
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddMountModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold transition"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={mountsLoading}
                  className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold shadow-xs transition flex items-center space-x-1.5 disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{mountsLoading ? '正在保存...' : '添加并直通'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Secondary Disk Bind Modal */}
      {showSecondaryModal && secondaryTargetDisk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/80 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center space-x-3">
                <div className="p-3 rounded-2xl bg-purple-50 dark:bg-purple-500/15 border border-purple-200 dark:border-purple-500/30 text-purple-600 dark:text-purple-400">
                  <Zap className="w-6 h-6 text-amber-500 dark:text-yellow-300" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">挂载为扩展存储空间 (存储空间 2)</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">利用高速固态进行扩展</p>
                </div>
              </div>
              <button
                onClick={() => setShowSecondaryModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">物理磁盘:</span>
                <span className="text-slate-900 dark:text-white font-mono font-bold">{secondaryTargetDisk.name} ({secondaryTargetDisk.totalSizeString})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">可用容量:</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-mono font-bold">{secondaryTargetDisk.freeSpaceString} 可用</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">虚拟机挂载点:</span>
                <span className="text-purple-600 dark:text-purple-300 font-mono font-bold">/data/volume2-ssd</span>
              </div>
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-3">
                <label className="block font-semibold text-slate-700 dark:text-slate-300">
                  Mac 本机高速存储池文件夹
                </label>
                <button
                  type="button"
                  onClick={handleRescanSecondaryPath}
                  disabled={scanningSecondaryPath}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-purple-600 hover:bg-purple-50 disabled:opacity-50 dark:text-purple-300 dark:hover:bg-purple-500/10"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${scanningSecondaryPath ? 'animate-spin' : ''}`} />
                  {scanningSecondaryPath ? '扫描中...' : '重新扫描'}
                </button>
              </div>
              <div className="flex min-h-12 items-center gap-2 rounded-xl border border-purple-300 bg-purple-50 px-4 py-3 dark:border-purple-500/50 dark:bg-purple-500/10">
                <FolderOpen className="h-4 w-4 shrink-0 text-purple-600 dark:text-purple-300" />
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-slate-900 dark:text-white" title={secondaryCustomDir}>
                  {secondaryCustomDir || '未找到可用目录'}
                </span>
                {secondaryCustomDir && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />}
              </div>
              <p className="text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                已由 MacNAS 根据这块磁盘的实际挂载状态自动扫描并推荐目录。该目录只存放扩展盘镜像；虚拟机内固定访问路径为 /data/volume2-ssd。
              </p>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowSecondaryModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmBindSecondary}
                disabled={bindingSecondary || !secondaryCustomDir.trim()}
                className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-xs flex items-center space-x-1.5 transition disabled:opacity-50"
              >
                <Zap className="w-3.5 h-3.5 text-yellow-300" />
                <span>{bindingSecondary ? '正在挂载...' : '确认挂载为空间 2'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
