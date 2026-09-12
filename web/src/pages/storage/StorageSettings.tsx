import React, { useState, useEffect } from 'react';
import {
  CheckCircle2, AlertCircle, RefreshCw, RotateCw
} from 'lucide-react';
import { DiskInfo, ManagedDisk, SambaStatus, SMBShare, FileItem } from '../../types';
import { api } from '../../api';
import { SMBSharingSection } from './settings/SMBSharingSection';
import { LocalMountSection } from './settings/LocalMountSection';
import { StorageDiskSection } from './settings/StorageDiskSection';
import { SMBShareModals } from './settings/SMBShareModals';
import { LocalMountModal } from './settings/LocalMountModal';
import { StorageBindingModals } from './settings/StorageBindingModals';
import { useLocalMountSettings } from './settings/useLocalMountSettings';

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

  const {
    localMounts,
    mountCandidates,
    mountHealth,
    showAddMountModal,
    showMountManager,
    newMountPath,
    newMountName,
    newMountCategory,
    newMountGuestTarget,
    newMountWritable,
    mountsLoading,
    loadLocalMounts,
    setShowAddMountModal,
    setShowMountManager,
    setNewMountPath,
    setNewMountName,
    setNewMountCategory,
    setNewMountGuestTarget,
    setNewMountWritable,
    openAddMount,
    selectMountCandidate,
    handleAddCustomMount,
    handleDeleteMount,
    handleToggleMountWritable,
    handleToggleMount,
  } = useLocalMountSettings({
    onAlert: (alert) => setAlertMsg(alert),
    onRestartRequired: () => setRestartPrompt(true),
    onRefreshOverview,
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [storageRes, sambaRes] = await Promise.all([
        api.getDisks(),
        api.getSambaStatus(),
        loadLocalMounts(),
      ]);
      setDisks(storageRes.disks || []);
      setManagedDisks(storageRes.managedDisks || []);
      setSelectedDiskId(storageRes.selectedDisk || '');
      setIsExternalActive(storageRes.isExternalActive || false);
      setDataPath(storageRes.dataPath || '');
      setSamba(sambaRes);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `加载存储数据失败: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

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
          onOpenAdd={openAddMount}
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

      <SMBShareModals
        showShareModal={showShareModal}
        editingShare={editingShare}
        shareFormName={shareFormName}
        shareFormPath={shareFormPath}
        shareFormComment={shareFormComment}
        shareFormWritable={shareFormWritable}
        shareFormGuestOk={shareFormGuestOk}
        shareFormEnabled={shareFormEnabled}
        shareActionLoading={shareActionLoading}
        showSharePathPicker={showSharePathPicker}
        sharePickerPath={sharePickerPath}
        sharePickerFolders={sharePickerFolders}
        sharePickerLoading={sharePickerLoading}
        onCloseShareModal={() => setShowShareModal(false)}
        onShareFormNameChange={setShareFormName}
        onShareFormPathPicker={openSharePathPicker}
        onShareFormCommentChange={setShareFormComment}
        onShareFormWritableChange={setShareFormWritable}
        onShareFormGuestOkChange={setShareFormGuestOk}
        onShareFormEnabledChange={setShareFormEnabled}
        onSaveShare={handleSaveShare}
        onCloseSharePathPicker={() => setShowSharePathPicker(false)}
        onLoadSharePickerFolders={loadSharePickerFolders}
        onConfirmSharePickerPath={confirmSharePickerPath}
      />
      <StorageBindingModals
        showBindModal={showBindModal}
        bindingDisk={bindingDisk}
        bindSizeGB={bindSizeGB}
        bindLoading={bindLoading}
        showUnbindConfirm={showUnbindConfirm}
        unbindLoading={unbindLoading}
        showSecondaryModal={false}
        secondaryTargetDisk={null}
        secondaryCustomDir=""
        bindingSecondary={false}
        scanningSecondaryPath={false}
        onCloseBindModal={() => setShowBindModal(false)}
        onBindSizeChange={setBindSizeGB}
        onConfirmBind={handleConfirmBind}
        onCloseUnbindConfirm={() => setShowUnbindConfirm(false)}
        onConfirmUnbind={() => void handleUnbind()}
        onCloseSecondaryModal={() => undefined}
        onRescanSecondaryPath={() => undefined}
        onConfirmBindSecondary={() => undefined}
      />
      <LocalMountModal
        open={showAddMountModal}
        candidates={mountCandidates}
        path={newMountPath}
        name={newMountName}
        category={newMountCategory}
        guestTarget={newMountGuestTarget}
        writable={newMountWritable}
        loading={mountsLoading}
        onClose={() => setShowAddMountModal(false)}
        onSubmit={handleAddCustomMount}
        onSelectCandidate={selectMountCandidate}
        onPathChange={setNewMountPath}
        onNameChange={setNewMountName}
        onCategoryChange={setNewMountCategory}
        onGuestTargetChange={setNewMountGuestTarget}
        onWritableChange={setNewMountWritable}
      />
      <StorageBindingModals
        showBindModal={false}
        bindingDisk={null}
        bindSizeGB={10}
        bindLoading={false}
        showUnbindConfirm={false}
        unbindLoading={false}
        showSecondaryModal={showSecondaryModal}
        secondaryTargetDisk={secondaryTargetDisk}
        secondaryCustomDir={secondaryCustomDir}
        bindingSecondary={bindingSecondary}
        scanningSecondaryPath={scanningSecondaryPath}
        onCloseBindModal={() => undefined}
        onBindSizeChange={() => undefined}
        onConfirmBind={() => undefined}
        onCloseUnbindConfirm={() => undefined}
        onConfirmUnbind={() => undefined}
        onCloseSecondaryModal={() => setShowSecondaryModal(false)}
        onRescanSecondaryPath={() => void handleRescanSecondaryPath()}
        onConfirmBindSecondary={() => void handleConfirmBindSecondary()}
      />
    </div>
  );
};
