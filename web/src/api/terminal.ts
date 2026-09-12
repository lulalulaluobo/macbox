import type { TerminalSettings, TerminalSkillsSettings } from '../types';
import { BASE_URL, fetchJSON } from './client';

export const terminalApi = {
  closeTerminalSession: (id: string) => fetchJSON<{ status: string; closed: boolean }>(`${BASE_URL}/terminal/session/close`, {
    method: 'POST',
    body: JSON.stringify({ id }),
  }),

  // Terminal Settings
  getTerminalSettings: () => fetchJSON<TerminalSettings>(`${BASE_URL}/system/terminal/settings`),
  updateTerminalSettings: (settings: TerminalSettings) =>
    fetchJSON<{ status: string; message: string }>(`${BASE_URL}/system/terminal/settings`, {
      method: 'POST',
      body: JSON.stringify(settings),
    }),
  getTerminalSkills: () => fetchJSON<TerminalSkillsSettings>(`${BASE_URL}/system/terminal/skills`),
  updateTerminalSkills: (settings: { enabled: boolean; hostPath: string; confirmRisk: boolean }) =>
    fetchJSON<{ status: string; message: string; requiresRestart: boolean; settings: TerminalSkillsSettings }>(`${BASE_URL}/system/terminal/skills`, {
      method: 'POST',
      body: JSON.stringify(settings),
    }),
};
