import { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { FileToolbar } from '../src/pages/storage/filemanager/FileToolbar';
import { useFileUpload } from '../src/pages/storage/filemanager/useFileUpload';
import '../src/index.css';

function UploadTest() {
  const [currentPath, setCurrentPath] = useState('/data');
  const [message, setMessage] = useState('');
  const [reloadCount, setReloadCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'mtime'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const upload = useFileUpload({
    targetPath: currentPath,
    onSuccess: setMessage,
    onError: setMessage,
    onReload: () => setReloadCount((count) => count + 1),
  });
  const navigate = () => {
    if (upload.isUploadInProgress()) setMessage('上传中，目录保持不变');
    else setCurrentPath('/data/other');
  };
  return <main className="mx-auto min-h-screen w-full max-w-5xl space-y-3 bg-slate-50 p-3 dark:bg-slate-950" onDrop={upload.handleDrop} onDragOver={upload.handleDragOver} onDragLeave={upload.handleDragLeave}>
    <FileToolbar currentPath={currentPath} searchQuery={searchQuery} sortBy={sortBy} sortOrder={sortOrder} viewMode={viewMode}
      selectionMode={false} selectedCount={0} totalCount={0} loading={false}
      uploading={upload.uploading} uploadProgress={upload.uploadProgress}
      fileInputRef={upload.fileInputRef} folderInputRef={upload.folderInputRef} folderUploadSupported={upload.folderUploadSupported}
      onGoUp={navigate} onSearchChange={setSearchQuery} onSortChange={(by, order) => { setSortBy(by); setSortOrder(order); }}
      onViewModeChange={setViewMode} onToggleSelectionMode={() => {}} onSelectAll={() => {}} onOpenMkdir={() => {}}
      onFileChange={upload.handleFileChange} onFolderChange={upload.handleFolderChange} onFolderPicker={upload.handleFolderPicker} onRefresh={() => {}} />
    <p data-testid="upload-message" role="alert" className="break-words text-sm text-slate-700 [overflow-wrap:anywhere]">{message}</p>
    <p data-testid="upload-current-path" className="text-xs">当前目录：{currentPath}</p>
    <p data-testid="upload-reload-count" className="text-xs">刷新次数：{reloadCount}</p>
    <button type="button" onClick={navigate} className="min-h-11 rounded-xl bg-white px-3 text-sm">尝试切换目录</button>
  </main>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<UploadTest />);
