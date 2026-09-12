import { useCallback, useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { FileItem } from '../../../types';
import { api } from '../../../api';

export interface UseFavoritesOptions {
  enabled: boolean;
}

const readStoredFavorites = (): string[] => {
  try {
    const saved = localStorage.getItem('macnas_file_favorites');
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

export const useFavorites = ({ enabled }: UseFavoritesOptions) => {
  const [favorites, setFavorites] = useState<string[]>(readStoredFavorites);
  const [favoriteItems, setFavoriteItems] = useState<FileItem[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(false);

  const loadFavoriteItems = useCallback(async () => {
    setFavoritesLoading(true);
    try {
      const parentPaths = Array.from(new Set(favorites.map((path) => {
        const parts = path.split('/').filter(Boolean);
        parts.pop();
        return `/${parts.join('/')}` || '/';
      })));
      const listings = await Promise.all(parentPaths.map(async (path) => {
        try { return { ok: true, items: (await api.listFiles(path)).items || [] }; }
        catch { return { ok: false, items: [] as FileItem[] }; }
      }));
      const itemMap = new Map(listings.flatMap((listing) => listing.items).map((item) => [item.path, item]));
      if (listings.every((listing) => listing.ok)) {
        const validPaths = favorites.filter((path) => itemMap.get(path)?.isDir === true);
        if (validPaths.length !== favorites.length) {
          setFavorites(validPaths);
          try { localStorage.setItem('macnas_file_favorites', JSON.stringify(validPaths)); } catch {}
        }
        setFavoriteItems(validPaths.map((path) => itemMap.get(path)).filter((item): item is FileItem => Boolean(item)));
        return;
      }
      setFavoriteItems(favorites.map((path) => itemMap.get(path)).filter((item): item is FileItem => Boolean(item && item.isDir)));
    } finally {
      setFavoritesLoading(false);
    }
  }, [favorites]);

  useEffect(() => {
    if (enabled) void loadFavoriteItems();
  }, [enabled, loadFavoriteItems]);

  const toggleFavorite = (path: string, event?: MouseEvent) => {
    event?.stopPropagation();
    setFavorites((previous) => {
      const next = previous.includes(path) ? previous.filter((item) => item !== path) : [...previous, path];
      try { localStorage.setItem('macnas_file_favorites', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  return { favorites, setFavorites, favoriteItems, favoritesLoading, loadFavoriteItems, toggleFavorite };
};
