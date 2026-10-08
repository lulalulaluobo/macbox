import React, { useState } from 'react';
import { X, Plus, FileCode, AlertCircle, Sparkles } from 'lucide-react';
import { CustomAppInput } from '../../types';
import { api } from '../../api';

interface CustomAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const SAMPLE_YAML = `services:
  app:
    image: amir20/dozzle:latest
    container_name: macbox-dozzle
    restart: unless-stopped
    ports:
      - "8888:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
`;

export const CustomAppModal: React.FC<CustomAppModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [category, setCategory] = useState("自建应用");
  const [icon, setIcon] = useState('box');
  const [description, setDescription] = useState('');
  const [port, setPort] = useState<number>(8888);
  const [composeYaml, setComposeYaml] = useState(SAMPLE_YAML);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg("请填写应用名称");
      return;
    }
    if (!composeYaml.trim()) {
      setErrorMsg("请填写安装配置");
      return;
    }

    setSaving(true);
    setErrorMsg(null);

    const input: CustomAppInput = {
      id: id.trim() || name.trim().toLowerCase().replace(/\s+/g, '-'),
      name: name.trim(),
      description: description.trim() || "自己添加的应用",
      category,
      icon,
      port: port || 80,
      composeYaml: composeYaml.trim(),
    };

    try {
      await api.addCustomApp(input);
      onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMsg(`保存失败，原因：${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl h-[85dvh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-950/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-500 dark:text-amber-400 border border-amber-500/30">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">添加应用</h3>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-900 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-400 dark:hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="flex-1 p-6 overflow-y-auto space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                应用名称 <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="例如：应用运行记录"
                value={name}
                onChange={e => {
                  setName(e.target.value);
                  if (!id) {
                    setId(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''));
                  }
                }}
                className="w-full px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                应用编号
              </label>
              <input
                type="text"
                placeholder="如dozzle，使用小写英文"
                value={id}
                onChange={e => setId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                className="w-full px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-mono text-xs focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">应用分类</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs focus:outline-none focus:border-amber-500"
              >
                <option value="自建应用">自建应用</option>
                <option value="影音娱乐">影音娱乐</option>
                <option value="下载工具">下载工具</option>
                <option value="个人网盘">个人网盘</option>
                <option value="实用工具">实用工具</option>
                <option value="智能家居">智能家居</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">网页端口</label>
              <input
                type="number"
                value={port}
                onChange={e => setPort(parseInt(e.target.value) || 0)}
                placeholder="8080"
                className="w-full px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-mono text-xs focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">应用图标</label>
              <select
                value={icon}
                onChange={e => setIcon(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs focus:outline-none focus:border-amber-500"
              >
                <option value="box">盒子</option>
                <option value="film">影音</option>
                <option value="cloud">网盘</option>
                <option value="download">下载</option>
                <option value="activity">监控</option>
                <option value="network">网络</option>
                <option value="code">代码</option>
                <option value="home">家居</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">应用简介</label>
            <input
              type="text"
              placeholder="写一句应用用途"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="space-y-1.5 flex-1 flex flex-col min-h-[220px]">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center space-x-1.5">
                <FileCode className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                <span>安装配置</span>
              </label>
              <button
                type="button"
                onClick={() => setComposeYaml(SAMPLE_YAML)}
                className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline flex items-center space-x-1"
              >
                <Sparkles className="w-3 h-3" />
                <span>填写示例</span>
              </button>
            </div>

            <textarea
              required
              spellCheck={false}
              value={composeYaml}
              onChange={e => setComposeYaml(e.target.value)}
              className="flex-1 w-full p-3 font-mono text-xs text-emerald-400/90 bg-[#06090e] border border-slate-800 rounded-xl resize-none focus:outline-none focus:border-amber-500 leading-relaxed"
              placeholder="粘贴应用安装配置"
            />
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-950/70 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 text-xs font-semibold transition"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center space-x-2 px-5 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-bold shadow-md shadow-amber-500/20 transition disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            <span>{saving ? "保存中" : "保存应用"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
