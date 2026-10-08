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
        <h3 className="text-lg font-bold text-white">默认账号</h3>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
          选择打开命令窗口时使用的账号 <strong>最高权限</strong> 或 <strong>普通账号</strong> 用于执行命令
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
            <span className="font-bold text-sm text-white">最高权限</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono font-semibold">
              sudo -i / #
            </span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            可直接修改系统和安装软件。<br />错误命令也会直接生效。
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
            <span className="font-bold text-sm text-white">普通账号</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 font-mono font-semibold">
              运行系统的普通账号
            </span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            以普通账号登录，管理时需提升权限
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
            <h4 className="text-sm font-bold text-white">助手技能</h4>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
              terminalSkills.status === 'ready'
                ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                : terminalSkills.status === 'missing' || terminalSkills.status === 'invalid'
                  ? 'border-rose-400/30 bg-rose-400/10 text-rose-300'
                  : 'border-slate-700 bg-slate-800 text-slate-400'
            }`}>
              {terminalSkills.status === 'ready' ? "已就绪" : terminalSkills.status === 'disabled' ? '未启用' : terminalSkills.message}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            让命令助手读取Mac上的技能文件 <code className="rounded bg-slate-950/70 px-1 py-0.5 text-violet-300">.agents/skills</code>、<code className="rounded bg-slate-950/70 px-1 py-0.5 text-violet-300">.claude/skills</code> 和 <code className="rounded bg-slate-950/70 px-1 py-0.5 text-violet-300">.codex/skills</code>可供命令助手使用，不能写入原目录
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-[11px] leading-relaxed text-amber-200">
          <div className="font-bold text-amber-100">读取提醒</div>
          <div className="mt-1">只选择专门存放技能的文件夹。<br />不要选择个人主目录或浏览器资料。<br />也不要选择钥匙串或.ssh目录。<br />不要接入含密码、令牌或私钥的目录。<br />启用后命令助手可以读取这些文件。</div>
          <label className="mt-2 flex cursor-pointer items-start gap-2 font-semibold text-amber-100">
            <input
              type="checkbox"
              checked={skillsRiskConfirmed}
              onChange={(event) => onSkillsRiskConfirmedChange(event.target.checked)}
              className="mt-0.5 rounded border-amber-300 bg-transparent text-amber-500 focus:ring-amber-400"
            />
            <span>我确认此目录只含可供助手使用的技能</span>
          </label>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5">
          <div>
            <div className="text-xs font-semibold text-slate-200">接入技能</div>
            <div className="mt-0.5 text-[11px] text-slate-500">下次启动或重启系统后生效</div>
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
          <span className="text-xs font-semibold text-slate-300">技能目录</span>
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
              <span>本机目录</span>
              <span>选择一个已找到的目录</span>
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
                    {candidate.available ? `${candidate.skillCount}个技能目录` : candidate.reason}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 rounded-xl border border-slate-800/80 bg-slate-950/40 p-3 text-[11px] leading-relaxed text-slate-500 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div>系统位置<code className="text-slate-300">.agents/skills</code>、<code className="text-slate-300">.claude/skills</code>、<code className="text-slate-300">.codex/skills</code>普通账号和最高权限账号都可使用</div>
            <div className="mt-1">此处只查找运行MacBox的Mac。<br />其他设备的文件夹不能在此选择。</div>
          </div>
          <span className="shrink-0 text-emerald-300">只能读取</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {terminalSkills.requiresRestart ? (
            <span className="text-[11px] font-semibold text-amber-300">设置已保存，启动或重启系统后生效</span>
          ) : <span />}
          <button
            type="button"
            onClick={onSaveTerminalSkills}
            disabled={skillsSaving || (skillsEnabled && (!skillsHostPath.trim() || !skillsRiskConfirmed))}
            className="flex items-center gap-1.5 rounded-xl bg-violet-500 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {skillsSaving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            <span>保存设置</span>
          </button>
        </div>
      </div>
    </div>

    <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-400 flex items-center justify-between">
      <span>默认账号 <strong className="font-mono text-white font-bold">{terminalSettings.defaultLoginUser === 'root' ? "最高权限" : "普通账号"}</strong></span>
      {termSaving && <span className="text-sky-400 flex items-center space-x-1"><RefreshCw className="w-3 h-3 animate-spin" /><span>保存中</span></span>}
    </div>
  </div>
);
