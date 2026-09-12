import React, { useState, useEffect } from 'react';
import {
  Users,
  Shield,
  Key,
  Terminal,
  RefreshCw,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Crown,
  UserCheck,
  Sliders,
  Eye,
  EyeOff,
  Download,
  FileKey,
  Sparkles,
  X,
  Sun,
  Moon,
  Monitor,
  Palette,
  FolderOpen,
} from 'lucide-react';
import { SystemUser, SSHConfig, TerminalSettings, TerminalSkillsSettings, SSHKeyGenerationResult, NASUser } from '../types';
import { api } from '../api';
import { useTheme } from '../theme';

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
  const [activeSubTab, setActiveSubTab] = useState<'nas_users' | 'users' | 'rootpwd' | 'ssh' | 'terminal' | 'appearance'>('nas_users');
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
    guestPaths: ['/home/macnasctl/.agents/skills', '/root/.agents/skills'],
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
    const blob = new Blob([privKey], { type: 'text/plain;charset=utf-8' });
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

      {/* Navigation Sub-Tabs */}
      <div className="grid grid-cols-3 gap-1 rounded-2xl border border-slate-200 bg-slate-100/80 p-1.5 text-xs font-semibold dark:border-slate-800 dark:bg-slate-900/70 sm:grid-cols-6">
        <button
          onClick={() => setActiveSubTab('nas_users')}
          className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 py-2 transition ${
            activeSubTab === 'nas_users'
              ? 'bg-sky-500 text-white shadow-md shadow-sky-500/25 font-semibold'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/50'
          }`}
        >
          <UserCheck className="h-4 w-4" />
          <span>NAS 用户</span>
        </button>

        <button
          onClick={() => setActiveSubTab('users')}
          className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 py-2 transition ${
            activeSubTab === 'users'
              ? 'bg-sky-500 text-white shadow-md shadow-sky-500/25 font-semibold'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/50'
          }`}
        >
          <Users className="w-4 h-4 text-slate-500" />
          <span>系统用户</span>
        </button>

        <button
          onClick={() => setActiveSubTab('rootpwd')}
          className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 py-2 transition ${
            activeSubTab === 'rootpwd'
              ? 'bg-sky-500 text-white shadow-md shadow-sky-500/25 font-semibold'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/50'
          }`}
        >
          <Crown className="w-4 h-4 text-amber-500" />
          <span>Root 密码</span>
        </button>

        <button
          onClick={() => setActiveSubTab('ssh')}
          className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 py-2 transition ${
            activeSubTab === 'ssh'
              ? 'bg-sky-500 text-white shadow-md shadow-sky-500/25 font-semibold'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/50'
          }`}
        >
          <Shield className="w-4 h-4 text-teal-500" />
          <span>SSH</span>
        </button>

        <button
          onClick={() => setActiveSubTab('terminal')}
          className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 py-2 transition ${
            activeSubTab === 'terminal'
              ? 'bg-sky-500 text-white shadow-md shadow-sky-500/25 font-semibold'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/50'
          }`}
        >
          <Terminal className="w-4 h-4 text-sky-500" />
          <span>终端</span>
        </button>

        <button
          onClick={() => setActiveSubTab('appearance')}
          className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 py-2 transition ${
            activeSubTab === 'appearance'
              ? 'bg-sky-500 text-white shadow-md shadow-sky-500/25 font-semibold'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/50'
          }`}
        >
          <Palette className="w-4 h-4 text-indigo-500" />
          <span>外观</span>
        </button>
      </div>

      {/* ===================== 0. NAS Console Users Management Panel ===================== */}
      {activeSubTab === 'nas_users' && (
        <div className="space-y-4">
          {/* Header Card */}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/90 bg-white p-4 dark:border-slate-800/80 dark:bg-slate-900/60">
            <div>
              <div className="flex items-center space-x-2.5">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white sm:text-base">NAS 用户</h3>
              </div>
              <p className="mt-0.5 hidden text-xs text-slate-500 dark:text-slate-400 sm:block">管理登录账号与管理员权限</p>
            </div>
            <button
              onClick={() => setShowAddNASModal(true)}
              className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-sky-500 px-3 py-2 text-xs font-bold text-white transition hover:bg-sky-600"
            >
              <Plus className="w-4 h-4" />
              <span>添加用户</span>
            </button>
          </div>

          {/* NAS Users Cards Grid */}
          {nasUsersLoading ? (
            <div className="p-8 rounded-2xl bg-white dark:bg-slate-900/60 border border-slate-200/90 dark:border-slate-800/80 text-center text-xs text-slate-500">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-sky-500" />
              <span>正在加载 NAS 控制台用户列表...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {nasUsers.map((u) => {
              const isSuper = u.role === 'admin';
              const isMe = currentUser?.id === u.id;
              const adminCount = nasUsers.filter((x) => x.role === 'admin' && x.enabled).length;
              const isSoleAdmin = isSuper && adminCount <= 1;

              return (
                <div
                  key={u.id}
                  className="p-5 rounded-2xl bg-white dark:bg-slate-900/60 border border-slate-200/90 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700/80 flex flex-col justify-between space-y-4 transition shadow-xs hover:shadow-md"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <div
                          className={`w-11 h-11 rounded-2xl flex items-center justify-center border shadow-xs ${
                            isSuper
                              ? 'bg-amber-50 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/30 text-amber-600 dark:text-amber-400'
                              : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {isSuper ? <Crown className="w-5 h-5" /> : <UserCheck className="w-5 h-5" />}
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-bold text-base text-slate-900 dark:text-white font-mono">{u.username}</span>
                            {isMe && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 font-semibold">
                                当前登录
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{u.displayName || u.username}</p>
                        </div>
                      </div>

                      <span
                        className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold border ${
                          isSuper
                            ? 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {isSuper ? '👑 超级管理员' : '普通用户'}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/60 text-xs space-y-1 text-slate-500 dark:text-slate-400">
                      <div className="flex justify-between">
                        <span>账号状态:</span>
                        <span className={u.enabled ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-rose-500 font-medium'}>
                          {u.enabled ? '🟢 正常使用' : '⚪ 已禁用'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>最后登录:</span>
                        <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                          {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('zh-CN', { hour12: false }) : '尚未登录'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>创建时间:</span>
                        <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                          {new Date(u.createdAt).toLocaleDateString('zh-CN')}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 pt-1 border-t border-slate-100 dark:border-slate-800/80">
                    <button
                      onClick={() => handleOpenEditNASUser(u)}
                      className="flex-1 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold transition text-center shadow-xs"
                    >
                      编辑 / 授权
                    </button>

                    <button
                      onClick={() => setDeletingNASUser(u)}
                      disabled={isMe || isSoleAdmin}
                      title={
                        isMe
                          ? '不能删除当前正在登录的账号'
                          : isSoleAdmin
                          ? '系统必须至少保留一位超级管理员'
                          : u.username === 'admin'
                          ? '点击可安全删除初始管理员 admin'
                          : '删除用户'
                      }
                      className={`p-2 rounded-xl text-xs font-medium border transition ${
                        isMe || isSoleAdmin
                          ? 'opacity-30 cursor-not-allowed bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                          : 'bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/20 dark:hover:bg-rose-900/30 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800/30 cursor-pointer shadow-xs'
                      }`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
            </div>
          )}
        </div>
      )}

      {/* ===================== 1. Users Management Panel ===================== */}
      {activeSubTab === 'users' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/60 p-4 rounded-2xl border border-slate-800/80">
            <div>
              <h3 className="text-base font-bold text-white">系统用户与权限</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                展示当前 Linux 虚拟机已创建的交互式系统用户。普通用户默认不会获得 sudo 或 docker 权限。
              </p>
            </div>
            <button
              onClick={() => setShowAddUserModal(true)}
              className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold shadow-lg shadow-sky-500/20 transition self-start sm:self-auto"
            >
              <Plus className="w-4 h-4" />
              <span>添加新用户</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {users.map((u) => {
              const isRoot = u.isRoot || u.username === 'root';
              const isCurrent = u.uid === 501;

              return (
                <div
                  key={u.username}
                  className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 hover:border-slate-700/80 flex flex-col justify-between space-y-4 transition shadow-lg"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <div
                          className={`w-11 h-11 rounded-2xl flex items-center justify-center border shadow-inner ${
                            isRoot
                              ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                              : u.isSudo
                              ? 'bg-sky-500/15 border-sky-500/30 text-sky-300'
                              : 'bg-slate-800 border-slate-700 text-slate-300'
                          }`}
                        >
                          {isRoot ? <Crown className="w-5 h-5" /> : <Users className="w-5 h-5" />}
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-bold text-base text-white font-mono">{u.username}</span>
                            {isCurrent && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold">
                                当前映射
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 font-mono mt-0.5">UID: {u.uid}</p>
                        </div>
                      </div>

                      <span
                        className={`text-[11px] px-2.5 py-1 rounded-full font-semibold border ${
                          isRoot
                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                            : u.isSudo
                            ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                            : 'bg-slate-800 text-slate-400 border-slate-700/60'
                        }`}
                      >
                        {isRoot ? '超级管理员' : u.isSudo ? 'Sudo 管理员' : '普通用户'}
                      </span>
                    </div>

                    <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 font-mono text-xs">
                      <div className="flex justify-between text-slate-400">
                        <span>家目录:</span>
                        <span className="text-slate-200 truncate max-w-[180px]">{u.homeDir}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>登录 Shell:</span>
                        <span className="text-slate-200">{u.shell}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-800/50">
                        <span>附加用户组: </span>
                        <span className="text-sky-300/90">{u.groups.join(', ') || '-'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
                    <button
                      onClick={() => {
                        setChangePwdUser(u.username);
                        setTargetNewPwd('');
                      }}
                      className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition flex items-center justify-center space-x-1.5"
                    >
                      <Key className="w-3.5 h-3.5 text-amber-400" />
                      <span>修改密码</span>
                    </button>

                    {!isRoot && !isCurrent && (
                      <button
                        onClick={() => handleDeleteUser(u.username)}
                        className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 border border-slate-700 transition"
                        title="删除该用户"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===================== 2. Root Password Panel ===================== */}
      {activeSubTab === 'rootpwd' && (
        <div className="max-w-2xl bg-slate-900/70 p-6 rounded-3xl border border-slate-800/80 shadow-xl space-y-6">
          <div className="flex items-start space-x-3.5">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-300 shrink-0">
              <Crown className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Root 超级管理员密码重置</h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                设置 Linux 虚拟机内部的 root 账号密码，可用于终端中的 <code>su -</code> 切换。SSH 始终关闭密码认证，远程连接只能使用 Root SSH 密钥。
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveRootPassword} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">输入新的 Root 密码:</label>
              <div className="relative">
                <input
                  type={showRootPwd ? 'text' : 'password'}
                  value={rootNewPwd}
                  onChange={(e) => setRootNewPwd(e.target.value)}
                  placeholder="请输入超级管理员新密码..."
                  className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-sm focus:outline-none focus:border-sky-500"
                />
                <button
                  type="button"
                  onClick={() => setShowRootPwd(!showRootPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showRootPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">再次确认新密码:</label>
              <input
                type={showRootPwd ? 'text' : 'password'}
                value={rootConfirmPwd}
                onChange={(e) => setRootConfirmPwd(e.target.value)}
                placeholder="请再次输入新密码..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-sm focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200/90 leading-relaxed space-y-1">
              <p className="font-semibold text-amber-300">💡 安全温馨提示:</p>
              <p>Root 账户拥有整个虚拟机的最高系统控制权限，请务必妥善保存所设置的密码，建议包含大小写字母、数字及特殊符号。</p>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={rootPwdSaving || !rootNewPwd || rootNewPwd !== rootConfirmPwd}
                className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-lg shadow-amber-500/20 transition flex items-center space-x-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {rootPwdSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                <span>确认修改 Root 密码</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================== 3. SSH Settings Panel ===================== */}
      {activeSubTab === 'ssh' && (
        <div className="space-y-5">
          {/* SSH Service Status & Switch Card */}
          <div className="p-6 rounded-3xl bg-slate-900/70 border border-slate-800/80 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div className="flex items-center space-x-4">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center border shadow-inner ${
                  sshConfig.status === 'running'
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                }`}
              >
                <Shield className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center space-x-2.5">
                  <h3 className="text-lg font-bold text-white">SSH 远程终端守护服务</h3>
                  <span
                    className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border ${
                      sshConfig.status === 'running'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                        : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                    }`}
                  >
                    {sshConfig.status === 'running' ? '● 正在运行' : '○ 已停止'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  允许使用 macOS Terminal、Termius、VSCode Remote 或 PuTTY 通过 SSH 协议远程连接管理 NAS。
                </p>
              </div>
            </div>

            <button
              onClick={handleToggleSSH}
              disabled={sshSaving}
              className={`px-5 py-2.5 rounded-xl font-bold text-xs shadow-md transition flex items-center space-x-2 self-start md:self-auto ${
                sshConfig.status === 'running'
                  ? 'bg-rose-600/90 hover:bg-rose-500 text-white shadow-rose-600/20'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'
              }`}
            >
              {sshSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>{sshConfig.status === 'running' ? '停止 SSH 服务' : '启动 SSH 服务'}</span>
            </button>
          </div>

          {/* SSH Configuration Form */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left: Settings */}
            <div className="lg:col-span-7 bg-slate-900/70 p-6 rounded-3xl border border-slate-800/80 shadow-xl space-y-6">
              <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-sky-400" />
                <span>SSH 安全访问策略</span>
              </h4>

              {/* 1. PermitRootLogin toggle (用户核心需求) */}
              <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-bold text-white">开放 SSH Root 账号登录</span>
                    <span className="text-[10px] font-mono text-slate-400">(PermitRootLogin)</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                    开启后，支持直接以 <code>root</code> 账号通过 SSH 远程登录。若关闭，仅允许普通用户登录后 <code>sudo</code> 提权。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSSHConfig({ ...sshConfig, permitRootLogin: !sshConfig.permitRootLogin })}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    sshConfig.permitRootLogin ? 'bg-amber-500' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      sshConfig.permitRootLogin ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* 2. Password Authentication is intentionally immutable */}
              <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-bold text-white">SSH 密码认证</span>
                    <span className="text-[10px] font-mono text-slate-400">(PasswordAuthentication)</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                    MacNAS 固定关闭 SSH 密码认证，仅使用 SSH 公钥登录 root；控制台和 root 密码不作为 SSH 凭据。
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-300">已关闭</span>
              </div>

              {/* 3. Port */}
              <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 flex items-center justify-between gap-4">
                <div>
                  <span className="text-sm font-bold text-white">SSH 监听端口:</span>
                  <p className="text-xs text-slate-400 mt-0.5">默认端口为 22。修改端口可有效降低外网或局域网扫描风险。</p>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={sshConfig.port}
                    onChange={(e) => setSSHConfig({ ...sshConfig, port: parseInt(e.target.value) || 22 })}
                    className="w-24 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono text-center text-xs focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleSaveSSHConfig}
                  disabled={sshSaving}
                  className="px-6 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-bold text-xs shadow-lg shadow-sky-500/25 transition flex items-center space-x-2"
                >
                  {sshSaving && <RefreshCw className="w-4 h-4 animate-spin" />}
                  <span>保存并应用 SSH 设置</span>
                </button>
              </div>
            </div>

            {/* Right: Quick SSH Commands */}
            <div className="lg:col-span-5 bg-slate-900/70 p-6 rounded-3xl border border-slate-800/80 shadow-xl space-y-4">
              <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span>一键直连 SSH 终端命令</span>
              </h4>

              <div className="space-y-3 font-mono text-xs">
                {/* Root Key Connect Command */}
                {sshConfig.permitRootLogin && (
                  <div className="p-3.5 rounded-2xl bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/30 space-y-2">
                    <div className="flex justify-between items-center text-amber-400 font-sans text-xs font-semibold">
                      <span className="flex items-center space-x-1.5">
                        <FileKey className="w-3.5 h-3.5" />
                        <span>👑 Root 密钥免密连接:</span>
                      </span>
                      <button
                        onClick={() => handleCopySSHCommand(`ssh -i ~/Downloads/macnas_root_id_ed25519 -p ${sshConfig.sshLocalPort || sshConfig.port} root@${sshConfig.sshLocalPort ? '127.0.0.1' : primaryIP}`)}
                        className="p-1 rounded hover:bg-amber-500/20 text-amber-300"
                        title="复制密钥连接命令"
                      >
                        {copiedSSH ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <code className="text-amber-200 block bg-black/60 p-2.5 rounded-xl break-all">
                      ssh -i ~/Downloads/macnas_root_id_ed25519 -p {sshConfig.sshLocalPort || sshConfig.port} root@{sshConfig.sshLocalPort ? '127.0.0.1' : primaryIP}
                    </code>
                  </div>
                )}

              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
                提示: 先生成或导入 Root SSH 公钥，再使用上面的密钥命令连接 MacNAS Linux 虚拟机。
              </p>
            </div>
          </div>

          {/* SSH Key Authentication & Root Key Generation Card */}
          <div className="bg-slate-900/70 p-6 rounded-3xl border border-slate-800/80 shadow-xl space-y-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center space-x-3.5">
                <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                  <FileKey className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-base font-bold text-white">SSH 密钥认证与 Root 秘钥管理</h4>
                    <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium">
                      PubkeyAuthentication (已开启)
                    </span>
                    <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-medium font-mono">
                      Root 授权公钥: {sshConfig.authorizedKeyCount || 0} 个
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    非对称加密密钥对 (ED25519) 具备极高安全性且免除输密烦恼。点击一键生成后，系统将自动将公钥部署进虚拟机，并将私钥直接下载至您的本地电脑。
                  </p>
                </div>
              </div>

              {/* One Click Generate & Download Button */}
              <button
                onClick={handleGenerateRootKey}
                disabled={generatingKey}
                className="px-5 py-3 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:brightness-110 text-slate-950 font-bold text-xs shadow-lg shadow-amber-500/20 transition flex items-center space-x-2 shrink-0 self-start md:self-auto disabled:opacity-50"
              >
                {generatingKey ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                    <span>正在生成密钥并部署...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 text-slate-950" />
                    <span>一键生成 Root 密钥并下载</span>
                    <Sparkles className="w-4 h-4 text-slate-950" />
                  </>
                )}
              </button>
            </div>

            {/* Sub actions: list keys, import key, clear keys */}
            <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    if (showAuthorizedKeys) {
                      setShowAuthorizedKeys(false);
                    } else {
                      handleLoadAuthorizedKeys();
                    }
                  }}
                  disabled={loadingAuthKeys}
                  className="px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition flex items-center space-x-1.5"
                >
                  <Key className="w-3.5 h-3.5 text-sky-400" />
                  <span>{showAuthorizedKeys ? '收起已授权公钥列表' : `查看 Root 已授权公钥 (${sshConfig.authorizedKeyCount || 0})`}</span>
                  {loadingAuthKeys && <RefreshCw className="w-3 h-3 animate-spin text-slate-400" />}
                </button>

                <button
                  onClick={() => setShowImportKeyModal(true)}
                  className="px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition flex items-center space-x-1.5"
                >
                  <Plus className="w-3.5 h-3.5 text-emerald-400" />
                  <span>导入已有公钥</span>
                </button>
              </div>

              {sshConfig.authorizedKeyCount && sshConfig.authorizedKeyCount > 0 ? (
                <button
                  onClick={handleClearAuthorizedKeys}
                  className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition flex items-center space-x-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>清空所有已授权公钥</span>
                </button>
              ) : null}
            </div>

            {/* Expandable Authorized Keys List */}
            {showAuthorizedKeys && (
              <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2 animate-in fade-in duration-150">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-xs font-semibold text-slate-300">
                  <span>/root/.ssh/authorized_keys 中生效的公钥:</span>
                  <span className="text-slate-500 font-normal font-mono">共 {authorizedKeys.length} 条记录</span>
                </div>
                {authorizedKeys.length === 0 ? (
                  <p className="text-xs text-slate-500 py-2">暂无已授权公钥，点击上方「一键生成 Root 密钥」即可生成并自动注入！</p>
                ) : (
                  <div className="space-y-2">
                    {authorizedKeys.map((keyLine, idx) => (
                      <div key={idx} className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-3 text-xs font-mono">
                        <span className="text-slate-300 truncate select-all">{keyLine}</span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(keyLine);
                            setAlertMsg({ type: 'success', text: '公钥内容已复制到剪贴板！' });
                          }}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white shrink-0 transition flex items-center space-x-1 text-[11px]"
                          title="复制公钥"
                        >
                          <Copy className="w-3 h-3" />
                          <span>复制</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================== 4. Terminal Settings Panel ===================== */}
      {activeSubTab === 'terminal' && (
        <div className="max-w-2xl bg-slate-900/70 p-6 rounded-3xl border border-slate-800/80 shadow-xl space-y-6">
          <div className="flex items-start space-x-3.5">
            <div className="w-12 h-12 rounded-2xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-300 shrink-0">
              <Terminal className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">终端默认登录身份设置</h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                设置每次打开 Web 终端页面、或一键进入容器终端时，系统默认直接以 <strong>Root 身份</strong> 还是 <strong>普通用户身份</strong> 进入交互式 Shell。
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            {/* Option 1: Root */}
            <div
              onClick={() => handleSaveTerminalSettings('root')}
              className={`p-4 rounded-2xl border cursor-pointer transition flex items-start space-x-3.5 ${
                terminalSettings.defaultLoginUser === 'root'
                  ? 'bg-amber-500/10 border-amber-500/40 shadow-lg shadow-amber-500/10'
                  : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="pt-0.5">
                <input
                  type="radio"
                  name="loginUser"
                  checked={terminalSettings.defaultLoginUser === 'root'}
                  onChange={() => handleSaveTerminalSettings('root')}
                  className="text-amber-500 focus:ring-0 cursor-pointer"
                />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-sm text-white">以 Root 身份直接登录 (高权限推荐)</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono font-semibold">
                    sudo -i / #
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  进入终端时自动提升为 root 超级管理员，具有整个系统的全部读写权限，免去频繁输入 sudo 的麻烦，适合系统深度维护与安装软件包。
                </p>
              </div>
            </div>

            {/* Option 2: Default Normal User */}
            <div
              onClick={() => handleSaveTerminalSettings('default')}
              className={`p-4 rounded-2xl border cursor-pointer transition flex items-start space-x-3.5 ${
                terminalSettings.defaultLoginUser === 'default'
                  ? 'bg-sky-500/10 border-sky-500/40 shadow-lg shadow-sky-500/10'
                  : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="pt-0.5">
                <input
                  type="radio"
                  name="loginUser"
                  checked={terminalSettings.defaultLoginUser === 'default'}
                  onChange={() => handleSaveTerminalSettings('default')}
                  className="text-sky-500 focus:ring-0 cursor-pointer"
                />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-sm text-white">以普通用户身份登录 (安全防误删)</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 font-mono font-semibold">
                    Lima 管理用户 / $
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  默认以当前普通用户登录，防止命令敲错误删系统核心目录，需要执行特权命令时可自行手动输入 sudo。
                </p>
              </div>
            </div>
          </div>

          {/* AI CLI skills mapping */}
          <div className="rounded-2xl border border-violet-500/25 bg-violet-500/[0.06] p-4 shadow-lg shadow-violet-500/[0.04] sm:p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-400/30 bg-violet-400/10 text-violet-300">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-bold text-white">AI CLI Skill 目录</h4>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    terminalSkills.status === 'ready'
                      ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                      : terminalSkills.status === 'missing' || terminalSkills.status === 'invalid'
                        ? 'border-rose-400/30 bg-rose-400/10 text-rose-300'
                        : 'border-slate-700 bg-slate-800 text-slate-400'
                  }`}>
                    {terminalSkills.status === 'ready' ? '本机目录已就绪' : terminalSkills.status === 'disabled' ? '未启用' : terminalSkills.message}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  将 Mac 本机的 <code className="rounded bg-slate-950/70 px-1 py-0.5 text-violet-300">.agents/skills</code> 以只读方式映射到 VM，终端里的 Codex、Claude 等 AI CLI 可以直接调用。目录不会被 AI CLI 修改。
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-[11px] leading-relaxed text-amber-200">
                <div className="font-bold text-amber-100">安全提示：这是本机目录映射</div>
                <div className="mt-1">只选择专门存放 Skill 的目录。不要选择用户主目录、.ssh、钥匙串、浏览器资料或任何包含密码、Token、私钥的目录；启用后该目录会以只读方式暴露给 VM 中的 AI CLI。</div>
                <label className="mt-2 flex cursor-pointer items-start gap-2 font-semibold text-amber-100">
                  <input
                    type="checkbox"
                    checked={skillsRiskConfirmed}
                    onChange={(event) => setSkillsRiskConfirmed(event.target.checked)}
                    className="mt-0.5 rounded border-amber-300 bg-transparent text-amber-500 focus:ring-amber-400"
                  />
                  <span>我确认所选目录仅包含可供 AI CLI 使用的 Skill 文件</span>
                </label>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5">
                <div>
                  <div className="text-xs font-semibold text-slate-200">启用 Skill 映射</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">下次启动或重启 VM 后挂载到终端</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={skillsEnabled}
                  onClick={() => setSkillsEnabled((enabled) => {
                    const next = !enabled;
                    if (next) setSkillsRiskConfirmed(false);
                    return next;
                  })}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition ${skillsEnabled ? 'bg-violet-500' : 'bg-slate-700'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition ${skillsEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-300">Mac 本机 Skill 目录</span>
                <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 focus-within:border-violet-400">
                  <FolderOpen className="h-4 w-4 shrink-0 text-violet-300" />
                  <input
                    value={skillsHostPath}
                    onChange={(event) => {
                      setSkillsHostPath(event.target.value);
                      setSkillsRiskConfirmed(false);
                    }}
                    placeholder="例如：/Users/你的用户名/.agents/skills"
                    className="min-w-0 flex-1 bg-transparent font-mono text-xs text-white outline-none placeholder:text-slate-600"
                    spellCheck={false}
                  />
                </div>
              </label>

              {terminalSkills.candidates.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>服务器本机扫描到的候选目录</span>
                    <span>可用目录可直接选用</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {terminalSkills.candidates.map((candidate) => (
                      <button
                        key={candidate.hostPath}
                        type="button"
                        disabled={!candidate.available}
                        onClick={() => handleUseSkillsCandidate(candidate.hostPath)}
                        className={`min-w-0 rounded-xl border p-2.5 text-left transition ${
                          candidate.available
                            ? skillsHostPath === candidate.hostPath
                              ? 'border-violet-400/60 bg-violet-400/10'
                              : 'border-slate-800 bg-slate-950/50 hover:border-violet-400/40 hover:bg-violet-400/[0.06]'
                            : 'cursor-not-allowed border-slate-800/60 bg-slate-950/30 opacity-50'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-violet-300" />
                          <span className="truncate">{candidate.name}</span>
                        </div>
                        <div className="mt-1 truncate font-mono text-[10px] text-slate-500" title={candidate.hostPath}>{candidate.hostPath}</div>
                        <div className={`mt-1 text-[10px] ${candidate.available ? 'text-emerald-300' : 'text-slate-600'}`}>
                          {candidate.available ? `${candidate.skillCount} 个 Skill 目录` : candidate.reason}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2 rounded-xl border border-slate-800/80 bg-slate-950/40 p-3 text-[11px] leading-relaxed text-slate-500 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div>VM 映射位置：<code className="text-slate-300">/home/macnasctl/.agents/skills</code>、<code className="text-slate-300">/root/.agents/skills</code></div>
                  <div className="mt-1">纯 Web 访问时，浏览器目录选择器只能读取手机/当前设备，不能代表运行 Mac；因此这里由 MacNAS 在服务器本机自动扫描。</div>
                </div>
                <span className="shrink-0 text-emerald-300">只读映射</span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                {terminalSkills.requiresRestart ? (
                  <span className="text-[11px] font-semibold text-amber-300">配置已保存，请下次启动或重启虚拟机使映射生效</span>
                ) : <span />}
                <button
                  type="button"
                  onClick={handleSaveTerminalSkills}
                  disabled={skillsSaving || (skillsEnabled && (!skillsHostPath.trim() || !skillsRiskConfirmed))}
                  className="flex items-center gap-1.5 rounded-xl bg-violet-500 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {skillsSaving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  <span>保存 Skill 映射</span>
                </button>
              </div>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-400 flex items-center justify-between">
            <span>当前默认配置: <strong className="font-mono text-white font-bold">{terminalSettings.defaultLoginUser === 'root' ? '👑 root 超级管理员' : '👤 普通用户'}</strong></span>
            {termSaving && <span className="text-sky-400 flex items-center space-x-1"><RefreshCw className="w-3 h-3 animate-spin" /><span>保存中...</span></span>}
          </div>
        </div>
      )}

      {/* ===================== 5. Appearance & Theme Settings ===================== */}
      {activeSubTab === 'appearance' && (
        <div className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div>
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <Palette className="w-5 h-5 text-indigo-400" />
                <span>外观与主题模式设置</span>
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                支持在明亮日间模式、极客夜间暗黑模式及跟随操作系统之间自由切换。
              </p>
            </div>
            <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
              当前: {theme === 'dark' ? '🌙 夜间暗黑' : theme === 'light' ? '☀️ 日间浅色' : '💻 跟随系统'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Dark Theme Option */}
            <div
              onClick={() => setTheme('dark')}
              className={`p-5 rounded-2xl border-2 cursor-pointer transition flex flex-col justify-between space-y-4 ${
                theme === 'dark'
                  ? 'bg-slate-800/80 border-sky-500 shadow-lg shadow-sky-500/10'
                  : 'bg-slate-800/40 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="space-y-3">
                {/* Mockup Preview Box */}
                <div className="w-full h-24 rounded-xl bg-[#090d16] border border-slate-700/80 p-2.5 flex flex-col justify-between shadow-inner">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                    <div className="flex items-center space-x-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                      <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    </div>
                    <div className="w-12 h-2 rounded bg-slate-800" />
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="w-6 h-6 rounded-lg bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-[10px]">🍎</div>
                    <div className="space-y-1 flex-1">
                      <div className="w-16 h-2 rounded bg-slate-700" />
                      <div className="w-24 h-1.5 rounded bg-slate-800" />
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-white flex items-center space-x-1.5">
                      <Moon className="w-4 h-4 text-sky-400" />
                      <span>夜间暗黑模式 (Dark)</span>
                    </span>
                    {theme === 'dark' && <CheckCircle2 className="w-4 h-4 text-sky-400" />}
                  </div>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    专为极客与夜间运维调校的深色美学，弱光护眼，专注沉浸。
                  </p>
                </div>
              </div>

              <div className="pt-2">
                <span className={`text-xs font-semibold px-3 py-1 rounded-lg block text-center ${
                  theme === 'dark' ? 'bg-sky-500 text-white font-bold' : 'bg-slate-700/60 text-slate-300'
                }`}>
                  {theme === 'dark' ? '当前已生效' : '选择夜间模式'}
                </span>
              </div>
            </div>

            {/* Light Theme Option */}
            <div
              onClick={() => setTheme('light')}
              className={`p-5 rounded-2xl border-2 cursor-pointer transition flex flex-col justify-between space-y-4 ${
                theme === 'light'
                  ? 'bg-slate-800/80 border-sky-500 shadow-lg shadow-sky-500/10'
                  : 'bg-slate-800/40 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="space-y-3">
                {/* Mockup Preview Box */}
                <div className="w-full h-24 rounded-xl bg-slate-100 border border-slate-300 p-2.5 flex flex-col justify-between shadow-inner">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                    <div className="flex items-center space-x-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                      <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    </div>
                    <div className="w-12 h-2 rounded bg-slate-300" />
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="w-6 h-6 rounded-lg bg-sky-100 border border-sky-300 flex items-center justify-center text-[10px]">🍎</div>
                    <div className="space-y-1 flex-1">
                      <div className="w-16 h-2 rounded bg-slate-400" />
                      <div className="w-24 h-1.5 rounded bg-slate-300" />
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-white flex items-center space-x-1.5">
                      <Sun className="w-4 h-4 text-amber-400" />
                      <span>日间浅色模式 (Light)</span>
                    </span>
                    {theme === 'light' && <CheckCircle2 className="w-4 h-4 text-sky-400" />}
                  </div>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    清爽雅致的浅灰白底配色，强光办公清晰易读，典雅自然。
                  </p>
                </div>
              </div>

              <div className="pt-2">
                <span className={`text-xs font-semibold px-3 py-1 rounded-lg block text-center ${
                  theme === 'light' ? 'bg-sky-500 text-white font-bold' : 'bg-slate-700/60 text-slate-300'
                }`}>
                  {theme === 'light' ? '当前已生效' : '选择日间模式'}
                </span>
              </div>
            </div>

            {/* System Theme Option */}
            <div
              onClick={() => setTheme('system')}
              className={`p-5 rounded-2xl border-2 cursor-pointer transition flex flex-col justify-between space-y-4 ${
                theme === 'system'
                  ? 'bg-slate-800/80 border-sky-500 shadow-lg shadow-sky-500/10'
                  : 'bg-slate-800/40 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="space-y-3">
                {/* Mockup Preview Box */}
                <div className="w-full h-24 rounded-xl bg-gradient-to-r from-slate-900 to-slate-100 border border-slate-700/80 p-2.5 flex flex-col justify-between shadow-inner">
                  <div className="flex items-center justify-between pb-1.5">
                    <div className="flex items-center space-x-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                      <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    </div>
                    <Monitor className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                  <div className="text-center py-1">
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-800/80 text-sky-300">
                      Auto (macOS)
                    </span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-white flex items-center space-x-1.5">
                      <Monitor className="w-4 h-4 text-emerald-400" />
                      <span>跟随系统设置 (Auto)</span>
                    </span>
                    {theme === 'system' && <CheckCircle2 className="w-4 h-4 text-sky-400" />}
                  </div>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    智能跟随 Mac 或客户端系统的深浅色设置自动平滑过渡。
                  </p>
                </div>
              </div>

              <div className="pt-2">
                <span className={`text-xs font-semibold px-3 py-1 rounded-lg block text-center ${
                  theme === 'system' ? 'bg-sky-500 text-white font-bold' : 'bg-slate-700/60 text-slate-300'
                }`}>
                  {theme === 'system' ? '当前已生效' : '选择跟随系统'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================== Modal: Add User ===================== */}
      {showAddUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <UserCheck className="w-5 h-5 text-sky-400" />
                <span>添加新系统终端用户</span>
              </h3>
              <button
                onClick={() => setShowAddUserModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">用户名:</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value.toLowerCase())}
                  placeholder="例如: dev, backup, admin2"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-sm focus:outline-none focus:border-sky-500"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">初始登录密码:</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="输入初始密码..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-sm focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="sudoCheck"
                  checked={newIsSudo}
                  onChange={(e) => setNewIsSudo(e.target.checked)}
                  className="rounded border-slate-700 text-sky-500 focus:ring-0 cursor-pointer"
                />
                <label htmlFor="sudoCheck" className="text-xs text-slate-300 cursor-pointer select-none">
                  授予 Sudo 超级管理员权限 (加入 sudo 组)
                </label>
              </div>

              <div className="flex justify-end space-x-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={userActionLoading || !newUsername.trim()}
                  className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold shadow-lg shadow-sky-500/20 transition disabled:opacity-50"
                >
                  {userActionLoading ? '创建中...' : '确认创建用户'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================== Modal: Change User Password ===================== */}
      {changePwdUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-3xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <Key className="w-4 h-4 text-amber-400" />
              <span>修改密码 - {changePwdUser}</span>
            </h3>

            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">新密码:</label>
                <input
                  type="password"
                  value={targetNewPwd}
                  onChange={(e) => setTargetNewPwd(e.target.value)}
                  placeholder="输入新密码..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-sm focus:outline-none focus:border-sky-500"
                  autoFocus
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setChangePwdUser(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={userActionLoading || !targetNewPwd}
                  className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold transition disabled:opacity-50"
                >
                  确认修改
                </button>
              </div>
            </form>
          </div>
        </div>
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
                <h4 className="font-bold text-slate-200">使用指南 (在 Mac 终端中运行):</h4>

                <div className="p-3 rounded-xl bg-black/60 border border-slate-800 font-mono text-[11px] space-y-2 text-slate-300">
                  <div>
                    <span className="text-slate-500"># 步骤 1: 设置严格权限 (macOS / Linux 必需)</span>
                    <div className="text-amber-300 select-all">chmod 600 ~/Downloads/{generatedKeyResult.filename}</div>
                  </div>

                  <div>
                    <span className="text-slate-500"># 步骤 2: 宿主机本机直连命令 (端口 {sshConfig.sshLocalPort || 58107})</span>
                    <div className="text-sky-300 select-all">
                      ssh -i ~/Downloads/{generatedKeyResult.filename} -p {sshConfig.sshLocalPort || 58107} root@127.0.0.1
                    </div>
                  </div>

                  <div>
                    <span className="text-slate-500"># 步骤 3: 局域网其他设备连接命令 (端口 {sshConfig.port})</span>
                    <div className="text-emerald-300 select-all">
                      ssh -i ~/Downloads/{generatedKeyResult.filename} -p {sshConfig.port} root@{primaryIP}
                    </div>
                  </div>
                </div>
              </div>

              {/* Important security warning */}
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300/90 text-[11px] leading-relaxed">
                ⚠️ <strong>安全提示</strong>: 私钥文件已自动下载至您的 Downloads 文件夹中。为确保绝对安全，MacNAS 服务器端已彻底擦除私钥明文，请妥善保存该私钥文件。
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
                    const cmd = `chmod 600 ~/Downloads/${generatedKeyResult.filename} && ssh -i ~/Downloads/${generatedKeyResult.filename} -p ${sshConfig.sshLocalPort || sshConfig.port} root@${sshConfig.sshLocalPort ? '127.0.0.1' : primaryIP}`;
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
      {/* Add NAS User Modal */}
      {showAddNASModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-xl bg-sky-50 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                  <UserCheck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">添加新 NAS 控制台用户</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">用于网页控制台登录与管理</p>
                </div>
              </div>
              <button
                onClick={() => setShowAddNASModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateNASUser} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">用户名 *</label>
                <input
                  type="text"
                  value={newNASUsername}
                  onChange={(e) => setNewNASUsername(e.target.value)}
                  placeholder="英文字母、数字或下划线 (如 manager)"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">显示昵称</label>
                <input
                  type="text"
                  value={newNASDisplayName}
                  onChange={(e) => setNewNASDisplayName(e.target.value)}
                  placeholder="用户备注名称 (可选)"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">初始登录密码 *</label>
                <input
                  type="password"
                  value={newNASPassword}
                  onChange={(e) => setNewNASPassword(e.target.value)}
				  placeholder="至少 8 位密码"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">确认初始密码 *</label>
                <input
                  type="password"
                  value={newNASConfirmPassword}
                  onChange={(e) => setNewNASConfirmPassword(e.target.value)}
                  placeholder="再次输入密码"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
                  required
                />
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">角色与权限授权</label>
                <div className="flex items-center space-x-4 text-xs">
                  <label className="flex items-center space-x-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="role"
                      value="admin"
                      checked={newNASRole === 'admin'}
                      onChange={() => setNewNASRole('admin')}
                      className="text-amber-500 focus:ring-amber-400"
                    />
                    <span className="font-semibold text-amber-600 dark:text-amber-400 flex items-center">
                      <Crown className="w-3.5 h-3.5 mr-1" /> 授权超级管理员
                    </span>
                  </label>
                  <label className="flex items-center space-x-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="role"
                      value="user"
                      checked={newNASRole === 'user'}
                      onChange={() => setNewNASRole('user')}
                      className="text-sky-500 focus:ring-sky-400"
                    />
                    <span className="text-slate-700 dark:text-slate-300">普通用户</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddNASModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold transition"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={nasActionLoading}
                  className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold shadow-md shadow-sky-500/25 transition disabled:opacity-50"
                >
                  {nasActionLoading ? '创建中...' : '确认创建用户'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit NAS User Modal */}
      {editingNASUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">编辑用户与角色授权</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">账号: {editingNASUser.username}</p>
              </div>
              <button
                onClick={() => setEditingNASUser(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateNASUser} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">显示昵称</label>
                <input
                  type="text"
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">权限角色分配</label>
                <div className="grid grid-cols-2 gap-2">
                  <div
                    onClick={() => setEditRole('admin')}
                    className={`p-3 rounded-xl border cursor-pointer transition flex items-center space-x-2 ${
                      editRole === 'admin'
                        ? 'bg-amber-50 dark:bg-amber-500/15 border-amber-300 dark:border-amber-500/40 text-amber-800 dark:text-amber-300'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <Crown className="w-4 h-4 text-amber-500" />
                    <div>
                      <p className="font-bold text-xs">超级管理员</p>
                      <p className="text-[10px] opacity-75">全系统管理权限</p>
                    </div>
                  </div>

                  <div
                    onClick={() => setEditRole('user')}
                    className={`p-3 rounded-xl border cursor-pointer transition flex items-center space-x-2 ${
                      editRole === 'user'
                        ? 'bg-sky-50 dark:bg-sky-500/15 border-sky-300 dark:border-sky-500/40 text-sky-800 dark:text-sky-300'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <UserCheck className="w-4 h-4 text-sky-500" />
                    <div>
                      <p className="font-bold text-xs">普通用户</p>
                      <p className="text-[10px] opacity-75">基础使用权限</p>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">重置密码 (留空则保持原密码不变)</label>
                <input
                  type="password"
                  value={editNewPassword}
                  onChange={(e) => setEditNewPassword(e.target.value)}
                  placeholder="留空表示不修改密码"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="flex items-center space-x-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={editEnabled}
                    onChange={(e) => setEditEnabled(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-700 text-sky-500 focus:ring-sky-400"
                  />
                  <span>账号处于启用状态 (允许登录控制台)</span>
                </label>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingNASUser(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold transition"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={nasActionLoading}
                  className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold shadow-md shadow-sky-500/25 transition disabled:opacity-50"
                >
                  {nasActionLoading ? '保存中...' : '保存更改'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete NAS User Confirmation Modal */}
      {deletingNASUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-rose-500">
              <div className="w-10 h-10 rounded-2xl bg-rose-50 dark:bg-rose-500/20 border border-rose-200 dark:border-rose-500/30 flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">删除控制台用户</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">操作不可撤销</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              确定要永久删除控制台用户 <span className="font-bold font-mono text-slate-900 dark:text-white">[{deletingNASUser.username}]</span> 吗？
              {deletingNASUser.username === 'admin' && (
                <span className="block mt-2 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 font-medium">
                  ⚠️ 您正在删除初始管理员 admin。删除后，请确保您已牢记当前登录的管理员账户与密码。
                </span>
              )}
            </p>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingNASUser(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleDeleteNASUser}
                disabled={nasActionLoading}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-md shadow-rose-600/25 transition disabled:opacity-50"
              >
                {nasActionLoading ? '删除中...' : '确认永久删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
