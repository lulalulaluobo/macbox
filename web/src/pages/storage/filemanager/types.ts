import { FileItem } from '../../../types';

export type FileType = 'video' | 'image' | 'audio' | 'text' | 'archive' | 'other';

export interface CategoryItem {
  name: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

export interface ClipboardState {
  action: 'copy' | 'cut';
  items: string[];
}

export interface TextPreviewState {
  item: FileItem;
  content: string;
}

export const getFileType = (ext: string): FileType => {
  const videoExts = ['mp4', 'mkv', 'webm', 'mov', 'avi', 'flv', 'wmv'];
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
  const audioExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'];
  const textExts = ['txt', 'md', 'json', 'yaml', 'yml', 'xml', 'conf', 'ini', 'sh', 'log', 'css', 'html', 'js', 'ts'];
  const archiveExts = ['zip'];

  if (videoExts.includes(ext)) return 'video';
  if (imageExts.includes(ext)) return 'image';
  if (audioExts.includes(ext)) return 'audio';
  if (textExts.includes(ext)) return 'text';
  if (archiveExts.includes(ext)) return 'archive';
  return 'other';
};
