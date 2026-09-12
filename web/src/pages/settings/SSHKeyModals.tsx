import React, { useState } from 'react';
import { Check, Copy, Download, FileKey, Plus, RefreshCw, X } from 'lucide-react';
import type { SSHConfig, SSHKeyGenerationResult } from '../../types';

interface SSHKeyModalsProps {
  showKeyModal: boolean;
  generatedKeyResult: SSHKeyGenerationResult | null;
  showImportKeyModal: boolean;
  importKeyText: string;
  importingKey: boolean;
  sshConfig: SSHConfig;
  primaryIP: string;
  onCloseKeyModal: () => void;
  onDownloadPrivateKey: (privateKey: string, filename: string) => void;
  onImportKeyTextChange: (value: string) => void;
  onCloseImportKeyModal: () => void;
  onAddAuthorizedKey: (event: React.FormEvent) => void;
}

export const SSHKeyModals: React.FC<SSHKeyModalsProps> = ({
  showKeyModal,
  generatedKeyResult,
  showImportKeyModal,
  importKeyText,
  importingKey,
  sshConfig,
  primaryIP,
  onCloseKeyModal,
  onDownloadPrivateKey,
  onImportKeyTextChange,
  onCloseImportKeyModal,
  onAddAuthorizedKey,
}) => {
  const [copiedKeyText, setCopiedKeyText] = useState(false);
  const [copiedKeyCmd, setCopiedKeyCmd] = useState(false);

  const copyPrivateKey = () => {
    if (!generatedKeyResult) return;
    navigator.clipboard.writeText(generatedKeyResult.privateKey);
    setCopiedKeyText(true);
    setTimeout(() => setCopiedKeyText(false), 2000);
  };

  const copyConnectionCommand = () => {
    if (!generatedKeyResult) return;
    const port = sshConfig.sshLocalPort || sshConfig.port;
    const host = sshConfig.sshLocalPort ? '127.0.0.1' : primaryIP;
    const command = `chmod 600 ~/Downloads/${generatedKeyResult.filename} && ssh -o StrictHostKeyChecking=accept-new -i ~/Downloads/${generatedKeyResult.filename} -p ${port} root@${host}`;
    navigator.clipboard.writeText(command);
    setCopiedKeyCmd(true);
    setTimeout(() => setCopiedKeyCmd(false), 2000);
  };

  return (
    <>
      {showKeyModal && generatedKeyResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-xl space-y-5 rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/15 text-amber-400"><FileKey className="h-5 w-5" /></div>
                <div><h3 className="text-base font-bold text-white">Root SSH 私钥已生成并自动下载</h3><p className="text-xs font-medium text-emerald-400">公钥已自动部署至虚拟机 /root/.ssh/authorized_keys</p></div>
              </div>
              <button type="button" onClick={onCloseKeyModal} className="rounded-lg p-1 text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="space-y-1.5 rounded-2xl border border-slate-800 bg-slate-950/70 p-3.5 font-mono">
                <div className="flex justify-between text-slate-400"><span>私钥文件名:</span><span className="font-bold text-amber-300">{generatedKeyResult.filename}</span></div>
                <div className="flex justify-between text-slate-400"><span>密钥算法:</span><span className="text-slate-200">{generatedKeyResult.keyType.toUpperCase()} (高安全性椭圆曲线)</span></div>
                <div className="flex justify-between text-slate-400"><span>密钥指纹:</span><span className="text-slate-200">{generatedKeyResult.fingerprint}</span></div>
              </div>
              <div className="space-y-2 font-sans">
                <h4 className="font-bold text-slate-200">使用指南（必须在运行 MacNAS 的 Mac 的 macOS“终端”中运行）:</h4>
                <div className="space-y-2 rounded-xl border border-slate-800 bg-black/60 p-3 font-mono text-[11px] text-slate-300">
                  <div><span className="text-slate-500"># 步骤 1: 设置严格权限 (macOS / Linux 必需)</span><div className="select-all text-amber-300">chmod 600 ~/Downloads/{generatedKeyResult.filename}</div></div>
                  <div><span className="text-slate-500"># 步骤 2: 在 Mac 宿主机终端执行（端口 {sshConfig.sshLocalPort || 58107}）</span><div className="select-all text-sky-300">ssh -o StrictHostKeyChecking=accept-new -i ~/Downloads/{generatedKeyResult.filename} -p {sshConfig.sshLocalPort || 58107} root@127.0.0.1</div></div>
                  <div><span className="text-slate-500"># 步骤 3: 局域网其他设备（当前不提供默认直连）</span><div className="text-emerald-300">当前未开放宿主机 22 端口；运行 Mac 请始终使用步骤 2 的 127.0.0.1:{sshConfig.sshLocalPort || 58107}。</div></div>
                </div>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-300/90">⚠️ <strong>安全提示</strong>: 私钥文件已自动下载至运行浏览器的 Mac 的 Downloads 文件夹中，文件名包含 `.txt` 扩展名也可以直接用于 SSH。为确保绝对安全，MacNAS 服务器端已彻底擦除私钥明文，请妥善保存该私钥文件。</div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2">
              <div className="flex items-center space-x-2">
                <button type="button" onClick={() => onDownloadPrivateKey(generatedKeyResult.privateKey, generatedKeyResult.filename)} className="flex items-center space-x-1.5 rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-700"><Download className="h-3.5 w-3.5" /><span>再次下载私钥</span></button>
                <button type="button" onClick={copyPrivateKey} className="flex items-center space-x-1.5 rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-700">{copiedKeyText ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}<span>{copiedKeyText ? '已复制私钥' : '复制私钥文本'}</span></button>
              </div>
              <div className="flex items-center space-x-2">
                <button type="button" onClick={copyConnectionCommand} className="flex items-center space-x-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 shadow-md shadow-amber-500/20 transition hover:bg-amber-400">{copiedKeyCmd ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}<span>{copiedKeyCmd ? '已复制命令' : '一键复制完整连接命令'}</span></button>
                <button type="button" onClick={onCloseKeyModal} className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700">关闭</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showImportKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-lg space-y-4 rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3"><h3 className="flex items-center space-x-2 text-base font-bold text-white"><Plus className="h-4 w-4 text-emerald-400" /><span>导入已有 SSH 公钥到 Root 授权列表</span></h3><button type="button" onClick={onCloseImportKeyModal} className="rounded-lg p-1 text-slate-400 hover:text-white"><X className="h-5 w-5" /></button></div>
            <p className="text-xs text-slate-400">请粘贴您本地生成的公钥（通常位于 <code>~/.ssh/id_ed25519.pub</code> 或 <code>~/.ssh/id_rsa.pub</code>）：</p>
            <form onSubmit={onAddAuthorizedKey} className="space-y-4">
              <textarea value={importKeyText} onChange={(event) => onImportKeyTextChange(event.target.value)} placeholder="ssh-ed25519 AAAA... 用户名@设备名" className="h-32 w-full resize-none rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 font-mono text-xs leading-relaxed text-white focus:border-sky-500 focus:outline-none" required autoFocus />
              <div className="flex justify-end space-x-2 pt-2"><button type="button" onClick={onCloseImportKeyModal} className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white">取消</button><button type="submit" disabled={importingKey || !importKeyText.trim()} className="flex items-center space-x-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white transition hover:bg-emerald-500 disabled:opacity-50">{importingKey && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}<span>{importingKey ? '导入中...' : '确认导入公钥'}</span></button></div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
