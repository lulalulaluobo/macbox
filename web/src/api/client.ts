export const BASE_URL = '/api';

export function getAuthenticatedFileUrl(endpoint: 'download' | 'raw', path: string) {
  const params = new URLSearchParams({ path });
  return `${BASE_URL}/terminal/files/${endpoint}?${params.toString()}`;
}

export async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (res.status === 401 && !url.endsWith('/api/auth/login')) {
    window.dispatchEvent(new CustomEvent('macbox-unauthorized'));
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}
