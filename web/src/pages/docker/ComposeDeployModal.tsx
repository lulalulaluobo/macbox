import React, { useState } from 'react';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-5xl h-[88vh] flex flex-col rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-950/70 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <FileCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">
                {initialProject ? `编辑 Compose 项目: ${initialProject.name}` : '部署 Docker Compose 服务'}
              </h3>
              <p className="text-xs text-slate-400">
                支持在线编写、粘贴 Compose YAML 配置，或基于常用 NAS 服务模板快速创建
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={deploying}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body (Split Left Editor & Right Templates / Details) */}
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
          {/* Main Area: Inputs & Editor */}
          <div className="flex-1 flex flex-col p-6 overflow-y-auto space-y-4 border-r border-slate-800/80">
            {errorMsg && (
              <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Project Name Input */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                项目标识 (Project Name) <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                disabled={!!initialProject || deploying}
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                placeholder="例如: my-nginx, my-redis, blog-wordpress"
                className="w-full px-3.5 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition disabled:opacity-60"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                将作为项目所属目录和容器编排标识，存储于 <code className="text-indigo-400">/data/appdata/compose/{projectName || '{name}'}/</code>
              </p>
            </div>

            {/* Compose YAML Editor */}
            <div className="flex-1 flex flex-col min-h-[320px]">
              <div className="flex items-center justify-between pb-1.5">
                <label className="text-xs font-semibold text-slate-300 flex items-center space-x-1.5">
                  <span>docker-compose.yml 配置文件内容</span>
                </label>
                <span className="text-[11px] text-slate-500 font-mono">YAML 语法 (version 3.8+)</span>
              </div>

              <div className="flex-1 relative rounded-2xl border border-slate-800 overflow-hidden bg-[#06090e] flex flex-col">
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
            <div className="w-full lg:w-80 bg-slate-950/40 p-5 flex flex-col space-y-4 overflow-y-auto">
              <div className="flex items-center space-x-2 text-xs font-bold text-white">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>精选快速服务模板</span>
              </div>

              <div className="space-y-2.5">
                {PRESET_COMPOSE_TEMPLATES.map(tpl => {
                  const isSelected = selectedTemplate === tpl.id;
                  return (
                    <div
                      key={tpl.id}
                      onClick={() => handleSelectTemplate(tpl)}
                      className={`p-3.5 rounded-2xl border cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-indigo-500/10 border-indigo-500/50 shadow-md shadow-indigo-500/10'
                          : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-white">{tpl.name}</h4>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700/60">
                          {tpl.category}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1 leading-normal line-clamp-2">
                        {tpl.description}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="p-3.5 rounded-2xl bg-indigo-500/5 border border-indigo-500/20 text-[11px] text-slate-400 leading-relaxed">
                💡 <strong className="text-indigo-300">提示：</strong> 您可以直接将 Github 或 Docker Hub 上的任何{' '}
                <code className="text-slate-200">docker-compose.yml</code> 复制粘贴到左侧编辑器，一键启动。
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-950/70 border-t border-slate-800 flex items-center justify-end space-x-3">
          <button
            onClick={onClose}
            disabled={deploying}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-semibold transition disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleDeploy}
            disabled={deploying}
            className="flex items-center space-x-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs text-white font-bold shadow-lg shadow-indigo-600/20 transition disabled:opacity-50"
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
