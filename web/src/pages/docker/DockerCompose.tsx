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
    const interval = setInterval(loadProjects, 6000);
    return () => clearInterval(interval);
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

      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-white flex items-center space-x-2">
            <Layers className="w-5 h-5 text-indigo-400" />
            <span>Docker Compose 服务编排</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            支持标准多容器拓扑架构，可视化编写 YAML、部署、启动与持续更新
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="搜索 Compose 项目名称..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9 pr-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-56 transition"
            />
          </div>

          <button
            onClick={loadProjects}
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition"
            title="刷新"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => {
              setEditProject(null);
              setIsDeployOpen(true);
            }}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 text-white text-xs font-bold shadow-lg shadow-indigo-500/20 transition"
          >
            <Plus className="w-4 h-4" />
            <span>部署新服务 (Compose)</span>
          </button>
        </div>
      </div>

      {/* Projects List */}
      {filtered.length === 0 ? (
        <div className="p-16 rounded-3xl bg-slate-900/60 border border-dashed border-slate-800 text-center space-y-4">
          <Layers className="w-12 h-12 text-slate-600 mx-auto" />
          <div>
            <h3 className="text-base font-bold text-slate-300">暂无 Compose 项目</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
              您可以点击右上角「部署新服务」，快速利用预设模板或自带的 docker-compose.yml 启动多容器业务栈。
            </p>
          </div>
          <button
            onClick={() => {
              setEditProject(null);
              setIsDeployOpen(true);
            }}
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition"
          >
            <Plus className="w-4 h-4" />
            <span>立即部署第一个项目</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filtered.map(proj => {
            const isRunning = proj.status === 'running';
            return (
              <div
                key={proj.name}
                className="p-5 rounded-3xl bg-slate-900/75 border border-slate-800/90 hover:border-slate-700 transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-5 shadow-lg"
              >
                {/* Left: Info */}
                <div className="flex items-start space-x-4 min-w-0 flex-1">
                  <div className="p-3 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex-shrink-0 mt-0.5">
                    <Layers className="w-6 h-6" />
                  </div>

                  <div className="space-y-2 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-bold text-white text-base font-mono">{proj.name}</h4>
                      <span
                        className={`text-[10px] px-2.5 py-0.5 rounded-full font-semibold uppercase ${
                          isRunning
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {isRunning ? '运行中' : '已停止'}
                      </span>
                      {proj.isSystemApp ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20 font-medium">
                          应用中心内置
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 font-medium">
                          自定义 Compose
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-400 font-mono truncate">
                      配置文件: <span className="text-slate-300">{proj.configFiles}</span>
                    </p>

                    {/* Associated Containers */}
                    {proj.containers.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-[11px] text-slate-400 mr-1">包含容器 ({proj.containers.length}):</span>
                        {proj.containers.map(cName => (
                          <span
                            key={cName}
                            className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-slate-300 text-xs font-mono"
                          >
                            <Box className="w-3 h-3 text-sky-400" />
                            <span>{cName}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center space-x-2 self-end lg:self-auto flex-shrink-0">
                  {!isRunning ? (
                    <button
                      onClick={() => handleAction(proj.name, 'start')}
                      disabled={actionLoading !== null}
                      className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition disabled:opacity-50"
                    >
                      <Play className="w-3.5 h-3.5 fill-white" />
                      <span>启动</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleAction(proj.name, 'stop')}
                      disabled={actionLoading !== null}
                      className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-950/50 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-500/30 text-xs font-semibold transition disabled:opacity-50"
                    >
                      <Square className="w-3 h-3" />
                      <span>停止</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleAction(proj.name, 'restart')}
                    disabled={actionLoading !== null}
                    className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition disabled:opacity-50"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>重启</span>
                  </button>

                  <button
                    onClick={() => handleAction(proj.name, 'pull')}
                    disabled={actionLoading !== null}
                    className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition disabled:opacity-50"
                    title="更新镜像"
                  >
                    <DownloadCloud className="w-3.5 h-3.5 text-sky-400" />
                    <span>更新</span>
                  </button>

                  <button
                    onClick={() => handleOpenEdit(proj.name)}
                    disabled={actionLoading !== null}
                    className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-semibold transition disabled:opacity-50"
                  >
                    <FileCode className="w-3.5 h-3.5" />
                    <span>查看配置</span>
                  </button>

                  {!proj.isSystemApp && (
                    <button
                      onClick={() => setDeleteModalProject(proj)}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950/50 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-500/30 transition"
                      title="下线并删除 Compose 项目"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-3 text-rose-400">
              <AlertCircle className="w-6 h-6" />
              <h3 className="text-base font-bold text-white">彻底下线并删除 Compose 项目？</h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              确定要删除项目 <span className="font-mono font-bold text-white">"{deleteModalProject.name}"</span> 吗？
              系统将执行 <code className="text-rose-400">docker compose down</code> 停止所有关联容器，并移除该项目在{' '}
              <code className="text-slate-200">/data/appdata/compose/</code> 中的配置目录。
            </p>

            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-400 flex items-center space-x-2">
              <input
                type="checkbox"
                id="delVol"
                checked={deleteVolumes}
                onChange={e => setDeleteVolumes(e.target.checked)}
                className="rounded border-slate-700 text-rose-500 focus:ring-0"
              />
              <label htmlFor="delVol" className="cursor-pointer">
                同时清除该项目创建的 Docker 命名数据卷 (-v)
              </label>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setDeleteModalProject(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-semibold transition"
              >
                取消
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={actionLoading !== null}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs text-white font-bold transition disabled:opacity-50"
              >
                确认下线并删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
