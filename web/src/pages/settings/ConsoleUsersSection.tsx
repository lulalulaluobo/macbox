import React from 'react';
import { Crown, Plus, RefreshCw, Trash2, UserCheck, X } from 'lucide-react';
import type { ConsoleUser } from '../../types';

interface ConsoleUsersSectionProps {
  users: ConsoleUser[];
  loading: boolean;
  currentUser?: ConsoleUser | null;
  showAddModal: boolean;
  newUsername: string;
  newDisplayName: string;
  newPassword: string;
  newConfirmPassword: string;
  newRole: 'admin' | 'user';
  editingUser: ConsoleUser | null;
  editDisplayName: string;
  editRole: 'admin' | 'user';
  editEnabled: boolean;
  editNewPassword: string;
  deletingUser: ConsoleUser | null;
  actionLoading: boolean;
  onOpenAdd: () => void;
  onCloseAdd: () => void;
  onNewUsernameChange: (value: string) => void;
  onNewDisplayNameChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onNewConfirmPasswordChange: (value: string) => void;
  onNewRoleChange: (value: 'admin' | 'user') => void;
  onCreate: (event: React.FormEvent<HTMLFormElement>) => void;
  onOpenEdit: (user: ConsoleUser) => void;
  onCloseEdit: () => void;
  onEditDisplayNameChange: (value: string) => void;
  onEditRoleChange: (value: 'admin' | 'user') => void;
  onEditEnabledChange: (value: boolean) => void;
  onEditNewPasswordChange: (value: string) => void;
  onUpdate: (event: React.FormEvent<HTMLFormElement>) => void;
  onRequestDelete: (user: ConsoleUser) => void;
  onCloseDelete: () => void;
  onDelete: () => void;
}

