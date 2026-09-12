import { useMemo } from 'react';
import type { DiskInfo, LocalMount } from '../../../types';
import type { DriveDetailInfo } from './DriveDetailModal';

export interface StorageDriveOption {
  id: string;
  defaultName: string;
  path: string;
  detail: DriveDetailInfo;
}

interface UseStorageDriveOptionsOptions {
  storageDisks: DiskInfo[];
  localMounts: LocalMount[];
  discoveredDrivePaths: string[];
  currentPath: string;
}

const toGuestPath = (target?: string | null, fallback = 'volume2-ssd') => {
  const value = (target || '').trim() || fallback;
  return value.startsWith('/') ? value : `/data/${value}`;
};

export const useStorageDriveOptions = ({
  storageDisks,
  localMounts,
  discoveredDrivePaths,
  currentPath,
}: UseStorageDriveOptionsOptions) => useMemo(() => {
  const primaryDisk = storageDisks.find((disk) => disk.isSelected);
  const secondaryDisks = storageDisks.filter((disk) => disk.isSecondary && !disk.isSelected);
  const secondaryDiskOptions = secondaryDisks.map((disk) => ({ id: disk.identifier, path: toGuestPath(disk.secondaryTarget) }));
  const secondaryMountOptions = localMounts
    .filter((mount) => mount.enabled && mount.category === 'volume2')
    .map((mount) => ({ id: `mount-${mount.id}`, path: toGuestPath(mount.guestTarget) }))
    .filter((mount) => !secondaryDiskOptions.some((disk) => disk.path === mount.path));
  const discoveredOptions = discoveredDrivePaths
    .map((path) => ({ id: `folder-${path}`, path }))
    .filter((drive) => !secondaryDiskOptions.some((disk) => disk.path === drive.path) && !secondaryMountOptions.some((mount) => mount.path === drive.path));
  const secondaryOptions = [...secondaryDiskOptions, ...secondaryMountOptions, ...discoveredOptions]
    .filter((drive, index, all) => all.findIndex((candidate) => candidate.path === drive.path) === index);
  const driveOptions: StorageDriveOption[] = [
    {
      id: primaryDisk?.identifier || 'primary',
      defaultName: '硬盘 1',
      path: '/data',
      detail: {
        kind: '主存储',
        source: primaryDisk?.name,
        total: primaryDisk?.totalSizeString,
        used: primaryDisk?.usedSpaceString,
        free: primaryDisk?.freeSpaceString,
        usedPercent: primaryDisk?.usedPercent,
        fileSystem: primaryDisk?.fileSystem,
      },
    },
    ...secondaryOptions.map((drive, index) => {
      const matchedDisk = secondaryDisks.find((disk) => toGuestPath(disk.secondaryTarget) === drive.path);
      const matchedMount = localMounts.find((mount) => mount.enabled && toGuestPath(mount.guestTarget) === drive.path);
      return {
        id: drive.id,
        defaultName: matchedMount?.name || `硬盘 ${index + 2}`,
        path: drive.path,
        detail: {
          kind: matchedDisk ? '扩展存储' : matchedMount ? '本机目录直通' : '已发现目录',
          source: matchedDisk?.name ?? matchedMount?.hostPath,
          total: matchedDisk?.totalSizeString,
          used: matchedDisk?.usedSpaceString,
          free: matchedDisk?.freeSpaceString,
          usedPercent: matchedDisk?.usedPercent,
          fileSystem: matchedDisk?.fileSystem,
          writable: matchedMount?.writable,
          description: matchedMount?.description,
        },
      };
    }),
  ];
  const activeDriveId = [...driveOptions]
    .sort((a, b) => b.path.length - a.path.length)
    .find((drive) => currentPath === drive.path || currentPath.startsWith(`${drive.path}/`))?.id;

  return {
    driveOptions,
    activeDriveId,
    secondaryOptions,
  };
}, [currentPath, discoveredDrivePaths, localMounts, storageDisks]);
