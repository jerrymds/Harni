import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createApp } from '../src/server.js';

describe('Server Skills REST Endpoints', () => {
  const tempDir = path.resolve('temp_server_test_skills');
  let app: any;
  let port: number;

  beforeAll(async () => {
    await fs.mkdir(tempDir, { recursive: true });
    app = createApp({
      port: 0,
      workspaceRoot: tempDir,
      dbPath: path.join(tempDir, 'cline-test.db'),
    });
    port = await app.start();
  });

  afterAll(async () => {
    if (app) await app.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('GET /api/skills returns skills array and POST /api/skills/refresh refreshes skills', async () => {
    const skillsRes = await fetch(`http://localhost:${port}/api/skills`);
    const skillsJson = (await skillsRes.json()) as any;
    expect(skillsRes.ok).toBe(true);
    expect(Array.isArray(skillsJson.skills)).toBe(true);
    expect(skillsJson.skills.length).toBeGreaterThanOrEqual(4);
    expect(skillsJson.skills.some((s: any) => s.name === 'run_test_suite')).toBe(true);

    const refreshSkillsRes = await fetch(`http://localhost:${port}/api/skills/refresh`, { method: 'POST' });
    const refreshSkillsJson = (await refreshSkillsRes.json()) as any;
    expect(refreshSkillsRes.ok).toBe(true);
    expect(refreshSkillsJson.success).toBe(true);
  });
});
