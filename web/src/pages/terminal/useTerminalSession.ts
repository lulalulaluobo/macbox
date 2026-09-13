import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { api } from '../../api';

export type TerminalLoginUser = 'root' | 'default';

interface UseTerminalSessionOptions {
  terminalRef: React.RefObject<HTMLDivElement | null>;
  onSwitchToDefault?: () => void;
}

export const useTerminalSession = ({ terminalRef, onSwitchToDefault }: UseTerminalSessionOptions) => {
  const xtermInstance = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const connectionGenerationRef = useRef(0);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionClosed, setSessionClosed] = useState(false);
  const [loginUser, setLoginUser] = useState<TerminalLoginUser>('default');

  const initTerminal = useCallback((userToUse?: TerminalLoginUser) => {
    if (!terminalRef.current) return;

    const generation = ++connectionGenerationRef.current;
    const targetUser = userToUse || loginUser;
    setSessionClosed(false);
    setConnected(false);
    resizeCleanupRef.current?.();
    resizeCleanupRef.current = null;

    xtermInstance.current?.dispose();
    wsRef.current?.close();

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#090d16',
        foreground: '#e2e8f0',
        cursor: '#38bdf8',
        selectionBackground: 'rgba(56, 189, 248, 0.3)',
        black: '#0f172a',
        red: '#f43f5e',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#d946ef',
        cyan: '#06b6d4',
        white: '#f8fafc',
        brightBlack: '#475569',
        brightRed: '#fb7185',
        brightGreen: '#34d399',
        brightYellow: '#fbbf24',
        brightBlue: '#60a5fa',
        brightMagenta: '#e879f9',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();
    xtermInstance.current = term;
    fitAddonRef.current = fitAddon;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsParams = new URLSearchParams({ user: targetUser });
    const sessionStorageKey = `macbox_terminal_session:${window.location.host}:${targetUser}`;
    const savedSessionID = window.sessionStorage.getItem(sessionStorageKey);
    if (savedSessionID) wsParams.set('session', savedSessionID);
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/terminal/ws?${wsParams.toString()}`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      const userBadge = targetUser === 'root' ? '\x1b[1;33m[👑 root 超级管理员]\x1b[0;36m' : '\x1b[1;32m[👤 普通用户 (macbox)]\x1b[0;36m';
      term.write(`\r\n\x1b[36m[MacBox] 已以 ${userBadge} 身份成功连接到 Linux 虚拟机交互终端！\x1b[0m\r\n\r\n`);
      const dims = fitAddon.proposeDimensions();
      if (dims) ws.send(JSON.stringify({ type: 'resize', rows: dims.rows, cols: dims.cols }));
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const control = JSON.parse(event.data) as { type?: string; id?: string; resumed?: boolean };
          if (control.type === 'session' && control.id) {
            window.sessionStorage.setItem(sessionStorageKey, control.id);
            sessionIdRef.current = control.id;
            setSessionId(control.id);
            term.write(control.resumed
              ? '\r\n\x1b[32m[MacBox] 已恢复之前的终端任务和输出记录。\x1b[0m\r\n'
              : '\r\n\x1b[36m[MacBox] 已创建可恢复的终端任务会话。\x1b[0m\r\n');
            return;
          }
        } catch {
          // PTY output is usually plain text; non-JSON output goes straight to xterm.
        }
        term.write(event.data);
      } else {
        term.write(new Uint8Array(event.data));
      }
    };

    ws.onclose = () => {
      if (generation !== connectionGenerationRef.current) return;
      setConnected(false);
      term.write('\r\n\x1b[33m[MacBox] 终端连接已断开。\x1b[0m\r\n');
    };
    ws.onerror = () => {
      if (generation !== connectionGenerationRef.current) return;
      setConnected(false);
      term.write('\r\n\x1b[31m[MacBox] 终端连接异常。\x1b[0m\r\n');
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    const handleResize = () => {
      try {
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', rows: dims.rows, cols: dims.cols }));
        }
      } catch {
        // The terminal may be disposing while the window is resizing.
      }
    };
    window.addEventListener('resize', handleResize);
    resizeCleanupRef.current = () => window.removeEventListener('resize', handleResize);
  }, [loginUser, terminalRef]);

  const switchUser = useCallback((newUser: TerminalLoginUser) => {
    const oldKey = `macbox_terminal_session:${window.location.host}:${loginUser}`;
    window.sessionStorage.removeItem(oldKey);
    sessionIdRef.current = null;
    setSessionId(null);
    setLoginUser(newUser);
    if (newUser !== 'root') onSwitchToDefault?.();
    initTerminal(newUser);
  }, [initTerminal, loginUser, onSwitchToDefault]);

  const reconnect = useCallback(() => {
    const key = `macbox_terminal_session:${window.location.host}:${loginUser}`;
    window.sessionStorage.removeItem(key);
    sessionIdRef.current = null;
    setSessionId(null);
    initTerminal(loginUser);
  }, [initTerminal, loginUser]);

  const closeSession = useCallback(async () => {
    const id = sessionIdRef.current;
    if (id) {
      try {
        await api.closeTerminalSession(id);
      } catch {
        // The VM may already have been restarted; clearing the local reference
        // still allows the next reconnect to create a fresh session.
      }
    }
    const key = `macbox_terminal_session:${window.location.host}:${loginUser}`;
    window.sessionStorage.removeItem(key);
    sessionIdRef.current = null;
    setSessionId(null);
    connectionGenerationRef.current += 1;
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
    setSessionClosed(true);
    xtermInstance.current?.write('\r\n\x1b[33m[MacBox] 当前终端会话已关闭。点击“重连”创建新会话。\x1b[0m\r\n');
  }, [loginUser]);

  const sendRaw = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(data);
  }, []);

  useEffect(() => {
    api.getTerminalSettings()
      .then((settings) => {
        const user: TerminalLoginUser = settings.defaultLoginUser === 'root' ? 'root' : 'default';
        setLoginUser(user);
        initTerminal(user);
      })
      .catch(() => initTerminal('default'));

    return () => {
      resizeCleanupRef.current?.();
      wsRef.current?.close();
      xtermInstance.current?.dispose();
      wsRef.current = null;
      xtermInstance.current = null;
    };
  }, []);

  return {
    xtermInstance,
    fitAddonRef,
    wsRef,
    connected,
    sessionId,
    sessionClosed,
    loginUser,
    switchUser,
    reconnect,
    closeSession,
    sendRaw,
  };
};
