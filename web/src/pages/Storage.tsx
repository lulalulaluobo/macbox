import React, { useState } from 'react';
import { Folder, Settings2, AlertCircle } from 'lucide-react';
import { FileManager } from './storage/FileManager';
import { StorageSettings } from './storage/StorageSettings';

interface StorageProps {
  configDirty?: boolean;
  onRefreshOverview?: () => void;
}

export const Storage: React.FC<StorageProps> = ({ configDirty, onRefreshOverview }) => {
  const [activeSubTab, setActiveSubTab] = useState<'files' | 'settings'>('files');

  return (
    <div className="space-y-6">
      {/* Top Header & View Switcher */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-800/80">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400">
              {activeSubTab === 'files' ? <Folder className="w-6 h-6" /> : <Settings2 className="w-6 h-6" />}
            </div>
            <div>
              <h2 className="text-xl font-bold text-white flex items-center space-x-2">
                <span>{activeSubTab === 'files' ? 'NAS 文件中心' : '存储池与共享设置'}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-medium">
                  {activeSubTab === 'files' ? '免第三方容器 · 原生直驱' : '底层拓扑 · 共享网络'}
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {activeSubTab === 'files'
                  ? '对标飞牛 OS 原生文件管理器，集成多媒体即时预览、文本在线编辑、CRUD 操作与系统目录默认防误删保护。'
                  : '配置外接 SSD 数据盘绑定、Samba 局域网共享密码、Mac 本地目录 VirtioFS 高速直通映射。'}
              </p>
            </div>
          </div>
        </div>

        {/* View Segmented Switcher */}
        <div className="flex items-center bg-slate-900/90 p-1 rounded-2xl border border-slate-800 shrink-0 self-start md:self-auto">
          <button
            onClick={() => setActiveSubTab('files')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold transition ${
              activeSubTab === 'files'
                ? 'bg-sky-600 text-white shadow-lg shadow-sky-600/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <Folder className="w-4 h-4" />
            <span>文件管理</span>
          </button>

          <button
            onClick={() => setActiveSubTab('settings')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold transition ${
              activeSubTab === 'settings'
                ? 'bg-sky-600 text-white shadow-lg shadow-sky-600/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <Settings2 className="w-4 h-4" />
            <span>存储与共享设置</span>
            {configDirty && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            )}
          </button>
        </div>
      </div>

      {/* Pending Restart Warning Banner */}
      {configDirty && activeSubTab === 'files' && (
        <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>检测到底层存储或直通配置发生变动，需要平稳重启虚拟机后方可生效。</span>
          </div>
          <button
            onClick={() => setActiveSubTab('settings')}
            className="px-3 py-1 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-semibold flex items-center space-x-1 transition"
          >
            <span>前往存储设置查看</span>
          </button>
        </div>
      )}

      {/* Active Tab View */}
      {activeSubTab === 'files' && <FileManager />}

      {activeSubTab === 'settings' && (
        <StorageSettings
          configDirty={configDirty}
          onRefreshOverview={onRefreshOverview}
        />
      )}
    </div>
  );
};
