import { useEffect, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import type { FileItem } from '../../../types';
import { api } from '../../../api';
import { TextPreviewState, getFileType } from './types';

interface UseFilePreviewsOptions {
  selectionMode: boolean;
  onToggleSelection: (path: string) => void;
  onOpenDirectory: (path: string) => void;
  onSuccess: (text: string) => void;
  onError: (text: string) => void;
  onReload: () => void;
}

export const useFilePreviews = ({
  selectionMode,
  onToggleSelection,
  onOpenDirectory,
  onSuccess,
  onError,
  onReload,
}: UseFilePreviewsOptions) => {
  const [videoPreview, setVideoPreview] = useState<FileItem | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoMuted, setVideoMuted] = useState(false);
  const [videoVolume, setVideoVolume] = useState(1.0);
  const [imagePreview, setImagePreview] = useState<FileItem | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imageRotate, setImageRotate] = useState(0);
  const [audioPreview, setAudioPreview] = useState<FileItem | null>(null);
  const [textPreview, setTextPreview] = useState<TextPreviewState | null>(null);
  const [savingText, setSavingText] = useState(false);

  useEffect(() => {
    if (videoPreview && videoRef.current) {
      videoRef.current.volume = 1.0;
      videoRef.current.muted = false;
      setVideoVolume(1.0);
      setVideoMuted(false);
      videoRef.current.play().catch(() => {});
    }
  }, [videoPreview]);

  const handleItemClick = async (item: FileItem) => {
    if (selectionMode) {
      onToggleSelection(item.path);
      return;
    }

    if (item.isDir) {
      onOpenDirectory(item.path);
      return;
    }

    const type = getFileType(item.ext);
    if (type === 'video') {
      setVideoPreview(item);
    } else if (type === 'image') {
      setImageZoom(1);
      setImageRotate(0);
      setImagePreview(item);
    } else if (type === 'audio') {
      setAudioPreview(item);
    } else if (type === 'text') {
      try {
        const result = await api.readFile(item.path);
        setTextPreview({ item, content: result.content || '' });
      } catch (err: any) {
        onError(`读取文本失败: ${err.message}`);
      }
    } else {
      const link = document.createElement('a');
      link.href = api.getFileDownloadUrl(item.path);
      link.download = item.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  };

  const handleSaveText = async () => {
    if (!textPreview) return;
    setSavingText(true);
    try {
      await api.writeFile(textPreview.item.path, textPreview.content);
      onSuccess('文件保存成功');
      setTextPreview(null);
      onReload();
    } catch (err: any) {
      onError(`保存失败: ${err.message}`);
    } finally {
      setSavingText(false);
    }
  };

  const previewProps = {
    videoPreview,
    videoRef,
    videoMuted,
    videoVolume,
    onCloseVideo: () => setVideoPreview(null),
    onToggleMute: () => {
      if (videoRef.current) {
        const next = !videoMuted;
        videoRef.current.muted = next;
        setVideoMuted(next);
        if (!next) videoRef.current.volume = 1.0;
      }
    },
    onVolumeChange: (event: SyntheticEvent<HTMLVideoElement>) => {
      const element = event.target as HTMLVideoElement;
      setVideoVolume(element.volume);
      setVideoMuted(element.muted);
    },
    imagePreview,
    imageZoom,
    imageRotate,
    onCloseImage: () => setImagePreview(null),
    onZoomIn: () => setImageZoom((previous) => Math.min(3, previous + 0.25)),
    onZoomOut: () => setImageZoom((previous) => Math.max(0.5, previous - 0.25)),
    onRotate: () => setImageRotate((previous) => (previous + 90) % 360),
    audioPreview,
    onCloseAudio: () => setAudioPreview(null),
    textPreview,
    savingText,
    onCloseText: () => setTextPreview(null),
    onTextContentChange: (content: string) => {
      if (textPreview) setTextPreview({ ...textPreview, content });
    },
    onSaveText: handleSaveText,
  };

  return {
    previewProps,
    handleItemClick,
    handleSaveText,
  };
};
