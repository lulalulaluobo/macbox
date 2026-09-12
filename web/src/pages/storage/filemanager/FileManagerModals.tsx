import React from 'react';
import { ArchiveModal } from './ArchiveModal';
import { CloudMountModal } from './CloudMountModal';
import { DriveDetailModal } from './DriveDetailModal';
import { FileActionSheet } from './FileActionSheet';
import { FileModals } from './FileModals';
import { FilePreviewModal } from './FilePreviewModal';
import { TransferDestinationModal } from './TransferDestinationModal';

interface FileManagerModalsProps {
  driveDetail: React.ComponentProps<typeof DriveDetailModal>;
  actionSheet: React.ComponentProps<typeof FileActionSheet>;
  preview: React.ComponentProps<typeof FilePreviewModal>;
  operations: React.ComponentProps<typeof FileModals>;
  cloudMount?: React.ComponentProps<typeof CloudMountModal>;
  archive: React.ComponentProps<typeof ArchiveModal>;
  transfer?: React.ComponentProps<typeof TransferDestinationModal>;
}

export const FileManagerModals: React.FC<FileManagerModalsProps> = ({
  driveDetail,
  actionSheet,
  preview,
  operations,
  cloudMount,
  archive,
  transfer,
}) => (
  <>
    <DriveDetailModal {...driveDetail} />
    <FileActionSheet {...actionSheet} />
    <FilePreviewModal {...preview} />
    <FileModals {...operations} />
    {cloudMount && <CloudMountModal {...cloudMount} />}
    <ArchiveModal {...archive} />
    {transfer && <TransferDestinationModal {...transfer} />}
  </>
);
