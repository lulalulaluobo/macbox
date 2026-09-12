import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, Dispatch, DragEvent, RefObject, SetStateAction } from 'react';
import { api } from '../../../api';
import type { BackgroundJob, CloudFile } from '../../../types';

export interface CloudTransferRequest {
  operation: 'copy' | 'move';
  files: CloudFile[];
}

interface UseTransferTasksOptions {
  mountId: string;
  parentFid: string;
  setSelectionMode: Dispatch<SetStateAction<boolean>>;
  setSelectedFids: Dispatch<SetStateAction<Set<string>>>;
  loadFiles: () => Promise<void>;
  onError: (message: string) => void;
}

export interface TransferTasksState {
  downloadTargets: CloudFile[];
  setDownloadTargets: Dispatch<SetStateAction<CloudFile[]>>;
  jobs: BackgroundJob[];
  showTransferTasks: boolean;
  setShowTransferTasks: Dispatch<SetStateAction<boolean>>;
  cloudTransfer: CloudTransferRequest | null;
  setCloudTransfer: Dispatch<SetStateAction<CloudTransferRequest | null>>;
  isDraggingUpload: boolean;
  uploadInputRef: RefObject<HTMLInputElement>;
  handleUploadChange: (event: ChangeEvent<HTMLInputElement>) => void;
  handleUploadDragOver: (event: DragEvent) => void;
  handleUploadDragLeave: (event: DragEvent) => void;
  handleUploadDrop: (event: DragEvent) => void;
  download: (targets: CloudFile[], destination: string) => Promise<void>;
  uploadFiles: (files: File[]) => Promise<void>;
  transferFiles: (targetFid: string) => Promise<void>;
  refreshJobs: () => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
  clearTransferJobs: () => Promise<number>;
}

const isTransferJob = (job: BackgroundJob) => job.kind === 'cloud.download' || job.kind === 'cloud.upload';

const getErrorMessage = (error: unknown, fallback: string): string => (
  error instanceof Error && error.message ? error.message : fallback
);

export const useTransferTasks = ({
  mountId,
  parentFid,
  setSelectionMode,
  setSelectedFids,
  loadFiles,
  onError,
}: UseTransferTasksOptions): TransferTasksState => {
  const [downloadTargets, setDownloadTargets] = useState<CloudFile[]>([]);
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [showTransferTasks, setShowTransferTasks] = useState(false);
  const [cloudTransfer, setCloudTransfer] = useState<CloudTransferRequest | null>(null);
  const [isDraggingUpload, setIsDraggingUpload] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const lastCompletedUploadRef = useRef('');

  useEffect(() => {
    setDownloadTargets([]);
    setCloudTransfer(null);
  }, [mountId]);

  const refreshJobs = async () => {
    const result = await api.getJobs();
    setJobs((result.jobs || []).filter(isTransferJob).slice(0, 50));
  };

  useEffect(() => {
    let active = true;
    const refresh = () => api.getJobs().then((result) => {
      if (active) setJobs((result.jobs || []).filter(isTransferJob).slice(0, 50));
    }).catch(() => {});
    void refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const latest = jobs
      .filter((job) => job.kind === 'cloud.upload' && job.status === 'succeeded')
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
    if (!latest || latest.id === lastCompletedUploadRef.current) return;
    lastCompletedUploadRef.current = latest.id;
    void loadFiles();
  }, [jobs, parentFid, mountId]);

  const download = async (targets: CloudFile[], destination: string) => {
    try {
      await Promise.all(targets.map((file) => api.downloadCloudFile(mountId, file, destination)));
      setDownloadTargets([]);
      setSelectionMode(false);
      setSelectedFids(new Set());
      await refreshJobs();
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, '创建下载任务失败'));
    }
  };

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return;
    try {
      for (const file of files) await api.uploadCloudFile(mountId, parentFid, file);
      await refreshJobs();
      await loadFiles();
    } catch (error: unknown) {
      onError(getErrorMessage(error, '创建云盘上传任务失败'));
    }
  };

  const handleUploadChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    void uploadFiles(files);
  };

  const handleUploadDragOver = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingUpload(true);
  };

  const handleUploadDragLeave = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsDraggingUpload(false);
  };

  const handleUploadDrop = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingUpload(false);
    void uploadFiles(Array.from(event.dataTransfer.files || []));
  };

  const transferFiles = async (targetFid: string) => {
    if (!cloudTransfer) return;
    const fids = cloudTransfer.files.map((file) => file.fid);
    if (cloudTransfer.operation === 'copy') await api.copyCloudFiles(mountId, fids, targetFid);
    else await api.moveCloudFiles(mountId, fids, targetFid);
    setCloudTransfer(null);
    setSelectionMode(false);
    setSelectedFids(new Set());
    await loadFiles();
  };

  const cancelJob = async (id: string) => {
    await api.cancelJob(id);
    await refreshJobs();
  };

  const clearTransferJobs = async () => {
    const result = await api.clearTransferJobs();
    await refreshJobs();
    return result.count;
  };

  return {
    downloadTargets,
    setDownloadTargets,
    jobs,
    showTransferTasks,
    setShowTransferTasks,
    cloudTransfer,
    setCloudTransfer,
    isDraggingUpload,
    uploadInputRef,
    handleUploadChange,
    handleUploadDragOver,
    handleUploadDragLeave,
    handleUploadDrop,
    download,
    uploadFiles,
    transferFiles,
    refreshJobs,
    cancelJob,
    clearTransferJobs,
  };
};
