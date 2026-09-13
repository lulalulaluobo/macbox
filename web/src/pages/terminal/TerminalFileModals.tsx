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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-0 backdrop-blur-md sm:p-4" role="dialog" aria-modal="true" aria-labelledby="terminal-file-editor-title">
        <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-slate-900 shadow-2xl sm:h-[min(760px,92dvh)] sm:max-w-3xl sm:rounded-2xl sm:border sm:border-slate-800">
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-800 px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5 sm:py-4">
            <div className="flex min-w-0 items-start gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
                {editingFile.readOnly ? <FileText className="h-4 w-4" /> : <Edit3 className="h-4 w-4" />}
              </span>
              <div className="min-w-0">
                <p id="terminal-file-editor-title" className="max-h-10 overflow-hidden break-words text-sm font-bold leading-5 text-white sm:max-h-none">
                  {editingFile.name}
                </p>
                <p className="mt-1 truncate font-mono text-[10px] leading-4 text-slate-500" title={editingFile.path}>
                  {editingFile.path}
                </p>
              </div>
            </div>
            <button onClick={onCloseEditor} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-white" aria-label="关闭文件编辑器">
              <X className="h-5 w-5" />
            </button>
          </header>

          <textarea
            value={editingFile.content}
            onChange={(event) => onEditContent(event.target.value)}
            readOnly={editingFile.readOnly}
            className={`m-3 min-h-0 flex-1 resize-none rounded-xl border border-slate-800 bg-[#090d16] p-3 font-mono text-xs leading-relaxed text-slate-200 focus:border-sky-500 focus:outline-none sm:m-5 sm:p-4 ${editingFile.readOnly ? 'cursor-default opacity-80' : ''}`}
            spellCheck={false}
          />

          <footer className="flex shrink-0 flex-col gap-2 border-t border-slate-800 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4">
            <span className="hidden text-xs leading-5 text-slate-500 sm:block">
              {editingFile.readOnly ? 'VM 系统目录仅支持查看；如需修改，请使用 root 终端命令并确认风险' : '支持直接在线修改文件并写回虚拟机文件系统'}
            </span>
            <div className={`grid w-full gap-2 sm:flex sm:w-auto ${editingFile.readOnly ? 'grid-cols-1' : 'grid-cols-2'}`}>
              <button onClick={onCloseEditor} className="min-h-11 rounded-xl bg-slate-800 px-4 text-xs font-medium text-slate-300 hover:text-white">{editingFile.readOnly ? '关闭' : '取消'}</button>
              {!editingFile.readOnly && (
                <button onClick={onSaveFile} disabled={savingFile} className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-4 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
                  <Save className="h-3.5 w-3.5" />
                  <span>{savingFile ? '保存中...' : '保存更改'}</span>
                </button>
              )}
            </div>
          </footer>
        </div>
      </div>
    )}
  </>
);
