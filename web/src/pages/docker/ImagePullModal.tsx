import React, { useState } from 'react';
import { X, Download, Terminal, AlertCircle, RefreshCw, Sparkles } from 'lucide-react';
import { POPULAR_IMAGES } from './types';
import { api } from '../../api';

interface ImagePullModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const ImagePullModal: React.FC<ImagePullModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [imageName, setImageName] = useState('');
  const [pulling, setPulling] = useState(false);
  const [logs, setLogs] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handlePull = async (targetImage?: string) => {
    const img = (targetImage || imageName).trim();
    if (!img) {
      setErrorMsg('请输入有效的镜像名称及标签 (如 nginx:alpine)');
      return;
    }

    setErrorMsg(null);
    setPulling(true);
    setLogs(`📦 开始拉取 Docker 镜像: ${img} ...\n⌛ 正在连接镜像仓库并下载数据层...\n`);

    try {
      const res = await api.pullImage(img);
      setLogs(prev => prev + (res.logs || '镜像拉取完成！\n'));
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err: any) {
      setErrorMsg(`拉取镜像失败: ${err.message}`);
      setLogs(prev => prev + `\n❌ 拉取错误: ${err.message}\n`);
    } finally {
      setPulling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-950/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">拉取 Docker 镜像</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">从 Docker Hub 或镜像仓库下载镜像</p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={pulling}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-900 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-400 dark:hover:text-white transition disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[70dvh]">
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              镜像名称与标签 (如: nginx:alpine)
            </label>
            <div className="flex space-x-2">
              <input
                type="text"
                value={imageName}
                onChange={e => setImageName(e.target.value)}
                disabled={pulling}
                placeholder="例如: nginx:alpine, redis:7-alpine, vaultwarden/server:latest"
                className="flex-1 px-3.5 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-sky-500 transition disabled:opacity-60"
              />
              <button
                onClick={() => handlePull()}
                disabled={pulling || !imageName.trim()}
                className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-xs text-white font-bold transition disabled:opacity-50 shadow-xs"
              >
                {pulling ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                <span>{pulling ? '拉取中' : '开始拉取'}</span>
              </button>
            </div>
          </div>

          {/* Popular Images Tags */}
          <div className="space-y-2">
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <Sparkles className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
              <span>常用热门基础镜像:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {POPULAR_IMAGES.map(item => (
                <button
                  key={item.name}
                  type="button"
                  disabled={pulling}
                  onClick={() => {
                    setImageName(item.name);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 border border-slate-200/80 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 dark:hover:text-white dark:border-slate-700 text-xs font-mono transition flex items-center space-x-1"
                >
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Live Progress Logs Drawer */}
          {logs && (
            <div className="rounded-2xl border border-slate-800 bg-black/90 p-4 space-y-2">
              <div className="flex items-center space-x-2 text-xs font-bold text-slate-300">
                <Terminal className="w-3.5 h-3.5 text-sky-400" />
                <span>终端拉取输出</span>
              </div>
              <pre className="font-mono text-xs text-emerald-400/90 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                {logs}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-950/70 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            disabled={pulling}
            className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 font-semibold transition disabled:opacity-50"
          >
            {pulling ? '后台拉取中' : '关闭'}
          </button>
        </div>
      </div>
    </div>
  );
};
