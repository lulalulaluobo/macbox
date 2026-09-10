import React, { useState, useEffect } from 'react';
import {
  HardDrive, Check, Copy, KeyRound, CheckCircle2, AlertCircle, RefreshCw, FolderLock, RotateCw,
  Layers, X, Film, DownloadCloud, Image, FolderPlus, FolderSync, Trash2, ShieldCheck, Plus, ToggleLeft, ToggleRight, Folder, Lock, Unlock, Edit3, Zap, Power
} from 'lucide-react';
import { DiskInfo, ManagedDisk, SambaStatus, LocalMount, SMBShare, AvailableTarget } from '../../types';
import { api } from '../../api';

export interface StorageSettingsProps {
  configDirty?: boolean;
  onRefreshOverview?: () => void;
}

export const StorageSettings: React.FC<StorageSettingsProps> = ({ configDirty, onRefreshOverview }) => {
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

  // Local Mounts (VirtioFS)
  const [localMounts, setLocalMounts] = useState<LocalMount[]>([]);
  const [recommendedMounts, setRecommendedMounts] = useState<LocalMount[]>([]);
  const [showAddMountModal, setShowAddMountModal] = useState(false);
  const [newMountPath, setNewMountPath] = useState('');
  const [newMountName, setNewMountName] = useState('');
  const [newMountCategory, setNewMountCategory] = useState<'media' | 'downloads' | 'pictures' | 'custom'>('media');
  const [newMountWritable, setNewMountWritable] = useState(false);
  const [mountsLoading, setMountsLoading] = useState(false);

  // Password Modal
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  // External Disk Bind Modal
  const [showBindModal, setShowBindModal] = useState(false);
  const [bindingDisk, setBindingDisk] = useState<DiskInfo | null>(null);
  const [bindSizeGB, setBindSizeGB] = useState<number>(100);
  const [bindLoading, setBindLoading] = useState(false);
  const [restartPrompt, setRestartPrompt] = useState(false);
  const [restartingVM, setRestartingVM] = useState(false);

  // Secondary Volume Modal
  const [showSecondaryModal, setShowSecondaryModal] = useState(false);
  const [secondaryTargetDisk, setSecondaryTargetDisk] = useState<DiskInfo | null>(null);
  const [secondaryCustomDir, setSecondaryCustomDir] = useState('');
  const [bindingSecondary, setBindingSecondary] = useState(false);

  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [storageRes, sambaRes, mountsRes] = await Promise.all([
        api.getDisks(),
        api.getSambaStatus(),
        api.getLocalMounts().catch(() => ({ mounts: [], recommended: [] })),
      ]);
      setDisks(storageRes.disks || []);
      setManagedDisks(storageRes.managedDisks || []);
      setSelectedDiskId(storageRes.selectedDisk || '');
      setIsExternalActive(storageRes.isExternalActive || false);
      setDataPath(storageRes.dataPath || '');
      setSamba(sambaRes);
      setLocalMounts(mountsRes.mounts || []);
      setRecommendedMounts(mountsRes.recommended || []);
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
    // Estimate sensible size: min(200GB, 80% free space if available, max 50GB)
    let defaultGB = 100;
    if (disk.freeSpace > 0) {
      const freeGB = Math.floor(disk.freeSpace / (1024 * 1024 * 1024));
      if (freeGB > 10) {
        defaultGB = Math.min(500, Math.floor(freeGB * 0.8));
      }
    }
    setBindSizeGB(defaultGB);
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
    if (!confirm('确定要切回内置虚拟数据盘吗？外接盘上的数据将安全保留。')) return;
    try {
      const res = await api.unbindStorage();
      setAlertMsg({ type: 'success', text: res.message });
      setRestartPrompt(true);
      loadData();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `解除绑定失败: ${err.message}` });
    }
  };

  const handleOpenSecondaryModal = (disk: DiskInfo) => {
    setSecondaryTargetDisk(disk);
    let defaultDir = '/Volumes/Data/Users/Shared/MacNAS-SSD-Pool';
    if (disk.mountPoint && disk.mountPoint !== '/' && disk.mountPoint !== '/System/Volumes/Data') {
      defaultDir = `${disk.mountPoint}/MacNAS-SSD-Pool`;
    }
    setSecondaryCustomDir(defaultDir);
    setShowSecondaryModal(true);
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

  const handleQuickAddMount = async (rec: LocalMount) => {
    try {
      const res = await api.addLocalMount({
        ...rec,
        enabled: true,
      });
      setLocalMounts(res.mounts);
      setRecommendedMounts(res.recommended);
      setRestartPrompt(true);
      setAlertMsg({ type: 'success', text: `已开启直通挂载「${rec.name}」，请点击上方黄色按钮重启 VM 生效！` });
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `开启直通失败: ${err.message}` });
    }
  };

  const handleToggleMount = async (id: string) => {
    try {
      const res = await api.toggleLocalMount(id);
      setLocalMounts(res.mounts);
      setRecommendedMounts(res.recommended);
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
      setRestartPrompt(true);
      setAlertMsg({ type: 'success', text: res.message });
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `删除失败: ${err.message}` });
    }
  };

  const handleAddCustomMount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMountPath.trim()) return;
    setMountsLoading(true);
    try {
      let targetSub = 'shared/' + (newMountName.trim() || 'Folder');
      if (newMountCategory === 'media') targetSub = 'media/' + (newMountName.trim() || 'MacMedia');
      else if (newMountCategory === 'downloads') targetSub = 'downloads/' + (newMountName.trim() || 'MacDownloads');
      else if (newMountCategory === 'pictures') targetSub = 'photos/' + (newMountName.trim() || 'MacPhotos');

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
      setShowAddMountModal(false);
      setNewMountPath('');
      setNewMountName('');
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

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword.trim()) return;
    setPasswordLoading(true);
    try {
      await api.updateSambaPassword(newPassword.trim());
      setAlertMsg({ type: 'success', text: 'Samba 访问密码已更新！' });
      setShowPasswordModal(false);
      setNewPassword('');
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `密码修改失败: ${err.message}` });
    } finally {
      setPasswordLoading(false);
    }
  };


  const handleCopyShareAddress = (address: string, id: string) => {
    navigator.clipboard.writeText(address);
    setCopiedShareId(id);
    setTimeout(() => setCopiedShareId(null), 2000);
  };

  const handleOpenAddShare = (preset?: AvailableTarget) => {
    setEditingShare(null);
    if (preset) {
      let cleanName = preset.path.replace(/^\/data\/?/, '').replace(/[^a-zA-Z0-9_\-]/g, '-');
      if (!cleanName) cleanName = 'DataShare';
      if (preset.source === 'primary') cleanName = 'MacNAS';
      else if (preset.source === 'secondary') cleanName = 'MacNAS-SSD2';

      setShareFormName(cleanName);
      setShareFormPath(preset.path);
      setShareFormComment(preset.description || preset.name);
      setShareFormDiskSource((preset.source as any) || 'custom');
    } else {
      setShareFormName('');
      setShareFormPath('/data/');
      setShareFormComment('');
      setShareFormDiskSource('custom');
    }
    setShareFormWritable(true);
    setShareFormGuestOk(true);
    setShareFormEnabled(true);
    setShowShareModal(true);
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
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-white">存储与共享管理</h2>
          <p className="text-sm text-slate-400 mt-1">自动识别 Mac 外接存储，独立管理 ext4 数据盘与 Samba 局域网共享。</p>
        </div>
        <button
          onClick={loadData}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>刷新磁盘列表</span>
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
      {(restartPrompt || configDirty) && (
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

      {/* Section 1: SMB Multi-Share & Granular Permission Management Hub */}
      <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/95 to-indigo-950/40 border border-slate-800/90 shadow-2xl space-y-6">
        {/* Top Header & Global Actions */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between pb-5 border-b border-slate-800/80 gap-4">
          <div className="flex items-start space-x-3.5">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-sky-500/20 to-indigo-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400 shadow-inner shrink-0 mt-0.5">
              <FolderLock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-bold text-white tracking-wide">Samba (SMB) 局域网多硬盘与文件夹共享</h3>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold flex items-center space-x-1.5 ${
                  samba?.status === 'running'
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                    : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${samba?.status === 'running' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
                  <span>{samba?.status === 'running' ? '服务运行中' : '服务已停止'}</span>
                </span>
                <span className="text-xs px-2.5 py-0.5 rounded-full font-mono bg-slate-800 text-slate-300 border border-slate-700">
                  端口: {samba?.port || 4455}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                针对不同物理硬盘（主存储盘、第二高速盘）及自定义文件夹独立设置共享开关、读写安全权限及免密访客访问。
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => handleOpenAddShare()}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-sky-600/20 transition active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ 新增共享目录</span>
            </button>
            <button
              onClick={handleRestartSamba}
              disabled={restartingSamba}
              title="重新加载配置并平滑重启 Samba"
              className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition disabled:opacity-50"
            >
              <RotateCw className={`w-3.5 h-3.5 text-sky-400 ${restartingSamba ? 'animate-spin' : ''}`} />
              <span>{restartingSamba ? '重启中...' : '重启服务'}</span>
            </button>
            <button
              onClick={() => setShowPasswordModal(true)}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition"
            >
              <KeyRound className="w-3.5 h-3.5 text-amber-400" />
              <span>修改密码</span>
            </button>
            <button
              onClick={() => handleToggleSMBService(samba?.status !== 'running')}
              disabled={shareActionLoading === 'service-toggle'}
              className={`p-2 rounded-xl border text-xs font-medium transition ${
                samba?.status === 'running'
                  ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border-rose-500/30'
                  : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
              }`}
              title={samba?.status === 'running' ? '停止 Samba 共享服务' : '启动 Samba 共享服务'}
            >
              <Power className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Global Connection Instructions */}
        <div className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-800/90 text-xs text-slate-300 flex flex-col md:flex-row md:items-center justify-between gap-2.5">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-sky-400 shrink-0" />
            <span>
              <strong>连接指引：</strong>Mac 按 <kbd className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-200 font-mono">Cmd + K</kbd> 输入下方任一共享连接串；Windows 资源管理器地址栏输入 <code>\\&lt;IP&gt;\&lt;共享名&gt;</code>。
            </span>
          </div>
          <div className="flex items-center space-x-3 text-slate-400 text-[11px] shrink-0">
            <span>默认账户: <code className="text-sky-300 font-mono font-bold">{samba?.user || 'macnas'}</code></span>
            <span>•</span>
            <span>权限模型: <span className="text-slate-300">Linux 原生 ACL 0777</span></span>
          </div>
        </div>

        {/* Quick Add Presets (Quick-start badges for 硬盘1, 硬盘2, 媒体, 下载) */}
        {samba?.availableTargets && samba.availableTargets.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 flex items-center space-x-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>快捷预设：点击一键共享推荐磁盘与目录</span>
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {samba.availableTargets.map((target, idx) => {
                const alreadyShared = samba.shares?.some(s => s.path === target.path);
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleOpenAddShare(target)}
                    className="p-3 rounded-xl bg-slate-800/30 hover:bg-slate-800/80 border border-slate-800 hover:border-sky-500/40 text-left transition group flex items-start justify-between"
                  >
                    <div className="space-y-1 overflow-hidden pr-2">
                      <div className="flex items-center space-x-2">
                        {target.source === 'primary' ? (
                          <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-bold border border-indigo-500/30">主硬盘1</span>
                        ) : target.source === 'secondary' ? (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/30">第二硬盘2</span>
                        ) : target.source === 'passthrough' ? (
                          <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 text-[10px] font-bold border border-cyan-500/30">Mac直通</span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 text-[10px] font-bold">推荐目录</span>
                        )}
                        <span className="text-xs font-bold text-white group-hover:text-sky-400 transition truncate">
                          {target.name}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate">{target.description}</p>
                    </div>
                    <span className="shrink-0 text-[11px] font-semibold px-2 py-1 rounded-lg bg-slate-800 text-slate-300 group-hover:bg-sky-500 group-hover:text-white transition mt-0.5">
                      {alreadyShared ? '再添共享' : '+ 快速配置'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Multi-Share List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              当前已生效的共享目录清单 ({samba?.shares?.length || 0})
            </h4>
            <span className="text-[11px] text-slate-400">所有开启中的共享项均支持局域网设备同时访问</span>
          </div>

          <div className="grid grid-cols-1 gap-3.5">
            {(!samba?.shares || samba.shares.length === 0) ? (
              <div className="p-8 rounded-xl bg-slate-800/20 border border-dashed border-slate-800 text-center space-y-3">
                <FolderLock className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="text-sm text-slate-400">当前尚未配置任何共享目录</p>
                <button
                  type="button"
                  onClick={() => handleOpenAddShare()}
                  className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition shadow"
                >
                  立即创建首个共享
                </button>
              </div>
            ) : (
              samba.shares.map((share) => {
                const isToggling = shareActionLoading === `toggle-${share.id}`;
                const isDeleting = shareActionLoading === `delete-${share.id}`;
                const isCopied = copiedShareId === share.id;

                return (
                  <div
                    key={share.id}
                    className={`p-4 rounded-xl border transition flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                      share.enabled
                        ? 'bg-slate-800/40 border-slate-800 hover:border-slate-700/80 shadow-md'
                        : 'bg-slate-900/40 border-slate-800/40 opacity-60'
                    }`}
                  >
                    {/* Share Identification & Path */}
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-bold text-white font-mono tracking-tight flex items-center space-x-1.5">
                          <Folder className={`w-4 h-4 ${share.enabled ? 'text-sky-400' : 'text-slate-500'}`} />
                          <span>{share.name}</span>
                        </span>

                        {share.diskSource === 'primary' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 font-semibold">
                            主硬盘 1 (2TB 池)
                          </span>
                        )}
                        {share.diskSource === 'secondary' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 font-semibold flex items-center space-x-1">
                            <Zap className="w-2.5 h-2.5" />
                            <span>第二硬盘 (256GB SSD)</span>
                          </span>
                        )}
                        {share.diskSource === 'passthrough' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/25 font-semibold">
                            Mac 本机直通
                          </span>
                        )}
                        {(!share.diskSource || share.diskSource === 'custom') && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 font-semibold">
                            自定义目录
                          </span>
                        )}

                        {share.enabled ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 font-bold">
                            已开启共享
                          </span>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 font-bold">
                            已暂停共享
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                        <span>真实路径: <code className="text-slate-300 font-mono bg-slate-800/80 px-1.5 py-0.5 rounded">{share.path}</code></span>
                        {share.comment && <span>备注: <span className="text-slate-300">{share.comment}</span></span>}
                      </div>

                      {/* Connection Address Box */}
                      {share.address && (
                        <div className="inline-flex items-center space-x-2 px-2.5 py-1 rounded-lg bg-slate-900/80 border border-slate-800 max-w-full">
                          <span className="text-xs font-mono font-bold text-sky-300 truncate select-all">
                            {share.address}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopyShareAddress(share.address!, share.id)}
                            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition"
                            title="复制共享直连地址"
                          >
                            {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Permissions & Controls */}
                    <div className="flex flex-wrap items-center gap-3 shrink-0">
                      {/* Permission Badges */}
                      <div className="flex items-center space-x-2">
                        {share.writable ? (
                          <span className="text-xs px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold flex items-center space-x-1" title="允许用户在共享中新建、修改和删除文件">
                            <Unlock className="w-3 h-3" />
                            <span>读写 (RW)</span>
                          </span>
                        ) : (
                          <span className="text-xs px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20 font-semibold flex items-center space-x-1" title="只读保护模式，禁止客户端修改或删除文件">
                            <Lock className="w-3 h-3" />
                            <span>只读 (RO)</span>
                          </span>
                        )}

                        {share.guestOk ? (
                          <span className="text-xs px-2.5 py-1 rounded-lg bg-sky-500/10 text-sky-300 border border-sky-500/20 font-semibold" title="局域网设备无需输入密码即可免密访问">
                            访客免密
                          </span>
                        ) : (
                          <span className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 text-slate-400 border border-slate-700 font-semibold flex items-center space-x-1" title="必须输入 macnas 账号密码才能访问">
                            <ShieldCheck className="w-3 h-3 text-slate-400" />
                            <span>需密码</span>
                          </span>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center space-x-1.5 pl-2 border-l border-slate-700/60">
                        {/* Toggle Share Button */}
                        <button
                          type="button"
                          onClick={() => handleToggleShare(share)}
                          disabled={isToggling}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1 transition ${
                            share.enabled
                              ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                              : 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30'
                          }`}
                          title={share.enabled ? '点击暂停此共享' : '点击启用此共享'}
                        >
                          {isToggling ? (
                            <RotateCw className="w-3.5 h-3.5 animate-spin" />
                          ) : share.enabled ? (
                            <span>暂停</span>
                          ) : (
                            <span>启用</span>
                          )}
                        </button>

                        {/* Edit Button */}
                        <button
                          type="button"
                          onClick={() => handleOpenEditShare(share)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                          title="编辑共享设置"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>

                        {/* Delete Button */}
                        <button
                          type="button"
                          onClick={() => handleDeleteShare(share)}
                          disabled={isDeleting}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition"
                          title="删除此共享项"
                        >
                          {isDeleting ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Section 2: NAS Storage Physical Mapping Architecture */}
      <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <Layers className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-bold text-white">NAS 存储物理映射拓扑 (宿主机 ↔ 虚拟机 ↔ 共享)</h3>
          </div>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/20">
            {isExternalActive ? '外接存储镜像模式' : '内置隔离镜像模式'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 text-xs">
          <div className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-800 space-y-1.5">
            <span className="text-slate-400 font-bold block">💻 Mac 宿主机实际文件路径</span>
            <p className="font-mono text-sky-300 break-all select-all font-semibold text-[11px]">
              {dataPath || '~/.lima/_disks/macnas-data/datadisk'}
            </p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              数据保存在独立虚拟磁盘中，绝对不修改或抹除您磁盘上原有的任何照片、文档与 macOS 系统数据。
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-800 space-y-1.5">
            <span className="text-slate-400 font-bold block">🐧 Linux 虚拟机内部挂载点</span>
            <p className="font-mono text-emerald-300 font-bold text-sm">/data</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              底层格式化为原生 ext4 高速文件系统，彻底规避网络共享文件锁导致 Docker 数据库崩溃的隐患。
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-800 space-y-1.5">
            <span className="text-slate-400 font-bold block">🐳 Docker 容器各应用路径映射</span>
            <div className="space-y-0.5 font-mono text-[11px] text-slate-300">
              <div>• 影音媒体: <span className="text-sky-300">/data/media</span> (Jellyfin)</div>
              <div>• 离线下载: <span className="text-sky-300">/data/downloads</span> (qBittorrent)</div>
              <div>• 全盘文件: <span className="text-sky-300">/data</span> (FileBrowser / Alist)</div>
            </div>
          </div>
        </div>
      </div>

      {/* Section: Mac Local Folder Passthrough (VirtioFS Bind Mount) */}
      <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/95 to-sky-950/30 border border-slate-800/90 shadow-xl space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800/80 gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <FolderSync className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2.5">
                <h3 className="text-lg font-bold text-white">Mac 本地目录一键直通 (VirtioFS 高速映射)</h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  零拷贝 · 3~5 GB/s
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                无需把 2T 盘上原有的几百 GB 电影或照片二次拷贝进虚拟机，直接穿透挂载给 Jellyfin、FileBrowser 与局域网共享。
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowAddMountModal(true)}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-md shadow-sky-500/20 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>添加自定义直通</span>
          </button>
        </div>

        {/* Quick Presets Recommendation */}
        {recommendedMounts.length > 0 && (
          <div className="space-y-2.5">
            <span className="text-xs text-slate-400 font-bold block uppercase tracking-wider text-[11px]">
              检测到 Mac 本地推荐媒体库 (点击即刻开启直通):
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {recommendedMounts.map((rec) => (
                <div
                  key={rec.id}
                  className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-800 hover:border-sky-500/40 transition flex flex-col justify-between space-y-3"
                >
                  <div className="flex items-start space-x-2.5">
                    <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400 mt-0.5">
                      {rec.category === 'media' && <Film className="w-4 h-4" />}
                      {rec.category === 'downloads' && <DownloadCloud className="w-4 h-4" />}
                      {rec.category === 'pictures' && <Image className="w-4 h-4" />}
                      {rec.category === 'custom' && <Folder className="w-4 h-4" />}
                    </div>
                    <div>
                      <h5 className="font-bold text-slate-200 text-xs">{rec.name}</h5>
                      <p className="text-[11px] text-slate-400 font-mono truncate max-w-[170px]" title={rec.hostPath}>
                        {rec.hostPath}
                      </p>
                      <p className="text-[10px] text-sky-400/80 font-mono mt-0.5">
                        映射至: /data/{rec.guestTarget}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleQuickAddMount(rec)}
                    className="w-full py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500 text-sky-300 hover:text-white text-xs font-semibold border border-sky-500/30 transition flex items-center justify-center space-x-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>开启直通挂载</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Configured Mounts List */}
        <div className="space-y-2.5">
          <span className="text-xs text-slate-400 font-bold block uppercase tracking-wider text-[11px]">
            已配置的本地直通目录 ({localMounts.length})
          </span>

          {localMounts.length === 0 ? (
            <div className="p-6 rounded-xl bg-slate-950/40 border border-dashed border-slate-800 text-center text-slate-400 text-xs space-y-1">
              <p>暂无配置的本地直通目录。</p>
              <p className="text-[11px] text-slate-500">点击上方推荐库或自定义直通按钮，即可秒级接入 Mac 现有文件。</p>
            </div>
          ) : (
            <div className="space-y-2">
              {localMounts.map((m) => (
                <div
                  key={m.id}
                  className={`p-3.5 rounded-xl border transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                    m.enabled
                      ? 'bg-slate-800/60 border-slate-700/80'
                      : 'bg-slate-900/40 border-slate-800/60 opacity-60'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <div className={`p-2 rounded-lg ${m.enabled ? 'bg-sky-500/20 text-sky-400' : 'bg-slate-800 text-slate-500'}`}>
                      {m.category === 'media' && <Film className="w-4 h-4" />}
                      {m.category === 'downloads' && <DownloadCloud className="w-4 h-4" />}
                      {m.category === 'pictures' && <Image className="w-4 h-4" />}
                      {(!m.category || m.category === 'custom') && <Folder className="w-4 h-4" />}
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-slate-200 text-xs">{m.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                          m.writable ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-700 text-slate-300'
                        }`}>
                          {m.writable ? '允许写入' : '只读保护'}
                        </span>
                        <span className={`w-2 h-2 rounded-full ${m.enabled ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                      </div>
                      <div className="flex items-center space-x-2 text-[11px] text-slate-400 font-mono mt-0.5">
                        <span className="text-slate-300 truncate max-w-[200px]" title={m.hostPath}>{m.hostPath}</span>
                        <span>→</span>
                        <span className="text-sky-300">/data/{m.guestTarget}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 self-end sm:self-center">
                    <button
                      onClick={() => handleToggleMountWritable(m.id, !m.writable)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition flex items-center space-x-1.5 border ${
                        m.writable
                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white'
                      }`}
                      title={m.writable ? '当前为允许读写，点击切换为只读保护模式' : '当前为只读保护，点击切换为允许读写（可删除/修改文件）'}
                    >
                      {m.writable ? <Edit3 className="w-3.5 h-3.5 text-amber-400" /> : <Lock className="w-3.5 h-3.5 text-slate-400" />}
                      <span>{m.writable ? '允许读写' : '只读保护'}</span>
                    </button>
                    <button
                      onClick={() => handleToggleMount(m.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center space-x-1 ${
                        m.enabled
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20'
                          : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-white'
                      }`}
                    >
                      {m.enabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                      <span>{m.enabled ? '已启用' : '已停用'}</span>
                    </button>
                    <button
                      onClick={() => handleDeleteMount(m.id, m.name)}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-500/40 transition"
                      title="移除直通配置"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Security and Performance Badge */}
        <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-200 text-xs flex items-center space-x-2.5">
          <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0" />
          <span>
            <strong>安全保障机制</strong>: 直通挂载默认开启只读保护，容器操作绝不破坏 Mac 原文件；基于 Apple Virtualization 引擎，享受 3~5 GB/s 的 NVMe 原生极速。
          </span>
        </div>
      </div>

      {/* Section 4: Physical Disks List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-white">识别到的物理磁盘列表</h3>
            <p className="text-xs text-slate-400 mt-0.5">自动识别 APFS 卷与真实挂载点。推荐使用高速外接固态硬盘作为 NAS 数据盘。</p>
          </div>
          <span className="text-xs text-slate-400 font-mono">已识别 {disks.length} 个物理存储设备</span>
        </div>

        {disks.length === 0 && !loading ? (
          <div className="p-8 rounded-2xl bg-slate-900/40 border border-dashed border-slate-800 text-center text-slate-400 text-sm">
            未扫描到外接磁盘设备，请检查 USB/雷电外接硬盘是否插好。
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {disks.map((disk) => {
              const isSelected = disk.identifier === selectedDiskId || disk.deviceNode === selectedDiskId || disk.isSelected;
              return (
                <div
                  key={disk.identifier}
                  className={`p-5 rounded-2xl border transition-all flex flex-col justify-between space-y-4 ${
                    isSelected
                      ? 'bg-slate-900/90 border-sky-500/60 shadow-lg shadow-sky-500/10 ring-1 ring-sky-500/30'
                      : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                          disk.isExternal ? 'bg-sky-500/10 text-sky-400' : 'bg-slate-800 text-slate-400'
                        }`}>
                          <HardDrive className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <h4 className="font-bold text-white text-base truncate max-w-[200px]" title={disk.name}>
                              {disk.name}
                            </h4>
                            {disk.isExternal && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                                外接磁盘
                              </span>
                            )}
                            {disk.isSSD && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold bg-slate-800 text-slate-300">
                                SSD
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 font-mono mt-0.5">
                            {disk.volumeName ? `${disk.volumeName} · ` : ''}{disk.deviceNode} · {disk.fileSystem || 'RAW'}
                          </p>
                        </div>
                      </div>

                      {isSelected ? (
                        <span className="flex items-center space-x-1 text-xs px-2.5 py-1 rounded-full font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          <Check className="w-3.5 h-3.5" />
                          <span>当前主数据盘 (空间 1)</span>
                        </span>
                      ) : disk.isSecondary ? (
                        <span className="flex items-center space-x-1 text-xs px-2.5 py-1 rounded-full font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                          <Zap className="w-3.5 h-3.5 text-yellow-300" />
                          <span>扩展存储盘 (空间 2)</span>
                        </span>
                      ) : null}
                    </div>

                    {/* Capacity Bar */}
                    <div className="mt-4 space-y-1.5">
                      <div className="flex justify-between text-xs text-slate-400">
                        <span>总容量: <strong className="text-white">{disk.totalSizeString}</strong></span>
                        <span>
                          {disk.usedSpaceString ? `已用 ${disk.usedSpaceString} / 剩余 ${disk.freeSpaceString}` : (disk.usedPercent > 0 ? `${disk.usedPercent.toFixed(1)}% 已使用` : '就绪')}
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 ${isSelected ? 'bg-sky-500' : disk.isSecondary ? 'bg-purple-500' : 'bg-slate-600'}`}
                          style={{ width: `${Math.min(disk.usedPercent || 0, 100)}%` }}
                        />
                      </div>
                    </div>

                    {disk.mountPoint === '/System/Volumes/Data' && (
                      <div className="mt-2.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300/90 flex items-center space-x-1.5">
                        <span>💡</span>
                        <span>当前 Mac 的主引导系统与数据盘（包含您的现有系统与个人文件，100% 安全共存）</span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="pt-3 flex flex-col sm:flex-row items-start sm:items-center justify-between border-t border-slate-800/60 text-xs gap-2">
                    <span className="text-slate-400 truncate max-w-[220px]" title={disk.mountPoint}>
                      {disk.mountPoint ? `挂载点: ${disk.mountPoint}` : (disk.mounted ? '已挂载' : '未挂载系统目录')}
                    </span>

                    <div className="flex items-center space-x-2 shrink-0">
                      {isSelected ? (
                        <>
                          {isExternalActive ? (
                            <div className="flex items-center space-x-2">
                              <span className="text-[11px] text-emerald-400 font-mono truncate max-w-[140px]" title={dataPath}>
                                镜像: {dataPath ? dataPath.split('/').pop() : 'datadisk.img'}
                              </span>
                              <button
                                onClick={handleUnbind}
                                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-500/40 transition text-xs font-semibold"
                                title={`解除外接盘软链，切回默认虚拟盘 (当前镜像: ${dataPath})`}
                              >
                                解除外接绑定
                              </button>
                            </div>
                          ) : (
                            <span className="text-emerald-400 font-medium flex items-center space-x-1">
                              <Check className="w-3.5 h-3.5" />
                              <span>内置虚拟盘已激活</span>
                            </span>
                          )}
                        </>
                      ) : disk.isSecondary ? (
                        <div className="flex items-center space-x-2">
                          <span className="text-[11px] text-purple-300 font-mono">
                            卷: volume2-ssd
                          </span>
                          <button
                            onClick={handleUnbindSecondary}
                            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-500/40 transition text-xs font-semibold"
                            title="解除扩展存储空间 2 挂载"
                          >
                            解除扩展绑定
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => handleOpenSecondaryModal(disk)}
                            className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold transition shadow-md shadow-purple-600/20 flex items-center space-x-1.5"
                            title="将此硬盘挂载为扩展存储空间 2 (高速固态池)，与 2TB 外接盘协同运作"
                          >
                            <Zap className="w-3.5 h-3.5 text-yellow-300" />
                            <span>挂载为存储空间 2</span>
                          </button>
                          {disk.mountPoint && (
                            <button
                              onClick={() => handleOpenBindModal(disk)}
                              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 font-medium transition"
                              title="设为主数据盘 (替换现有主盘)"
                            >
                              设为主盘
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 3: Lima Managed Disks Info */}
      {managedDisks.length > 0 && (
        <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-white">Lima 托管 ext4 虚拟磁盘 (Managed Disks)</h4>
            <span className="text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full font-semibold">
              动态精简分配 (Thin Provisioning)
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {managedDisks.map((md) => (
              <div key={md.name} className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-800 flex flex-col justify-between space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-slate-200">{md.name}</span>
                    <span className="px-1.5 py-0.5 rounded font-mono text-[10px] bg-sky-500/20 text-sky-300">ext4</span>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400 font-semibold">
                    实际物理占用: {md.actualSizeString || '24 MB'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 space-y-0.5">
                  <p>虚拟容量上限: <strong className="text-slate-300 font-mono">{(md.size / 1024 / 1024 / 1024).toFixed(0)} GiB</strong> · 格式: <span className="font-mono text-slate-300">{md.format}</span></p>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    💡 采用 APFS 稀疏文件技术，存放多少数据才消耗多少物理空间，绝不提前占用主机 178GB。
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-5">
            <div>
              <h3 className="text-lg font-bold text-white">修改 Samba 共享密码</h3>
              <p className="text-xs text-slate-400 mt-1">此密码用于局域网用户 <code>macnas</code> 连接共享文件夹。</p>
            </div>

            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">新密码</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="请输入 6 位以上新密码"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={passwordLoading}
                  className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold shadow-md transition disabled:opacity-50"
                >
                  {passwordLoading ? '保存中...' : '确认修改'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit SMB Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-lg font-bold text-white">
                  {editingShare ? '编辑 SMB 共享目录与权限' : '新增 SMB 共享目录'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  为局域网设备定义共享名称、映射硬盘/目录及安全访问权限。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowShareModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveShare} className="space-y-4">
              {/* Quick Preset Selector */}
              {samba?.availableTargets && samba.availableTargets.length > 0 && !editingShare && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">快捷选择已有存储目标</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {samba.availableTargets.map((t, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          let cleanName = t.path.replace(/^\/data\/?/, '').replace(/[^a-zA-Z0-9_\-]/g, '-');
                          if (!cleanName) cleanName = 'DataShare';
                          if (t.source === 'primary') cleanName = 'MacNAS';
                          else if (t.source === 'secondary') cleanName = 'MacNAS-SSD2';

                          setShareFormName(cleanName);
                          setShareFormPath(t.path);
                          setShareFormComment(t.description || t.name);
                          setShareFormDiskSource((t.source as any) || 'custom');
                        }}
                        className={`p-2 rounded-xl text-left border text-xs transition flex items-center justify-between ${
                          shareFormPath === t.path
                            ? 'bg-sky-500/15 border-sky-500/40 text-sky-200'
                            : 'bg-slate-800/40 border-slate-800 hover:bg-slate-800 text-slate-300'
                        }`}
                      >
                        <div className="truncate pr-1">
                          <span className="font-bold block truncate">{t.name}</span>
                          <span className="text-[10px] text-slate-400 font-mono truncate">{t.path}</span>
                        </div>
                        {shareFormPath === t.path && <Check className="w-3.5 h-3.5 text-sky-400 shrink-0" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Share Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  共享服务名称 (Share Name) <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={shareFormName}
                  onChange={(e) => setShareFormName(e.target.value)}
                  placeholder="例如: MacNAS, MacNAS-SSD2, Movies"
                  required
                  pattern="^[a-zA-Z0-9_\-]+$"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm font-mono focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  局域网访问连接预览: <code className="text-sky-300 font-mono">smb://&lt;IP&gt;:{samba?.port || 4455}/{shareFormName || '名称'}</code> (仅支持英文、数字与连字符)
                </p>
              </div>

              {/* Target Path */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  虚拟机共享目录路径 (Path) <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={shareFormPath}
                  onChange={(e) => setShareFormPath(e.target.value)}
                  placeholder="例如: /data, /data/volume2-ssd, /data/media"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm font-mono focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  若目录不存在，系统将在保存时自动为您在虚拟机内创建。
                </p>
              </div>

              {/* Disk Source & Comment */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">关联物理存储来源</label>
                  <select
                    value={shareFormDiskSource}
                    onChange={(e) => setShareFormDiskSource(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-sky-500"
                  >
                    <option value="primary">主硬盘 1 存储池 (2TB)</option>
                    <option value="secondary">第二硬盘 2 本机高速盘 (256GB SSD)</option>
                    <option value="passthrough">Mac 本机直通目录</option>
                    <option value="custom">自定义文件夹目录</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">备注说明</label>
                  <input
                    type="text"
                    value={shareFormComment}
                    onChange={(e) => setShareFormComment(e.target.value)}
                    placeholder="例如: 家庭相册 / 高速传输专用"
                    className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              {/* Permissions & Auth Selector */}
              <div className="p-3.5 rounded-xl bg-slate-800/50 border border-slate-700/70 space-y-3">
                <span className="text-xs font-bold text-slate-300 block">共享权限与安全控制</span>

                {/* Read-Write vs Read-Only */}
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShareFormWritable(true)}
                    className={`p-3 rounded-xl border text-left transition flex items-start space-x-2 ${
                      shareFormWritable
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-white'
                        : 'bg-slate-800/40 border-slate-700/60 text-slate-400 hover:text-white'
                    }`}
                  >
                    <Unlock className={`w-4 h-4 mt-0.5 ${shareFormWritable ? 'text-emerald-400' : 'text-slate-500'}`} />
                    <div>
                      <span className="text-xs font-bold block">读写模式 (RW)</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">允许客户端上传、修改与删除文件</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShareFormWritable(false)}
                    className={`p-3 rounded-xl border text-left transition flex items-start space-x-2 ${
                      !shareFormWritable
                        ? 'bg-amber-500/15 border-amber-500/40 text-white'
                        : 'bg-slate-800/40 border-slate-700/60 text-slate-400 hover:text-white'
                    }`}
                  >
                    <Lock className={`w-4 h-4 mt-0.5 ${!shareFormWritable ? 'text-amber-400' : 'text-slate-500'}`} />
                    <div>
                      <span className="text-xs font-bold block">只读保护模式 (RO)</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">仅允许浏览与下载，防止误改误删</span>
                    </div>
                  </button>
                </div>

                {/* Guest Access Toggle */}
                <label className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700/60 transition cursor-pointer">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-slate-200 block">允许匿名访客免密直接访问 (Guest OK)</span>
                    <span className="text-[11px] text-slate-400 block">开启后局域网电视盒子、手机平板无需输入密码即可浏览；关闭后强制 macnas 密码验证。</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={shareFormGuestOk}
                    onChange={(e) => setShareFormGuestOk(e.target.checked)}
                    className="w-4 h-4 text-sky-500 rounded border-slate-700 focus:ring-0 cursor-pointer"
                  />
                </label>

                {/* Enabled Toggle */}
                <label className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700/60 transition cursor-pointer">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-slate-200 block">立即开启此项共享 (Enabled)</span>
                    <span className="text-[11px] text-slate-400 block">保存后立即通过 Samba 广播并在局域网中生效。</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={shareFormEnabled}
                    onChange={(e) => setShareFormEnabled(e.target.checked)}
                    className="w-4 h-4 text-emerald-500 rounded border-slate-700 focus:ring-0 cursor-pointer"
                  />
                </label>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowShareModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={shareActionLoading === 'save'}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-sky-600/20 transition flex items-center space-x-1.5 disabled:opacity-50"
                >
                  {shareActionLoading === 'save' ? (
                    <>
                      <RotateCw className="w-3.5 h-3.5 animate-spin" />
                      <span>正在应用配置...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>{editingShare ? '保存修改' : '立即创建并生效'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* External Disk Bind Modal */}
      {showBindModal && bindingDisk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">初始化外接 SSD 为 NAS 数据盘</h3>
                  <p className="text-xs text-slate-400">{bindingDisk.name} ({bindingDisk.deviceNode})</p>
                </div>
              </div>
              <button
                onClick={() => setShowBindModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs text-slate-300">
              <div className="p-3.5 rounded-xl bg-slate-800/50 border border-slate-700/60 space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">外接挂载目录:</span>
                  <span className="font-mono text-sky-300 font-semibold">{bindingDisk.mountPoint || '系统已识别，自动创建'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">可用空闲容量:</span>
                  <span className="font-mono text-white">{bindingDisk.freeSpaceString || bindingDisk.totalSizeString}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">文件系统模式:</span>
                  <span className="font-mono text-emerald-300">保持现有 APFS/ExFAT + Linux ext4 镜像容器</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  分配 NAS 数据镜像容量 (GB)
                </label>
                <div className="flex items-center space-x-3">
                  <input
                    type="number"
                    min={10}
                    max={20000}
                    value={bindSizeGB}
                    onChange={(e) => setBindSizeGB(parseInt(e.target.value) || 10)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm font-mono focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition"
                  />
                  <span className="text-sm font-semibold text-slate-400">GiB</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  采用 macOS 稀疏文件技术（Sparse Image），按需分配真实块，不会写满磁盘。
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-200 text-xs leading-relaxed space-y-1.5">
                <p className="font-bold text-sky-300">💡 为什么采用虚拟镜像容器方式？</p>
                <p>1. <strong>不格式化外接盘</strong>：盘上已有照片、备份或电影文件完好保留。</p>
                <p>2. <strong>原生 ext4 性能与稳定性</strong>：Docker 容器与 SQLite 数据库直接运行在 Linux 原生文件系统上，彻底消除网络共享文件锁死隐患。</p>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowBindModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmBind}
                disabled={bindLoading}
                className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-md shadow-sky-500/20 transition flex items-center space-x-1.5 disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{bindLoading ? '正在创建镜像并绑定...' : '确认绑定为数据盘'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Custom Local Mount Modal */}
      {showAddMountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center">
                  <FolderPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">添加 Mac 本地直通目录 (VirtioFS)</h3>
                  <p className="text-xs text-slate-400">穿透挂载已有大文件至 NAS 容器，零拷贝、3~5 GB/s 原生极速</p>
                </div>
              </div>
              <button
                onClick={() => setShowAddMountModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddCustomMount} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">
                  Mac 本地物理路径 <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={newMountPath}
                  onChange={(e) => setNewMountPath(e.target.value)}
                  placeholder="例如: /Users/luluen/Movies 或 /Volumes/Lexar/4K_Remux"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white font-mono placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition"
                />
                <p className="text-[11px] text-slate-400 mt-1">支持 Mac 主盘或外接 SSD 上的任意现有文件夹路径。</p>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">
                  直通展示名称 (可选)
                </label>
                <input
                  type="text"
                  value={newMountName}
                  onChange={(e) => setNewMountName(e.target.value)}
                  placeholder="例如: 4K蓝光影院 / 经典收藏"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1.5">
                  映射分类与 NAS 目标路径
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewMountCategory('media')}
                    className={`p-2.5 rounded-xl border text-center transition flex flex-col items-center space-y-1 ${
                      newMountCategory === 'media'
                        ? 'bg-sky-500/20 border-sky-500 text-sky-300 font-bold'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Film className="w-4 h-4" />
                    <span className="text-[11px]">影音 (/media)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewMountCategory('downloads')}
                    className={`p-2.5 rounded-xl border text-center transition flex flex-col items-center space-y-1 ${
                      newMountCategory === 'downloads'
                        ? 'bg-sky-500/20 border-sky-500 text-sky-300 font-bold'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <DownloadCloud className="w-4 h-4" />
                    <span className="text-[11px]">下载 (/downloads)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewMountCategory('pictures')}
                    className={`p-2.5 rounded-xl border text-center transition flex flex-col items-center space-y-1 ${
                      newMountCategory === 'pictures'
                        ? 'bg-sky-500/20 border-sky-500 text-sky-300 font-bold'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Image className="w-4 h-4" />
                    <span className="text-[11px]">照片 (/photos)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewMountCategory('custom')}
                    className={`p-2.5 rounded-xl border text-center transition flex flex-col items-center space-y-1 ${
                      newMountCategory === 'custom'
                        ? 'bg-sky-500/20 border-sky-500 text-sky-300 font-bold'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Folder className="w-4 h-4" />
                    <span className="text-[11px]">通用 (/shared)</span>
                  </button>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-200 block">写入权限设置</span>
                  <span className="text-[11px] text-slate-400">
                    {newMountWritable ? '允许容器修改与写入本地原文件' : '开启只读保护 (推荐，保护 Mac 本地文件防误删)'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setNewMountWritable(!newMountWritable)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    newMountWritable ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  }`}
                >
                  {newMountWritable ? '读写模式' : '只读保护'}
                </button>
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddMountModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={mountsLoading}
                  className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-md shadow-sky-500/20 transition flex items-center space-x-1.5 disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{mountsLoading ? '正在保存...' : '添加并直通挂载'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Secondary Disk Bind Modal */}
      {showSecondaryModal && secondaryTargetDisk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-3">
                <div className="p-3 rounded-2xl bg-purple-500/15 border border-purple-500/30 text-purple-400">
                  <Zap className="w-6 h-6 text-yellow-300" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">挂载为扩展存储空间 (存储空间 2)</h3>
                  <p className="text-xs text-slate-400">双硬盘同时挂载协同工作 · 充分利用 256GB 高速固态</p>
                </div>
              </div>
              <button
                onClick={() => setShowSecondaryModal(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">物理磁盘设备:</span>
                <span className="text-white font-mono font-bold">{secondaryTargetDisk.name} ({secondaryTargetDisk.totalSizeString})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">可用空闲容量:</span>
                <span className="text-emerald-400 font-mono font-bold">{secondaryTargetDisk.freeSpaceString} 可用</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">虚拟机目标挂载点:</span>
                <span className="text-purple-300 font-mono font-bold">/data/volume2-ssd</span>
              </div>
            </div>

            <div className="space-y-1.5 text-xs">
              <label className="block font-semibold text-slate-300">
                Mac 本机高速存储池目录 (持久化存储)
              </label>
              <input
                type="text"
                value={secondaryCustomDir}
                onChange={(e) => setSecondaryCustomDir(e.target.value)}
                placeholder="/Volumes/Data/Users/Shared/MacNAS-SSD-Pool"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-purple-500 transition"
              />
              <p className="text-[11px] text-slate-500">
                系统将在此目录下建立存储池，通过 Apple VirtioFS 原生直通给 NAS，享受 3~5 GB/s 的 NVMe 读写极速。
              </p>
            </div>

            <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-200 text-xs flex items-start space-x-2">
              <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <span>
                <strong>双盘协同架构</strong>: 主数据盘 (2TB 外接盘) 保留为主存储；256GB 本机固态将作为高速存储卷，在文件管理器与 Docker 中直接可用。
              </span>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowSecondaryModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-medium transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmBindSecondary}
                disabled={bindingSecondary}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-purple-600/20 flex items-center space-x-1.5 transition disabled:opacity-50"
              >
                <Zap className="w-3.5 h-3.5 text-yellow-300" />
                <span>{bindingSecondary ? '正在挂载...' : '立即挂载为存储空间 2'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
