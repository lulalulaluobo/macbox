import React, { useEffect, useRef, useState } from 'react';
import { X, Play, Terminal, Sparkles, AlertCircle, RefreshCw, FileCode, Upload } from 'lucide-react';
import { PRESET_COMPOSE_TEMPLATES, ComposeTemplate } from './types';
import { api } from '../../api';

const MAX_COMPOSE_FILE_BYTES = 8 * 1024 * 1024;

const suggestProjectNameFromFile = (fileName: string) => {
  const baseName = fileName.replace(/\.(ya?ml)$/i, '').trim();
  if (!baseName || /^(docker-)?compose$/i.test(baseName)) return '';

  return baseName
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
};

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
  const [importedFileName, setImportedFileName] = useState<string | null>(null);
  const [isDropActive, setIsDropActive] = useState(false);
  const composeFileInputRef = useRef<HTMLInputElement | null>(null);
  const logOutputRef = useRef<HTMLPreElement | null>(null);
  const deployAbortRef = useRef<AbortController | null>(null);

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
    setImportedFileName(null);
    setIsDropActive(false);
  }, [initialProject, isOpen]);

  useEffect(() => {
    if (logOutputRef.current) {
      logOutputRef.current.scrollTop = logOutputRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => () => deployAbortRef.current?.abort(), []);

  if (!isOpen) return null;

  const handleSelectTemplate = (tpl: ComposeTemplate) => {
    setSelectedTemplate(tpl.id);
    setImportedFileName(null);
    if (!initialProject) {
      setProjectName(tpl.defaultProjectName);
    }
    setYamlContent(tpl.yaml);
  };

  const handleImportFile = async (file: File | null) => {
    if (!file || deploying) return;

    if (!/\.(ya?ml)$/i.test(file.name)) {
      setErrorMsg("请选择.yml或.yaml文件");
      return;
    }
    if (file.size > MAX_COMPOSE_FILE_BYTES) {
      setErrorMsg("配置文件不能超过8MB");
      return;
    }

    try {
      const content = await file.text();
      if (!content.trim()) {
        setErrorMsg("配置文件为空，请选择其他文件");
        return;
      }

      setYamlContent(content);
      setSelectedTemplate('');
      setImportedFileName(file.name);
      setErrorMsg(null);

      const selectedPreset = PRESET_COMPOSE_TEMPLATES.find(tpl => tpl.id === selectedTemplate);
      const hasPresetProjectName = selectedPreset?.defaultProjectName === projectName;
      if (!initialProject && (!projectName.trim() || hasPresetProjectName)) {
        setProjectName(suggestProjectNameFromFile(file.name));
      }
    } catch {
      setErrorMsg(`未能读取“${file.name}”，请重试`);
    }
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    void handleImportFile(file);
  };

  const handleComposeDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDropActive(false);
    void handleImportFile(event.dataTransfer.files?.[0] || null);
  };

  const handleDeploy = async () => {
    if (!projectName.trim()) {
      setErrorMsg("名称可用英文、数字、下划线或横杠");
      return;
    }
    if (!yamlContent.trim()) {
      setErrorMsg("请填写安装配置");
      return;
    }

    setErrorMsg(null);
    setDeploying(true);
    setLogs(`正在提交应用组合“${projectName}”`);

    const controller = new AbortController();
    deployAbortRef.current?.abort();
    deployAbortRef.current = controller;

    try {
      await api.deployComposeStream(
        projectName.trim(),
        yamlContent,
        line => setLogs(previous => `${previous}${line}\n`),
        controller.signal,
      );
      setLogs(previous => `${previous}✅ 应用组合已创建并启动。\n`);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err: any) {
	  if (controller.signal.aborted) return;
      setErrorMsg(`部署失败，原因：${err.message}`);
      setLogs(prev => prev + `\n❌ 部署遇到错误: ${err.message}\n`);
    } finally {
      if (deployAbortRef.current === controller) deployAbortRef.current = null;
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
                {initialProject ? `编辑配置：${initialProject.name}` : "安装组合"}
              </h3>
              <p className="hidden text-xs text-slate-400 sm:block">
                粘贴配置、导入文件或选用模板
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={deploying}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 disabled:opacity-50"
            aria-label="关闭配置"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body (Split Left Editor & Right Templates / Details) */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch] lg:flex-row lg:overflow-hidden">
          {/* Main Area: Inputs & Editor */}
          <div className={`flex min-h-0 flex-col space-y-4 p-3 sm:p-5 lg:flex-1 lg:overflow-y-auto lg:border-r lg:border-slate-800/80 ${initialProject ? 'flex-1' : ''}`}>
            {errorMsg && (
              <div className="flex items-center space-x-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-600 dark:text-rose-300">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Project Name Input */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                组合名称 <span className="text-rose-400">*</span>
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
                用于标识此应用组合，配置保存在： <code className="text-indigo-400">/data/appdata/compose/{projectName || '{name}'}/</code>
              </p>
            </div>

            {/* Compose YAML Editor */}
            <div className={`flex min-h-[430px] flex-col lg:min-h-[320px] lg:flex-1 ${initialProject ? 'flex-1' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5">
                <label className="flex items-center space-x-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <span>安装配置</span>
                </label>
                <div className="flex items-center gap-2">
                  {importedFileName && (
                    <span className="max-w-36 truncate rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-300" title={importedFileName}>
                      已导入 {importedFileName}
                    </span>
                  )}
                  <input
                    ref={composeFileInputRef}
                    type="file"
                    accept=".yml,.yaml,text/yaml,application/x-yaml"
                    onChange={handleFileInputChange}
                    disabled={deploying}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => composeFileInputRef.current?.click()}
                    disabled={deploying}
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 text-[11px] font-semibold text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-indigo-500/20"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    <span>导入文件</span>
                  </button>
                  <span className="hidden font-mono text-[10px] text-slate-500 sm:inline">docker-compose.yml</span>
                </div>
              </div>

              <div
                onDragEnter={event => {
                  event.preventDefault();
                  if (!deploying) setIsDropActive(true);
                }}
                onDragOver={event => event.preventDefault()}
                onDragLeave={() => setIsDropActive(false)}
                onDrop={handleComposeDrop}
                className={`terminal-dark-preserve relative flex flex-1 flex-col overflow-hidden rounded-2xl border bg-[#06090e] transition ${
                  isDropActive ? 'border-indigo-400 ring-2 ring-indigo-400/30' : 'border-slate-800'
                }`}
              >
                {isDropActive && (
                  <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-slate-950/90 text-indigo-200">
                    <Upload className="h-8 w-8" />
                    <span className="text-sm font-semibold">松开文件即可导入配置</span>
                    <span className="text-xs text-slate-400">请选择.yml或.yaml文件</span>
                  </div>
                )}
                <textarea
                  value={yamlContent}
                  onChange={e => setYamlContent(e.target.value)}
                  disabled={deploying}
                  spellCheck={false}
                  className="flex-1 w-full p-4 bg-transparent text-xs font-mono text-emerald-400/90 leading-relaxed resize-none focus:outline-none selection:bg-indigo-500/30"
                  placeholder="粘贴或导入安装配置"
                />
              </div>
            </div>

            {/* Output Logs Drawer when Deploying */}
            {logs && (
              <div className="rounded-2xl border border-slate-800 bg-black/90 p-4 space-y-2">
                <div className="flex items-center space-x-2 text-xs font-bold text-slate-300">
                  <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                  <span>安装记录</span>
                </div>
                <pre
                  ref={logOutputRef}
                  aria-live="polite"
                  className="max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-300 scroll-smooth"
                >
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
                <span>常用模板</span>
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
                      <p className="mt-1 text-[11px] font-mono text-slate-400">{tpl.brand}</p>
                      <p className="mt-1 hidden text-[11px] leading-normal text-slate-400 sm:line-clamp-2">
                        {tpl.description}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="hidden rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-3.5 text-[11px] leading-relaxed text-slate-400 sm:block">
                💡 <strong className="text-indigo-300">操作说明</strong> 可以导入配置文件：{' '}
                <code className="text-slate-200">docker-compose.yml</code>也可粘贴或填写配置后启动
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
                <span>安装中</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>{initialProject ? "保存应用" : "开始安装"}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
