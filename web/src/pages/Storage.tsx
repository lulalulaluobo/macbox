import React from 'react';
import { FileManager } from './storage/FileManager';

export const Storage: React.FC = () => (
  <div className="mx-auto h-[calc(100dvh-92px)] min-h-[520px] w-full max-w-6xl overflow-hidden sm:h-[calc(100dvh-104px)]">
    <FileManager />
  </div>
);
