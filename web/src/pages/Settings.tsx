import React, { useState, useEffect } from 'react';
import {
  RefreshCw,
  Plus,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Download,
  FileKey,
  X,
} from 'lucide-react';
import { SystemUser, SSHConfig, TerminalSettings, TerminalSkillsSettings, SSHKeyGenerationResult, NASUser } from '../types';
import { api } from '../api';
import { useTheme } from '../theme';
import { SettingsNavigation, SettingsSubTab } from './settings/SettingsNavigation';
import { SSHSettingsSection } from './settings/SSHSettingsSection';
import { TerminalSettingsSection } from './settings/TerminalSettingsSection';
import { NASUsersSection } from './settings/NASUsersSection';
import { SystemUsersSection } from './settings/SystemUsersSection';
import { RootPasswordSection } from './settings/RootPasswordSection';
import { AppearanceSettingsSection } from './settings/AppearanceSettingsSection';

interface SettingsProps {
  primaryIP?: string;
  currentUser?: NASUser | null;
  onCurrentUserUpdated?: (u: NASUser) => void;
}

export const Settings: React.FC<SettingsProps> = ({
  primaryIP = '192.168.2.123',
  currentUser,
  onCurrentUserUpdated,
}) => {
  const { theme, setTheme } = useTheme();
  const [activeSubTab, setActiveSubTab] = useState<SettingsSubTab>('nas_users');
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 0. NAS Users state (Web Console Authentication)
  const [nasUsers, setNasUsers] = useState<NASUser[]>([]);
  const [nasUsersLoading, setNasUsersLoading] = useState(false);
  const [showAddNASModal, setShowAddNASModal] = useState(false);
  const [newNASUsername, setNewNASUsername] = useState('');
  const [newNASDisplayName, setNewNASDisplayName] = useState('');
  const [newNASPassword, setNewNASPassword] = useState('');
  const [newNASConfirmPassword, setNewNASConfirmPassword] = useState('');
  const [newNASRole, setNewNASRole] = useState<'admin' | 'user'>('user');

  // Edit / Promote NAS User
  const [editingNASUser, setEditingNASUser] = useState<NASUser | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editRole, setEditRole] = useState<'admin' | 'user'>('user');
  const [editEnabled, setEditEnabled] = useState(true);
  const [editNewPassword, setEditNewPassword] = useState('');

  // Delete NAS User
  const [deletingNASUser, setDeletingNASUser] = useState<NASUser | null>(null);
  const [nasActionLoading, setNasActionLoading] = useState(false);

  // 1. Users state
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newIsSudo, setNewIsSudo] = useState(false);
  const [userActionLoading, setUserActionLoading] = useState(false);

  // Change password modal
  const [changePwdUser, setChangePwdUser] = useState<string | null>(null);
  const [targetNewPwd, setTargetNewPwd] = useState('');

  // 2. Root password state
  const [rootNewPwd, setRootNewPwd] = useState('');
  const [rootConfirmPwd, setRootConfirmPwd] = useState('');
  const [rootPwdSaving, setRootPwdSaving] = useState(false);
  const [showRootPwd, setShowRootPwd] = useState(false);

  // 3. SSH state
  const [sshConfig, setSSHConfig] = useState<SSHConfig>({
    enabled: true,
    status: 'running',
    port: 22,
    permitRootLogin: false,
    passwordAuthentication: false,
  });
  const [sshLoading, setSSHLoading] = useState(false);
  const [sshSaving, setSSHSaving] = useState(false);
  const [copiedSSH, setCopiedSSH] = useState(false);

  // SSH Key Generation & Management state
  const [generatingKey, setGeneratingKey] = useState(false);
  const [generatedKeyResult, setGeneratedKeyResult] = useState<SSHKeyGenerationResult | null>(null);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [copiedKeyText, setCopiedKeyText] = useState(false);
  const [copiedKeyCmd, setCopiedKeyCmd] = useState(false);
  const [authorizedKeys, setAuthorizedKeys] = useState<string[]>([]);
  const [showAuthorizedKeys, setShowAuthorizedKeys] = useState(false);
  const [loadingAuthKeys, setLoadingAuthKeys] = useState(false);
  const [showImportKeyModal, setShowImportKeyModal] = useState(false);
  const [importKeyText, setImportKeyText] = useState('');
  const [importingKey, setImportingKey] = useState(false);

  // 4. Terminal Settings state
  const [terminalSettings, setTerminalSettings] = useState<TerminalSettings>({
    defaultLoginUser: 'default',
    fontSize: 13,
    cursorStyle: 'block',
  });
  const [termSaving, setTermSaving] = useState(false);
  const [terminalSkills, setTerminalSkills] = useState<TerminalSkillsSettings>({
    enabled: false,
    hostPath: '',
    guestPaths: [
      '/home/macnasctl/.agents/skills', '/root/.agents/skills',
      '/home/macnasctl/.claude/skills', '/root/.claude/skills',
      '/home/macnasctl/.codex/skills', '/root/.codex/skills',
    ],
    readOnly: true,
    status: 'disabled',
    message: '未启用本机 Skill 目录映射',
    requiresRestart: false,
    candidates: [],
  });
  const [skillsEnabled, setSkillsEnabled] = useState(false);
  const [skillsHostPath, setSkillsHostPath] = useState('');
  const [skillsRiskConfirmed, setSkillsRiskConfirmed] = useState(false);
  const [skillsSaving, setSkillsSaving] = useState(false);

  const loadData = async () => {
    setUsersLoading(true);
    setSSHLoading(true);
    setNasUsersLoading(true);
    try {
      const [uList, sCfg, tCfg, nUsers, skillsCfg] = await Promise.all([
        api.getUsers().catch(() => []),
        api.getSSHConfig().catch(() => null),
        api.getTerminalSettings().catch(() => null),
        api.getNASUsers().catch(() => ({ users: [] })),
        api.getTerminalSkills().catch(() => null),
      ]);
      setUsers(uList || []);
      if (sCfg) setSSHConfig(sCfg);
      if (tCfg) setTerminalSettings(tCfg);
      if (nUsers && nUsers.users) setNasUsers(nUsers.users);
      if (skillsCfg) {
        setTerminalSkills(skillsCfg);
        setSkillsEnabled(skillsCfg.enabled);
        setSkillsHostPath(skillsCfg.hostPath || '');
        setSkillsRiskConfirmed(skillsCfg.enabled);
      }
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `加载系统设置失败: ${err.message}` });
    } finally {
      setUsersLoading(false);
      setSSHLoading(false);
      setNasUsersLoading(false);
    }
  };

  const loadNASUsers = async () => {
    setNasUsersLoading(true);
    try {
      const res = await api.getNASUsers();
      setNasUsers(res.users || []);
    } catch (err: any) {
      // ignore
    } finally {
      setNasUsersLoading(false);
    }
  };

  const handleCreateNASUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNASUsername.trim() || !newNASPassword) {
      setAlertMsg({ type: 'error', text: '请填写用户名和登录密码' });
      return;
    }
	if (Array.from(newNASPassword).length < 8) {
	  setAlertMsg({ type: 'error', text: '密码长度至少需要 8 个字符' });
      return;
    }
    if (newNASPassword !== newNASConfirmPassword) {
      setAlertMsg({ type: 'error', text: '两次输入的新密码不一致' });
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
      setAlertMsg({ type: 'success', text: `NAS 控制台用户 [${newNASUsername}] 创建成功！` });
      setShowAddNASModal(false);
      setNewNASUsername('');
      setNewNASDisplayName('');
      setNewNASPassword('');
      setNewNASConfirmPassword('');
      setNewNASRole('user');
      await loadNASUsers();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `创建用户失败: ${err.message}` });
    } finally {
      setNasActionLoading(false);
    }
  };

  const handleOpenEditNASUser = (u: NASUser) => {
    setEditingNASUser(u);
    setEditDisplayName(u.displayName || u.username);
    setEditRole(u.role);
    setEditEnabled(u.enabled);
    setEditNewPassword('');
  };

  const handleUpdateNASUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingNASUser) return;

    setNasActionLoading(true);
    try {
      const payload: any = {
        displayName: editDisplayName.trim() || undefined,
        role: editRole,
        enabled: editEnabled,
      };
      if (editNewPassword.trim()) {
		if (Array.from(editNewPassword.trim()).length < 8) {
		  setAlertMsg({ type: 'error', text: '重置密码长度至少需要 8 个字符' });
          setNasActionLoading(false);
          return;
        }
        payload.newPassword = editNewPassword.trim();
      }

      const res = await api.updateNASUser(editingNASUser.id, payload);
      setAlertMsg({ type: 'success', text: `用户 [${editingNASUser.username}] 配置已成功更新！` });
      if (currentUser && currentUser.id === editingNASUser.id && onCurrentUserUpdated) {
        onCurrentUserUpdated(res.user);
      }
      setEditingNASUser(null);
      await loadNASUsers();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `更新用户失败: ${err.message}` });
    } finally {
      setNasActionLoading(false);
    }
  };

  const handleDeleteNASUser = async () => {
    if (!deletingNASUser) return;
    setNasActionLoading(true);
    try {
      await api.deleteNASUser(deletingNASUser.id);
      setAlertMsg({ type: 'success', text: `控制台用户 [${deletingNASUser.username}] 已成功删除！` });
      setDeletingNASUser(null);
      await loadNASUsers();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `删除用户失败: ${err.message}` });
    } finally {
      setNasActionLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // --- Users Handlers ---
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim()) return;
    setUserActionLoading(true);
    try {
      await api.createUser({
        username: newUsername.trim(),
        password: newPassword.trim(),
        isSudo: newIsSudo,
      });
      setAlertMsg({ type: 'success', text: `用户 [${newUsername}] 创建成功！` });
      setShowAddUserModal(false);
      setNewUsername('');
      setNewPassword('');
      setNewIsSudo(false);
      await loadData();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `创建用户失败: ${err.message}` });
    } finally {
      setUserActionLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changePwdUser || !targetNewPwd) return;
    setUserActionLoading(true);
    try {
      await api.updateUserPassword(changePwdUser, targetNewPwd);
      setAlertMsg({ type: 'success', text: `用户 [${changePwdUser}] 密码修改成功！` });
      setChangePwdUser(null);
      setTargetNewPwd('');
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `修改密码失败: ${err.message}` });
    } finally {
      setUserActionLoading(false);
    }
  };

  const handleDeleteUser = async (username: string) => {
    if (!confirm(`确定要彻底删除系统用户 [${username}] 及其个人家目录吗？此操作不可逆！`)) return;
    try {
      await api.deleteUser(username);
      setAlertMsg({ type: 'success', text: `用户 [${username}] 已被删除` });
      await loadData();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `删除用户失败: ${err.message}` });
    }
  };

  // --- Root Password Handlers ---
  const handleSaveRootPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rootNewPwd) {
      setAlertMsg({ type: 'error', text: 'Root 密码不能为空' });
      return;
    }
    if (rootNewPwd !== rootConfirmPwd) {
      setAlertMsg({ type: 'error', text: '两次输入的 Root 密码不一致，请核对后重试' });
      return;
    }

    setRootPwdSaving(true);
    try {
      await api.updateRootPassword(rootNewPwd);
      setAlertMsg({ type: 'success', text: '超级管理员 (root) 密码已成功更新！' });
      setRootNewPwd('');
      setRootConfirmPwd('');
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `更新 Root 密码失败: ${err.message}` });
    } finally {
      setRootPwdSaving(false);
    }
  };

  // --- SSH Handlers ---
  const handleSaveSSHConfig = async () => {
    setSSHSaving(true);
    try {
      // MacNAS keeps SSH password authentication disabled. The console/root
      // passwords are local VM credentials and are never used for SSH.
      const safeSSHConfig = { ...sshConfig, passwordAuthentication: false };
      await api.updateSSHConfig(safeSSHConfig);
      setSSHConfig(safeSSHConfig);
      setAlertMsg({ type: 'success', text: 'SSH 配置已成功保存并即时生效！' });
      await loadData();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `更新 SSH 配置失败: ${err.message}` });
    } finally {
      setSSHSaving(false);
    }
  };

  const handleToggleSSH = async () => {
    setSSHSaving(true);
    try {
      const nextState = !(sshConfig.status === 'running');
      await api.toggleSSH(nextState);
      setAlertMsg({ type: 'success', text: nextState ? 'SSH 服务已成功启动' : 'SSH 服务已停止' });
      await loadData();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `操作 SSH 服务失败: ${err.message}` });
    } finally {
      setSSHSaving(false);
    }
  };

  const handleCopySSHCommand = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedSSH(true);
    setTimeout(() => setCopiedSSH(false), 2000);
  };

  const downloadPrivateKeyFile = (privKey: string, filename: string) => {
    // OpenSSH expects the PEM-style text file to end with a newline. The API
    // trims transport whitespace, so restore it before browser download.
    const normalizedKey = privKey.endsWith('\n') ? privKey : `${privKey}\n`;
    const blob = new Blob([normalizedKey], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleGenerateRootKey = async () => {
    setGeneratingKey(true);
    try {
      const res = await api.generateSSHRootKey();
      if (res.result) {
        setGeneratedKeyResult(res.result);
        setShowKeyModal(true);
        // Automatically trigger browser download of private key file
        downloadPrivateKeyFile(res.result.privateKey, res.result.filename);
        setAlertMsg({ type: 'success', text: 'Root SSH 私钥已成功生成并下载到您的本地电脑！' });
        // Refresh SSH config
        const fresh = await api.getSSHConfig();
        setSSHConfig(fresh);
      }
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `生成 SSH 密钥失败: ${err.message}` });
    } finally {
      setGeneratingKey(false);
    }
  };

  const handleLoadAuthorizedKeys = async () => {
    setLoadingAuthKeys(true);
    try {
      const res = await api.getSSHAuthorizedKeys();
      setAuthorizedKeys(res.keys || []);
      setShowAuthorizedKeys(true);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `获取已授权公钥列表失败: ${err.message}` });
    } finally {
      setLoadingAuthKeys(false);
    }
  };

  const handleAddAuthorizedKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importKeyText.trim()) return;
    setImportingKey(true);
    try {
      await api.addSSHAuthorizedKey(importKeyText.trim());
      setAlertMsg({ type: 'success', text: '公钥已成功添加到 Root 授权列表！' });
      setShowImportKeyModal(false);
      setImportKeyText('');
      await handleLoadAuthorizedKeys();
      const fresh = await api.getSSHConfig();
      setSSHConfig(fresh);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `添加公钥失败: ${err.message}` });
    } finally {
      setImportingKey(false);
    }
  };

  const handleClearAuthorizedKeys = async () => {
    if (!window.confirm('确认清空 Root 的所有已授权 SSH 公钥吗？清空后将无法使用已有密钥免密登录！')) {
      return;
    }
    try {
      await api.clearSSHAuthorizedKeys();
      setAlertMsg({ type: 'success', text: '已清空 Root 的所有已授权公钥' });
      setAuthorizedKeys([]);
      const fresh = await api.getSSHConfig();
      setSSHConfig(fresh);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `清空失败: ${err.message}` });
    }
  };

  // --- Terminal Settings Handlers ---
  const handleSaveTerminalSettings = async (userChoice: 'root' | 'default') => {
    setTermSaving(true);
    const updated: TerminalSettings = {
      ...terminalSettings,
      defaultLoginUser: userChoice,
    };
    try {
      await api.updateTerminalSettings(updated);
      setTerminalSettings(updated);
      setAlertMsg({ type: 'success', text: `终端设置已更新: 进入终端后默认以 ${userChoice === 'root' ? 'Root 超级管理员' : '普通用户'} 登录` });
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `保存终端设置失败: ${err.message}` });
    } finally {
      setTermSaving(false);
    }
  };

  const handleSaveTerminalSkills = async () => {
    const hostPath = skillsHostPath.trim();
    if (skillsEnabled && !hostPath) {
      setAlertMsg({ type: 'error', text: '请先选择或填写本机 AI Skill 目录' });
      return;
    }
    if (skillsEnabled && !skillsRiskConfirmed) {
      setAlertMsg({ type: 'error', text: '请先阅读风险提示并勾选确认，再启用 Skill 映射' });
      return;
    }

    setSkillsSaving(true);
    try {
      const res = await api.updateTerminalSkills({ enabled: skillsEnabled, hostPath, confirmRisk: skillsEnabled && skillsRiskConfirmed });
      setTerminalSkills(res.settings);
      setSkillsEnabled(res.settings.enabled);
      setSkillsHostPath(res.settings.hostPath || '');
      setSkillsRiskConfirmed(res.settings.enabled);
      setAlertMsg({ type: 'success', text: res.message });
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `保存 AI Skill 映射失败: ${err.message}` });
    } finally {
      setSkillsSaving(false);
    }
  };

  const handleUseSkillsCandidate = (hostPath: string) => {
    setSkillsHostPath(hostPath);
    setSkillsEnabled(true);
    setSkillsRiskConfirmed(false);
  };

  return (
    <div className="space-y-4 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-2xl">设置</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">账户、安全与系统偏好</p>
        </div>

        <button
          onClick={loadData}
          aria-label="刷新设置状态"
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${usersLoading || sshLoading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">刷新</span>
        </button>
      </div>

      {/* Alert Banner */}
      {alertMsg && (
        <div
          className={`p-4 rounded-2xl text-xs flex items-center justify-between transition-all ${
            alertMsg.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center space-x-2.5">
            {alertMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
            <span>{alertMsg.text}</span>
          </div>
          <button onClick={() => setAlertMsg(null)} className="text-xs opacity-70 hover:opacity-100 ml-4 font-bold">
            ✕
          </button>
        </div>
      )}

      <SettingsNavigation activeSubTab={activeSubTab} onChange={setActiveSubTab} />

      {activeSubTab === 'nas_users' && (
        <NASUsersSection
          users={nasUsers}
          loading={nasUsersLoading}
          currentUser={currentUser}
          showAddModal={showAddNASModal}
          newUsername={newNASUsername}
          newDisplayName={newNASDisplayName}
          newPassword={newNASPassword}
          newConfirmPassword={newNASConfirmPassword}
          newRole={newNASRole}
          editingUser={editingNASUser}
          editDisplayName={editDisplayName}
          editRole={editRole}
          editEnabled={editEnabled}
          editNewPassword={editNewPassword}
          deletingUser={deletingNASUser}
          actionLoading={nasActionLoading}
          onOpenAdd={() => setShowAddNASModal(true)}
          onCloseAdd={() => setShowAddNASModal(false)}
          onNewUsernameChange={setNewNASUsername}
          onNewDisplayNameChange={setNewNASDisplayName}
          onNewPasswordChange={setNewNASPassword}
          onNewConfirmPasswordChange={setNewNASConfirmPassword}
          onNewRoleChange={setNewNASRole}
          onCreate={handleCreateNASUser}
          onOpenEdit={handleOpenEditNASUser}
          onCloseEdit={() => setEditingNASUser(null)}
          onEditDisplayNameChange={setEditDisplayName}
          onEditRoleChange={setEditRole}
          onEditEnabledChange={setEditEnabled}
          onEditNewPasswordChange={setEditNewPassword}
          onUpdate={handleUpdateNASUser}
          onRequestDelete={setDeletingNASUser}
          onCloseDelete={() => setDeletingNASUser(null)}
          onDelete={handleDeleteNASUser}
        />
      )}

      {activeSubTab === 'users' && (
        <SystemUsersSection
          users={users}
          showAddModal={showAddUserModal}
          username={newUsername}
          password={newPassword}
          isSudo={newIsSudo}
          changePasswordUser={changePwdUser}
          targetPassword={targetNewPwd}
          actionLoading={userActionLoading}
          onOpenAdd={() => setShowAddUserModal(true)}
          onCloseAdd={() => setShowAddUserModal(false)}
          onUsernameChange={setNewUsername}
          onPasswordChange={setNewPassword}
          onSudoChange={setNewIsSudo}
          onCreate={handleCreateUser}
          onOpenChangePassword={(username) => {
            setChangePwdUser(username);
            setTargetNewPwd('');
          }}
          onCloseChangePassword={() => setChangePwdUser(null)}
          onTargetPasswordChange={setTargetNewPwd}
          onUpdatePassword={handleUpdatePassword}
          onDelete={handleDeleteUser}
        />
      )}

      {activeSubTab === 'rootpwd' && (
        <RootPasswordSection
          password={rootNewPwd}
          confirmPassword={rootConfirmPwd}
          saving={rootPwdSaving}
          visible={showRootPwd}
          onPasswordChange={setRootNewPwd}
          onConfirmPasswordChange={setRootConfirmPwd}
          onToggleVisibility={() => setShowRootPwd((visible) => !visible)}
          onSubmit={handleSaveRootPassword}
        />
      )}

      {/* ===================== 3. SSH Settings Panel ===================== */}
      {activeSubTab === 'ssh' && (
        <SSHSettingsSection
          sshConfig={sshConfig}
          sshSaving={sshSaving}
          copiedSSH={copiedSSH}
          generatingKey={generatingKey}
          generatedKeyResult={generatedKeyResult}
          authorizedKeys={authorizedKeys}
          showAuthorizedKeys={showAuthorizedKeys}
          loadingAuthKeys={loadingAuthKeys}
          onToggleSSH={handleToggleSSH}
          onSaveSSHConfig={handleSaveSSHConfig}
          onSSHConfigChange={setSSHConfig}
          onCopySSHCommand={handleCopySSHCommand}
          onGenerateRootKey={handleGenerateRootKey}
          onLoadAuthorizedKeys={handleLoadAuthorizedKeys}
          onCollapseAuthorizedKeys={() => setShowAuthorizedKeys(false)}
          onOpenImportKey={() => setShowImportKeyModal(true)}
          onClearAuthorizedKeys={handleClearAuthorizedKeys}
          onCopyAuthorizedKey={(key) => {
            navigator.clipboard.writeText(key);
            setAlertMsg({ type: 'success', text: '公钥内容已复制到剪贴板！' });
          }}
        />
      )}

      {/* ===================== 4. Terminal Settings Panel ===================== */}
      {activeSubTab === 'terminal' && (
        <TerminalSettingsSection
          terminalSettings={terminalSettings}
          termSaving={termSaving}
          terminalSkills={terminalSkills}
          skillsEnabled={skillsEnabled}
          skillsHostPath={skillsHostPath}
          skillsRiskConfirmed={skillsRiskConfirmed}
          skillsSaving={skillsSaving}
          onSaveTerminalSettings={handleSaveTerminalSettings}
          onSaveTerminalSkills={handleSaveTerminalSkills}
          onUseSkillsCandidate={handleUseSkillsCandidate}
          onSkillsRiskConfirmedChange={(confirmed) => setSkillsRiskConfirmed(confirmed)}
          onToggleSkills={() => setSkillsEnabled((enabled) => {
            const next = !enabled;
            if (next) setSkillsRiskConfirmed(false);
            return next;
          })}
          onSkillsHostPathChange={(hostPath) => {
            setSkillsHostPath(hostPath);
            setSkillsRiskConfirmed(false);
          }}
        />
      )}

      {activeSubTab === 'appearance' && (
        <AppearanceSettingsSection theme={theme} onThemeChange={setTheme} />
      )}

      {/* ===================== Modal: Generated Root SSH Key ===================== */}
      {showKeyModal && generatedKeyResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-xl rounded-3xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <FileKey className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Root SSH 私钥已生成并自动下载</h3>
                  <p className="text-xs text-emerald-400 font-medium">公钥已自动部署至虚拟机 /root/.ssh/authorized_keys</p>
                </div>
              </div>
              <button
                onClick={() => setShowKeyModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Key metadata */}
              <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-1.5 font-mono">
                <div className="flex justify-between text-slate-400">
                  <span>私钥文件名:</span>
                  <span className="text-amber-300 font-bold">{generatedKeyResult.filename}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>密钥算法:</span>
                  <span className="text-slate-200">{generatedKeyResult.keyType.toUpperCase()} (高安全性椭圆曲线)</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>密钥指纹:</span>
                  <span className="text-slate-200">{generatedKeyResult.fingerprint}</span>
                </div>
              </div>

              {/* Usage Guide */}
              <div className="space-y-2 font-sans">
                <h4 className="font-bold text-slate-200">使用指南（必须在运行 MacNAS 的 Mac 的 macOS“终端”中运行）:</h4>

                <div className="p-3 rounded-xl bg-black/60 border border-slate-800 font-mono text-[11px] space-y-2 text-slate-300">
                  <div>
                    <span className="text-slate-500"># 步骤 1: 设置严格权限 (macOS / Linux 必需)</span>
                    <div className="text-amber-300 select-all">chmod 600 ~/Downloads/{generatedKeyResult.filename}</div>
                  </div>

                  <div>
                    <span className="text-slate-500"># 步骤 2: 在 Mac 宿主机终端执行（端口 {sshConfig.sshLocalPort || 58107}）</span>
                    <div className="text-sky-300 select-all">
                      ssh -o StrictHostKeyChecking=accept-new -i ~/Downloads/{generatedKeyResult.filename} -p {sshConfig.sshLocalPort || 58107} root@127.0.0.1
                    </div>
                  </div>

                  <div>
                    <span className="text-slate-500"># 步骤 3: 局域网其他设备（当前不提供默认直连）</span>
                    <div className="text-emerald-300">当前未开放宿主机 22 端口；运行 Mac 请始终使用步骤 2 的 127.0.0.1:{sshConfig.sshLocalPort || 58107}。</div>
                  </div>
                </div>
              </div>

              {/* Important security warning */}
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300/90 text-[11px] leading-relaxed">
                ⚠️ <strong>安全提示</strong>: 私钥文件已自动下载至运行浏览器的 Mac 的 Downloads 文件夹中，文件名包含 `.txt` 扩展名也可以直接用于 SSH。为确保绝对安全，MacNAS 服务器端已彻底擦除私钥明文，请妥善保存该私钥文件。
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => downloadPrivateKeyFile(generatedKeyResult.privateKey, generatedKeyResult.filename)}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center space-x-1.5 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>再次下载私钥</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(generatedKeyResult.privateKey);
                    setCopiedKeyText(true);
                    setTimeout(() => setCopiedKeyText(false), 2000);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center space-x-1.5 transition"
                >
                  {copiedKeyText ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKeyText ? '已复制私钥' : '复制私钥文本'}</span>
                </button>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    const cmd = `chmod 600 ~/Downloads/${generatedKeyResult.filename} && ssh -o StrictHostKeyChecking=accept-new -i ~/Downloads/${generatedKeyResult.filename} -p ${sshConfig.sshLocalPort || sshConfig.port} root@${sshConfig.sshLocalPort ? '127.0.0.1' : primaryIP}`;
                    navigator.clipboard.writeText(cmd);
                    setCopiedKeyCmd(true);
                    setTimeout(() => setCopiedKeyCmd(false), 2000);
                  }}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition flex items-center space-x-1.5 shadow-md shadow-amber-500/20"
                >
                  {copiedKeyCmd ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKeyCmd ? '已复制命令' : '一键复制完整连接命令'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowKeyModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================== Modal: Import Existing Public Key ===================== */}
      {showImportKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <Plus className="w-4 h-4 text-emerald-400" />
                <span>导入已有 SSH 公钥到 Root 授权列表</span>
              </h3>
              <button
                onClick={() => setShowImportKeyModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              请粘贴您本地生成的公钥（通常位于 <code>~/.ssh/id_ed25519.pub</code> 或 <code>~/.ssh/id_rsa.pub</code>）：
            </p>

            <form onSubmit={handleAddAuthorizedKey} className="space-y-4">
              <textarea
                value={importKeyText}
                onChange={(e) => setImportKeyText(e.target.value)}
                placeholder="ssh-ed25519 AAAA... 用户名@设备名"
                className="w-full h-32 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:outline-none focus:border-sky-500 resize-none leading-relaxed"
                required
                autoFocus
              />

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowImportKeyModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={importingKey || !importKeyText.trim()}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition disabled:opacity-50 flex items-center space-x-1.5"
                >
                  {importingKey && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{importingKey ? '导入中...' : '确认导入公钥'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
