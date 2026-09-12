import React from 'react';
import {
  Check, Copy, Download, FileKey, Key, Plus, RefreshCw, Shield, Sliders,
  Sparkles, Terminal, Trash2,
} from 'lucide-react';
import { SSHConfig, SSHKeyGenerationResult } from '../../types';

export interface SSHSettingsSectionProps {
  sshConfig: SSHConfig;
  sshSaving: boolean;
  copiedSSH: boolean;
  generatingKey: boolean;
  generatedKeyResult: SSHKeyGenerationResult | null;
  authorizedKeys: string[];
  showAuthorizedKeys: boolean;
  loadingAuthKeys: boolean;
  onToggleSSH: () => void;
  onSaveSSHConfig: () => void;
  onSSHConfigChange: React.Dispatch<React.SetStateAction<SSHConfig>>;
  onCopySSHCommand: (command: string) => void;
  onGenerateRootKey: () => void;
  onLoadAuthorizedKeys: () => void;
  onCollapseAuthorizedKeys: () => void;
  onOpenImportKey: () => void;
  onClearAuthorizedKeys: () => void;
  onCopyAuthorizedKey: (key: string) => void;
}

export const SSHSettingsSection: React.FC<SSHSettingsSectionProps> = ({
  sshConfig,
  sshSaving,
  copiedSSH,
  generatingKey,
  generatedKeyResult,
  authorizedKeys,
  showAuthorizedKeys,
  loadingAuthKeys,
  onToggleSSH,
  onSaveSSHConfig,
  onSSHConfigChange,
  onCopySSHCommand,
  onGenerateRootKey,
  onLoadAuthorizedKeys,
  onCollapseAuthorizedKeys,
  onOpenImportKey,
  onClearAuthorizedKeys,
  onCopyAuthorizedKey,
}) => (
        <div className="space-y-5">
          {/* SSH Service Status & Switch Card */}
          <div className="p-6 rounded-3xl bg-slate-900/70 border border-slate-800/80 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div className="flex items-center space-x-4">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center border shadow-inner ${
                  sshConfig.status === 'running'
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                }`}
              >
                <Shield className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center space-x-2.5">
                  <h3 className="text-lg font-bold text-white">SSH 远程终端守护服务</h3>
                  <span
                    className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border ${
                      sshConfig.status === 'running'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                        : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                    }`}
                  >
                    {sshConfig.status === 'running' ? '● 正在运行' : '○ 已停止'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  允许使用 macOS Terminal、Termius、VSCode Remote 或 PuTTY 通过 SSH 协议远程连接管理 NAS。
                </p>
              </div>
            </div>

            <button
              onClick={onToggleSSH}
              disabled={sshSaving}
              className={`px-5 py-2.5 rounded-xl font-bold text-xs shadow-md transition flex items-center space-x-2 self-start md:self-auto ${
                sshConfig.status === 'running'
                  ? 'bg-rose-600/90 hover:bg-rose-500 text-white shadow-rose-600/20'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'
              }`}
            >
              {sshSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>{sshConfig.status === 'running' ? '停止 SSH 服务' : '启动 SSH 服务'}</span>
            </button>
          </div>

          {/* SSH Configuration Form */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left: Settings */}
            <div className="lg:col-span-7 bg-slate-900/70 p-6 rounded-3xl border border-slate-800/80 shadow-xl space-y-6">
              <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-sky-400" />
                <span>SSH 安全访问策略</span>
              </h4>

              {/* 1. PermitRootLogin toggle (用户核心需求) */}
              <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-bold text-white">开放 SSH Root 账号登录</span>
                    <span className="text-[10px] font-mono text-slate-400">(PermitRootLogin)</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                    开启后，支持直接以 <code>root</code> 账号通过 SSH 远程登录。若关闭，仅允许普通用户登录后 <code>sudo</code> 提权。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onSSHConfigChange({ ...sshConfig, permitRootLogin: !sshConfig.permitRootLogin })}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    sshConfig.permitRootLogin ? 'bg-amber-500' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      sshConfig.permitRootLogin ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* 2. Password Authentication is intentionally immutable */}
              <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-bold text-white">SSH 密码认证</span>
                    <span className="text-[10px] font-mono text-slate-400">(PasswordAuthentication)</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                    MacNAS 固定关闭 SSH 密码认证，仅使用 SSH 公钥登录 root；控制台和 root 密码不作为 SSH 凭据。
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-300">已关闭</span>
              </div>

              {/* 3. Port */}
              <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 flex items-center justify-between gap-4">
                <div>
                  <span className="text-sm font-bold text-white">SSH 监听端口:</span>
                  <p className="text-xs text-slate-400 mt-0.5">默认端口为 22。修改端口可有效降低外网或局域网扫描风险。</p>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={sshConfig.port}
                    onChange={(e) => onSSHConfigChange({ ...sshConfig, port: parseInt(e.target.value) || 22 })}
                    className="w-24 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono text-center text-xs focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={onSaveSSHConfig}
                  disabled={sshSaving}
                  className="px-6 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-bold text-xs shadow-lg shadow-sky-500/25 transition flex items-center space-x-2"
                >
                  {sshSaving && <RefreshCw className="w-4 h-4 animate-spin" />}
                  <span>保存并应用 SSH 设置</span>
                </button>
              </div>
            </div>

            {/* Right: Quick SSH Commands */}
            <div className="lg:col-span-5 bg-slate-900/70 p-6 rounded-3xl border border-slate-800/80 shadow-xl space-y-4">
              <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span>一键直连 SSH 终端命令</span>
              </h4>

              <div className="space-y-3 font-mono text-xs">
                {/* Root Key Connect Command */}
                {sshConfig.permitRootLogin && generatedKeyResult && (
                  <div className="p-3.5 rounded-2xl bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/30 space-y-2">
                    <div className="flex justify-between items-center text-amber-400 font-sans text-xs font-semibold">
                      <span className="flex items-center space-x-1.5">
                        <FileKey className="w-3.5 h-3.5" />
                        <span>👑 Root 密钥免密连接:</span>
                      </span>
                      <button
                        onClick={() => onCopySSHCommand(`ssh -o StrictHostKeyChecking=accept-new -i ~/Downloads/${generatedKeyResult.filename} -p ${sshConfig.sshLocalPort || sshConfig.port} root@127.0.0.1`)}
                        className="p-1 rounded hover:bg-amber-500/20 text-amber-300"
                        title="复制密钥连接命令"
                      >
                        {copiedSSH ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <code className="text-amber-200 block bg-black/60 p-2.5 rounded-xl break-all">
                      ssh -o StrictHostKeyChecking=accept-new -i ~/Downloads/{generatedKeyResult.filename} -p {sshConfig.sshLocalPort || sshConfig.port} root@127.0.0.1
                    </code>
                  </div>
                )}

              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
                提示: 先生成 Root SSH 密钥，然后在运行 MacNAS 的这台 Mac 的 macOS“终端”中执行弹窗里的完整命令；不要把这些命令粘贴到本页面的 Web 终端中。私钥路径是 Mac 的 Downloads，不是 VM 内的 /root/Downloads。
              </p>
            </div>
          </div>

          {/* SSH Key Authentication & Root Key Generation Card */}
          <div className="bg-slate-900/70 p-6 rounded-3xl border border-slate-800/80 shadow-xl space-y-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center space-x-3.5">
                <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                  <FileKey className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-base font-bold text-white">SSH 密钥认证与 Root 秘钥管理</h4>
                    <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium">
                      PubkeyAuthentication (已开启)
                    </span>
                    <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-medium font-mono">
                      Root 授权公钥: {sshConfig.authorizedKeyCount || 0} 个
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    非对称加密密钥对 (ED25519) 具备极高安全性且免除输密烦恼。点击一键生成后，系统将自动将公钥部署进虚拟机，并将私钥直接下载至您的本地电脑。
                  </p>
                </div>
              </div>

              {/* One Click Generate & Download Button */}
              <button
                onClick={onGenerateRootKey}
                disabled={generatingKey}
                className="px-5 py-3 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:brightness-110 text-slate-950 font-bold text-xs shadow-lg shadow-amber-500/20 transition flex items-center space-x-2 shrink-0 self-start md:self-auto disabled:opacity-50"
              >
                {generatingKey ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                    <span>正在生成密钥并部署...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 text-slate-950" />
                    <span>一键生成 Root 密钥并下载</span>
                    <Sparkles className="w-4 h-4 text-slate-950" />
                  </>
                )}
              </button>
            </div>

            {/* Sub actions: list keys, import key, clear keys */}
            <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    if (showAuthorizedKeys) {
                      onCollapseAuthorizedKeys();
                    } else {
                      onLoadAuthorizedKeys();
                    }
                  }}
                  disabled={loadingAuthKeys}
                  className="px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition flex items-center space-x-1.5"
                >
                  <Key className="w-3.5 h-3.5 text-sky-400" />
                  <span>{showAuthorizedKeys ? '收起已授权公钥列表' : `查看 Root 已授权公钥 (${sshConfig.authorizedKeyCount || 0})`}</span>
                  {loadingAuthKeys && <RefreshCw className="w-3 h-3 animate-spin text-slate-400" />}
                </button>

                <button
                  onClick={() => onOpenImportKey()}
                  className="px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition flex items-center space-x-1.5"
                >
                  <Plus className="w-3.5 h-3.5 text-emerald-400" />
                  <span>导入已有公钥</span>
                </button>
              </div>

              {sshConfig.authorizedKeyCount && sshConfig.authorizedKeyCount > 0 ? (
                <button
                  onClick={onClearAuthorizedKeys}
                  className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition flex items-center space-x-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>清空所有已授权公钥</span>
                </button>
              ) : null}
            </div>

            {/* Expandable Authorized Keys List */}
            {showAuthorizedKeys && (
              <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2 animate-in fade-in duration-150">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-xs font-semibold text-slate-300">
                  <span>/root/.ssh/authorized_keys 中生效的公钥:</span>
                  <span className="text-slate-500 font-normal font-mono">共 {authorizedKeys.length} 条记录</span>
                </div>
                {authorizedKeys.length === 0 ? (
                  <p className="text-xs text-slate-500 py-2">暂无已授权公钥，点击上方「一键生成 Root 密钥」即可生成并自动注入！</p>
                ) : (
                  <div className="space-y-2">
                    {authorizedKeys.map((keyLine, idx) => (
                      <div key={idx} className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-3 text-xs font-mono">
                        <span className="text-slate-300 truncate select-all">{keyLine}</span>
                        <button
                          onClick={() => onCopyAuthorizedKey(keyLine)}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white shrink-0 transition flex items-center space-x-1 text-[11px]"
                          title="复制公钥"
                        >
                          <Copy className="w-3 h-3" />
                          <span>复制</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

);
