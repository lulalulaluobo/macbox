import React from 'react';
import { FolderPlus, Edit3, Trash2, ShieldCheck, X } from 'lucide-react';
import { FileItem, TrashItem } from '../../../types';

interface FileModalsProps {
  // Mkdir
  showMkdirModal: boolean;
  newFolderName: string;
  onCloseMkdir: () => void;
  onNewFolderNameChange: (name: string) => void;
  onCreateFolder: (e: React.FormEvent) => void;

  // Rename
  showRenameModal: boolean;
  renameItem: FileItem | null;
  renameNewName: string;
  onCloseRename: () => void;
  onRenameNewNameChange: (name: string) => void;
  onRenameConfirm: (e: React.FormEvent) => void;

  // Delete
  showDeleteModal: boolean;
  deleteTarget: FileItem | null;
  selectedCount: number;
  deleting: boolean;
  onCloseDelete: () => void;
  onPermanentDelete: () => void;
  onMoveToTrash: () => void;

  // Trash Delete
  showTrashDeleteModal: boolean;
  trashDeleteTarget: TrashItem | null;
  trashSelectedCount: number;
  deletingTrash: boolean;
  onCloseTrashDelete: () => void;
  onConfirmDeleteTrash: () => void;

  // Empty Trash
  showEmptyTrashModal: boolean;
  trashItemsCount: number;
  onCloseEmptyTrash: () => void;
  onConfirmEmptyTrash: () => void;
}

export const FileModals: React.FC<FileModalsProps> = ({
  showMkdirModal,
  newFolderName,
  onCloseMkdir,
  onNewFolderNameChange,
  onCreateFolder,
  showRenameModal,
  renameItem,
  renameNewName,
  onCloseRename,
  onRenameNewNameChange,
  onRenameConfirm,
  showDeleteModal,
  deleteTarget,
  selectedCount,
  deleting,
  onCloseDelete,
  onPermanentDelete,
  onMoveToTrash,
  showTrashDeleteModal,
  trashDeleteTarget,
  trashSelectedCount,
  deletingTrash,
  onCloseTrashDelete,
  onConfirmDeleteTrash,
  showEmptyTrashModal,
  trashItemsCount,
  onCloseEmptyTrash,
  onConfirmEmptyTrash,
}) => {
  return (
    <>
      {/* 1. Mkdir Modal */}
      {showMkdirModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white text-sm flex items-center space-x-2">
                <FolderPlus className="w-4 h-4 text-sky-400" />
                <span>新建文件夹</span>
              </h3>
              <button onClick={onCloseMkdir} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={onCreateFolder} className="space-y-4">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => onNewFolderNameChange(e.target.value)}
                placeholder="例如: 电影 或 备份"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-sky-500"
                autoFocus
              />
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={onCloseMkdir}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-medium"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!newFolderName.trim()}
                  className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold disabled:opacity-50"
                >
                  创建
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Rename Modal */}
      {showRenameModal && renameItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white text-sm flex items-center space-x-2">
                <Edit3 className="w-4 h-4 text-sky-400" />
                <span>重命名</span>
              </h3>
              <button onClick={onCloseRename} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={onRenameConfirm} className="space-y-4">
              <input
                type="text"
                value={renameNewName}
                onChange={(e) => onRenameNewNameChange(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-sky-500"
                autoFocus
              />
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={onCloseRename}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-medium"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!renameNewName.trim() || renameNewName === renameItem.name}
                  className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold disabled:opacity-50"
                >
                  确认更改
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Delete / Move to Trash Modal */}
      {showDeleteModal && (deleteTarget || selectedCount > 0) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3">
              <div className="p-3 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">删除文件确认</h3>
                <p className="text-xs text-slate-400">建议优先移入回收站，可随时安全还原</p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs">
              <span className="text-slate-400">即将处理: </span>
              {deleteTarget ? (
                <>
                  <strong className="text-white font-mono">{deleteTarget.name}</strong>
                  <p className="text-[10px] text-slate-500 font-mono mt-1 truncate">{deleteTarget.path}</p>
                </>
              ) : (
                <strong className="text-white">已勾选的 {selectedCount} 个项目</strong>
              )}
            </div>

            <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-200 text-xs flex items-start space-x-2">
              <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <span>
                <strong>回收站机制</strong>: 移入回收站后文件暂存于 <code className="text-sky-300 font-mono">/data/.trash</code>，点击侧边栏回收站即可一键找回。
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onCloseDelete}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-medium transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={onPermanentDelete}
                disabled={deleting}
                className="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-semibold transition disabled:opacity-50"
              >
                彻底抹除
              </button>
              <button
                type="button"
                onClick={onMoveToTrash}
                disabled={deleting}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-lg shadow-sky-600/25 flex items-center justify-center space-x-1.5 transition disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{deleting ? '处理中...' : '移入回收站 (推荐)'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Trash Individual / Batch Delete to Mac Trash Modal */}
      {showTrashDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3">
              <div className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-400">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">移入 Mac 本机废纸篓确认</h3>
                <p className="text-xs text-slate-400">项目将安全移入 Mac 访达废纸篓 (~/.Trash)</p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
              <span className="text-slate-400">即将处理: </span>
              {trashDeleteTarget ? (
                <>
                  <strong className="text-white font-mono block">{trashDeleteTarget.name}</strong>
                  <p className="text-[10px] text-slate-500 font-mono truncate">原路径: {trashDeleteTarget.originalPath}</p>
                </>
              ) : (
                <strong className="text-white">已选中的 {trashSelectedCount} 个项目</strong>
              )}
            </div>

            <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-200 text-xs flex items-start space-x-2">
              <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <span>
                <strong>Mac 本机废纸篓双重保障</strong>: 从回收站删除后，文件不会直接物理抹除，而是会安全转入 Mac 系统的 <code className="text-sky-300 font-mono">~/.Trash</code>。您可随时在 Mac 访达 (Finder) 废纸篓中查阅、还原或彻底清空。
              </span>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={onCloseTrashDelete}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-medium transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={onConfirmDeleteTrash}
                disabled={deletingTrash}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/25 flex items-center space-x-1.5 transition disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{deletingTrash ? '正在转移...' : '移入 Mac 废纸篓 (删除)'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Empty Trash Modal */}
      {showEmptyTrashModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3">
              <div className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-400">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">清空回收站确认</h3>
                <p className="text-xs text-slate-400">所有文件将安全移入 Mac 本机废纸篓</p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs">
              <p className="text-slate-300">回收站内目前共有 <strong className="text-rose-400 font-bold">{trashItemsCount}</strong> 个暂存项目。</p>
            </div>

            <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-200 text-xs flex items-start space-x-2">
              <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <span>
                <strong>安全声明</strong>: 清空后并非不可挽回的物理擦除，系统会自动将全部项目转移到 Mac 本机系统的 <code className="text-sky-300 font-mono">~/.Trash</code> (访达废纸篓)，保留最后的防误删安全网。
              </span>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={onCloseEmptyTrash}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-medium transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={onConfirmEmptyTrash}
                disabled={deletingTrash}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/25 flex items-center space-x-1.5 transition disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{deletingTrash ? '正在转移...' : '确认清空并移入 Mac 废纸篓'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
