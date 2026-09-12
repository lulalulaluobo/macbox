import { useState } from 'react';
import type { MouseEvent } from 'react';
import { FileItem } from '../../../types';

export interface UseFileSelectionOptions {
  filteredFiles: FileItem[];
}

export const useFileSelection = ({ filteredFiles }: UseFileSelectionOptions) => {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);

  const toggleSelectItem = (path: string, event?: MouseEvent) => {
    event?.stopPropagation();
    setSelectedPaths((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedPaths.size === filteredFiles.length && filteredFiles.length > 0) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(filteredFiles.map((file) => file.path)));
    }
  };

  const handleLongPress = (item: FileItem) => {
    setSelectionMode(true);
    setSelectedPaths((current) => new Set(current).add(item.path));
  };

  return {
    selectedPaths,
    setSelectedPaths,
    selectionMode,
    setSelectionMode,
    toggleSelectItem,
    handleSelectAll,
    handleLongPress,
  };
};
