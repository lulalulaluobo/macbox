import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, RefObject } from 'react';
import { api } from '../../../api';

interface UseFileUploadOptions {
  targetPath: string;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onReload: () => void;
}

const getErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
);

export interface FileUploadState {
  uploading: boolean;
  uploadProgress: string;
  fileInputRef: RefObject<HTMLInputElement>;
  isDragging: boolean;
  handleFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
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

  const uploadFiles = async (fileArray: File[]) => {
    setUploading(true);
    let successCount = 0;
    try {
      for (let i = 0; i < fileArray.length; i += 1) {
        const file = fileArray[i];
        setUploadProgress(`正在上传 (${i + 1}/${fileArray.length}): ${file.name}`);
        await api.uploadFile(file, targetPath);
        successCount += 1;
      }
      onSuccess(`成功上传 ${successCount} 个文件`);
      onReload();
    } catch (error: unknown) {
      onError(`上传过程中断: ${getErrorMessage(error)}`);
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const uploadList = event.target.files;
    if (!uploadList || uploadList.length === 0) return;
    await uploadFiles(Array.from(uploadList));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDragOver = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
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
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      await uploadFiles(Array.from(event.dataTransfer.files));
    }
  };

  return {
    uploading,
    uploadProgress,
    fileInputRef,
    isDragging,
    handleFileChange,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
};
