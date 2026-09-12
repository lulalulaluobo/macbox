import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Sparkles,
  CornerDownLeft,
  Eraser,
} from 'lucide-react';

interface TerminalInputBarProps {
  onSendRaw: (data: string) => void;
  disabled?: boolean;
  placeholder?: string;
  prefill?: { id: number; text: string } | null;
}

export const TerminalInputBar: React.FC<TerminalInputBarProps> = ({
  onSendRaw,
  disabled = false,
  placeholder = '在此输入文本、长命令或与终端 LLM 对话 (Enter 发送，Shift+Enter 换行)...',
  prefill = null,
}) => {
  const [inputText, setInputText] = useState('');
  const [isMultiline, setIsMultiline] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!prefill) return;
    setInputText(prefill.text);
    setIsMultiline(true);
    setHistoryIndex(-1);
  }, [prefill?.id]);

  // Send input content to terminal
  const handleSend = () => {
    if (disabled || !inputText.trim()) return;

    // Send the text followed by carriage return \r
    onSendRaw(inputText + '\r');

    // Save to local history
    setHistory((prev) => [inputText, ...prev.slice(0, 49)]);
    setHistoryIndex(-1);
    setInputText('');

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === 'ArrowUp' && !isMultiline && inputText === '') {
      e.preventDefault();
      handleHistoryNavigate(1);
    } else if (e.key === 'ArrowDown' && !isMultiline) {
      e.preventDefault();
      handleHistoryNavigate(-1);
    }
  };

  const handleHistoryNavigate = (direction: number) => {
    if (history.length === 0) return;
    const newIdx = historyIndex + direction;
    if (newIdx >= 0 && newIdx < history.length) {
      setHistoryIndex(newIdx);
      setInputText(history[newIdx]);
    } else if (newIdx < 0) {
      setHistoryIndex(-1);
      setInputText('');
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setInputText((prev) => prev + text);
        if (text.includes('\n')) {
          setIsMultiline(true);
        }
      }
    } catch (err) {
      // ignore
    }
  };

  // Adjust textarea height
  useEffect(() => {
    if (textareaRef.current) {
      if (isMultiline) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
      } else {
        textareaRef.current.style.height = '40px';
      }
    }
  }, [inputText, isMultiline]);

  return (
    <div className="terminal-dark-preserve shrink-0 space-y-1.5 border-t border-slate-800/90 bg-[#090d16] p-2 sm:space-y-2 sm:p-3">
      {/* 1. Virtual Control Keypad Bar (对标移动与桌面级终端按键条) */}
      <div className="flex touch-pan-x items-center gap-2 overflow-x-auto overscroll-x-contain scrollbar-none select-none [-webkit-overflow-scrolling:touch]">
        <div className="flex shrink-0 items-center space-x-1.5 rounded-xl border border-slate-800/90 bg-slate-900/90 p-1 shadow-inner">
          {/* Arrow Keys */}
          <button
            type="button"
            onClick={() => onSendRaw('\x1b[A')}
            disabled={disabled}
            className="p-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-mono transition flex items-center justify-center disabled:opacity-40"
            title="历史上一条 (↑)"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onSendRaw('\x1b[B')}
            disabled={disabled}
            className="p-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-mono transition flex items-center justify-center disabled:opacity-40"
            title="历史下一条 (↓)"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onSendRaw('\x1b[D')}
            disabled={disabled}
            className="p-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-mono transition flex items-center justify-center disabled:opacity-40"
            title="光标左移 (←)"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onSendRaw('\x1b[C')}
            disabled={disabled}
            className="p-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-mono transition flex items-center justify-center disabled:opacity-40"
            title="光标右移 (→)"
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Shortcuts & Control Keys */}
        <div className="flex shrink-0 items-center space-x-1.5 rounded-xl border border-slate-800/90 bg-slate-900/90 p-1 shadow-inner">
          <button
            type="button"
            onClick={() => onSendRaw('\t')}
            disabled={disabled}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white text-xs font-mono font-semibold transition disabled:opacity-40"
            title="自动补全 (Tab)"
          >
            Tab
          </button>
          <button
            type="button"
            onClick={() => onSendRaw('\x03')}
            disabled={disabled}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/50 active:scale-95 text-rose-300 hover:text-rose-200 text-xs font-mono font-semibold transition disabled:opacity-40"
            title="中断命令 (Ctrl+C)"
          >
            Ctrl+C
          </button>
          <button
            type="button"
            onClick={handlePasteClipboard}
            disabled={disabled}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white text-xs font-mono font-semibold transition disabled:opacity-40"
            title="从剪贴板粘贴文本"
          >
            Ctrl+V
          </button>
          <button
            type="button"
            onClick={() => onSendRaw('\x1a')}
            disabled={disabled}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white text-xs font-mono font-semibold transition disabled:opacity-40"
            title="挂起进程 (Ctrl+Z)"
          >
            Ctrl+Z
          </button>
          <button
            type="button"
            onClick={() => onSendRaw('clear\r')}
            disabled={disabled}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white text-xs font-mono font-semibold transition disabled:opacity-40"
            title="清屏 (clear)"
          >
            清屏
          </button>
        </div>

        {/* Right Mode Switchers */}
        <div className="flex shrink-0 items-center space-x-1.5">
          <button
            type="button"
            onClick={() => setIsMultiline(!isMultiline)}
            className="p-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-sky-300 border border-slate-800 text-xs transition"
            title={isMultiline ? '切换为单行极简输入' : '切换为多行编写模式 (适合 LLM 复杂 Prompt)'}
          >
            {isMultiline ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* 2. Text Input Area (支持长文本、中文、多行 Prompt 顺畅输入) */}
      <div className="flex items-end gap-1.5 rounded-2xl border border-slate-800 bg-slate-950 p-1.5 transition focus-within:border-sky-500/70 sm:gap-2 sm:p-2">
        <div className="hidden flex-shrink-0 p-1.5 text-slate-500 sm:block">
          <Sparkles className="w-4 h-4 text-sky-400" />
        </div>

        <textarea
          ref={textareaRef}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          rows={isMultiline ? 3 : 1}
          className="min-h-[36px] max-h-[120px] min-w-0 flex-1 resize-none bg-transparent py-1.5 font-mono text-xs leading-relaxed text-white placeholder:text-slate-500 focus:outline-none sm:max-h-[160px] sm:text-sm"
        />

        <div className="flex items-center space-x-1.5 pb-0.5 flex-shrink-0">
          {inputText && (
            <button
              type="button"
              onClick={() => setInputText('')}
              className="p-1.5 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-slate-900 transition"
              title="清空输入框"
            >
              <Eraser className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={handleSend}
            disabled={disabled || !inputText.trim()}
            className="flex min-h-10 items-center space-x-1.5 rounded-xl bg-sky-500 px-3 py-2 text-xs font-bold text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-400 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 sm:px-3.5"
            title="发送命令到终端 (Enter)"
          >
            <span>发送</span>
            <CornerDownLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
