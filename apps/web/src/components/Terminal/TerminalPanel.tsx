import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { Terminal as TermIcon, Trash2 } from 'lucide-react';
import { useAgentStore, useShallow } from '../../store/useAgentStore.js';

export const TerminalPanel: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const { sendTerminalInput, resizeTerminal, registerTerminalDataCallback } =
    useAgentStore(
      useShallow((s) => ({
        sendTerminalInput: s.sendTerminalInput,
        resizeTerminal: s.resizeTerminal,
        registerTerminalDataCallback: s.registerTerminalDataCallback,
      }))
    );

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      theme: {
        background: '#0F172A',
        foreground: '#F8FAFC',
        cursor: '#93C5FD',
        cursorAccent: '#0F172A',
        selectionBackground: 'rgba(147, 197, 253, 0.28)',
        black: '#1E293B',
        red: '#F87171',
        green: '#86EFAC',
        yellow: '#FDE047',
        blue: '#93C5FD',
        magenta: '#A78BFA',
        cyan: '#38BDF8',
        white: '#F8FAFC',
        brightBlack: '#475569',
        brightRed: '#FCA5A5',
        brightGreen: '#A7F3D0',
        brightYellow: '#FEF08A',
        brightBlue: '#BFDBFE',
        brightMagenta: '#DDD6FE',
        brightCyan: '#7DD3FC',
        brightWhite: '#FFFFFF',
      },
      fontFamily: '"Fira Code", "JetBrains Mono", Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.3,
      cursorBlink: true,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    term.onData((data) => {
      sendTerminalInput(data);
    });

    term.onResize(({ cols, rows }) => {
      resizeTerminal(cols, rows);
    });

    registerTerminalDataCallback((data: string) => {
      term.write(data);
    });

    const handleResize = () => {
      try {
        fitAddon.fit();
      } catch {}
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, []);

  const handleClear = () => {
    termRef.current?.clear();
  };

  return (
    <div className="flex h-52 flex-col border-t border-[#1E293B] bg-[#0F172A] select-none shadow-2xl">
      <div className="flex h-8 items-center justify-between border-b border-[#334155] px-3.5 bg-[#1E293B] text-xs text-slate-400">
        <div className="flex items-center space-x-2 font-mono text-[11.5px] text-slate-200">
          <TermIcon className="h-3.5 w-3.5 text-[#93C5FD]" />
          <span className="font-semibold text-slate-100">Terminal</span>
          <span className="rounded bg-[#0F172A] px-1.5 py-0.2 text-[10px] text-[#93C5FD] border border-[#334155] font-medium">
            PTY Shell
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleClear}
            className="rounded-md p-1 text-slate-400 hover:bg-[#0F172A] hover:text-slate-200 transition-colors cursor-pointer"
            title="Clear Terminal"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden bg-[#0F172A]" ref={containerRef} />
    </div>
  );
};
