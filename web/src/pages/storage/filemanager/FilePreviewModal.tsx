import React from 'react';
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

            <div className="relative rounded-xl overflow-hidden bg-black flex items-center justify-center max-h-[70vh]">
              <video
                ref={videoRef}
                src={api.getFileRawUrl(videoPreview.path)}
                controls
                autoPlay
                playsInline
                onVolumeChange={onVolumeChange}
                className="w-full h-auto max-h-[70vh] rounded-xl"
              >
                您的浏览器不支持流式播放此视频。
              </video>
            </div>
          </div>
        </div>
      )}

      {/* 2. Image Lightbox Modal */}
      {imagePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
          <div className="w-full max-w-5xl rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl flex flex-col space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <Image className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-white text-sm">{imagePreview.name}</span>
                <span className="text-xs text-slate-500 font-mono">({imagePreview.sizeFormatted})</span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={onZoomOut}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                  title="缩小"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  onClick={onZoomIn}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                  title="放大"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  onClick={onRotate}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                  title="旋转"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
                <a
                  href={api.getFileDownloadUrl(imagePreview.path)}
                  download
                  className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center space-x-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>下载</span>
                </a>
                <button
                  onClick={onCloseImage}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="relative rounded-xl overflow-hidden bg-black/60 flex items-center justify-center min-h-[400px] max-h-[70vh]">
              <img
                src={api.getFileRawUrl(imagePreview.path)}
                alt={imagePreview.name}
                style={{
                  transform: `scale(${imageZoom}) rotate(${imageRotate}deg)`,
                  transition: 'transform 0.2s ease',
                }}
                className="max-w-full max-h-[68vh] object-contain select-none"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
          <div className="w-full max-w-3xl rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4 flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-sky-400" />
                <span className="font-bold text-white text-sm">{textPreview.item.name}</span>
                <span className="text-xs text-slate-500 font-mono">({textPreview.item.path})</span>
              </div>
              <button
                onClick={onCloseText}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <textarea
              value={textPreview.content}
              onChange={(e) => onTextContentChange(e.target.value)}
              className="flex-1 w-full min-h-[380px] p-4 rounded-xl bg-[#090d16] border border-slate-800 font-mono text-xs text-slate-200 focus:outline-none focus:border-sky-500 resize-none leading-relaxed"
              spellCheck={false}
            />

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-slate-500">在线修改保存后直接写入 NAS 存储空间</span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={onCloseText}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white text-xs font-medium"
                >
                  取消
                </button>
                <button
                  onClick={onSaveText}
                  disabled={savingText}
                  className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center space-x-1.5 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savingText ? '保存中...' : '保存更改'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
