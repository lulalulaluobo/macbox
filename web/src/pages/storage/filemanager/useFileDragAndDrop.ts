import { useRef, useState } from 'react';
import type { Dispatch, DragEvent, SetStateAction } from 'react';
import type { FileItem } from '../../../types';
import type { TransferOperation } from './TransferDestinationModal';

interface UseFileDragAndDropOptions {
  selectedPaths: Set<string>;
  setSelectedPaths: Dispatch<SetStateAction<Set<string>>>;
  setSelectionMode: Dispatch<SetStateAction<boolean>>;
  openTransfer: (operation: TransferOperation, paths: string[], initialPath?: string) => void;
}

export function useFileDragAndDrop({
  selectedPaths,
  setSelectedPaths,
  setSelectionMode,
  openTransfer,
}: UseFileDragAndDropOptions) {
  const draggedPathsRef = useRef<string[]>([]);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);

  const handleItemDragStart = (item: FileItem, event: DragEvent<HTMLDivElement>) => {
    const paths = selectedPaths.has(item.path) ? Array.from(selectedPaths) : [item.path];
    draggedPathsRef.current = paths;
    setSelectionMode(true);
    setSelectedPaths(new Set(paths));
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', JSON.stringify(paths));
  };

  const handleItemDragOver = (item: FileItem, event: DragEvent<HTMLDivElement>) => {
    if (!item.isDir || draggedPathsRef.current.length === 0) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetPath(item.path);
  };

  const handleItemDrop = (item: FileItem, event: DragEvent<HTMLDivElement>) => {
    if (!item.isDir || draggedPathsRef.current.length === 0) return;
    event.preventDefault();
    const paths = draggedPathsRef.current;
    draggedPathsRef.current = [];
    setDropTargetPath(null);
    openTransfer('move', paths, item.path);
  };

  return {
    dropTargetPath,
    handleItemDragStart,
    handleItemDragOver,
    handleItemDrop,
  };
}
