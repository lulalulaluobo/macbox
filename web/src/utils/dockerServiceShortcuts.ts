import { DockerServiceShortcut } from '../types';

export const DOCKER_SERVICE_SHORTCUTS_KEY = 'macnas_docker_service_shortcuts';

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
    ));
  } catch {
    return [];
  }
};

export const saveDockerServiceShortcuts = (shortcuts: DockerServiceShortcut[]) => {
  try {
    window.localStorage.setItem(DOCKER_SERVICE_SHORTCUTS_KEY, JSON.stringify(shortcuts));
  } catch {
    // 本地快捷入口无法保存时，不影响容器管理和服务访问。
  }
};

export const upsertDockerServiceShortcut = (shortcut: DockerServiceShortcut) => {
  const next = [shortcut, ...loadDockerServiceShortcuts().filter((item) => item.id !== shortcut.id)];
  saveDockerServiceShortcuts(next);
  return next;
};
