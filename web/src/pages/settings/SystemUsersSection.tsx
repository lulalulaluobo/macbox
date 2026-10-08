import React from 'react';
import { Crown, Key, Plus, Trash2, Users, UserCheck } from 'lucide-react';
import type { SystemUser } from '../../types';

interface SystemUsersSectionProps {
  users: SystemUser[];
  showAddModal: boolean;
  username: string;
  password: string;
  isSudo: boolean;
  changePasswordUser: string | null;
  targetPassword: string;
  actionLoading: boolean;
  onOpenAdd: () => void;
  onCloseAdd: () => void;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSudoChange: (value: boolean) => void;
  onCreate: (event: React.FormEvent<HTMLFormElement>) => void;
  onOpenChangePassword: (username: string) => void;
  onCloseChangePassword: () => void;
  onTargetPasswordChange: (value: string) => void;
  onUpdatePassword: (event: React.FormEvent<HTMLFormElement>) => void;
  onDelete: (username: string) => void;
}

export const SystemUsersSection: React.FC<SystemUsersSectionProps> = ({
  users,
  showAddModal,
  username,
  password,
  isSudo,
  changePasswordUser,
  targetPassword,
  actionLoading,
  onOpenAdd,
  onCloseAdd,
  onUsernameChange,
  onPasswordChange,
  onSudoChange,
  onCreate,
  onOpenChangePassword,
  onCloseChangePassword,
  onTargetPasswordChange,
  onUpdatePassword,
  onDelete,
}) => (
  <>
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-4 sm:flex-row sm:items-center">
        <div><h3 className="text-base font-bold text-white">系统账号</h3><p className="mt-0.5 text-xs text-slate-400">管理运行系统中的账号和操作权限</p></div>
        <button type="button" onClick={onOpenAdd} className="flex items-center space-x-1.5 self-start rounded-xl bg-sky-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-400 sm:self-auto"><Plus className="h-4 w-4" /><span>添加账号</span></button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {users.map((user) => {
          const isRoot = user.isRoot || user.username === 'root';
          const isCurrent = user.uid === 501;
          return (
            <div key={user.username} className="flex flex-col justify-between space-y-4 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-5 shadow-lg transition hover:border-slate-700/80">
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border shadow-inner ${isRoot ? 'border-amber-500/30 bg-amber-500/15 text-amber-300' : user.isSudo ? 'border-sky-500/30 bg-sky-500/15 text-sky-300' : 'border-slate-700 bg-slate-800 text-slate-300'}`}>{isRoot ? <Crown className="h-5 w-5" /> : <Users className="h-5 w-5" />}</div>
                    <div><div className="flex items-center space-x-2"><span className="font-mono text-base font-bold text-white">{user.username}</span>{isCurrent && <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">当前账号</span>}</div><p className="mt-0.5 font-mono text-[11px] text-slate-400">UID: {user.uid}</p></div>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${isRoot ? 'border-amber-500/30 bg-amber-500/15 text-amber-300' : user.isSudo ? 'border-sky-500/30 bg-sky-500/15 text-sky-300' : 'border-slate-700/60 bg-slate-800 text-slate-400'}`}>{isRoot ? "管理员" : user.isSudo ? "管理权限" : "普通账号"}</span>
                </div>
                <div className="space-y-1.5 rounded-xl border border-slate-800/80 bg-slate-950/60 p-3 font-mono text-xs">
                  <div className="flex justify-between text-slate-400"><span>个人目录</span><span className="max-w-[180px] truncate text-slate-200">{user.homeDir}</span></div>
                  <div className="flex justify-between text-slate-400"><span>命令程序</span><span className="text-slate-200">{user.shell}</span></div>
                  <div className="border-t border-slate-800/50 pt-1 text-[11px] text-slate-400"><span>所属组别 </span><span className="text-sky-300/90">{user.groups.join(', ') || '-'}</span></div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-slate-800/80 pt-2">
                <button type="button" onClick={() => onOpenChangePassword(user.username)} className="flex flex-1 items-center justify-center space-x-1.5 rounded-xl border border-slate-700 bg-slate-800 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"><Key className="h-3.5 w-3.5 text-amber-400" /><span>修改密码</span></button>
                {!isRoot && !isCurrent && <button type="button" onClick={() => onDelete(user.username)} className="rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-400 transition hover:bg-rose-950/60 hover:text-rose-400" title="删除账号"><Trash2 className="h-4 w-4" /></button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>

    {showAddModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
        <div className="w-full max-w-md space-y-5 rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3"><h3 className="flex items-center space-x-2 text-base font-bold text-white"><UserCheck className="h-5 w-5 text-sky-400" /><span>添加账号</span></h3><button type="button" onClick={onCloseAdd} className="rounded-lg p-1 text-slate-400 hover:text-white">✕</button></div>
          <form onSubmit={onCreate} className="space-y-4">
            <div className="space-y-1.5"><label className="text-xs font-semibold text-slate-300">账号名称</label><input type="text" value={username} onChange={(event) => onUsernameChange(event.target.value.toLowerCase())} placeholder="例如: dev, backup, admin2" className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 font-mono text-sm text-white focus:border-sky-500 focus:outline-none" required /></div>
            <div className="space-y-1.5"><label className="text-xs font-semibold text-slate-300">登录密码</label><input type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} placeholder="输入登录密码" className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 font-mono text-sm text-white focus:border-sky-500 focus:outline-none" /></div>
            <div className="flex items-center space-x-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5"><input type="checkbox" id="sudoCheck" checked={isSudo} onChange={(event) => onSudoChange(event.target.checked)} className="cursor-pointer rounded border-slate-700 text-sky-500 focus:ring-0" /><label htmlFor="sudoCheck" className="cursor-pointer select-none text-xs text-slate-300">允许管理</label></div>
            <div className="flex justify-end space-x-2 pt-3"><button type="button" onClick={onCloseAdd} className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white">取消</button><button type="submit" disabled={actionLoading || !username.trim()} className="rounded-xl bg-sky-500 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-400 disabled:opacity-50">{actionLoading ? "创建中" : "创建账号"}</button></div>
          </form>
        </div>
      </div>
    )}

    {changePasswordUser && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
        <div className="w-full max-w-sm space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          <h3 className="flex items-center space-x-2 text-base font-bold text-white"><Key className="h-4 w-4 text-amber-400" /><span>修改密码 {changePasswordUser}</span></h3>
          <form onSubmit={onUpdatePassword} className="space-y-4"><div className="space-y-1.5"><label className="text-xs font-semibold text-slate-300">新密码</label><input type="password" value={targetPassword} onChange={(event) => onTargetPasswordChange(event.target.value)} placeholder="输入新密码" className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 font-mono text-sm text-white focus:border-sky-500 focus:outline-none" autoFocus required /></div><div className="flex justify-end space-x-2 pt-2"><button type="button" onClick={onCloseChangePassword} className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white">取消</button><button type="submit" disabled={actionLoading || !targetPassword} className="rounded-xl bg-sky-500 px-5 py-2 text-xs font-bold text-white transition hover:bg-sky-400 disabled:opacity-50">保存</button></div></form>
        </div>
      </div>
    )}
  </>
);
