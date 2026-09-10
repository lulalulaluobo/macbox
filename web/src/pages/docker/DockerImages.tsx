import React, { useState, useEffect } from 'react';
import {
  Disc3,
  Download,
  Trash2,
  RefreshCw,
  Search,
  Sparkles,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { ImageInfo } from '../../types';
import { api } from '../../api';
import { ImagePullModal } from './ImagePullModal';

export const DockerImages: React.FC = () => {
  const [images, setImages] = useState<ImageInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Pull Modal
  const [isPullOpen, setIsPullOpen] = useState(false);

  // Delete Modal
  const [deleteModalImage, setDeleteModalImage] = useState<ImageInfo | null>(null);
  const [forceDelete, setForceDelete] = useState(false);

  const loadImages = async () => {
    try {
      const data = await api.getImages();
      setImages(data || []);
    } catch (err) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadImages();
  }, []);

  const handlePrune = async () => {
    if (!window.confirm('确定要清理所有未被任何容器使用的虚悬镜像 (dangling images) 吗？这有助于释放磁盘空间。')) {
      return;
    }
    setActionLoading('prune');
    try {
      const res = await api.pruneImages();
      await loadImages();
      setAlertMsg({ type: 'success', text: `清理完成: ${res.output || '已释放无用镜像层空间'}` });
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `清理失败: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteModalImage) return;
    const id = deleteModalImage.id;
    setActionLoading(`del-${id}`);
    try {
      await api.removeImage(id, forceDelete);
      setDeleteModalImage(null);
      setAlertMsg({
        type: 'success',
        text: `镜像 ${deleteModalImage.repository}:${deleteModalImage.tag} 已成功删除`,
      });
      await loadImages();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `删除失败: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const filtered = images.filter(img => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      img.repository.toLowerCase().includes(term) ||
      img.tag.toLowerCase().includes(term) ||
      img.id.toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-5">
      {/* Alert Banner */}
      {alertMsg && (
        <div
          className={`p-4 rounded-2xl text-xs flex items-center justify-between shadow-lg ${
            alertMsg.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4" />
            <span>{alertMsg.text}</span>
          </div>
          <button onClick={() => setAlertMsg(null)} className="opacity-70 hover:opacity-100 font-bold">
            ✕
          </button>
        </div>
      )}

      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-white flex items-center space-x-2">
            <Disc3 className="w-5 h-5 text-amber-400" />
            <span>本地镜像管理</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            查看本地已缓存的 Docker 镜像，支持镜像拉取、删除与空间深度清理
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="搜索镜像仓库或标签..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9 pr-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 w-52 transition"
            />
          </div>

          <button
            onClick={loadImages}
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition"
            title="刷新"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={handlePrune}
            disabled={actionLoading !== null}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-400 hover:text-amber-300 border border-amber-500/30 text-xs font-semibold transition disabled:opacity-50"
            title="一键清理所有未引用的无用镜像"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>清理虚悬镜像</span>
          </button>

          <button
            onClick={() => setIsPullOpen(true)}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-bold shadow-lg shadow-amber-500/20 transition"
          >
            <Download className="w-4 h-4" />
            <span>拉取新镜像</span>
          </button>
        </div>
      </div>

      {/* Images List */}
      {filtered.length === 0 ? (
        <div className="p-16 rounded-3xl bg-slate-900/60 border border-dashed border-slate-800 text-center space-y-4">
          <Disc3 className="w-12 h-12 text-slate-600 mx-auto" />
          <div>
            <h3 className="text-base font-bold text-slate-300">暂无本地镜像</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
              当前本地没有缓存的镜像，点击右上角「拉取新镜像」即可下载所需镜像。
            </p>
          </div>
          <button
            onClick={() => setIsPullOpen(true)}
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition"
          >
            <Download className="w-4 h-4" />
            <span>立即拉取镜像</span>
          </button>
        </div>
      ) : (
        <div className="rounded-3xl bg-slate-900/75 border border-slate-800/90 overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3.5 px-6">镜像仓库 (Repository:Tag)</th>
                  <th className="py-3.5 px-4">Image ID</th>
                  <th className="py-3.5 px-4">物理占用</th>
                  <th className="py-3.5 px-4">状态 / 关联容器</th>
                  <th className="py-3.5 px-4">创建时间</th>
                  <th className="py-3.5 px-6 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {filtered.map(img => {
                  return (
                    <tr key={img.id} className="hover:bg-slate-800/30 transition">
                      {/* Repo & Tag */}
                      <td className="py-4 px-6 font-sans">
                        <div className="flex items-center space-x-3">
                          <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 flex-shrink-0">
                            <Disc3 className="w-4 h-4" />
                          </div>
                          <div>
                            <span className="font-bold text-white text-sm font-mono">{img.repository}</span>
                            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-slate-800 text-amber-400 border border-slate-700 font-mono">
                              {img.tag}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* ID */}
                      <td className="py-4 px-4 text-slate-400 font-mono text-xs">
                        {img.id.slice(0, 12)}
                      </td>

                      {/* Size */}
                      <td className="py-4 px-4 text-white font-bold font-mono">
                        {img.size}
                      </td>

                      {/* Status */}
                      <td className="py-4 px-4 font-sans">
                        {img.inUse ? (
                          <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>使用中 ({img.containers} 个容器)</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700/60 text-xs font-medium">
                            未使用
                          </span>
                        )}
                      </td>

                      {/* Created */}
                      <td className="py-4 px-4 text-slate-400 text-xs font-sans">
                        {img.createdSince || img.createdAt}
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-6 text-right font-sans">
                        <button
                          onClick={() => setDeleteModalImage(img)}
                          className="p-2 rounded-xl bg-slate-800/80 hover:bg-rose-950/50 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-500/30 transition"
                          title="删除镜像"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pull Image Modal */}
      <ImagePullModal
        isOpen={isPullOpen}
        onClose={() => setIsPullOpen(false)}
        onSuccess={() => {
          loadImages();
        }}
      />

      {/* Delete Image Modal */}
      {deleteModalImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-3 text-rose-400">
              <AlertCircle className="w-6 h-6" />
              <h3 className="text-base font-bold text-white">确认删除镜像？</h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              确定要删除镜像{' '}
              <span className="font-mono font-bold text-white">
                "{deleteModalImage.repository}:{deleteModalImage.tag}"
              </span>{' '}
              (ID: {deleteModalImage.id.slice(0, 12)}) 吗？
              {deleteModalImage.inUse && (
                <span className="block mt-1 text-amber-400 font-semibold">
                  ⚠️ 警告：当前有容器正在使用此镜像，直接删除可能失败，需勾选强制删除。
                </span>
              )}
            </p>

            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-400 flex items-center space-x-2">
              <input
                type="checkbox"
                id="forceDelImg"
                checked={forceDelete}
                onChange={e => setForceDelete(e.target.checked)}
                className="rounded border-slate-700 text-rose-500 focus:ring-0"
              />
              <label htmlFor="forceDelImg" className="cursor-pointer">
                强制删除镜像 (-f / --force)
              </label>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setDeleteModalImage(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-semibold transition"
              >
                取消
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={actionLoading !== null}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs text-white font-bold transition disabled:opacity-50"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
