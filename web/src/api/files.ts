import type { FileItem, TrashItem } from '../types';
import { BASE_URL, fetchJSON, getAuthenticatedFileUrl } from './client';
import { uploadFileRequest } from './upload';

export const filesApi = {  // Web Terminal & File System
  listFiles: (path?: string, offset = 0, limit = 300) => fetchJSON<{ status: string; path: string; items: FileItem[]; hasMore: boolean; nextOffset: number }>(
    `${BASE_URL}/terminal/files?${new URLSearchParams({ ...(path ? { path } : {}), offset: String(offset), limit: String(limit) })}`
  ),
  readFile: (path: string) => fetchJSON<{ status: string; path: string; content: string }>(
    `${BASE_URL}/terminal/files/read?path=${encodeURIComponent(path)}`
  ),
  writeFile: (path: string, content: string) => fetchJSON<{ status: string; message: string }>(
    `${BASE_URL}/terminal/files/write`,
    {
      method: 'POST',
      body: JSON.stringify({ path, content }),
    }
  ),
  createFolder: (path: string, uploadRoot?: string) => fetchJSON<{ status: string; message: string }>(
    `${BASE_URL}/terminal/files/mkdir`,
    {
      method: 'POST',
      body: JSON.stringify({ path, ...(uploadRoot ? { uploadRoot } : {}) }),
    }
  ),
  deleteFile: (path: string) => fetchJSON<{ status: string; message: string }>(
    `${BASE_URL}/terminal/files?path=${encodeURIComponent(path)}`,
    {
      method: 'DELETE',
    }
  ),
  uploadFile: (file: File, targetDir: string, relativePath?: string) => {
    const params = new URLSearchParams({ targetDir });
    if (relativePath) params.set('relativePath', relativePath);
    return uploadFileRequest<{ status: string; message: string }>(`${BASE_URL}/terminal/files/upload?${params}`, file);
  },
  getFileDownloadUrl: (path: string) => getAuthenticatedFileUrl('download', path),
  getArchiveCapabilities: () => fetchJSON<{ zip: boolean }>(`${BASE_URL}/terminal/files/archive-capabilities`),
  getBatchDownloadUrl: (paths: string[]) => {
    const params = new URLSearchParams();
    paths.forEach((path) => params.append('path', path));
    return `${BASE_URL}/terminal/files/download-archive?${params.toString()}`;
  },
  archiveFiles: (sourcePaths: string[], operation: 'compress' | 'extract', format: 'zip', destination: string, conflictPolicy: 'error' | 'overwrite' | 'rename' | 'skip' = 'error') => fetchJSON<{ status: string; message: string }>(
    `${BASE_URL}/terminal/files/archive`,
    {
      method: 'POST',
      body: JSON.stringify({ sourcePaths, operation, format, destination, conflictPolicy }),
    }
  ),
  getFileRawUrl: (path: string) => getAuthenticatedFileUrl('raw', path),
  renameFile: (oldPath: string, newPath: string) => fetchJSON<{ status: string; message: string }>(
    `${BASE_URL}/terminal/files/rename`,
    {
      method: 'POST',
      body: JSON.stringify({ oldPath, newPath }),
    }
  ),
  copyFiles: (srcPaths: string[], destDir: string, conflictPolicy: 'error' | 'overwrite' | 'rename' | 'skip' = 'error') => fetchJSON<{ status: string; message: string }>(
    `${BASE_URL}/terminal/files/copy`,
    {
      method: 'POST',
      body: JSON.stringify({ srcPaths, destDir, conflictPolicy }),
    }
  ),
  moveFiles: (srcPaths: string[], destDir: string, conflictPolicy: 'error' | 'overwrite' | 'rename' | 'skip' = 'error') => fetchJSON<{ status: string; message: string }>(
    `${BASE_URL}/terminal/files/move`,
    {
      method: 'POST',
      body: JSON.stringify({ srcPaths, destDir, conflictPolicy }),
    }
  ),
  moveToTrash: (paths: string[]) => fetchJSON<{ status: string; message: string }>(
    `${BASE_URL}/terminal/files/trash`,
    {
      method: 'POST',
      body: JSON.stringify({ paths }),
    }
  ),
  listTrash: () => fetchJSON<{ status: string; items: TrashItem[] }>(
    `${BASE_URL}/terminal/files/trash`
  ),
  restoreTrash: (ids: string[]) => fetchJSON<{ status: string; message: string }>(
    `${BASE_URL}/terminal/files/restore`,
    {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }
  ),
  emptyTrash: () => fetchJSON<{ status: string; message: string; count?: number }>(
    `${BASE_URL}/terminal/files/empty-trash`,
    {
      method: 'POST',
    }
  ),
  deleteTrashItems: (ids: string[]) => fetchJSON<{ status: string; message: string; count?: number }>(
    `${BASE_URL}/terminal/files/trash/delete`,
    {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }
  ),


};
