import React from 'react';
import { Check, FolderOpen, RefreshCw, Sparkles, Terminal } from 'lucide-react';
import { TerminalSettings, TerminalSkillsSettings } from '../../types';

export interface TerminalSettingsSectionProps {
  terminalSettings: TerminalSettings;
  termSaving: boolean;
  terminalSkills: TerminalSkillsSettings;
  skillsEnabled: boolean;
  skillsHostPath: string;
  skillsRiskConfirmed: boolean;
  skillsSaving: boolean;
  onSaveTerminalSettings: (userChoice: 'root' | 'default') => void;
  onSaveTerminalSkills: () => void;
  onUseSkillsCandidate: (hostPath: string) => void;
  onSkillsRiskConfirmedChange: (confirmed: boolean) => void;
  onToggleSkills: () => void;
  onSkillsHostPathChange: (hostPath: string) => void;
}

export const TerminalSettingsSection: React.FC<TerminalSettingsSectionProps> = ({
  terminalSettings,
  termSaving,
  terminalSkills,
  skillsEnabled,
  skillsHostPath,
  skillsRiskConfirmed,
  skillsSaving,
  onSaveTerminalSettings,
  onSaveTerminalSkills,
  onUseSkillsCandidate,
  onSkillsRiskConfirmedChange,
  onToggleSkills,
  onSkillsHostPathChange,
}) => (
  <div className="max-w-2xl bg-slate-900/70 p-6 rounded-3xl border border-slate-800/80 shadow-xl space-y-6">
    <div className="flex items-start space-x-3.5">
      <div className="w-12 h-12 rounded-2xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-300 shrink-0">
        <Terminal className="w-6 h-6" />
      </div>
      <div>
        <h3 className="text-lg font-bold text-white">终端默认登录身份设置</h3>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
          设置每次打开 Web 终端页面、或一键进入容器终端时，系统默认直接以 <strong>Root 身份</strong> 还是 <strong>普通用户身份</strong> 进入交互式 Shell。
        </p>
      </div>
    </div>

    <div className="space-y-3 pt-2">
      <div
        onClick={() => onSaveTerminalSettings('root')}
        className={`p-4 rounded-2xl border cursor-pointer transition flex items-start space-x-3.5 ${
          terminalSettings.defaultLoginUser === 'root'
            ? 'bg-amber-500/10 border-amber-500/40 shadow-lg shadow-amber-500/10'
            : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
        }`}
      >
        <div className="pt-0.5">
          <input
            type="radio"
            name="loginUser"
            checked={terminalSettings.defaultLoginUser === 'root'}
            onChange={() => onSaveTerminalSettings('root')}
            className="text-amber-500 focus:ring-0 cursor-pointer"
          />
        </div>
        <div className="flex-1 space-y-1">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-sm text-white">以 Root 身份直接登录 (高权限推荐)</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono font-semibold">
              sudo -i / #
            </span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            进入终端时自动提升为 root 超级管理员，具有整个系统的全部读写权限，免去频繁输入 sudo 的麻烦，适合系统深度维护与安装软件包。
          </p>
        </div>
      </div>

      <div
        onClick={() => onSaveTerminalSettings('default')}
        className={`p-4 rounded-2xl border cursor-pointer transition flex items-start space-x-3.5 ${
          terminalSettings.defaultLoginUser === 'default'
            ? 'bg-sky-500/10 border-sky-500/40 shadow-lg shadow-sky-500/10'
            : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
        }`}
      >
        <div className="pt-0.5">
          <input
            type="radio"
            name="loginUser"
            checked={terminalSettings.defaultLoginUser === 'default'}
            onChange={() => onSaveTerminalSettings('default')}
            className="text-sky-500 focus:ring-0 cursor-pointer"
          />
        </div>
        <div className="flex-1 space-y-1">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-sm text-white">以普通用户身份登录 (安全防误删)</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 font-mono font-semibold">
              Lima 管理用户 / $
            </span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            默认以当前普通用户登录，防止命令敲错误删系统核心目录，需要执行特权命令时可自行手动输入 sudo。
          </p>
        </div>
      </div>
    </div>

    <div className="rounded-2xl border border-violet-500/25 bg-violet-500/[0.06] p-4 shadow-lg shadow-violet-500/[0.04] sm:p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-400/30 bg-violet-400/10 text-violet-300">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-bold text-white">AI CLI Skill 目录</h4>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
              terminalSkills.status === 'ready'
                ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                : terminalSkills.status === 'missing' || terminalSkills.status === 'invalid'
                  ? 'border-rose-400/30 bg-rose-400/10 text-rose-300'
                  : 'border-slate-700 bg-slate-800 text-slate-400'
            }`}>
              {terminalSkills.status === 'ready' ? '本机目录已就绪' : terminalSkills.status === 'disabled' ? '未启用' : terminalSkills.message}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            将 Mac 本机的 Skill 目录以只读方式映射到 VM 的 <code className="rounded bg-slate-950/70 px-1 py-0.5 text-violet-300">.agents/skills</code>、<code className="rounded bg-slate-950/70 px-1 py-0.5 text-violet-300">.claude/skills</code> 和 <code className="rounded bg-slate-950/70 px-1 py-0.5 text-violet-300">.codex/skills</code>，终端里的 Codex、Claude 等 AI CLI 可以直接调用。目录不会被 AI CLI 修改。
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-[11px] leading-relaxed text-amber-200">
          <div className="font-bold text-amber-100">安全提示：这是本机目录映射</div>
          <div className="mt-1">只选择专门存放 Skill 的目录。不要选择用户主目录、.ssh、钥匙串、浏览器资料或任何包含密码、Token、私钥的目录；启用后该目录会以只读方式暴露给 VM 中的 AI CLI。</div>
          <label className="mt-2 flex cursor-pointer items-start gap-2 font-semibold text-amber-100">
            <input
              type="checkbox"
              checked={skillsRiskConfirmed}
              onChange={(event) => onSkillsRiskConfirmedChange(event.target.checked)}
              className="mt-0.5 rounded border-amber-300 bg-transparent text-amber-500 focus:ring-amber-400"
            />
            <span>我确认所选目录仅包含可供 AI CLI 使用的 Skill 文件</span>
          </label>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5">
          <div>
            <div className="text-xs font-semibold text-slate-200">启用 Skill 映射</div>
            <div className="mt-0.5 text-[11px] text-slate-500">下次启动或重启 VM 后挂载到终端</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={skillsEnabled}
            onClick={onToggleSkills}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition ${skillsEnabled ? 'bg-violet-500' : 'bg-slate-700'}`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition ${skillsEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-slate-300">Mac 本机 Skill 目录</span>
          <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 focus-within:border-violet-400">
            <FolderOpen className="h-4 w-4 shrink-0 text-violet-300" />
            <input
              value={skillsHostPath}
              onChange={(event) => onSkillsHostPathChange(event.target.value)}
              placeholder="例如：/Users/你的用户名/.agents/skills"
              className="min-w-0 flex-1 bg-transparent font-mono text-xs text-white outline-none placeholder:text-slate-600"
              spellCheck={false}
            />
          </div>
        </label>

        {terminalSkills.candidates.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>服务器本机扫描到的候选目录</span>
              <span>可用目录可直接选用</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {terminalSkills.candidates.map((candidate) => (
                <button
                  key={candidate.hostPath}
                  type="button"
                  disabled={!candidate.available}
                  onClick={() => onUseSkillsCandidate(candidate.hostPath)}
                  className={`min-w-0 rounded-xl border p-2.5 text-left transition ${
                    candidate.available
                      ? skillsHostPath === candidate.hostPath
                        ? 'border-violet-400/60 bg-violet-400/10'
                        : 'border-slate-800 bg-slate-950/50 hover:border-violet-400/40 hover:bg-violet-400/[0.06]'
                      : 'cursor-not-allowed border-slate-800/60 bg-slate-950/30 opacity-50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-violet-300" />
                    <span className="truncate">{candidate.name}</span>
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] text-slate-500" title={candidate.hostPath}>{candidate.hostPath}</div>
                  <div className={`mt-1 text-[10px] ${candidate.available ? 'text-emerald-300' : 'text-slate-600'}`}>
                    {candidate.available ? `${candidate.skillCount} 个 Skill 目录` : candidate.reason}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 rounded-xl border border-slate-800/80 bg-slate-950/40 p-3 text-[11px] leading-relaxed text-slate-500 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div>VM 映射位置：<code className="text-slate-300">.agents/skills</code>、<code className="text-slate-300">.claude/skills</code>、<code className="text-slate-300">.codex/skills</code>（普通用户与 root 均已映射）</div>
            <div className="mt-1">纯 Web 访问时，浏览器目录选择器只能读取手机/当前设备，不能代表运行 Mac；因此这里由 MacNAS 在服务器本机自动扫描。</div>
          </div>
          <span className="shrink-0 text-emerald-300">只读映射</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {terminalSkills.requiresRestart ? (
            <span className="text-[11px] font-semibold text-amber-300">配置已保存，请下次启动或重启虚拟机使映射生效</span>
          ) : <span />}
          <button
            type="button"
            onClick={onSaveTerminalSkills}
            disabled={skillsSaving || (skillsEnabled && (!skillsHostPath.trim() || !skillsRiskConfirmed))}
            className="flex items-center gap-1.5 rounded-xl bg-violet-500 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {skillsSaving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            <span>保存 Skill 映射</span>
          </button>
        </div>
      </div>
    </div>

    <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-400 flex items-center justify-between">
      <span>当前默认配置: <strong className="font-mono text-white font-bold">{terminalSettings.defaultLoginUser === 'root' ? '👑 root 超级管理员' : '👤 普通用户'}</strong></span>
      {termSaving && <span className="text-sky-400 flex items-center space-x-1"><RefreshCw className="w-3 h-3 animate-spin" /><span>保存中...</span></span>}
    </div>
  </div>
);
