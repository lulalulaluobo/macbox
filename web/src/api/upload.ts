const mobileRetryLimit = 128 * 1024 * 1024;

const connectionError = () => new Error('上传连接失败，请检查网络，并用 Edge 从本地“文件”重新选择后上传。');

function sendFile(url: string, content: Blob, name: string): Promise<Response> {
  const formData = new FormData();
  // A directory picker can attach a relative path to File. Keep the multipart
  // filename a basename; the validated relativePath query carries the folders.
  formData.append('file', content, name);
  return fetch(url, { method: 'POST', body: formData });
}

export async function uploadFileRequest<T>(url: string, file: File): Promise<T> {
  let response: Response;
  try {
    response = await sendFile(url, file, file.name);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    // Some Android file providers fail to upload a file-backed Blob. Only after
    // a transport failure, try a content-backed Blob for a bounded single file.
    // Do not read size/lastModified before the native attempt: these metadata
    // reads can themselves expose Android file-provider compatibility bugs.
    if (typeof navigator === 'undefined' || !/Android/i.test(navigator.userAgent) || file.size > mobileRetryLimit) {
      throw connectionError();
    }
    let content: Blob;
    try {
      content = new Blob([await file.arrayBuffer()], { type: file.type || 'application/octet-stream' });
    } catch {
      throw new Error('浏览器无法读取所选文件，请先保存到手机本地，再通过“文件”重新选择。');
    }
    try {
      response = await sendFile(url, content, file.name);
    } catch {
      throw connectionError();
    }
  }
  if (response.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('macbox-unauthorized'));
  }
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: unknown } | null;
    const message = result && typeof result.error === 'string' ? result.error : '';
    throw new Error(message || `上传失败（HTTP ${response.status}），请稍后重试。`);
  }
  try {
    return await response.json() as T;
  } catch {
    throw new Error('上传结果未能读取，请刷新目录确认文件是否已上传。');
  }
}
