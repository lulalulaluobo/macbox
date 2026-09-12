import React, { useState, useEffect } from 'react';
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
import { SSHKeyModals } from './settings/SSHKeyModals';
import { useNASUserSettings } from './settings/useNASUserSettings';
import { SettingsAlert, SettingsHeader, SettingsAlertMessage } from './settings/SettingsHeader';

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
  const [alertMsg, setAlertMsg] = useState<SettingsAlertMessage | null>(null);

  const {
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
  } = useNASUserSettings({
    currentUser,
    onCurrentUserUpdated,
    onAlert: (alert) => setAlertMsg(alert),
  });

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
    try {
      const [uList, sCfg, tCfg, skillsCfg] = await Promise.all([
        api.getUsers().catch(() => []),
        api.getSSHConfig().catch(() => null),
        api.getTerminalSettings().catch(() => null),
        api.getTerminalSkills().catch(() => null),
        loadNASUsers(),
      ]);
      setUsers(uList || []);
      if (sCfg) setSSHConfig(sCfg);
      if (tCfg) setTerminalSettings(tCfg);
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
      <SettingsHeader loading={usersLoading || sshLoading} onRefresh={loadData} />
      {alertMsg && <SettingsAlert alert={alertMsg} onDismiss={() => setAlertMsg(null)} />}

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

      <SSHKeyModals
        showKeyModal={showKeyModal}
        generatedKeyResult={generatedKeyResult}
        showImportKeyModal={showImportKeyModal}
        importKeyText={importKeyText}
        importingKey={importingKey}
        sshConfig={sshConfig}
        primaryIP={primaryIP}
        onCloseKeyModal={() => setShowKeyModal(false)}
        onDownloadPrivateKey={downloadPrivateKeyFile}
        onImportKeyTextChange={setImportKeyText}
        onCloseImportKeyModal={() => setShowImportKeyModal(false)}
        onAddAuthorizedKey={handleAddAuthorizedKey}
      />
    </div>
  );
};
