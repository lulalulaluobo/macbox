import React from 'react';

interface TerminalViewportProps {
  terminalRef: React.Ref<HTMLDivElement>;
}

export const TerminalViewport: React.FC<TerminalViewportProps> = ({ terminalRef }) => (
  <div ref={terminalRef} className="terminal-viewport h-full min-h-0 min-w-0 overflow-hidden bg-[#090d16] font-mono" />
);
