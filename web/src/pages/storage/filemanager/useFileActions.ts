import { api } from '../../../api';

interface UseFileActionsOptions {
  selectedPaths: Set<string>;
  onSuccess: (text: string) => void;
  onError: (text: string) => void;
}

export const useFileActions = ({ selectedPaths, onSuccess, onError }: UseFileActionsOptions) => {
  const handleCopyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      onSuccess('路径已复制');
    } catch {
      onError('复制路径失败，请检查浏览器剪贴板权限');
    }
  };

  const handleBatchDownload = () => {
    const paths = Array.from(selectedPaths);
    if (paths.length === 0) return;
    const link = document.createElement('a');
    link.href = api.getBatchDownloadUrl(paths);
    link.download = 'MacBox-批量下载.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return { handleCopyPath, handleBatchDownload };
};
