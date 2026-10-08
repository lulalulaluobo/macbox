import React, { useState, useEffect } from 'react';
import { SystemUser, SSHConfig, TerminalSettings, TerminalSkillsSettings, SSHKeyGenerationResult, ConsoleUser, SystemOverview } from '../types';
import { api } from '../api';
import { useTheme } from '../theme';
import { SettingsNavigation, SettingsSubTab, settingsTabs } from './settings/SettingsNavigation';
import { SSHSettingsSection } from './settings/SSHSettingsSection';
import { TerminalSettingsSection } from './settings/TerminalSettingsSection';
import { ConsoleUsersSection } from './settings/ConsoleUsersSection';
import { SystemUsersSection } from './settings/SystemUsersSection';
import { RootPasswordSection } from './settings/RootPasswordSection';
import { AppearanceSettingsSection } from './settings/AppearanceSettingsSection';
import { SSHKeyModals } from './settings/SSHKeyModals';
import { useConsoleUserSettings } from './settings/useConsoleUserSettings';
import { SettingsAlert, SettingsHeader, SettingsAlertMessage } from './settings/SettingsHeader';
import { BackupRestoreSection } from './settings/BackupRestoreSection';
import { NetworkSettingsSection } from './settings/NetworkSettingsSection';
import { VersionManagementSection } from './settings/VersionManagementSection';
import { SettingsOverviewSection } from './settings/SettingsOverviewSection';
import { TailscaleSettingsSection } from './settings/TailscaleSettingsSection';

interface SettingsProps {
 overview?: SystemOverview | null;
 onRefreshOverview?: () => void;
 onNavigateTab?: (tab: 'storage_settings' | 'smb_sharing') => void;
  primaryIP?: string;
  currentUser?: ConsoleUser | null;
  onCurrentUserUpdated?: (u: ConsoleUser) => void;
}

