import { useState } from 'react';
import { api } from '../../../api';
import type { TrashItem } from '../../../types';

interface UseTrashOptions {
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const getErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
);

export interface TrashState {
  trashItems: TrashItem[];
  trashLoading: boolean;
  trashSelectedIds: Set<string>;
  setTrashSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  showTrashDeleteModal: boolean;
  setShowTrashDeleteModal: React.Dispatch<React.SetStateAction<boolean>>;
  trashDeleteTarget: TrashItem | null;
  setTrashDeleteTarget: React.Dispatch<React.SetStateAction<TrashItem | null>>;
  deletingTrash: boolean;
  showEmptyTrashModal: boolean;
  setShowEmptyTrashModal: React.Dispatch<React.SetStateAction<boolean>>;
  loadTrash: () => Promise<void>;
  handleRestoreTrash: (ids: string[]) => Promise<void>;
  handlePromptDeleteTrash: (item?: TrashItem) => void;
  handleConfirmDeleteTrash: () => Promise<void>;
  handleConfirmEmptyTrash: () => Promise<void>;
}

export const useTrash = ({ onSuccess, onError }: UseTrashOptions): TrashState => {
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashSelectedIds, setTrashSelectedIds] = useState<Set<string>>(new Set());
  const [showTrashDeleteModal, setShowTrashDeleteModal] = useState(false);
  const [trashDeleteTarget, setTrashDeleteTarget] = useState<TrashItem | null>(null);
  const [deletingTrash, setDeletingTrash] = useState(false);
  const [showEmptyTrashModal, setShowEmptyTrashModal] = useState(false);

  const loadTrash = async () => {
    setTrashLoading(true);
    try {
      const response = await api.listTrash();
      setTrashItems(response.items || []);
    } catch {
      // The file list remains usable when the trash endpoint is unavailable.
    } finally {
      setTrashLoading(false);
    }
  };

  const handleRestoreTrash = async (ids: string[]) => {
    try {
      const response = await api.restoreTrash(ids);
      onSuccess(response.message);
      await loadTrash();
    } catch (error: unknown) {
      onError(`还原失败: ${getErrorMessage(error)}`);
    }
  };

  const handlePromptDeleteTrash = (item?: TrashItem) => {
    setTrashDeleteTarget(item || null);
    setShowTrashDeleteModal(true);
  };

  const handleConfirmDeleteTrash = async () => {
    const ids = trashDeleteTarget ? [trashDeleteTarget.id] : Array.from(trashSelectedIds);
    if (ids.length === 0) return;
    setDeletingTrash(true);
    try {
      const response = await api.deleteTrashItems(ids);
      onSuccess(response.message);
      setShowTrashDeleteModal(false);
      setTrashDeleteTarget(null);
      setTrashSelectedIds(new Set());
      await loadTrash();
    } catch (error: unknown) {
      onError(`从回收站删除失败: ${getErrorMessage(error)}`);
    } finally {
      setDeletingTrash(false);
    }
  };

  const handleConfirmEmptyTrash = async () => {
    setDeletingTrash(true);
    try {
      const response = await api.emptyTrash();
      onSuccess(response.message);
      setShowEmptyTrashModal(false);
      setTrashSelectedIds(new Set());
      await loadTrash();
    } catch (error: unknown) {
      onError(`清空回收站失败: ${getErrorMessage(error)}`);
    } finally {
      setDeletingTrash(false);
    }
  };

  return {
    trashItems,
    trashLoading,
    trashSelectedIds,
    setTrashSelectedIds,
    showTrashDeleteModal,
    setShowTrashDeleteModal,
    trashDeleteTarget,
    setTrashDeleteTarget,
    deletingTrash,
    showEmptyTrashModal,
    setShowEmptyTrashModal,
    loadTrash,
    handleRestoreTrash,
    handlePromptDeleteTrash,
    handleConfirmDeleteTrash,
    handleConfirmEmptyTrash,
  };
};
