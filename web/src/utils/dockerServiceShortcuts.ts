import { DockerServiceShortcut } from '../types';

export const DOCKER_SERVICE_SHORTCUTS_KEY = 'macbox_docker_service_shortcuts';

export const loadDockerServiceShortcuts = (): DockerServiceShortcut[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DOCKER_SERVICE_SHORTCUTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is DockerServiceShortcut => (
      Boolean(item)
      && typeof item === 'object'
      && typeof (item as DockerServiceShortcut).id === 'string'
      && typeof (item as DockerServiceShortcut).containerName === 'string'
      && typeof (item as DockerServiceShortcut).name === 'string'
      && typeof (item as DockerServiceShortcut).url === 'string'
      && /^https?:\/\//i.test((item as DockerServiceShortcut).url)
      && typeof (item as DockerServiceShortcut).icon === 'string'
    )).map((item) => ({
      ...(item as DockerServiceShortcut),
      source: 'docker' as const,
      containerId: (item as DockerServiceShortcut).containerId || (item as DockerServiceShortcut).id.replace(/^container:/, ''),
      enabled: true,
    }));
  } catch {
    return [];
  }
};

export const clearLegacyDockerServiceShortcuts = () => {
  try {
    window.localStorage.removeItem(DOCKER_SERVICE_SHORTCUTS_KEY);
  } catch {
    // Legacy browser-local data is best-effort only.
  }
};
