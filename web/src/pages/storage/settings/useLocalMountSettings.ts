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
  const [pickingHostDirectory, setPickingHostDirectory] = useState(false);

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
      onAlert({ type: 'error', text: `操作失败，原因：${err.message}` });
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
      onAlert({ type: 'error', text: `切换权限失败，原因：${err.message}` });
    }
  };

  const handleDeleteMount = async (id: string, name: string) => {
    if (!confirm(`移除“${name}”的文件接入？
Mac上的原始文件保持不变。`)) return;
    try {
      const res = await api.deleteLocalMount(id);
      setLocalMounts(res.mounts);
      setRecommendedMounts(res.recommended);
      void refreshMountData();
      onRestartRequired();
      onAlert({ type: 'success', text: res.message });
    } catch (err: any) {
      onAlert({ type: 'error', text: `删除失败，原因：${err.message}` });
    }
  };

  const selectMountCandidate = (candidate: LocalMountCandidate) => {
    if (!candidate.available || candidate.configured) return;
    setNewMountPath(candidate.hostPath);
    setNewMountName(candidate.name);
    if (candidate.category === 'media' || candidate.category === 'downloads' || candidate.category === 'pictures' || candidate.category === 'custom') {
      setNewMountCategory(candidate.category);
      const targetName = candidate.name || "本机文件";
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
      onAlert({ type: 'error', text: "请先填写本机文件夹的完整位置" });
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
        name: newMountName.trim() || newMountPath.split('/').pop() || "本机文件",
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
      onAlert({ type: 'success', text: "设置已保存，重启系统后生效。\n重启期间应用会暂时离线。\n完成后会自动恢复运行。" });
    } catch (err: any) {
      onAlert({ type: 'error', text: `添加文件接入失败，原因：${err.message}` });
    } finally {
      setMountsLoading(false);
    }
  };

  const handlePickHostDirectory = async () => {
    setPickingHostDirectory(true);
    try {
      const result = await api.pickHostDirectory();
      if (result.cancelled || !result.path) return;

      setNewMountPath(result.path);
      if (!newMountName.trim()) {
        const leaf = result.path.split('/').filter(Boolean).pop();
        if (leaf) setNewMountName(leaf);
      }
    } catch (err: any) {
      onAlert({ type: 'error', text: `选择本机目录失败，原因：${err.message}` });
    } finally {
      setPickingHostDirectory(false);
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
    pickingHostDirectory,
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
    handlePickHostDirectory,
    handleDeleteMount,
    handleToggleMountWritable,
    handleToggleMount,
  };
}
