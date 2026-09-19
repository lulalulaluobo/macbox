import type { ContainerInfo, ImageInfo, ComposeProject, DockerOverview, DockerEngineInfo, AppleComposeBridge, DockerNetwork } from '../types';
import { BASE_URL, fetchJSON } from './client';

export const dockerApi = {  // Docker Overview & Containers
  getDockerOverview: () => fetchJSON<DockerOverview>(`${BASE_URL}/docker/overview`),
  getDockerEngine: () => fetchJSON<DockerEngineInfo>(`${BASE_URL}/docker/engine`),
  getContainers: () => fetchJSON<ContainerInfo[]>(`${BASE_URL}/docker/containers`),
  containerAction: (id: string, action: 'start' | 'stop' | 'restart' | 'remove', force = false) =>
    fetchJSON<{ status: string }>(`${BASE_URL}/docker/containers/${id}/action`, {
      method: 'POST',
      body: JSON.stringify({ action, force }),
    }),
  removeContainer: (id: string, force = false) =>
    fetchJSON<{ status: string }>(`${BASE_URL}/docker/containers/${id}?force=${force}`, { method: 'DELETE' }),
  getContainerLogs: (id: string, tail = 100) => fetchJSON<{ logs: string }>(`${BASE_URL}/docker/containers/${id}/logs?tail=${tail}`),

  // Docker Images
  getImages: () => fetchJSON<ImageInfo[]>(`${BASE_URL}/docker/images`),
  pullImage: (image: string) => fetchJSON<{ status: string; logs: string }>(`${BASE_URL}/docker/images/pull`, {
    method: 'POST',
    body: JSON.stringify({ image }),
  }),
  removeImage: (id: string, force = false) =>
    fetchJSON<{ status: string }>(`${BASE_URL}/docker/images/${id}?force=${force}`, { method: 'DELETE' }),
  pruneImages: () => fetchJSON<{ status: string; output: string }>(`${BASE_URL}/docker/images/prune`, { method: 'POST' }),

  // Docker Compose
  getComposeProjects: () => fetchJSON<ComposeProject[]>(`${BASE_URL}/docker/compose`),
  getComposeYaml: (name: string) => fetchJSON<{ name: string; yaml: string }>(`${BASE_URL}/docker/compose/${name}`),
  deployCompose: (name: string, yaml: string) =>
    fetchJSON<{ status: string; logs: string }>(`${BASE_URL}/docker/compose/deploy`, {
      method: 'POST',
      body: JSON.stringify({ name, yaml }),
    }),
  deployComposeStream: async (
    name: string,
    yaml: string,
    onLog: (line: string) => void,
    signal?: AbortSignal,
  ) => {
    const response = await fetch(`${BASE_URL}/docker/compose/deploy/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, yaml }),
      signal,
    });
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('macbox-unauthorized'));
    }
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(payload.error || '无法建立部署日志连接');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completed = false;
    let streamError = '';

    const processFrame = (frame: string) => {
      let event = 'message';
      const data: string[] = [];
      for (const rawLine of frame.split('\n')) {
        const line = rawLine.replace(/\r$/, '');
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      const value = data.join('\n');
      if (event === 'done') {
        completed = true;
      } else if (event === 'error') {
        try {
          streamError = JSON.parse(value).error || 'Compose 部署失败';
        } catch {
          streamError = value || 'Compose 部署失败';
        }
      } else if (value) {
        onLog(value);
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        processFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) processFrame(buffer);
    if (streamError) throw new Error(streamError);
    if (!completed) throw new Error('部署连接已结束，但服务端没有返回完成确认');
  },
  composeAction: (name: string, action: 'start' | 'stop' | 'restart' | 'down' | 'pull') =>
    fetchJSON<{ status: string; output: string }>(`${BASE_URL}/docker/compose/${name}/action`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  deleteComposeProject: (name: string, deleteVolumes = false) =>
    fetchJSON<{ status: string }>(
      `${BASE_URL}/docker/compose/${name}?volumes=${deleteVolumes}${deleteVolumes ? '&confirm=DELETE_DATA' : ''}`,
      { method: 'DELETE' },
    ),

  // Docker Networks & Mirrors
  getDockerNetworks: () => fetchJSON<DockerNetwork[]>(`${BASE_URL}/docker/networks`),
  getAppleComposeBridge: () => fetchJSON<AppleComposeBridge>(`${BASE_URL}/docker/apple-compose`),
  setAppleComposeBridge: (enabled: boolean) =>
    fetchJSON<AppleComposeBridge>(`${BASE_URL}/docker/apple-compose`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  getRegistryMirrors: () => fetchJSON<{ mirrors: string[] }>(`${BASE_URL}/docker/mirrors`),
  setRegistryMirrors: (mirrors: string[]) =>
    fetchJSON<{ status: string }>(`${BASE_URL}/docker/mirrors`, {
      method: 'POST',
      body: JSON.stringify({ mirrors }),
    }),


};
