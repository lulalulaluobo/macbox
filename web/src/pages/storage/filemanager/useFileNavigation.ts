import { useEffect, useState } from 'react';
import { FileItem } from '../../../types';
import { api } from '../../../api';

export type FileSortBy = 'name' | 'size' | 'mtime';
export type FileSortOrder = 'asc' | 'desc';
export type FileViewMode = 'grid' | 'list';

export interface UseFileNavigationOptions {
  initialPath: string;
  onError: (message: string) => void;
}

export const useFileNavigation = ({ initialPath, onError }: UseFileNavigationOptions) => {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreFiles, setHasMoreFiles] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<FileSortBy>('name');
  const [sortOrder, setSortOrder] = useState<FileSortOrder>('asc');
  const [viewMode, setViewMode] = useState<FileViewMode>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches ? 'list' : 'grid'
  );
  const [discoveredDrivePaths, setDiscoveredDrivePaths] = useState<string[]>([]);

  const loadFiles = async (targetPath: string, append = false) => {
    append ? setLoadingMore(true) : setLoading(true);
    try {
      const offset = append ? files.length : 0;
      const response = await api.listFiles(targetPath, offset);
      setFiles((current) => append ? [...current, ...(response.items || [])] : (response.items || []));
      setHasMoreFiles(Boolean(response.hasMore));
      setCurrentPath(response.path);
      if (response.path === '/data') {
        const discovered = (response.items || [])
          .filter((item) => item.isDir && /^(volume|disk|storage)[-_ ]?\d/i.test(item.name))
          .map((item) => item.path);
        if (discovered.length > 0) setDiscoveredDrivePaths(discovered);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      onError(`读取文件夹失败: ${message}`);
    } finally {
      append ? setLoadingMore(false) : setLoading(false);
    }
  };

  useEffect(() => {
    void loadFiles(currentPath);
  }, [currentPath]);

  const handleGoUp = () => {
    if (currentPath === '/' || currentPath === '/data') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setCurrentPath('/' + parts.join('/') || '/');
  };

  return {
    currentPath,
    setCurrentPath,
    files,
    loading,
    loadingMore,
    hasMoreFiles,
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    viewMode,
    setViewMode,
    discoveredDrivePaths,
    loadFiles,
    handleGoUp,
  };
};
