import { useState } from 'react';
import type { FormEvent } from 'react';
import type { LocalMount, LocalMountCandidate, LocalMountHealth } from '../../../types';
import { api } from '../../../api';

type StorageAlert = { type: 'success' | 'error'; text: string };

interface UseLocalMountSettingsOptions {
  onAlert: (alert: StorageAlert) => void;
  onRestartRequired: () => void;
  onRefreshOverview?: () => void;
}

export function useLocalMountSettings({
  onAlert,
  onRestartRequired,
  onRefreshOverview,
}: UseLocalMountSettingsOptions) {
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

  const loadLocalMounts = async () => {
    const mountsRes = await api.getLocalMounts().catch(() => ({ mounts: [], recommended: [], candidates: [], health: [] }));
    setLocalMounts(mountsRes.mounts || []);
    setRecommendedMounts(mountsRes.recommended || []);
    setMountCandidates(mountsRes.candidates || []);
    setMountHealth(mountsRes.health || []);
  };

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

  const handleToggleMount = async (id: string) => {
    try {
      const res = await api.toggleLocalMount(id);
      setLocalMounts(res.mounts);
      setRecommendedMounts(res.recommended);
      void refreshMountData();
      onRestartRequired();
      onAlert({ type: 'success', text: res.message });
    } catch (err: any) {
      onAlert({ type: 'error', text: `操作失败: ${err.message}` });
    }
  };

  const handleToggleMountWritable = async (id: string, writable: boolean) => {
    try {
      const res = await api.toggleLocalMountWritable(id, writable);
      setLocalMounts(res.mounts);
      setRecommendedMounts(res.recommended);
      void refreshMountData();
      onAlert({ type: 'success', text: res.message });
      onRefreshOverview?.();
    } catch (err: any) {
      onAlert({ type: 'error', text: `切换权限失败: ${err.message}` });
    }
  };

  const handleDeleteMount = async (id: string, name: string) => {
    if (!confirm(`确定要移除「${name}」的直通挂载配置吗？（您的 Mac 本地原始文件不会受到任何影响）`)) return;
    try {
      const res = await api.deleteLocalMount(id);
      setLocalMounts(res.mounts);
      setRecommendedMounts(res.recommended);
      void refreshMountData();
      onRestartRequired();
      onAlert({ type: 'success', text: res.message });
    } catch (err: any) {
      onAlert({ type: 'error', text: `删除失败: ${err.message}` });
    }
  };

  const selectMountCandidate = (candidate: LocalMountCandidate) => {
    if (!candidate.available || candidate.configured) return;
    setNewMountPath(candidate.hostPath);
    setNewMountName(candidate.name);
    if (candidate.category === 'media' || candidate.category === 'downloads' || candidate.category === 'pictures' || candidate.category === 'custom') {
      setNewMountCategory(candidate.category);
      const targetName = candidate.name || '本机直通';
      setNewMountGuestTarget(
        candidate.category === 'media'
          ? `media/${targetName}`
          : candidate.category === 'downloads'
            ? `downloads/${targetName}`
            : candidate.category === 'pictures'
              ? `photos/${targetName}`
              : `shared/${targetName}`
      );
    }
  };

  const handleAddCustomMount = async (e: FormEvent) => {
    e.preventDefault();
    if (!newMountPath.trim()) {
      onAlert({ type: 'error', text: '请先填写一个 Mac 本地文件夹路径。' });
      return;
    }
    setMountsLoading(true);
    try {
      let targetSub = newMountGuestTarget.trim().replace(/^\/data\/?/, '').replace(/^\/+/, '');
      if (!targetSub) {
        targetSub =
          newMountCategory === 'media'
            ? `media/${newMountName.trim() || 'MacMedia'}`
            : newMountCategory === 'downloads'
              ? `downloads/${newMountName.trim() || 'MacDownloads'}`
              : newMountCategory === 'pictures'
                ? `photos/${newMountName.trim() || 'MacPhotos'}`
                : `shared/${newMountName.trim() || 'Folder'}`;
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
      onRestartRequired();
      onAlert({ type: 'success', text: '已保存本机目录直通配置。请重启 VM 后再访问；重启期间 Docker 服务会短暂离线并自动恢复。' });
    } catch (err: any) {
      onAlert({ type: 'error', text: `添加直通失败: ${err.message}` });
    } finally {
      setMountsLoading(false);
    }
  };

  const openAddMount = () => {
    setShowMountManager(false);
    setNewMountGuestTarget('media/MacMedia');
    setShowAddMountModal(true);
  };

  return {
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
  };
}
