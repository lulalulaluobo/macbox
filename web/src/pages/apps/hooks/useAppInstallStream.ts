import { useEffect, useRef, useState } from 'react';
import { InstallCustomConfig } from '../../../types';

export type AppInstallStatus = 'idle' | 'installing' | 'done' | 'error';

export interface UseAppInstallStreamOptions {
  appId?: string;
  portsMap: Record<string, number>;
  volumesMap: Record<string, string>;
  envMap: Record<string, string>;
  useYamlMode: boolean;
  customYaml: string;
}

export const useAppInstallStream = ({
  appId,
  portsMap,
  volumesMap,
  envMap,
  useYamlMode,
  customYaml,
}: UseAppInstallStreamOptions) => {
  const [installStatus, setInstallStatus] = useState<AppInstallStatus>('idle');
  const [installLogs, setInstallLogs] = useState<string[]>([]);
  const [installError, setInstallError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setInstallStatus('idle');
    setInstallLogs([]);
    setInstallError(null);

    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, [appId]);

  const startDeploy = async () => {
    if (!appId) return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setInstallStatus('installing');
    setInstallLogs(["正在提交安装设置"]);
    setInstallError(null);

    const payload: InstallCustomConfig = {
      portsMap,
      volumesMap,
      envMap,
      customYaml: useYamlMode ? customYaml : undefined,
    };

    try {
      const response = await fetch(`/api/apps/${appId}/install/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(response.statusText || "请求未完成，请重试");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamCompleted = false;
      let streamFailed = false;

      const processStreamLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        if (trimmed.startsWith('data:')) {
          const dataStr = trimmed.slice(5).trim();
          if (dataStr) setInstallLogs((previous) => [...previous, dataStr]);
        } else if (trimmed === 'event: done') {
          streamCompleted = true;
          setInstallStatus('done');
        } else if (trimmed === 'event: error') {
          streamFailed = true;
          setInstallStatus('error');
          setInstallError("安装出错，请查看安装记录");
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        lines.forEach(processStreamLine);
      }

      buffer += decoder.decode();
      processStreamLine(buffer);

      if (!streamCompleted && !streamFailed) {
        setInstallError("连接已结束，安装结果暂未确认。\n请保留记录并检查应用状态。\n确认后再决定是否重试。");
        setInstallStatus('error');
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "安装连接已断开";
      setInstallError(message || "安装连接已断开");
      setInstallStatus('error');
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
    }
  };

  return { installStatus, installLogs, installError, startDeploy };
};
