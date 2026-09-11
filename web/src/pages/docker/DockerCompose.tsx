import React, { useState, useEffect } from 'react';
import {
  Layers,
  Plus,
  Play,
  Square,
  RotateCw,
  Trash2,
  FileCode,
  RefreshCw,
  Search,
  Box,
  AlertCircle,
  DownloadCloud,
} from 'lucide-react';
import { ComposeProject } from '../../types';
import { api } from '../../api';
import { ComposeDeployModal } from './ComposeDeployModal';

export const DockerCompose: React.FC = () => {
  const [projects, setProjects] = useState<ComposeProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Deploy / Edit Modal
  const [isDeployOpen, setIsDeployOpen] = useState(false);
  const [editProject, setEditProject] = useState<{ name: string; yaml: string } | null>(null);

  // Delete Modal
  const [deleteModalProject, setDeleteModalProject] = useState<ComposeProject | null>(null);
  const [deleteVolumes, setDeleteVolumes] = useState(false);

  const loadProjects = async () => {
    try {
      const data = await api.getComposeProjects();
      setProjects(data || []);
    } catch (err) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
    const poll = () => { if (!document.hidden) loadProjects(); };
    const interval = setInterval(poll, 6000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', poll);
    };
  }, []);

  const handleAction = async (name: string, action: 'start' | 'stop' | 'restart' | 'down' | 'pull') => {
    setActionLoading(`${action}-${name}`);
    try {
      await api.composeAction(name, action);
      await loadProjects();
      setAlertMsg({ type: 'success', text: `项目 [${name}] 已成功执行 ${action}` });
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `操作失败: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenEdit = async (name: string) => {
    setActionLoading(`edit-${name}`);
    try {
      const res = await api.getComposeYaml(name);
      setEditProject({ name: res.name, yaml: res.yaml });
      setIsDeployOpen(true);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `获取配置失败: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteModalProject) return;
    const name = deleteModalProject.name;
    setActionLoading(`del-${name}`);
    try {
      await api.deleteComposeProject(name, deleteVolumes);
      setDeleteModalProject(null);
      setAlertMsg({ type: 'success', text: `项目 [${name}] 已彻底下线并删除` });
      await loadProjects();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `删除失败: ${err.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  const filtered = projects.filter(p => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      p.name.toLowerCase().includes(term) ||
      p.configFiles.toLowerCase().includes(term) ||
      p.containers.some(c => c.toLowerCase().includes(term))
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

      {/* Header Bar */}
      <div className="flex shrink-0 items-center justify-between gap-2 rounded-[20px] border border-slate-200/80 bg-white p-2 shadow-xs dark:border-slate-800 dark:bg-slate-900/80">
        <div>
          <h2 className="hidden items-center space-x-2 text-sm font-extrabold text-slate-900 dark:text-white sm:flex">
            <Layers className="w-5 h-5 text-indigo-400" />
            <span>Docker Compose 服务编排</span>
          </h2>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          <div className="relative min-w-0 flex-1 sm:max-w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="搜索 Compose 项目名称..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="min-h-10 w-full rounded-xl border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-xs text-slate-900 shadow-xs transition placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            />
          </div>

          <button
            onClick={loadProjects}
            className="p-2 rounded-xl bg-white hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 shadow-xs transition"
            title="刷新"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => {
              setEditProject(null);
              setIsDeployOpen(true);
            }}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-xs transition"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">部署</span>
          </button>
        </div>
      </div>

      {/* Projects List */}
      {filtered.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-[22px] border border-dashed border-slate-200 bg-white p-8 text-center shadow-xs dark:border-slate-800 dark:bg-slate-900/60">
          <Layers className="w-12 h-12 text-slate-400 dark:text-slate-600 mx-auto" />
          <div>
            <h3 className="text-base font-bold text-slate-700 dark:text-slate-300">暂无 Compose 项目</h3>
          </div>
          <button
            onClick={() => {
              setEditProject(null);
              setIsDeployOpen(true);
            }}
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-xs transition"
          >
            <Plus className="w-4 h-4" />
            <span>立即部署第一个项目</span>
          </button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
          {filtered.map(proj => {
            const isRunning = proj.status === 'running';
            return (
              <div
                key={proj.name}
                className="flex flex-col justify-between gap-3 rounded-[20px] border border-slate-200 bg-white p-3 shadow-xs transition-all hover:border-slate-300 dark:border-slate-800/90 dark:bg-slate-900/75 dark:hover:border-slate-700 lg:flex-row lg:items-center"
              >
                {/* Left: Info */}
                <div className="flex items-start space-x-4 min-w-0 flex-1">
                  <div className="p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20 flex-shrink-0 mt-0.5">
                    <Layers className="w-6 h-6" />
                  </div>

                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-bold text-slate-900 dark:text-white text-base font-mono">{proj.name}</h4>
                      <span
                        className={`text-[10px] px-2.5 py-0.5 rounded-full font-semibold uppercase ${
                          isRunning
                            ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {isRunning ? '运行中' : '已停止'}
                      </span>
                      {proj.isSystemApp ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-500/20 font-medium">
                          内置预设
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-500/20 font-medium">
                          自定义 Compose
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">
                      配置文件: <span className="text-slate-700 dark:text-slate-300">{proj.configFiles}</span>
                    </p>

                    {/* Associated Containers */}
                    {proj.containers.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-1">包含容器 ({proj.containers.length}):</span>
                        {proj.containers.map(cName => (
                          <span
                            key={cName}
                            className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 text-slate-700 dark:text-slate-300 text-xs font-mono"
                          >
                            <Box className="w-3 h-3 text-sky-500 dark:text-sky-400" />
                            <span>{cName}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="grid w-full flex-shrink-0 grid-cols-3 gap-2 lg:flex lg:w-auto lg:items-center lg:self-auto">
                  {!isRunning ? (
                    <button
                      onClick={() => handleAction(proj.name, 'start')}
                      disabled={actionLoading !== null}
                    className="flex min-w-0 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-2 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-emerald-500 disabled:opacity-50 lg:px-3.5 lg:py-1.5"
                    >
                      <Play className="w-3.5 h-3.5 fill-white" />
                      <span>启动</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleAction(proj.name, 'stop')}
                      disabled={actionLoading !== null}
                      className="flex min-w-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-2 py-2 text-xs font-semibold text-slate-700 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-rose-950/50 dark:hover:text-rose-300 lg:px-3.5 lg:py-1.5"
                    >
                      <Square className="w-3 h-3" />
                      <span>停止</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleAction(proj.name, 'restart')}
                    disabled={actionLoading !== null}
                    className="flex min-w-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-2 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 lg:px-3.5 lg:py-1.5"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>重启</span>
                  </button>

                  <button
                    onClick={() => handleAction(proj.name, 'pull')}
                    disabled={actionLoading !== null}
                    className="flex min-w-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-2 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 lg:px-3.5 lg:py-1.5"
                    title="更新镜像"
                  >
                    <DownloadCloud className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
                    <span>更新</span>
                  </button>

                  <button
                    onClick={() => handleOpenEdit(proj.name)}
                    disabled={actionLoading !== null}
                    className={`flex min-w-0 items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-indigo-500/20 lg:px-3.5 lg:py-1.5 ${
                      proj.isSystemApp ? 'col-span-3' : 'col-span-2'
                    } lg:col-auto`}
                  >
                    <FileCode className="w-3.5 h-3.5" />
                    <span>查看配置</span>
                  </button>

                  {!proj.isSystemApp && (
                    <button
                      onClick={() => setDeleteModalProject(proj)}
                      className="flex w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-100 p-2 text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-rose-950/50 dark:hover:text-rose-400 lg:w-auto"
                      title="删除 Compose 项目"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Deploy / Edit Compose Modal */}
      <ComposeDeployModal
        isOpen={isDeployOpen}
        onClose={() => {
          setIsDeployOpen(false);
          setEditProject(null);
        }}
        onSuccess={() => {
          loadProjects();
        }}
        initialProject={editProject}
      />

      {/* Delete Project Modal */}
      {deleteModalProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-3 text-rose-500">
              <AlertCircle className="w-6 h-6" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">确认删除 Compose 项目？</h3>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              确定要删除项目 <span className="font-mono font-bold text-slate-900 dark:text-white">"{deleteModalProject.name}"</span> 吗？
              系统将停止所有关联容器。
            </p>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 flex items-center space-x-2">
              <input
                type="checkbox"
                id="delVol"
                checked={deleteVolumes}
                onChange={e => setDeleteVolumes(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 text-rose-500 focus:ring-0"
              />
              <label htmlFor="delVol" className="cursor-pointer">
                同时清除数据卷 (-v)
              </label>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setDeleteModalProject(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs text-slate-700 dark:text-slate-300 font-semibold transition"
              >
                取消
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={actionLoading !== null}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs text-white font-bold transition disabled:opacity-50 shadow-xs"
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
