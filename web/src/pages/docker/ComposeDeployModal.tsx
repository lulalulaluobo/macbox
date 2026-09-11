import React, { useEffect, useState } from 'react';
import { X, Play, Terminal, Sparkles, AlertCircle, RefreshCw, FileCode } from 'lucide-react';
import { PRESET_COMPOSE_TEMPLATES, ComposeTemplate } from './types';
import { api } from '../../api';

interface ComposeDeployModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialProject?: { name: string; yaml: string } | null;
}

export const ComposeDeployModal: React.FC<ComposeDeployModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialProject,
}) => {
  const [projectName, setProjectName] = useState(initialProject?.name || '');
  const [yamlContent, setYamlContent] = useState(
    initialProject?.yaml || PRESET_COMPOSE_TEMPLATES[0].yaml
  );
  const [selectedTemplate, setSelectedTemplate] = useState<string>(
    initialProject ? '' : PRESET_COMPOSE_TEMPLATES[0].id
  );
  const [deploying, setDeploying] = useState(false);
  const [logs, setLogs] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (initialProject) {
      setProjectName(initialProject.name);
      setYamlContent(initialProject.yaml);
      setSelectedTemplate('');
    } else {
      const initialTemplate = PRESET_COMPOSE_TEMPLATES[0];
      setProjectName(initialTemplate.defaultProjectName);
      setYamlContent(initialTemplate.yaml);
      setSelectedTemplate(initialTemplate.id);
    }
    setLogs('');
    setErrorMsg(null);
  }, [initialProject, isOpen]);

  if (!isOpen) return null;

  const handleSelectTemplate = (tpl: ComposeTemplate) => {
    setSelectedTemplate(tpl.id);
    if (!initialProject) {
      setProjectName(tpl.defaultProjectName);
    }
    setYamlContent(tpl.yaml);
  };

  const handleDeploy = async () => {
    if (!projectName.trim()) {
      setErrorMsg('请输入项目名称（仅支持英文字母、数字和横杠）');
      return;
    }
    if (!yamlContent.trim()) {
      setErrorMsg('Docker Compose YAML 配置不能为空');
      return;
    }

    setErrorMsg(null);
    setDeploying(true);
    setLogs(`🚀 正在向底层引擎提交 Compose 项目 [${projectName}] ...\n`);

    try {
      const res = await api.deployCompose(projectName.trim(), yamlContent);
      setLogs(prev => prev + (res.logs || '项目已成功创建并启动！\n'));
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err: any) {
      setErrorMsg(`部署失败: ${err.message}`);
      setLogs(prev => prev + `\n❌ 部署遇到错误: ${err.message}\n`);
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-0 sm:p-4">
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-900 sm:h-[min(820px,92dvh)] sm:max-w-5xl sm:rounded-3xl sm:border sm:border-slate-200 sm:dark:border-slate-800">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950/70 sm:px-5 sm:py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="shrink-0 rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-2 text-indigo-500 dark:text-indigo-400">
              <FileCode className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-slate-900 dark:text-white sm:text-base">
                {initialProject ? `编辑：${initialProject.name}` : '部署 Compose 项目'}
              </h3>
              <p className="hidden text-xs text-slate-400 sm:block">
                编辑 YAML 配置或选择服务模板
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={deploying}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 disabled:opacity-50"
            aria-label="关闭 Compose 配置"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body (Split Left Editor & Right Templates / Details) */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch] lg:flex-row lg:overflow-hidden">
          {/* Main Area: Inputs & Editor */}
          <div className={`flex min-h-0 flex-col space-y-4 p-3 sm:p-5 lg:flex-1 lg:overflow-y-auto lg:border-r lg:border-slate-800/80 ${initialProject ? 'flex-1' : ''}`}>
            {errorMsg && (
              <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Project Name Input */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                项目名称 <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                disabled={!!initialProject || deploying}
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                placeholder="例如: my-nginx, my-redis, blog-wordpress"
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 font-mono text-xs text-slate-900 transition placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none disabled:opacity-60 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
              />
              <p className="mt-1 hidden text-[11px] text-slate-500 sm:block">
                将作为项目所属目录和容器编排标识，存储于 <code className="text-indigo-400">/data/appdata/compose/{projectName || '{name}'}/</code>
              </p>
            </div>

            {/* Compose YAML Editor */}
            <div className={`flex min-h-[430px] flex-col lg:min-h-[320px] lg:flex-1 ${initialProject ? 'flex-1' : ''}`}>
              <div className="flex items-center justify-between pb-1.5">
                <label className="flex items-center space-x-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <span>Compose 配置</span>
                </label>
                <span className="font-mono text-[10px] text-slate-500">docker-compose.yml</span>
              </div>

              <div className="terminal-dark-preserve relative flex flex-1 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-[#06090e]">
                <textarea
                  value={yamlContent}
                  onChange={e => setYamlContent(e.target.value)}
                  disabled={deploying}
                  spellCheck={false}
                  className="flex-1 w-full p-4 bg-transparent text-xs font-mono text-emerald-400/90 leading-relaxed resize-none focus:outline-none selection:bg-indigo-500/30"
                  placeholder="在此粘贴或编写 docker-compose.yml 配置..."
                />
              </div>
            </div>

            {/* Output Logs Drawer when Deploying */}
            {logs && (
              <div className="rounded-2xl border border-slate-800 bg-black/90 p-4 space-y-2">
                <div className="flex items-center space-x-2 text-xs font-bold text-slate-300">
                  <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                  <span>部署输出日志</span>
                </div>
                <pre className="font-mono text-xs text-slate-300 whitespace-pre-wrap max-h-32 overflow-y-auto leading-relaxed">
                  {logs}
                </pre>
              </div>
            )}
          </div>

          {/* Right Sidebar: Preset Templates */}
          {!initialProject && (
            <div className="flex w-full flex-col space-y-3 border-t border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40 sm:p-5 lg:w-80 lg:overflow-y-auto lg:border-t-0">
              <div className="flex items-center space-x-2 text-xs font-bold text-slate-900 dark:text-white">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>精选快速服务模板</span>
              </div>

              <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                {PRESET_COMPOSE_TEMPLATES.map(tpl => {
                  const isSelected = selectedTemplate === tpl.id;
                  return (
                    <div
                      key={tpl.id}
                      onClick={() => handleSelectTemplate(tpl)}
                      className={`cursor-pointer rounded-2xl border p-3 transition-colors ${
                        isSelected
                          ? 'bg-indigo-500/10 border-indigo-500/50 shadow-md shadow-indigo-500/10'
                          : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <h4 className="truncate text-xs font-bold text-slate-900 dark:text-white">{tpl.name}</h4>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700/60">
                          {tpl.category}
                        </span>
                      </div>
                      <p className="mt-1 hidden text-[11px] leading-normal text-slate-400 sm:line-clamp-2">
                        {tpl.description}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="hidden rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-3.5 text-[11px] leading-relaxed text-slate-400 sm:block">
                💡 <strong className="text-indigo-300">提示：</strong> 您可以直接将 Github 或 Docker Hub 上的任何{' '}
                <code className="text-slate-200">docker-compose.yml</code> 复制粘贴到左侧编辑器，一键启动。
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="grid shrink-0 grid-cols-[0.75fr_1.5fr] gap-2 border-t border-slate-200 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-950/70 sm:flex sm:justify-end sm:px-5 sm:py-4">
          <button
            onClick={onClose}
            disabled={deploying}
            className="min-h-11 rounded-xl bg-slate-100 px-4 text-xs font-semibold text-slate-600 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleDeploy}
            disabled={deploying}
            className="flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500 disabled:opacity-50 sm:px-5"
          >
            {deploying ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>正在部署并拉取镜像...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>{initialProject ? '保存并重新构建' : '一键构建并部署'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
