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
    const wsUrl = `${protocol}//${window.location.host}/api/terminal/ws?container=${encodeURIComponent(containerName)}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      term.write(`\r\n\x1b[36m[MacNAS] 已通过 docker exec 成功进入容器 [${containerName}] 终端会话！\x1b[0m\r\n\r\n`);
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
      term.write(`\r\n\x1b[33m[MacNAS] 容器 [${containerName}] 终端连接已退出或断开。\x1b[0m\r\n`);
    };

    ws.onerror = () => {
      setConnected(false);
      term.write(`\r\n\x1b[31m[MacNAS] 连接容器终端出现异常，请确认容器是否处于运行状态。\x1b[0m\r\n`);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className={`terminal-dark-preserve w-full flex flex-col rounded-2xl bg-[#090d16] border border-slate-800 shadow-2xl overflow-hidden transition-all duration-300 ${
          fullscreen ? 'h-[96vh] max-w-[96vw]' : 'h-[85vh] max-w-5xl'
        }`}
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <Box className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-sm text-white font-mono">{containerName}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold">
                  docker exec
                </span>
              </div>
              <p className="text-[11px] text-slate-400">交互式容器命令终端 (自动兼容 /bin/bash 与 /bin/sh)</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700/80 text-[11px] font-mono mr-2">
              <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
              <span className="text-slate-300">{connected ? '终端在线' : '连接中断'}</span>
            </div>

            <button
              onClick={() => xtermInstance.current?.clear()}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
              title="清屏"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            <button
              onClick={() => setFullscreen(!fullscreen)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
              title={fullscreen ? '还原窗口' : '全屏模式'}
            >
              {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 border border-slate-700/80 transition"
              title="关闭终端"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Terminal Canvas */}
        <div
          ref={terminalRef}
          className="flex-1 p-3 bg-[#090d16] overflow-hidden font-mono"
        />

        {/* Bottom Text Input & Virtual Action Keys */}
        <TerminalInputBar
          onSendRaw={handleSendRaw}
          disabled={!connected}
          placeholder="向此容器终端发送指令 (Enter 发送，Shift+Enter 换行)..."
        />
      </div>
    </div>
  );
};
