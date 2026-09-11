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
    <div className="flex h-full min-h-0 flex-col gap-2.5 overflow-hidden">
      {/* Alert Banner */}
      {alertMsg && (
        <div
          className={`fixed left-1/2 top-20 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center justify-between gap-3 rounded-full border bg-white/95 px-4 py-2.5 text-xs shadow-xl backdrop-blur dark:bg-slate-900/95 ${
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
      <div className="flex shrink-0 items-center justify-between gap-2 rounded-[20px] border border-slate-200/80 bg-white p-2 shadow-xs dark:border-slate-800 dark:bg-slate-900/80">
        <div>
          <h2 className="hidden items-center space-x-2 text-sm font-extrabold text-slate-900 dark:text-white sm:flex">
            <Disc3 className="w-5 h-5 text-amber-500 dark:text-amber-400" />
            <span>本地镜像管理</span>
          </h2>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          <div className="relative min-w-0 flex-1 sm:max-w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="搜索镜像仓库或标签..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="min-h-10 w-full rounded-xl border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-xs text-slate-900 shadow-xs transition placeholder:text-slate-400 focus:border-amber-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500"
            />
          </div>

          <button
            onClick={loadImages}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200/80 dark:bg-slate-900 dark:hover:bg-slate-800 dark:text-slate-300 dark:border-slate-800 transition"
            title="刷新"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={handlePrune}
            disabled={actionLoading !== null}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200/80 dark:bg-slate-900 dark:hover:bg-slate-800 dark:text-amber-400 dark:border-amber-500/30 text-xs font-semibold transition disabled:opacity-50"
            title="清理所有未被引用的镜像"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">清理</span>
          </button>

          <button
            onClick={() => setIsPullOpen(true)}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-bold shadow-md shadow-amber-500/20 transition"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">拉取</span>
          </button>
        </div>
      </div>

      {/* Images List */}
      {filtered.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-[22px] border border-dashed border-slate-200 bg-white p-8 text-center shadow-xs dark:border-slate-800 dark:bg-slate-900/60">
          <Disc3 className="w-12 h-12 text-slate-400 dark:text-slate-600 mx-auto" />
          <div>
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-300">暂无本地镜像</h3>
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
        <>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-0.5 sm:hidden [-webkit-overflow-scrolling:touch]">
            {filtered.map(img => (
              <article
                key={img.id}
                className="rounded-[20px] border border-slate-200/90 bg-white p-3 shadow-xs dark:border-slate-800/90 dark:bg-slate-900/75"
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <div className="shrink-0 rounded-xl border border-amber-500/20 bg-amber-500/10 p-2 text-amber-600 dark:text-amber-400">
                    <Disc3 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <h3 className="min-w-0 flex-1 truncate font-mono text-sm font-bold text-slate-900 dark:text-white">
                        {img.repository}
                      </h3>
                      <span className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-amber-700 dark:border-slate-700 dark:bg-slate-800 dark:text-amber-400">
                        {img.tag}
                      </span>
                    </div>
                    <p className="mt-1 truncate font-mono text-[10px] text-slate-400">{img.id.slice(0, 12)}</p>
                  </div>
                  <button
                    onClick={() => setDeleteModalImage(img)}
                    className="shrink-0 rounded-xl border border-slate-200 bg-slate-100 p-2 text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-400"
                    title="删除镜像"
                    aria-label={`删除镜像 ${img.repository}:${img.tag}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-3 divide-x divide-slate-100 rounded-xl bg-slate-50 px-1 py-2 dark:divide-slate-800 dark:bg-slate-950/60">
                  <div className="min-w-0 px-2">
                    <p className="text-[10px] text-slate-400">占用</p>
                    <p className="mt-0.5 truncate font-mono text-xs font-bold text-slate-800 dark:text-white">{img.size}</p>
                  </div>
                  <div className="min-w-0 px-2">
                    <p className="text-[10px] text-slate-400">状态</p>
                    <p className={`mt-0.5 truncate text-xs font-semibold ${img.inUse ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}`}>
                      {img.inUse ? `使用中 · ${img.containers}` : '未使用'}
                    </p>
                  </div>
                  <div className="min-w-0 px-2">
                    <p className="text-[10px] text-slate-400">创建</p>
                    <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-slate-300">{img.createdSince || img.createdAt}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="hidden min-h-0 flex-1 overflow-hidden rounded-[20px] border border-slate-200/90 bg-white shadow-xs dark:border-slate-800/90 dark:bg-slate-900/75 sm:block">
          <div className="h-full overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold tracking-wider text-[11px]">
                <tr>
                  <th className="px-4 py-3">镜像</th>
                  <th className="py-3.5 px-4">Image ID</th>
                  <th className="py-3.5 px-4">物理占用</th>
                  <th className="py-3.5 px-4">状态 / 关联容器</th>
                  <th className="py-3.5 px-4">创建时间</th>
                  <th className="py-3.5 px-6 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono">
                {filtered.map(img => {
                  return (
                    <tr key={img.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition">
                      {/* Repo & Tag */}
                      <td className="px-4 py-3 font-sans">
                        <div className="flex items-center space-x-3">
                          <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex-shrink-0">
                            <Disc3 className="w-4 h-4" />
                          </div>
                          <div>
                            <span className="font-bold text-slate-900 dark:text-white text-sm font-mono">{img.repository}</span>
                            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-slate-100 text-amber-700 border border-slate-200 dark:bg-slate-800 dark:text-amber-400 dark:border-slate-700 font-mono">
                              {img.tag}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* ID */}
                      <td className="py-4 px-4 text-slate-500 dark:text-slate-400 font-mono text-xs">
                        {img.id.slice(0, 12)}
                      </td>

                      {/* Size */}
                      <td className="py-4 px-4 text-slate-800 dark:text-white font-bold font-mono">
                        {img.size}
                      </td>

                      {/* Status */}
                      <td className="py-4 px-4 font-sans">
                        {img.inUse ? (
                          <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs font-semibold">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>使用中 ({img.containers} 个容器)</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700/60 text-xs font-medium">
                            未使用
                          </span>
                        )}
                      </td>

                      {/* Created */}
                      <td className="py-4 px-4 text-slate-500 dark:text-slate-400 text-xs font-sans">
                        {img.createdSince || img.createdAt}
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-6 text-right font-sans">
                        <button
                          onClick={() => setDeleteModalImage(img)}
                          className="p-2 rounded-xl bg-slate-100 hover:bg-rose-50 text-slate-500 hover:text-rose-600 border border-slate-200 hover:border-rose-200 dark:bg-slate-800/80 dark:hover:bg-rose-950/50 dark:text-slate-400 dark:hover:text-rose-400 dark:border-slate-700 dark:hover:border-rose-500/30 transition"
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
        </>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-3 text-rose-500">
              <AlertCircle className="w-6 h-6" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">确认删除镜像？</h3>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              确定要删除镜像{' '}
              <span className="font-mono font-bold text-slate-900 dark:text-white">
                "{deleteModalImage.repository}:{deleteModalImage.tag}"
              </span>{' '}
              (ID: {deleteModalImage.id.slice(0, 12)}) 吗？
              {deleteModalImage.inUse && (
                <span className="block mt-1 text-amber-600 dark:text-amber-400 font-semibold">
                  ⚠️ 警告：当前有容器正在使用此镜像，直接删除可能失败，需勾选强制删除。
                </span>
              )}
            </p>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 flex items-center space-x-2">
              <input
                type="checkbox"
                id="forceDelImg"
                checked={forceDelete}
                onChange={e => setForceDelete(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 text-rose-500 focus:ring-0"
              />
              <label htmlFor="forceDelImg" className="cursor-pointer">
                强制删除镜像 (-f / --force)
              </label>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setDeleteModalImage(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 font-semibold transition"
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
