import React from 'react';
import { Edit3, FileText, FolderPlus, Save, X } from 'lucide-react';

export interface TerminalEditingFile {
  path: string;
  name: string;
  content: string;
  readOnly: boolean;
}

interface TerminalFileModalsProps {
  showMkdirModal: boolean;
  currentPath: string;
  newFolderName: string;
  editingFile: TerminalEditingFile | null;
  savingFile: boolean;
  onNewFolderNameChange: (value: string) => void;
  onCloseMkdir: () => void;
  onCreateFolder: (event: React.FormEvent) => void | Promise<void>;
  onCloseEditor: () => void;
  onEditContent: (content: string) => void;
  onSaveFile: () => void | Promise<void>;
}

export const TerminalFileModals: React.FC<TerminalFileModalsProps> = ({
  showMkdirModal,
  currentPath,
  newFolderName,
  editingFile,
  savingFile,
  onNewFolderNameChange,
  onCloseMkdir,
  onCreateFolder,
  onCloseEditor,
  onEditContent,
  onSaveFile,
}) => (
  <>
    {showMkdirModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
        <div className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
          <h3 className="flex items-center space-x-2 text-base font-bold text-white">
            <FolderPlus className="h-4 w-4 text-sky-400" />
            <span>新建文件夹</span>
          </h3>
          <p className="text-xs text-slate-400">将在目录 <code className="text-sky-300">{currentPath}</code> 下创建新文件夹：</p>
          <form onSubmit={onCreateFolder} className="space-y-4">
            <input
              type="text"
              value={newFolderName}
              onChange={(event) => onNewFolderNameChange(event.target.value)}
              placeholder="例如: documents 或 backup"
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-sky-500 focus:outline-none"
              autoFocus
            />
            <div className="flex justify-end space-x-2">
              <button type="button" onClick={onCloseMkdir} className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:text-white">取消</button>
              <button type="submit" disabled={!newFolderName.trim()} className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50">创建</button>
            </div>
          </form>
        </div>
      </div>
    )}

    {editingFile && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
        <div className="flex max-h-[85dvh] w-full max-w-3xl flex-col space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2">
              {editingFile.readOnly ? <FileText className="h-4 w-4 text-sky-400" /> : <Edit3 className="h-4 w-4 text-sky-400" />}
              <span className="text-sm font-bold text-white">{editingFile.name}</span>
              <span className="font-mono text-xs text-slate-500">({editingFile.path})</span>
            </div>
            <button onClick={onCloseEditor} className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-800 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>

          <textarea
            value={editingFile.content}
            onChange={(event) => onEditContent(event.target.value)}
            readOnly={editingFile.readOnly}
            className={`min-h-[360px] w-full flex-1 resize-none rounded-xl border border-slate-800 bg-[#090d16] p-4 font-mono text-xs leading-relaxed text-slate-200 focus:border-sky-500 focus:outline-none ${editingFile.readOnly ? 'cursor-default opacity-80' : ''}`}
            spellCheck={false}
          />

          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-slate-500">
              {editingFile.readOnly ? 'VM 系统目录仅支持查看；如需修改，请使用 root 终端命令并确认风险' : '支持直接在线修改文件并写回虚拟机文件系统'}
            </span>
            <div className="flex items-center space-x-2">
              <button onClick={onCloseEditor} className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:text-white">取消</button>
              {!editingFile.readOnly && (
                <button onClick={onSaveFile} disabled={savingFile} className="flex items-center space-x-1.5 rounded-xl bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
                  <Save className="h-3.5 w-3.5" />
                  <span>{savingFile ? '保存中...' : '保存更改'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )}
  </>
);
