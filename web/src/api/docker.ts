import type { ContainerInfo, ImageInfo, ComposeProject, DockerOverview, DockerNetwork } from '../types';
import { BASE_URL, fetchJSON } from './client';

export const dockerApi = {  // Docker Overview & Containers
  getDockerOverview: () => fetchJSON<DockerOverview>(`${BASE_URL}/docker/overview`),
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
  getRegistryMirrors: () => fetchJSON<{ mirrors: string[] }>(`${BASE_URL}/docker/mirrors`),
  setRegistryMirrors: (mirrors: string[]) =>
    fetchJSON<{ status: string }>(`${BASE_URL}/docker/mirrors`, {
      method: 'POST',
      body: JSON.stringify({ mirrors }),
    }),


};
