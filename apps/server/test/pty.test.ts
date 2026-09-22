import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PTYService } from '../src/services/ptyService.js';

describe('Multi-Session PTY Management & Concurrency Isolation', () => {
  const tempDir = path.resolve('temp_server_test_pty');

  beforeAll(async () => {
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('manages multiple PTY sessions with isolated I/O and dimensions', async () => {
    const multiPty = new PTYService({ workspaceRoot: tempDir });
    try {
      const s1 = multiPty.createSession('session_term_1', { cols: 100, rows: 30 });
      const s2 = multiPty.createSession('session_term_2', { cols: 120, rows: 40 });

      expect(multiPty.hasSession('session_term_1')).toBe(true);
      expect(multiPty.hasSession('session_term_2')).toBe(true);
      expect(multiPty.listSessions().length).toBe(2);

      multiPty.resize(110, 35, 'session_term_1');
      expect(s1.cols).toBe(110);
      expect(s1.rows).toBe(35);
      expect(s2.cols).toBe(120);
      expect(s2.rows).toBe(40);

      // Session output isolation
      let s1Output = '';
      let s2Output = '';
      const unsub1 = multiPty.onSessionData('session_term_1', (d) => { s1Output += d; });
      const unsub2 = multiPty.onSessionData('session_term_2', (d) => { s2Output += d; });

      multiPty.write('echo pty_session_one_unique\r\n', 'session_term_1');
      multiPty.write('echo pty_session_two_unique\r\n', 'session_term_2');

      const startWait = Date.now();
      while (
        Date.now() - startWait < 3000 &&
        (!s1Output.includes('pty_session_one_unique') || !s2Output.includes('pty_session_two_unique'))
      ) {
        await new Promise((r) => setTimeout(r, 100));
      }

      expect(s1Output).toContain('pty_session_one_unique');
      expect(s1Output).not.toContain('pty_session_two_unique');
      expect(s2Output).toContain('pty_session_two_unique');
      expect(s2Output).not.toContain('pty_session_one_unique');

      unsub1();
      unsub2();

      const closed = multiPty.closeSession('session_term_1');
      expect(closed).toBe(true);
      expect(multiPty.hasSession('session_term_1')).toBe(false);
      expect(multiPty.hasSession('session_term_2')).toBe(true);
      expect(multiPty.listSessions().length).toBe(1);
    } finally {
      multiPty.close();
    }
  });

  it('isolates executeCommand from interactive PTY sessions', async () => {
    const multiPty = new PTYService({ workspaceRoot: tempDir });
    try {
      let interactivePtyDataAfterAgent = '';
      const unsubGlobal = multiPty.onData((data) => {
        interactivePtyDataAfterAgent += data;
      });

      const agentResult = await multiPty.executeCommand('echo agent_isolated_execution_token_999');
      await new Promise((r) => setTimeout(r, 300));

      expect(agentResult.exitCode).toBe(0);
      expect(agentResult.output).toContain('agent_isolated_execution_token_999');
      expect(interactivePtyDataAfterAgent).not.toContain('agent_isolated_execution_token_999');

      unsubGlobal();
    } finally {
      multiPty.close();
    }
  });
});
