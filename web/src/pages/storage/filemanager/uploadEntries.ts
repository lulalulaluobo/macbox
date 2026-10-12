export interface UploadFileEntry {
  file: File;
  relativePath: string;
}

export interface UploadSelection {
  files: UploadFileEntry[];
  directories: string[];
}

// Use a small structural interface so the legacy drag API works in browsers
// that expose webkitGetAsEntry without shipping the newer filesystem API.
export interface UploadEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file?: (success: (file: File) => void, failure: (error: DOMException) => void) => void;
  createReader?: () => {
    readEntries: (success: (entries: UploadEntry[]) => void, failure: (error: DOMException) => void) => void;
  };
}

export interface UploadDropSnapshot {
  entries: UploadEntry[];
  files: File[];
  unreadable: boolean;
}

export function normalizeUploadPath(value: string): string {
  const parts = value.split('/');
  if (!value || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)
    || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`文件相对路径无效：${value || '未提供路径'}`);
  }
  return parts.join('/');
}

export function joinUploadTarget(target: string, relativePath: string): string {
  return `${target.replace(/\/+$/, '')}/${normalizeUploadPath(relativePath)}`;
}

export function selectionFromFiles(files: File[], requireDirectory = false): UploadSelection {
  if (requireDirectory && files.some((file) => !file.webkitRelativePath)) {
    throw new Error('当前浏览器未提供文件夹路径，请换用 Edge 或 Chrome 上传文件夹，或先压缩为 ZIP 后上传。');
  }
  const directories = new Set<string>();
  const entries = files.map((file) => {
    const relativePath = normalizeUploadPath(file.webkitRelativePath || file.name);
    const parts = relativePath.split('/');
    for (let i = 1; i < parts.length; i += 1) directories.add(parts.slice(0, i).join('/'));
    return { file, relativePath };
  });
  return { files: entries, directories: Array.from(directories) };
}

export function emptyUploadDirectories(selection: UploadSelection): string[] {
  const occupiedParents = new Set<string>();
  const recordParents = (relativePath: string) => {
    const parts = relativePath.split('/');
    for (let i = 1; i < parts.length; i += 1) occupiedParents.add(parts.slice(0, i).join('/'));
  };
  for (const entry of selection.files) recordParents(entry.relativePath);
  for (const directory of selection.directories) recordParents(directory);
  // File uploads create their parents. Only empty leaf directories need an
  // explicit request; mkdir creates their empty ancestors at the same time.
  return selection.directories.filter((directory) => !occupiedParents.has(directory));
}

// DataTransfer is readable only during the drop event. Snapshot native entries
// and File references now; recurse through directories after the event returns.
export function captureUploadDrop(dataTransfer: DataTransfer): UploadDropSnapshot {
  const entries: UploadEntry[] = [];
  const files: File[] = [];
  let unreadable = false;
  const items = Array.from(dataTransfer.items || []).filter((item) => item.kind === 'file');
  for (const item of items) {
    try {
      const entry = item.webkitGetAsEntry?.() as UploadEntry | null;
      if (entry) entries.push(entry);
      else {
        const file = item.getAsFile();
        if (file) files.push(file);
        else unreadable = true;
      }
    } catch {
      unreadable = true;
    }
  }
  if (items.length === 0) files.push(...Array.from(dataTransfer.files));
  return { entries, files, unreadable };
}

export async function selectionFromDrop(snapshot: UploadDropSnapshot): Promise<UploadSelection> {
  if (snapshot.unreadable) {
    throw new Error('浏览器无法读取拖入的文件夹，请使用“上传文件夹”，或换用 Edge、Chrome 后重试。');
  }
  const selection = selectionFromFiles(snapshot.files);
  const directories = new Set(selection.directories);
  const visit = async (entry: UploadEntry, parent: string) => {
    const relativePath = normalizeUploadPath(parent ? `${parent}/${entry.name}` : entry.name);
    try {
      if (entry.isFile && entry.file) {
        const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
        selection.files.push({ file, relativePath });
        return;
      }
      if (!entry.isDirectory || !entry.createReader) throw new Error('浏览器未提供可读取的文件夹');
      directories.add(relativePath);
      const reader = entry.createReader();
      // Chromium returns directory contents in batches (often 100 entries).
      // A single readEntries call silently loses the remainder of the folder.
      while (true) {
        const batch = await new Promise<UploadEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (batch.length === 0) break;
        for (const child of batch) await visit(child, relativePath);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`无法读取“${relativePath}”：${message}`);
    }
  };
  for (const entry of snapshot.entries) await visit(entry, '');
  return { files: selection.files, directories: Array.from(directories) };
}

export function supportsFolderUpload(): boolean {
  return typeof document !== 'undefined' && 'webkitdirectory' in document.createElement('input');
}
