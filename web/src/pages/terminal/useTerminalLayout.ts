import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { FitAddon } from '@xterm/addon-fit';

interface UseTerminalLayoutOptions {
  terminalRef: RefObject<HTMLDivElement | null>;
  fitAddonRef: RefObject<FitAddon | null>;
  wsRef: RefObject<WebSocket | null>;
  layoutKey: string;
}

const fitTerminal = (fitAddonRef: RefObject<FitAddon | null>, wsRef: RefObject<WebSocket | null>) => {
  if (!fitAddonRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
  try {
    fitAddonRef.current.fit();
    const dimensions = fitAddonRef.current.proposeDimensions();
    if (dimensions) wsRef.current.send(JSON.stringify({ type: 'resize', rows: dimensions.rows, cols: dimensions.cols }));
  } catch {
    // The terminal may be disposing while layout changes are being delivered.
  }
};

export const useTerminalLayout = ({ terminalRef, fitAddonRef, wsRef, layoutKey }: UseTerminalLayoutOptions) => {
  useEffect(() => {
    const timer = window.setTimeout(() => fitTerminal(fitAddonRef, wsRef), 150);
    return () => window.clearTimeout(timer);
  }, [fitAddonRef, wsRef, layoutKey]);

  useEffect(() => {
    const element = terminalRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => requestAnimationFrame(() => fitTerminal(fitAddonRef, wsRef)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [terminalRef, fitAddonRef, wsRef]);
};
