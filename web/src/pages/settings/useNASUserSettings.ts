import { useState } from 'react';
import type { FormEvent } from 'react';
import type { NASUser } from '../../types';
import { api } from '../../api';

type SettingsAlert = { type: 'success' | 'error'; text: string };

interface UseNASUserSettingsOptions {
  currentUser?: NASUser | null;
  onCurrentUserUpdated?: (user: NASUser) => void;
  onAlert: (alert: SettingsAlert) => void;
}

export function useNASUserSettings({
  currentUser,
  onCurrentUserUpdated,
  onAlert,
}: UseNASUserSettingsOptions) {
  const [nasUsers, setNasUsers] = useState<NASUser[]>([]);
  const [nasUsersLoading, setNasUsersLoading] = useState(false);
  const [showAddNASModal, setShowAddNASModal] = useState(false);
  const [newNASUsername, setNewNASUsername] = useState('');
  const [newNASDisplayName, setNewNASDisplayName] = useState('');
  const [newNASPassword, setNewNASPassword] = useState('');
  const [newNASConfirmPassword, setNewNASConfirmPassword] = useState('');
  const [newNASRole, setNewNASRole] = useState<'admin' | 'user'>('user');
  const [editingNASUser, setEditingNASUser] = useState<NASUser | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editRole, setEditRole] = useState<'admin' | 'user'>('user');
  const [editEnabled, setEditEnabled] = useState(true);
  const [editNewPassword, setEditNewPassword] = useState('');
  const [deletingNASUser, setDeletingNASUser] = useState<NASUser | null>(null);
  const [nasActionLoading, setNasActionLoading] = useState(false);

  const loadNASUsers = async () => {
    setNasUsersLoading(true);
    try {
      const res = await api.getNASUsers();
      setNasUsers(res.users || []);
    } catch {
      // Keep the existing page behavior: the aggregate settings refresh reports
      // its own failures while this optional list can remain empty.
    } finally {
      setNasUsersLoading(false);
    }
  };

  const handleCreateNASUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!newNASUsername.trim() || !newNASPassword) {
      onAlert({ type: 'error', text: '请填写用户名和登录密码' });
      return;
    }
    if (Array.from(newNASPassword).length < 8) {
      onAlert({ type: 'error', text: '密码长度至少需要 8 个字符' });
      return;
    }
    if (newNASPassword !== newNASConfirmPassword) {
      onAlert({ type: 'error', text: '两次输入的新密码不一致' });
      return;
    }

    setNasActionLoading(true);
    try {
      await api.createNASUser({
        username: newNASUsername.trim(),
        displayName: newNASDisplayName.trim() || undefined,
        password: newNASPassword,
        role: newNASRole,
      });
      onAlert({ type: 'success', text: `NAS 控制台用户 [${newNASUsername}] 创建成功！` });
      setShowAddNASModal(false);
      setNewNASUsername('');
      setNewNASDisplayName('');
      setNewNASPassword('');
      setNewNASConfirmPassword('');
      setNewNASRole('user');
      await loadNASUsers();
    } catch (err: any) {
      onAlert({ type: 'error', text: `创建用户失败: ${err.message}` });
    } finally {
      setNasActionLoading(false);
    }
  };

  const handleOpenEditNASUser = (user: NASUser) => {
    setEditingNASUser(user);
    setEditDisplayName(user.displayName || user.username);
    setEditRole(user.role);
    setEditEnabled(user.enabled);
    setEditNewPassword('');
  };

  const handleUpdateNASUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingNASUser) return;

    setNasActionLoading(true);
    try {
      const payload: {
        displayName?: string;
        role: 'admin' | 'user';
        enabled: boolean;
        newPassword?: string;
      } = {
        displayName: editDisplayName.trim() || undefined,
        role: editRole,
        enabled: editEnabled,
      };
      if (editNewPassword.trim()) {
        if (Array.from(editNewPassword.trim()).length < 8) {
          onAlert({ type: 'error', text: '重置密码长度至少需要 8 个字符' });
          setNasActionLoading(false);
          return;
        }
        payload.newPassword = editNewPassword.trim();
      }

      const res = await api.updateNASUser(editingNASUser.id, payload);
      onAlert({ type: 'success', text: `用户 [${editingNASUser.username}] 配置已成功更新！` });
      if (currentUser && currentUser.id === editingNASUser.id && onCurrentUserUpdated) {
        onCurrentUserUpdated(res.user);
      }
      setEditingNASUser(null);
      await loadNASUsers();
    } catch (err: any) {
      onAlert({ type: 'error', text: `更新用户失败: ${err.message}` });
    } finally {
      setNasActionLoading(false);
    }
  };

  const handleDeleteNASUser = async () => {
    if (!deletingNASUser) return;
    setNasActionLoading(true);
    try {
      await api.deleteNASUser(deletingNASUser.id);
      onAlert({ type: 'success', text: `控制台用户 [${deletingNASUser.username}] 已成功删除！` });
      setDeletingNASUser(null);
      await loadNASUsers();
    } catch (err: any) {
      onAlert({ type: 'error', text: `删除用户失败: ${err.message}` });
    } finally {
      setNasActionLoading(false);
    }
  };

  return {
    nasUsers,
    nasUsersLoading,
    showAddNASModal,
    newNASUsername,
    newNASDisplayName,
    newNASPassword,
    newNASConfirmPassword,
    newNASRole,
    editingNASUser,
    editDisplayName,
    editRole,
    editEnabled,
    editNewPassword,
    deletingNASUser,
    nasActionLoading,
    loadNASUsers,
    setShowAddNASModal,
    setNewNASUsername,
    setNewNASDisplayName,
    setNewNASPassword,
    setNewNASConfirmPassword,
    setNewNASRole,
    setEditingNASUser,
    setEditDisplayName,
    setEditRole,
    setEditEnabled,
    setEditNewPassword,
    setDeletingNASUser,
    handleCreateNASUser,
    handleOpenEditNASUser,
    handleUpdateNASUser,
    handleDeleteNASUser,
  };
}
