import React, { useEffect, useState } from 'react';
import {
  Film, VolumeX, Volume2, Download, X, Image,
  ZoomOut, ZoomIn, RotateCw, Music, FileText, Save
} from 'lucide-react';
import { FileItem } from '../../../types';
import { api } from '../../../api';
import { TextPreviewState } from './types';

interface FilePreviewModalProps {
  // Video
  videoPreview: FileItem | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  videoMuted: boolean;
  videoVolume: number;
  onCloseVideo: () => void;
  onToggleMute: () => void;
  onVolumeChange: (e: React.SyntheticEvent<HTMLVideoElement>) => void;

  // Image
  imagePreview: FileItem | null;
  imageZoom: number;
  imageRotate: number;
  onCloseImage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRotate: () => void;

  // Audio
  audioPreview: FileItem | null;
  onCloseAudio: () => void;

  // Text
  textPreview: TextPreviewState | null;
  savingText: boolean;
  onCloseText: () => void;
  onTextContentChange: (content: string) => void;
  onSaveText: () => void;
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  videoPreview,
  videoRef,
  videoMuted,
  videoVolume,
  onCloseVideo,
  onToggleMute,
  onVolumeChange,
  imagePreview,
  imageZoom,
  imageRotate,
  onCloseImage,
  onZoomIn,
  onZoomOut,
  onRotate,
  audioPreview,
  onCloseAudio,
  textPreview,
  savingText,
  onCloseText,
  onTextContentChange,
  onSaveText,
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
  }, [imagePreview?.path]);

  return (
    <>
      {/* 1. Video Player Modal */}
      {videoPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
          <div className="w-full max-w-4xl rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl flex flex-col space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center space-x-2 truncate">
                <Film className="w-4 h-4 text-violet-400 shrink-0" />
                <span className="font-bold text-white text-sm truncate">{videoPreview.name}</span>
                <span className="text-xs text-slate-500 font-mono shrink-0">({videoPreview.sizeFormatted})</span>
              </div>
              <div className="flex items-center space-x-2 shrink-0">
                <button
                  onClick={onToggleMute}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1 border transition ${
                    videoMuted
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30'
                      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25'
                  }`}
                  title="切换静音/开启声音"
                >
                  {videoMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                  <span>{videoMuted ? '点击开启声音' : `音量 ${Math.round(videoVolume * 100)}%`}</span>
                </button>
                <a
                  href={api.getFileDownloadUrl(videoPreview.path)}
                  download
                  className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center space-x-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>下载</span>
                </a>
                <button
                  onClick={onCloseVideo}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="relative rounded-xl overflow-hidden bg-black flex items-center justify-center max-h-[70dvh]">
              <video
                ref={videoRef}
                src={api.getFileRawUrl(videoPreview.path)}
                controls
                autoPlay
                playsInline
                onVolumeChange={onVolumeChange}
                className="w-full h-auto max-h-[70dvh] rounded-xl"
              >
                您的浏览器不支持流式播放此视频。
              </video>
            </div>
          </div>
        </div>
      )}

      {/* 2. Image Lightbox Modal */}
      {imagePreview && (
        <div className="terminal-dark-preserve fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-0 sm:p-4">
          <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#0b0f19] shadow-2xl sm:h-[min(760px,92dvh)] sm:max-w-5xl sm:rounded-2xl sm:border sm:border-slate-800">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 px-3 py-3 sm:px-4">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
                  <Image className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <span className="block truncate text-sm font-bold text-white">{imagePreview.name}</span>
                  <p className="font-mono text-[10px] text-slate-500">{imagePreview.sizeFormatted}</p>
                </div>
              </div>
              <button
                onClick={onCloseImage}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
                aria-label="关闭图片预览"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="flex shrink-0 items-center justify-center gap-2 border-b border-slate-800 px-3 py-2">
                <button
                  onClick={onZoomOut}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700"
                  title="缩小"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  onClick={onZoomIn}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700"
                  title="放大"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  onClick={onRotate}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700"
                  title="旋转"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
                <a
                  href={api.getFileDownloadUrl(imagePreview.path)}
                  download
                  className="flex h-10 items-center gap-1.5 rounded-xl bg-slate-800 px-3 text-xs text-slate-200 hover:bg-slate-700"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>下载</span>
                </a>
            </div>

            <div className="relative flex min-h-0 flex-1 touch-pan-x touch-pan-y items-center justify-center overflow-auto bg-black/55 p-3 sm:p-5">
              {!imageLoaded && !imageError && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-500 border-t-emerald-400" />
                </div>
              )}
              {imageError && (
                <div className="flex flex-col items-center gap-2 text-center text-slate-400">
                  <Image className="h-10 w-10" />
                  <p className="text-sm font-semibold">图片加载失败</p>
                  <p className="text-xs text-slate-500">可尝试下载后查看</p>
                </div>
              )}
              <img
                src={api.getFileRawUrl(imagePreview.path)}
                alt={imagePreview.name}
                onLoad={() => setImageLoaded(true)}
                onError={() => setImageError(true)}
                style={{
                  transform: `scale(${imageZoom}) rotate(${imageRotate}deg)`,
                  transition: 'transform 0.2s ease',
                }}
                className={`${imageError ? 'hidden' : ''} max-h-full max-w-full select-none object-contain`}
              />
            </div>
          </div>
        </div>
      )}

      {/* 3. Audio Player Modal */}
      {audioPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Music className="w-5 h-5 text-pink-400" />
                <span className="font-bold text-white text-sm truncate">{audioPreview.name}</span>
              </div>
              <button
                onClick={onCloseAudio}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col items-center space-y-3">
              <div className="w-16 h-16 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center animate-pulse">
                <Music className="w-8 h-8" />
              </div>
              <span className="text-xs text-slate-400 font-mono">{audioPreview.sizeFormatted}</span>
              <audio
                src={api.getFileRawUrl(audioPreview.path)}
                controls
                autoPlay
                className="w-full mt-2"
              >
                您的浏览器不支持在线音频播放。
              </audio>
            </div>
          </div>
        </div>
      )}

      {/* 4. Text / Code Editor Modal */}
      {textPreview && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-0 sm:p-4">
          <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-900 sm:h-[min(760px,92dvh)] sm:max-w-3xl sm:rounded-2xl sm:border sm:border-slate-200 sm:dark:border-slate-800">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-3 py-3 dark:border-slate-800 sm:px-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-500 dark:bg-sky-500/15 dark:text-sky-400">
                  <FileText className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{textPreview.item.name}</p>
                  <p className="truncate font-mono text-[10px] text-slate-400">{textPreview.item.path}</p>
                </div>
              </div>
              <button
                onClick={onCloseText}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
                aria-label="关闭文档"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            <textarea
              value={textPreview.content}
              onChange={(e) => onTextContentChange(e.target.value)}
              className="m-3 min-h-0 flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-sm leading-7 text-slate-800 focus:border-sky-500 focus:outline-none dark:border-slate-800 dark:bg-[#090d16] dark:text-slate-200 sm:m-4"
              spellCheck={false}
            />

            <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-3 py-3 dark:border-slate-800 sm:px-4">
              <span className="mr-auto hidden text-xs text-slate-500 sm:block">保存后直接写入 NAS</span>
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                <button
                  onClick={onCloseText}
                  className="min-h-11 rounded-xl bg-slate-100 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white"
                >
                  取消
                </button>
                <button
                  onClick={onSaveText}
                  disabled={savingText}
                  className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-4 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savingText ? '保存中...' : '保存更改'}</span>
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </>
  );
};
