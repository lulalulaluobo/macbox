import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, RefObject } from 'react';
import { api } from '../../../api';
import { captureUploadDrop, emptyUploadDirectories, joinUploadTarget, selectionFromDrop, selectionFromFiles, supportsFolderUpload } from './uploadEntries';
import type { UploadSelection } from './uploadEntries';

interface UseFileUploadOptions {
  targetPath: string;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onReload: (path: string) => void | Promise<void>;
}

const getErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|load failed|networkerror|network error/i.test(message)) {
    return '浏览器未能完成上传。请确认连接正常；手机上请从“浏览/文件”选择本地文件，或换用 Edge、Chrome 后重试。';
  }
  if (error instanceof DOMException && (error.name === 'NotReadableError' || error.name === 'NotFoundError')) {
    return '手机未能读取所选文件，请先将文件保存到手机本地，再从“浏览/文件”重新选择。';
  }
  return message;
};

export interface FileUploadState {
  uploading: boolean;
  uploadProgress: string;
  fileInputRef: RefObject<HTMLInputElement>;
  folderInputRef: RefObject<HTMLInputElement>;
  folderUploadSupported: boolean;
  isUploadInProgress: () => boolean;
  isDragging: boolean;
  handleFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleFolderChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleFolderPicker: () => void;
  handleDragOver: (event: DragEvent) => void;
  handleDragLeave: (event: DragEvent) => void;
  handleDrop: (event: DragEvent) => Promise<void>;
}

export const useFileUpload = ({
  targetPath,
  onSuccess,
  onError,
  onReload,
}: UseFileUploadOptions): FileUploadState => {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const uploadInProgressRef = useRef(false);
  const folderUploadSupported = supportsFolderUpload();

  const uploadSelection = async (prepare: () => UploadSelection | Promise<UploadSelection>) => {
    if (uploadInProgressRef.current) return;
    uploadInProgressRef.current = true;
    setUploading(true);
    setUploadProgress('正在读取所选文件夹和文件…');
    const destination = targetPath;
    let successCount = 0;
    let createdDirectories = 0;
    let activePath = '';
    try {
      const selection = await prepare();
      if (selection.files.length === 0 && selection.directories.length === 0) {
        throw new Error('没有可上传的文件。选择文件夹时，浏览器不会提供其中的空文件夹；可在电脑上拖入文件夹保留空目录。');
      }
      for (const directory of emptyUploadDirectories(selection)) {
        activePath = directory;
        setUploadProgress(`正在准备文件夹：${directory}`);
        await api.createFolder(joinUploadTarget(destination, directory), destination);
        createdDirectories += 1;
      }
      for (let i = 0; i < selection.files.length; i += 1) {
        const { file, relativePath } = selection.files[i];
        activePath = relativePath;
        setUploadProgress(`上传中：${i + 1}/${selection.files.length}\n${relativePath}`);
        await api.uploadFile(file, destination, relativePath);
        successCount += 1;
      }
      onSuccess(successCount > 0 ? `已上传 ${successCount} 个文件${selection.directories.length ? '，已保留文件夹结构' : ''}` : `已上传 ${selection.directories.length} 个空文件夹`);
    } catch (error: unknown) {
      onError(`${activePath ? `上传“${activePath}”失败` : '无法开始上传'}，已上传 ${successCount} 个文件。${getErrorMessage(error)}`);
    } finally {
      if (successCount > 0 || createdDirectories > 0) {
        try {
          await onReload(destination);
        } catch (error) {
          onError(`已上传 ${successCount} 个文件，但刷新目录失败。${getErrorMessage(error)}`);
        }
      }
      uploadInProgressRef.current = false;
      setUploading(false);
      setUploadProgress('');
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files || []);
    if (files.length === 0) return;
    await uploadSelection(() => selectionFromFiles(files));
    input.value = '';
  };

  const handleFolderChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files || []);
    if (files.length === 0) {
      onError('所选文件夹没有可上传的文件。浏览器选择文件夹时不会提供空目录，可在电脑上拖入文件夹保留空目录。');
      return;
    }
    await uploadSelection(() => selectionFromFiles(files, true));
    input.value = '';
  };

  const handleFolderPicker = () => {
    if (uploadInProgressRef.current) return;
    if (!folderUploadSupported) {
      onError('当前浏览器不支持选择文件夹，请换用 Edge 或 Chrome，或先将文件夹压缩为 ZIP 后上传。');
      return;
    }
    folderInputRef.current?.click();
  };

  const handleDragOver = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    if (uploadInProgressRef.current) return;
    setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    setIsDragging(false);
    if (uploadInProgressRef.current) return;
    const snapshot = captureUploadDrop(event.dataTransfer);
    if (snapshot.entries.length === 0 && snapshot.files.length === 0 && !snapshot.unreadable) return;
    await uploadSelection(() => selectionFromDrop(snapshot));
  };

  return {
    uploading,
    uploadProgress,
    fileInputRef,
    folderInputRef,
    folderUploadSupported,
    isUploadInProgress: () => uploadInProgressRef.current,
    isDragging,
    handleFileChange,
    handleFolderChange,
    handleFolderPicker,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
};
