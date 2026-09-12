import { useState } from 'react';
import type { Dispatch, FormEvent, MouseEvent, SetStateAction } from 'react';
import { api } from '../../../api';
import type { FileItem } from '../../../types';
import type { ConflictPolicy, TransferOperation } from './TransferDestinationModal';

export interface TransferRequest {
  operation: TransferOperation;
  paths: string[];
  initialPath: string;
}

interface UseFileOperationsOptions {
  currentPath: string;
  selectedPaths: Set<string>;
  setSelectedPaths: Dispatch<SetStateAction<Set<string>>>;
  setSelectionMode: Dispatch<SetStateAction<boolean>>;
  loadFiles: (targetPath: string) => Promise<void>;
  loadTrash: () => Promise<void>;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

export interface FileOperationsState {
  transferRequest: TransferRequest | null;
  setTransferRequest: Dispatch<SetStateAction<TransferRequest | null>>;
  showMkdirModal: boolean;
  setShowMkdirModal: Dispatch<SetStateAction<boolean>>;
  newFolderName: string;
  setNewFolderName: Dispatch<SetStateAction<string>>;
  showRenameModal: boolean;
  setShowRenameModal: Dispatch<SetStateAction<boolean>>;
  renameItem: FileItem | null;
  setRenameItem: Dispatch<SetStateAction<FileItem | null>>;
  renameNewName: string;
  setRenameNewName: Dispatch<SetStateAction<string>>;
  showDeleteModal: boolean;
  setShowDeleteModal: Dispatch<SetStateAction<boolean>>;
  deleteTarget: FileItem | null;
  setDeleteTarget: Dispatch<SetStateAction<FileItem | null>>;
  deleting: boolean;
  openTransfer: (operation: TransferOperation, paths: string[], initialPath?: string, event?: MouseEvent) => void;
  handleCreateFolder: (event: FormEvent) => Promise<void>;
  handleOpenRename: (item: FileItem, event?: MouseEvent) => void;
  handleRenameConfirm: (event: FormEvent) => Promise<void>;
  handleTransferConfirm: (destination: string, conflictPolicy: ConflictPolicy) => Promise<void>;
  handleOpenDelete: (item: FileItem, event?: MouseEvent) => void;
  handleMoveToTrashConfirm: () => Promise<void>;
  handlePermanentDeleteConfirm: () => Promise<void>;
}

const getErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
);

export const useFileOperations = ({
  currentPath,
  selectedPaths,
  setSelectedPaths,
  setSelectionMode,
  loadFiles,
  loadTrash,
  onSuccess,
  onError,
}: UseFileOperationsOptions): FileOperationsState => {
  const [transferRequest, setTransferRequest] = useState<TransferRequest | null>(null);
  const [showMkdirModal, setShowMkdirModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameItem, setRenameItem] = useState<FileItem | null>(null);
  const [renameNewName, setRenameNewName] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FileItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleCreateFolder = async (event: FormEvent) => {
    event.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      const targetDir = currentPath === '/' ? `/${newFolderName.trim()}` : `${currentPath}/${newFolderName.trim()}`;
      await api.createFolder(targetDir);
      setShowMkdirModal(false);
      setNewFolderName('');
      onSuccess('文件夹创建成功');
      await loadFiles(currentPath);
    } catch (error: unknown) {
      onError(`创建文件夹失败: ${getErrorMessage(error)}`);
    }
  };

  const handleOpenRename = (item: FileItem, event?: MouseEvent) => {
    event?.stopPropagation();
    setRenameItem(item);
    setRenameNewName(item.name);
    setShowRenameModal(true);
  };

  const handleRenameConfirm = async (event: FormEvent) => {
    event.preventDefault();
    if (!renameItem || !renameNewName.trim() || renameNewName === renameItem.name) {
      setShowRenameModal(false);
      return;
    }
    const newPath = currentPath === '/' ? `/${renameNewName.trim()}` : `${currentPath}/${renameNewName.trim()}`;
    try {
      await api.renameFile(renameItem.path, newPath);
      setShowRenameModal(false);
      setRenameItem(null);
      onSuccess('重命名成功');
      await loadFiles(currentPath);
    } catch (error: unknown) {
      onError(`重命名失败: ${getErrorMessage(error)}`);
    }
  };

  const openTransfer = (operation: TransferOperation, paths: string[], initialPath = currentPath, event?: MouseEvent) => {
    event?.stopPropagation();
    if (paths.length === 0) return;
    setTransferRequest({ operation, paths, initialPath });
  };

  const handleTransferConfirm = async (destination: string, conflictPolicy: ConflictPolicy) => {
    if (!transferRequest) return;
    const result = transferRequest.operation === 'copy'
      ? await api.copyFiles(transferRequest.paths, destination, conflictPolicy)
      : await api.moveFiles(transferRequest.paths, destination, conflictPolicy);
    setTransferRequest(null);
    setSelectedPaths(new Set());
    setSelectionMode(false);
    onSuccess(result.message);
    await loadFiles(currentPath);
  };

  const handleOpenDelete = (item: FileItem, event?: MouseEvent) => {
    event?.stopPropagation();
    setDeleteTarget(item);
    setShowDeleteModal(true);
  };

  const handleMoveToTrashConfirm = async () => {
    const targets = deleteTarget ? [deleteTarget.path] : Array.from(selectedPaths);
    if (targets.length === 0) return;
    setDeleting(true);
    try {
      const response = await api.moveToTrash(targets);
      setShowDeleteModal(false);
      setDeleteTarget(null);
      setSelectedPaths(new Set());
      setSelectionMode(false);
      onSuccess(response.message);
      await loadFiles(currentPath);
      await loadTrash();
    } catch (error: unknown) {
      onError(`移入回收站失败: ${getErrorMessage(error)}`);
    } finally {
      setDeleting(false);
    }
  };

  const handlePermanentDeleteConfirm = async () => {
    const targets = deleteTarget ? [deleteTarget.path] : Array.from(selectedPaths);
    if (targets.length === 0) return;
    setDeleting(true);
    try {
      for (const path of targets) {
        await api.deleteFile(path);
      }
      setShowDeleteModal(false);
      setDeleteTarget(null);
      setSelectedPaths(new Set());
      setSelectionMode(false);
      onSuccess(`已彻底删除 ${targets.length} 个项目`);
      await loadFiles(currentPath);
    } catch (error: unknown) {
      onError(`删除失败: ${getErrorMessage(error)}`);
    } finally {
      setDeleting(false);
    }
  };

  return {
    transferRequest,
    setTransferRequest,
    showMkdirModal,
    setShowMkdirModal,
    newFolderName,
    setNewFolderName,
    showRenameModal,
    setShowRenameModal,
    renameItem,
    setRenameItem,
    renameNewName,
    setRenameNewName,
    showDeleteModal,
    setShowDeleteModal,
    deleteTarget,
    setDeleteTarget,
    deleting,
    openTransfer,
    handleCreateFolder,
    handleOpenRename,
    handleRenameConfirm,
    handleTransferConfirm,
    handleOpenDelete,
    handleMoveToTrashConfirm,
    handlePermanentDeleteConfirm,
  };
};