export const Settings: React.FC<SettingsProps> = ({
 overview, onRefreshOverview, onNavigateTab,
  currentUser,
  onCurrentUserUpdated,
}) => {
  const { theme, setTheme } = useTheme();
  const [activeSubTab, setActiveSubTab] = useState<SettingsSubTab>(() => {
 const stored = localStorage.getItem('macbox-settings-tab');
 return settingsTabs.find(tab => tab.id === stored && (!tab.admin || currentUser?.role === 'admin'))?.id || 'overview';
 });
  const [alertMsg, setAlertMsg] = useState<SettingsAlertMessage | null>(null);

  const {
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
  } = useConsoleUserSettings({
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
      '/home/macboxctl/.agents/skills', '/root/.agents/skills',
      '/home/macboxctl/.claude/skills', '/root/.claude/skills',
      '/home/macboxctl/.codex/skills', '/root/.codex/skills',
    ],
    readOnly: true,
    status: 'disabled',
    message: "还没有接入助手技能",
    requiresRestart: false,
    candidates: [],
  });
  const [skillsEnabled, setSkillsEnabled] = useState(false);
  const [skillsHostPath, setSkillsHostPath] = useState('');
  const [skillsRiskConfirmed, setSkillsRiskConfirmed] = useState(false);
  const [skillsSaving, setSkillsSaving] = useState(false);

  const loadData = async () => {
    setUsersLoading(activeSubTab === 'users'); setSSHLoading(activeSubTab === 'ssh');
    try {
      if (activeSubTab === 'users') setUsers(await api.getUsers());
      if (activeSubTab === 'ssh') setSSHConfig(await api.getSSHConfig());
      if (activeSubTab === 'console_users') await loadConsoleUsers();
      if (activeSubTab === 'terminal') {
        const [tCfg, skillsCfg] = await Promise.all([api.getTerminalSettings(), api.getTerminalSkills()]);
        setTerminalSettings(tCfg); setTerminalSkills(skillsCfg); setSkillsEnabled(skillsCfg.enabled);
        setSkillsHostPath(skillsCfg.hostPath || ''); setSkillsRiskConfirmed(skillsCfg.enabled);
      }
      onRefreshOverview?.();
    } catch (err: any) { setAlertMsg({ type: 'error', text: `加载设置失败，原因：${err.message}` }); }
    finally { setUsersLoading(false); setSSHLoading(false); }
  };
  useEffect(() => { localStorage.setItem('macbox-settings-tab', activeSubTab); void loadData(); }, [activeSubTab]);

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
      setAlertMsg({ type: 'success', text: `账号“${newUsername}”已创建` });
      setShowAddUserModal(false);
      setNewUsername('');
      setNewPassword('');
      setNewIsSudo(false);
      await loadData();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `创建用户失败，原因：${err.message}` });
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
      setAlertMsg({ type: 'success', text: `账号“${changePwdUser}”的密码已修改` });
      setChangePwdUser(null);
      setTargetNewPwd('');
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `修改密码失败，原因：${err.message}` });
    } finally {
      setUserActionLoading(false);
    }
  };

  const handleDeleteUser = async (username: string) => {
    if (!confirm(`删除系统账号“${username}”？
个人文件夹中的文件也将删除。
此操作无法撤销。`)) return;
    try {
      await api.deleteUser(username);
      setAlertMsg({ type: 'success', text: `账号“${username}”已删除` });
      await loadData();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `删除用户失败，原因：${err.message}` });
    }
  };

  // --- Root Password Handlers ---
  const handleSaveRootPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rootNewPwd) {
      setAlertMsg({ type: 'error', text: "请填写管理密码" });
      return;
    }
    if (rootNewPwd !== rootConfirmPwd) {
      setAlertMsg({ type: 'error', text: "两次输入的密码不一致" });
      return;
    }

    setRootPwdSaving(true);
    try {
      await api.updateRootPassword(rootNewPwd);
      setAlertMsg({ type: 'success', text: "系统最高权限账号的密码已修改" });
      setRootNewPwd('');
      setRootConfirmPwd('');
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `更新 管理 密码失败，原因：${err.message}` });
    } finally {
      setRootPwdSaving(false);
    }
  };

  // --- SSH Handlers ---
  const handleSaveSSHConfig = async () => {
    setSSHSaving(true);
    try {
      // MacBox keeps SSH password authentication disabled. The console/root
      // passwords are local VM credentials and are never used for SSH.
      const safeSSHConfig = { ...sshConfig, passwordAuthentication: false };
      await api.updateSSHConfig(safeSSHConfig);
      setSSHConfig(safeSSHConfig);
      setAlertMsg({ type: 'success', text: "远程登录设置已保存并生效" });
      await loadData();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `更新 远程登录 配置失败，原因：${err.message}` });
    } finally {
      setSSHSaving(false);
    }
  };

  const handleToggleSSH = async () => {
    setSSHSaving(true);
    try {
      const nextState = !(sshConfig.status === 'running');
      await api.toggleSSH(nextState);
      setAlertMsg({ type: 'success', text: nextState ? "远程登录服务已启动" : "远程登录服务已停止" });
      await loadData();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `操作 远程登录 服务失败，原因：${err.message}` });
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
        setAlertMsg({ type: 'success', text: "私钥已生成并下载，请妥善保存" });
        // Refresh SSH config
        const fresh = await api.getSSHConfig();
        setSSHConfig(fresh);
      }
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `生成 远程登录 密钥失败，原因：${err.message}` });
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
      setAlertMsg({ type: 'error', text: `获取已授权公钥列表失败，原因：${err.message}` });
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
      setAlertMsg({ type: 'success', text: "公钥已授权，可使用对应私钥登录" });
      setShowImportKeyModal(false);
      setImportKeyText('');
      await handleLoadAuthorizedKeys();
      const fresh = await api.getSSHConfig();
      setSSHConfig(fresh);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `添加公钥失败，原因：${err.message}` });
    } finally {
      setImportingKey(false);
    }
  };

  const handleClearAuthorizedKeys = async () => {
    if (!window.confirm("将清空最高权限账号的公钥。\n已有密钥将无法登录该账号。\n是否清空？")) {
      return;
    }
    try {
      await api.clearSSHAuthorizedKeys();
      setAlertMsg({ type: 'success', text: "最高权限账号的公钥已清空" });
      setAuthorizedKeys([]);
      const fresh = await api.getSSHConfig();
      setSSHConfig(fresh);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `清空失败，原因：${err.message}` });
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
      setAlertMsg({ type: 'success', text: `默认登录账号已改为：${userChoice === 'root' ? 'Root 超级管理员' : '普通用户'}` });
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `保存命令窗口设置失败，原因：${err.message}` });
    } finally {
      setTermSaving(false);
    }
  };

  const handleSaveTerminalSkills = async () => {
    const hostPath = skillsHostPath.trim();
    if (skillsEnabled && !hostPath) {
      setAlertMsg({ type: 'error', text: "请先选择或填写本机技能文件夹" });
      return;
    }
    if (skillsEnabled && !skillsRiskConfirmed) {
      setAlertMsg({ type: 'error', text: "请先阅读提醒并勾选确认" });
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
      setAlertMsg({ type: 'error', text: `保存 助手技能 映射失败，原因：${err.message}` });
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

      <SettingsNavigation activeSubTab={activeSubTab} onChange={setActiveSubTab} isAdmin={currentUser?.role === 'admin'} />

      {activeSubTab === 'console_users' && (
        <ConsoleUsersSection
          users={consoleUsers}
          loading={consoleUsersLoading}
          currentUser={currentUser}
          showAddModal={showAddConsoleModal}
          newUsername={newConsoleUsername}
          newDisplayName={newConsoleDisplayName}
          newPassword={newConsolePassword}
          newConfirmPassword={newConsoleConfirmPassword}
          newRole={newConsoleRole}
          editingUser={editingConsoleUser}
          editDisplayName={editDisplayName}
          editRole={editRole}
          editEnabled={editEnabled}
          editNewPassword={editNewPassword}
          deletingUser={deletingConsoleUser}
          actionLoading={consoleActionLoading}
          onOpenAdd={() => setShowAddConsoleModal(true)}
          onCloseAdd={() => setShowAddConsoleModal(false)}
          onNewUsernameChange={setNewConsoleUsername}
          onNewDisplayNameChange={setNewConsoleDisplayName}
          onNewPasswordChange={setNewConsolePassword}
          onNewConfirmPasswordChange={setNewConsoleConfirmPassword}
          onNewRoleChange={setNewConsoleRole}
          onCreate={handleCreateConsoleUser}
          onOpenEdit={handleOpenEditConsoleUser}
          onCloseEdit={() => setEditingConsoleUser(null)}
          onEditDisplayNameChange={setEditDisplayName}
          onEditRoleChange={setEditRole}
          onEditEnabledChange={setEditEnabled}
          onEditNewPasswordChange={setEditNewPassword}
          onUpdate={handleUpdateConsoleUser}
          onRequestDelete={setDeletingConsoleUser}
          onCloseDelete={() => setDeletingConsoleUser(null)}
          onDelete={handleDeleteConsoleUser}
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
            setAlertMsg({ type: 'success', text: "公钥已复制" });
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

      {activeSubTab === 'overview' && <SettingsOverviewSection overview={overview} isAdmin={currentUser?.role === 'admin'} onRefresh={onRefreshOverview} onSelect={setActiveSubTab} onNavigate={onNavigateTab} />}
      {activeSubTab === 'network' && <NetworkSettingsSection isAdmin={currentUser?.role === 'admin'} onRefresh={onRefreshOverview} />}
      {activeSubTab === 'remote' && currentUser?.role === 'admin' && <TailscaleSettingsSection />}
      {activeSubTab === 'updates' && <VersionManagementSection isAdmin={currentUser?.role === 'admin'} />}

      {activeSubTab === 'appearance' && (
        <AppearanceSettingsSection theme={theme} onThemeChange={setTheme} />
      )}

      {activeSubTab === 'backup' && (
        <BackupRestoreSection onAlert={(alert) => setAlertMsg(alert)} />
      )}

      <SSHKeyModals
        showKeyModal={showKeyModal}
        generatedKeyResult={generatedKeyResult}
        showImportKeyModal={showImportKeyModal}
        importKeyText={importKeyText}
        importingKey={importingKey}
        sshConfig={sshConfig}
        primaryIP={overview?.vm.bridgeIP || ''}
        onCloseKeyModal={() => setShowKeyModal(false)}
        onDownloadPrivateKey={downloadPrivateKeyFile}
        onImportKeyTextChange={setImportKeyText}
        onCloseImportKeyModal={() => setShowImportKeyModal(false)}
        onAddAuthorizedKey={handleAddAuthorizedKey}
      />
    </div>
  );
};
