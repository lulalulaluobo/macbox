import React, { useState, useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { X, Maximize2, Minimize2, RefreshCw, Box } from 'lucide-react';
import { TerminalInputBar } from '../terminal/TerminalInputBar';

interface ContainerTerminalModalProps {
  containerName: string | null;
  onClose: () => void;
}

export const ContainerTerminalModal: React.FC<ContainerTerminalModalProps> = ({
  containerName,
  onClose,
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [connected, setConnected] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!containerName) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      lineHeight: 1.25,
      theme: {
        background: '#090d16',
        foreground: '#f8fafc',
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

    if (terminalRef.current) {
      term.open(terminalRef.current);
      fitAddon.fit();
    }

    xtermInstance.current = term;
    fitAddonRef.current = fitAddon;

    // WebSocket connection with ?container= query parameter
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsParams = new URLSearchParams({ container: containerName });
    const wsUrl = `${protocol}//${window.location.host}/api/terminal/ws?${wsParams.toString()}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      term.write(`\r\n\x1b[36m[MacBox] 已通过 docker exec 成功进入容器 [${containerName}] 终端会话！\x1b[0m\r\n\r\n`);
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        ws.send(JSON.stringify({ type: 'resize', rows: dims.rows, cols: dims.cols }));
      }
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        term.write(event.data);
      } else {
        term.write(new Uint8Array(event.data));
      }
    };

    ws.onclose = () => {
      setConnected(false);
      term.write(`\r\n\x1b[33m[MacBox] 容器 [${containerName}] 终端连接已退出或断开。\x1b[0m\r\n`);
    };

    ws.onerror = () => {
      setConnected(false);
      term.write(`\r\n\x1b[31m[MacBox] 连接容器终端出现异常，请确认容器是否处于运行状态。\x1b[0m\r\n`);
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    const handleResize = () => {
      try {
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', rows: dims.rows, cols: dims.cols }));
        }
      } catch (e) {
        // ignore
      }
    };

    window.addEventListener('resize', handleResize);
    const timer = setTimeout(handleResize, 150);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
      if (wsRef.current) {
        wsRef.current.close();
      }
      term.dispose();
    };
  }, [containerName]);

  if (!containerName) return null;

  const handleSendRaw = (data: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-0 sm:p-5">
      <div
        className={`terminal-dark-preserve flex h-[100dvh] w-full flex-col overflow-hidden bg-[#090d16] shadow-2xl transition-[height,max-width] duration-200 sm:rounded-2xl sm:border sm:border-slate-800 ${
          fullscreen ? 'sm:h-[96dvh] sm:max-w-[96vw]' : 'sm:h-[88dvh] sm:max-w-5xl'
        }`}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/90 px-3 py-2.5 sm:px-5 sm:py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sky-500/20 bg-sky-500/10 text-sky-400">
              <Box className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-sm font-bold text-white">{containerName}</span>
                <span className={`h-2 w-2 shrink-0 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-500'}`} />
              </div>
              <p className="truncate text-[10px] text-slate-400">{connected ? '终端已连接' : '连接已断开'}</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => xtermInstance.current?.clear()}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 text-slate-300 transition hover:bg-slate-700 hover:text-white"
              title="清屏"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            <button
              onClick={() => setFullscreen(!fullscreen)}
              className="hidden h-10 w-10 items-center justify-center rounded-xl bg-slate-800 text-slate-300 transition hover:bg-slate-700 hover:text-white sm:flex"
              title={fullscreen ? '还原窗口' : '全屏模式'}
            >
              {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            <button
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-800 text-slate-300 transition hover:bg-rose-950/60 hover:text-rose-400"
              title="关闭终端"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Terminal Canvas */}
        <div
          ref={terminalRef}
          className="min-h-0 flex-1 overflow-hidden bg-[#090d16] p-2 font-mono sm:p-3"
        />

        {/* Bottom Text Input & Virtual Action Keys */}
        <TerminalInputBar
          onSendRaw={handleSendRaw}
          disabled={!connected}
          placeholder="输入命令…"
        />
      </div>
    </div>
  );
};