export const ConsoleUsersSection: React.FC<ConsoleUsersSectionProps> = ({
  users,
  loading,
  currentUser,
  showAddModal,
  newUsername,
  newDisplayName,
  newPassword,
  newConfirmPassword,
  newRole,
  editingUser,
  editDisplayName,
  editRole,
  editEnabled,
  editNewPassword,
  deletingUser,
  actionLoading,
  onOpenAdd,
  onCloseAdd,
  onNewUsernameChange,
  onNewDisplayNameChange,
  onNewPasswordChange,
  onNewConfirmPasswordChange,
  onNewRoleChange,
  onCreate,
  onOpenEdit,
  onCloseEdit,
  onEditDisplayNameChange,
  onEditRoleChange,
  onEditEnabledChange,
  onEditNewPasswordChange,
  onUpdate,
  onRequestDelete,
  onCloseDelete,
  onDelete,
}) => (
  <>
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/90 bg-white p-4 dark:border-slate-800/80 dark:bg-slate-900/60">
        <div><h3 className="text-sm font-bold text-slate-900 dark:text-white sm:text-base">MacBox 用户</h3><p className="mt-0.5 hidden text-xs text-slate-500 dark:text-slate-400 sm:block">管理登录账号与管理员权限</p></div>
        <button type="button" onClick={onOpenAdd} className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-sky-500 px-3 py-2 text-xs font-bold text-white transition hover:bg-sky-600"><Plus className="h-4 w-4" /><span>添加用户</span></button>
      </div>
      {loading ? (
        <div className="rounded-2xl border border-slate-200/90 bg-white p-8 text-center text-xs text-slate-500 dark:border-slate-800/80 dark:bg-slate-900/60"><RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin text-sky-500" /><span>正在加载 MacBox 控制台用户列表...</span></div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {users.map((user) => {
            const isAdmin = user.role === 'admin';
            const isMe = currentUser?.id === user.id;
            const adminCount = users.filter((item) => item.role === 'admin' && item.enabled).length;
            const isSoleAdmin = isAdmin && adminCount <= 1;
            return (
              <div key={user.id} className="flex flex-col justify-between space-y-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs transition hover:border-slate-300 hover:shadow-md dark:border-slate-800/80 dark:bg-slate-900/60 dark:hover:border-slate-700/80">
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                      <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border shadow-xs ${isAdmin ? 'border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-400' : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>{isAdmin ? <Crown className="h-5 w-5" /> : <UserCheck className="h-5 w-5" />}</div>
                      <div><div className="flex items-center space-x-2"><span className="font-mono text-base font-bold text-slate-900 dark:text-white">{user.username}</span>{isMe && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">当前登录</span>}</div><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{user.displayName || user.username}</p></div>
                    </div>
                    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${isAdmin ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-400' : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'}`}>{isAdmin ? '👑 超级管理员' : '普通用户'}</span>
                  </div>
                  <div className="space-y-1 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-500 dark:border-slate-800/60 dark:bg-slate-950/60 dark:text-slate-400"><div className="flex justify-between"><span>账号状态:</span><span className={user.enabled ? 'font-medium text-emerald-600 dark:text-emerald-400' : 'font-medium text-rose-500'}>{user.enabled ? '🟢 正常使用' : '⚪ 已禁用'}</span></div><div className="flex justify-between"><span>最后登录:</span><span className="font-mono text-[11px] text-slate-700 dark:text-slate-300">{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('zh-CN', { hour12: false }) : '尚未登录'}</span></div><div className="flex justify-between"><span>创建时间:</span><span className="font-mono text-[11px] text-slate-700 dark:text-slate-300">{new Date(user.createdAt).toLocaleDateString('zh-CN')}</span></div></div>
                </div>
                <div className="flex items-center space-x-2 border-t border-slate-100 pt-1 dark:border-slate-800/80"><button type="button" onClick={() => onOpenEdit(user)} className="flex-1 rounded-xl bg-slate-100 py-1.5 text-center text-xs font-semibold text-slate-700 shadow-xs transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">编辑 / 授权</button><button type="button" onClick={() => onRequestDelete(user)} disabled={isMe || isSoleAdmin} title={isMe ? '不能删除当前正在登录的账号' : isSoleAdmin ? '系统必须至少保留一位超级管理员' : user.username === 'admin' ? '点击可安全删除初始管理员 admin' : '删除用户'} className={`rounded-xl border p-2 text-xs font-medium transition ${isMe || isSoleAdmin ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 opacity-30 dark:border-slate-700 dark:bg-slate-800' : 'cursor-pointer border-rose-200 bg-rose-50 text-rose-600 shadow-xs hover:bg-rose-100 dark:border-rose-800/30 dark:bg-rose-950/20 dark:text-rose-400 dark:hover:bg-rose-900/30'}`}><Trash2 className="h-3.5 w-3.5" /></button></div>
              </div>
            );
          })}
        </div>
      )}
    </div>

    {showAddModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"><div className="w-full max-w-md space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800"><div className="flex items-center space-x-2"><div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400"><UserCheck className="h-4 w-4" /></div><div><h3 className="text-base font-bold text-slate-900 dark:text-white">添加新 MacBox 控制台用户</h3><p className="text-xs text-slate-500 dark:text-slate-400">用于网页控制台登录与管理</p></div></div><button type="button" onClick={onCloseAdd} className="rounded-lg p-1 text-slate-400 transition hover:text-slate-600 dark:hover:text-white"><X className="h-5 w-5" /></button></div><form onSubmit={onCreate} className="space-y-3.5">
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">用户名 *<input type="text" value={newUsername} onChange={(event) => onNewUsernameChange(event.target.value)} placeholder="英文字母、数字或下划线 (如 manager)" className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white" required /></label>
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">显示昵称<input type="text" value={newDisplayName} onChange={(event) => onNewDisplayNameChange(event.target.value)} placeholder="用户备注名称 (可选)" className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></label>
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">初始登录密码 *<input type="password" value={newPassword} onChange={(event) => onNewPasswordChange(event.target.value)} placeholder="至少 8 位密码" className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white" required /></label>
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">确认初始密码 *<input type="password" value={newConfirmPassword} onChange={(event) => onNewConfirmPasswordChange(event.target.value)} placeholder="再次输入密码" className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white" required /></label>
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60"><span className="block text-xs font-semibold text-slate-700 dark:text-slate-300">角色与权限授权</span><div className="flex items-center space-x-4 text-xs"><label className="flex cursor-pointer items-center space-x-1.5"><input type="radio" name="console-role" checked={newRole === 'admin'} onChange={() => onNewRoleChange('admin')} className="text-amber-500 focus:ring-amber-400" /><span className="flex items-center font-semibold text-amber-600 dark:text-amber-400"><Crown className="mr-1 h-3.5 w-3.5" />授权超级管理员</span></label><label className="flex cursor-pointer items-center space-x-1.5"><input type="radio" name="console-role" checked={newRole === 'user'} onChange={() => onNewRoleChange('user')} className="text-sky-500 focus:ring-sky-400" /><span className="text-slate-700 dark:text-slate-300">普通用户</span></label></div></div>
        <div className="flex justify-end space-x-2 pt-2"><button type="button" onClick={onCloseAdd} className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">取消</button><button type="submit" disabled={actionLoading} className="rounded-xl bg-sky-500 px-5 py-2 text-xs font-bold text-white shadow-md shadow-sky-500/25 transition hover:bg-sky-600 disabled:opacity-50">{actionLoading ? '创建中...' : '确认创建用户'}</button></div>
      </form></div></div>
    )}

    {editingUser && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"><div className="w-full max-w-md space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800"><div><h3 className="text-base font-bold text-slate-900 dark:text-white">编辑用户与角色授权</h3><p className="text-xs text-slate-500 dark:text-slate-400">账号: {editingUser.username}</p></div><button type="button" onClick={onCloseEdit} className="rounded-lg p-1 text-slate-400 transition hover:text-slate-600 dark:hover:text-white"><X className="h-5 w-5" /></button></div><form onSubmit={onUpdate} className="space-y-3.5">
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">显示昵称<input type="text" value={editDisplayName} onChange={(event) => onEditDisplayNameChange(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></label>
        <div><span className="block text-xs font-semibold text-slate-700 dark:text-slate-300">权限角色分配</span><div className="mt-1 grid grid-cols-2 gap-2"><button type="button" onClick={() => onEditRoleChange('admin')} className={`flex items-center space-x-2 rounded-xl border p-3 text-left transition ${editRole === 'admin' ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300' : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'}`}><Crown className="h-4 w-4 text-amber-500" /><span><strong className="block text-xs">超级管理员</strong><small className="text-[10px] opacity-75">全系统管理权限</small></span></button><button type="button" onClick={() => onEditRoleChange('user')} className={`flex items-center space-x-2 rounded-xl border p-3 text-left transition ${editRole === 'user' ? 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-300' : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'}`}><UserCheck className="h-4 w-4 text-sky-500" /><span><strong className="block text-xs">普通用户</strong><small className="text-[10px] opacity-75">基础使用权限</small></span></button></div></div>
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">重置密码 (留空则保持原密码不变)<input type="password" value={editNewPassword} onChange={(event) => onEditNewPasswordChange(event.target.value)} placeholder="留空表示不修改密码" className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></label>
        <label className="flex cursor-pointer items-center space-x-2 pt-1 text-xs font-semibold text-slate-700 dark:text-slate-300"><input type="checkbox" checked={editEnabled} onChange={(event) => onEditEnabledChange(event.target.checked)} className="rounded border-slate-300 text-sky-500 focus:ring-sky-400" /><span>账号处于启用状态 (允许登录控制台)</span></label>
        <div className="flex justify-end space-x-2 pt-2"><button type="button" onClick={onCloseEdit} className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">取消</button><button type="submit" disabled={actionLoading} className="rounded-xl bg-sky-500 px-5 py-2 text-xs font-bold text-white shadow-md shadow-sky-500/25 transition hover:bg-sky-600 disabled:opacity-50">{actionLoading ? '保存中...' : '保存更改'}</button></div>
      </form></div></div>
    )}

    {deletingUser && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"><div className="w-full max-w-md space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center space-x-3 text-rose-500"><div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/20"><Trash2 className="h-5 w-5" /></div><div><h3 className="text-base font-bold text-slate-900 dark:text-white">删除控制台用户</h3><p className="text-xs text-slate-500 dark:text-slate-400">操作不可撤销</p></div></div><p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">确定要永久删除控制台用户 <span className="font-mono font-bold text-slate-900 dark:text-white">[{deletingUser.username}]</span> 吗？{deletingUser.username === 'admin' && <span className="mt-2 block rounded-xl border border-amber-200 bg-amber-50 p-2.5 font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">⚠️ 您正在删除初始管理员 admin。删除后，请确保您已牢记当前登录的管理员账户与密码。</span>}</p><div className="flex justify-end space-x-2 pt-2"><button type="button" onClick={onCloseDelete} className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">取消</button><button type="button" onClick={onDelete} disabled={actionLoading} className="rounded-xl bg-rose-600 px-5 py-2 text-xs font-bold text-white shadow-md shadow-rose-600/25 transition hover:bg-rose-500 disabled:opacity-50">{actionLoading ? '删除中...' : '确认永久删除'}</button></div></div></div>
    )}
  </>
);
