import { useState } from 'react';
import type { FormEvent } from 'react';
import type { ConsoleUser } from '../../types';
import { api } from '../../api';

type SettingsAlert = { type: 'success' | 'error'; text: string };

interface UseConsoleUserSettingsOptions {
  currentUser?: ConsoleUser | null;
  onCurrentUserUpdated?: (user: ConsoleUser) => void;
  onAlert: (alert: SettingsAlert) => void;
}

export function useConsoleUserSettings({
  currentUser,
  onCurrentUserUpdated,
  onAlert,
}: UseConsoleUserSettingsOptions) {
  const [consoleUsers, setConsoleUsers] = useState<ConsoleUser[]>([]);
  const [consoleUsersLoading, setConsoleUsersLoading] = useState(false);
  const [showAddConsoleModal, setShowAddConsoleModal] = useState(false);
  const [newConsoleUsername, setNewConsoleUsername] = useState('');
  const [newConsoleDisplayName, setNewConsoleDisplayName] = useState('');
  const [newConsolePassword, setNewConsolePassword] = useState('');
  const [newConsoleConfirmPassword, setNewConsoleConfirmPassword] = useState('');
  const [newConsoleRole, setNewConsoleRole] = useState<'admin' | 'user'>('user');
  const [editingConsoleUser, setEditingConsoleUser] = useState<ConsoleUser | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editRole, setEditRole] = useState<'admin' | 'user'>('user');
  const [editEnabled, setEditEnabled] = useState(true);
  const [editNewPassword, setEditNewPassword] = useState('');
  const [deletingConsoleUser, setDeletingConsoleUser] = useState<ConsoleUser | null>(null);
  const [consoleActionLoading, setConsoleActionLoading] = useState(false);

  const loadConsoleUsers = async () => {
    setConsoleUsersLoading(true);
    try {
      const res = await api.getConsoleUsers();
      setConsoleUsers(res.users || []);
    } catch {
      // Keep the existing page behavior: the aggregate settings refresh reports
      // its own failures while this optional list can remain empty.
    } finally {
      setConsoleUsersLoading(false);
    }
  };

  const handleCreateConsoleUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!newConsoleUsername.trim() || !newConsolePassword) {
      onAlert({ type: 'error', text: "请填写账号和密码" });
      return;
    }
    if (Array.from(newConsolePassword).length < 8) {
      onAlert({ type: 'error', text: "密码至少8个字符" });
      return;
    }
    if (newConsolePassword !== newConsoleConfirmPassword) {
      onAlert({ type: 'error', text: "两次输入的密码不一致" });
      return;
    }

    setConsoleActionLoading(true);
    try {
      await api.createConsoleUser({
        username: newConsoleUsername.trim(),
        displayName: newConsoleDisplayName.trim() || undefined,
        password: newConsolePassword,
        role: newConsoleRole,
      });
      onAlert({ type: 'success', text: `后台账号“${newConsoleUsername}”已创建` });
      setShowAddConsoleModal(false);
      setNewConsoleUsername('');
      setNewConsoleDisplayName('');
      setNewConsolePassword('');
      setNewConsoleConfirmPassword('');
      setNewConsoleRole('user');
      await loadConsoleUsers();
    } catch (err: any) {
      onAlert({ type: 'error', text: `创建用户失败，原因：${err.message}` });
    } finally {
      setConsoleActionLoading(false);
    }
  };

  const handleOpenEditConsoleUser = (user: ConsoleUser) => {
    setEditingConsoleUser(user);
    setEditDisplayName(user.displayName || user.username);
    setEditRole(user.role);
    setEditEnabled(user.enabled);
    setEditNewPassword('');
  };

  const handleUpdateConsoleUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingConsoleUser) return;

    setConsoleActionLoading(true);
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
          onAlert({ type: 'error', text: "新密码至少8个字符" });
          setConsoleActionLoading(false);
          return;
        }
        payload.newPassword = editNewPassword.trim();
      }

      const res = await api.updateConsoleUser(editingConsoleUser.id, payload);
      onAlert({ type: 'success', text: `账号“${editingConsoleUser.username}”的设置已更新` });
      if (currentUser && currentUser.id === editingConsoleUser.id && onCurrentUserUpdated) {
        onCurrentUserUpdated(res.user);
      }
      setEditingConsoleUser(null);
      await loadConsoleUsers();
    } catch (err: any) {
      onAlert({ type: 'error', text: `更新用户失败，原因：${err.message}` });
    } finally {
      setConsoleActionLoading(false);
    }
  };

  const handleDeleteConsoleUser = async () => {
    if (!deletingConsoleUser) return;
    setConsoleActionLoading(true);
    try {
      await api.deleteConsoleUser(deletingConsoleUser.id);
      onAlert({ type: 'success', text: `后台账号“${deletingConsoleUser.username}”已删除` });
      setDeletingConsoleUser(null);
      await loadConsoleUsers();
    } catch (err: any) {
      onAlert({ type: 'error', text: `删除用户失败，原因：${err.message}` });
    } finally {
      setConsoleActionLoading(false);
    }
  };

  return {
    consoleUsers,
    consoleUsersLoading,
    showAddConsoleModal,
    newConsoleUsername,
    newConsoleDisplayName,
    newConsolePassword,
    newConsoleConfirmPassword,
    newConsoleRole,
    editingConsoleUser,
    editDisplayName,
    editRole,
    editEnabled,
    editNewPassword,
    deletingConsoleUser,
    consoleActionLoading,
    loadConsoleUsers,
    setShowAddConsoleModal,
    setNewConsoleUsername,
    setNewConsoleDisplayName,
    setNewConsolePassword,
    setNewConsoleConfirmPassword,
    setNewConsoleRole,
    setEditingConsoleUser,
    setEditDisplayName,
    setEditRole,
    setEditEnabled,
    setEditNewPassword,
    setDeletingConsoleUser,
    handleCreateConsoleUser,
    handleOpenEditConsoleUser,
    handleUpdateConsoleUser,
    handleDeleteConsoleUser,
  };
}
