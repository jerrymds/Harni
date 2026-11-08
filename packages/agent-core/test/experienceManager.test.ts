import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import {
  ExperienceManager,
  SystemPromptBuilder,
  type HarnessExperience,
  type HarnessSynthesisInput,
} from '../src/index.js';

describe('ExperienceManager & Dynamic Harness Synthesizer', () => {
  let tempDir: string;
  let manager: ExperienceManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harni-exp-test-'));
    manager = new ExperienceManager({ storageDir: tempDir });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('1. Experience Storage and Loading (saveExperience, loadAll)', () => {
    it('saves experience with auto-generated id and loads it back', async () => {
      const saved = await manager.saveExperience({
        title: 'Fix NodeNext Vitest Import Extension',
        category: 'bug_fix',
        tags: ['typescript', 'vitest', 'esm'],
        summary: 'TypeScript NodeNext requires explicit .js extensions in import specifiers.',
        actionableGuidance: 'Ensure all local relative imports end with .js extension.',
        relatedFiles: ['tsconfig.json', 'src/index.ts'],
        confidenceScore: 0.95,
      });

      expect(saved.id).toBeDefined();
      expect(saved.id.length).toBeGreaterThan(0);
      expect(saved.createdAt).toBeDefined();
      expect(saved.updatedAt).toBeDefined();
      expect(saved.title).toBe('Fix NodeNext Vitest Import Extension');

      // Verify file exists on disk
      const filePath = path.join(tempDir, `${saved.id}.json`);
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const loadedFromFile = JSON.parse(fileContent);
      expect(loadedFromFile.id).toBe(saved.id);

      // Verify loadAll retrieves it
      const all = await manager.loadAll();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(saved.id);
      expect(all[0].title).toBe('Fix NodeNext Vitest Import Extension');
    });

    it('saves experience with explicit id and updates existing entries', async () => {
      const customId = 'custom-exp-001';
      const initial = await manager.saveExperience({
        id: customId,
        title: 'Initial Title',
        category: 'workflow',
        tags: ['git'],
        summary: 'Initial summary',
        actionableGuidance: 'Run git status first.',
      });

      expect(initial.id).toBe(customId);

      // Update experience with same id
      const updated = await manager.saveExperience({
        id: customId,
        title: 'Updated Title',
        category: 'workflow',
        tags: ['git', 'cli'],
        summary: 'Updated summary',
        actionableGuidance: 'Run git status and git diff.',
        createdAt: initial.createdAt,
      });

      expect(updated.id).toBe(customId);
      const all = await manager.loadAll();
      expect(all).toHaveLength(1);
      expect(all[0].title).toBe('Updated Title');
      expect(all[0].tags).toEqual(['git', 'cli']);
    });

    it('clears all experiences and handles non-existent storageDir gracefully', async () => {
      await manager.saveExperience({
        title: 'Exp 1',
        category: 'pitfall',
        tags: ['memory'],
        summary: 'Beware of memory leaks in event listeners',
        actionableGuidance: 'Always remove listeners on cleanup',
      });
      await manager.saveExperience({
        title: 'Exp 2',
        category: 'tool_usage',
        tags: ['mcp'],
        summary: 'Tool call formatting for MCP',
        actionableGuidance: 'Pass arguments as an object',
      });

      expect(await manager.loadAll()).toHaveLength(2);

      await manager.clear();
      expect(await manager.loadAll()).toHaveLength(0);

      // Point to a non-existent directory
      const emptyManager = new ExperienceManager({
        storageDir: path.join(tempDir, 'non_existent_subdir'),
      });
      expect(await emptyManager.loadAll()).toEqual([]);
    });

    it('prunes oldest experiences when maxRetained is exceeded', async () => {
      const limitedManager = new ExperienceManager({
        storageDir: tempDir,
        maxRetained: 2,
      });

      const exp1 = await limitedManager.saveExperience({
        title: 'Oldest Experience',
        category: 'workflow',
        tags: ['old'],
        summary: 'First experience',
        actionableGuidance: 'Guidance 1',
      });

      // Small delay to ensure timestamp progression
      await new Promise((r) => setTimeout(r, 10));

      const exp2 = await limitedManager.saveExperience({
        title: 'Second Experience',
        category: 'workflow',
        tags: ['mid'],
        summary: 'Second experience',
        actionableGuidance: 'Guidance 2',
      });

      await new Promise((r) => setTimeout(r, 10));

      const exp3 = await limitedManager.saveExperience({
        title: 'Newest Experience',
        category: 'workflow',
        tags: ['new'],
        summary: 'Third experience',
        actionableGuidance: 'Guidance 3',
      });

      const remaining = await limitedManager.loadAll();
      expect(remaining).toHaveLength(2);

      const remainingIds = remaining.map((e) => e.id);
      expect(remainingIds).not.toContain(exp1.id);
      expect(remainingIds).toContain(exp2.id);
      expect(remainingIds).toContain(exp3.id);
    });
  });

  describe('2. Experience Search & Ranking (searchExperiences)', () => {
    beforeEach(async () => {
      // Seed a variety of experiences
      await manager.saveExperience({
        id: 'exp-vitest-bug',
        title: 'Vitest ESM Resolution Bug Fix',
        category: 'bug_fix',
        tags: ['vitest', 'esm', 'typescript'],
        summary: 'Fix failed imports due to missing .js extension in Vitest ESM runner.',
        triggerCondition: 'When vitest throws ERR_MODULE_NOT_FOUND',
        actionableGuidance: 'Append .js to relative imports in typescript files.',
        relatedFiles: ['src/index.ts', 'tsconfig.json'],
        confidenceScore: 0.95,
      });

      await manager.saveExperience({
        id: 'exp-git-workflow',
        title: 'Git Checkpoint and Stash Workflow',
        category: 'workflow',
        tags: ['git', 'vcs', 'workflow'],
        summary: 'SOP for safely creating git checkpoints before executing refactoring.',
        triggerCondition: 'Before starting major multi-file refactoring',
        actionableGuidance: 'Create a temporary branch or stash uncommitted changes.',
        relatedFiles: ['gitCheckpointService.ts'],
        confidenceScore: 0.9,
      });

      await manager.saveExperience({
        id: 'exp-sqlite-pitfall',
        title: 'SQLite Database Lock Pitfall',
        category: 'pitfall',
        tags: ['database', 'sqlite', 'concurrency'],
        summary: 'Concurrent writes to SQLite database can cause SQLITE_BUSY error.',
        triggerCondition: 'When multiple workers attempt to write to sqlite at the same time',
        actionableGuidance: 'Use WAL mode and a retry queue for concurrent database writes.',
        relatedFiles: ['db.sqlite'],
        confidenceScore: 0.85,
      });

      await manager.saveExperience({
        id: 'exp-arch-subagent',
        title: 'Hierarchical Multi-Agent Architecture',
        category: 'architectural',
        tags: ['architecture', 'subagents', 'orchestration'],
        summary: 'Guidelines for decomposing tasks into researcher, coder, and reviewer subagents.',
        triggerCondition: 'When handling complex tasks with large context footprints',
        actionableGuidance: 'Isolate exploration context inside researcher subagent.',
        relatedFiles: ['subagentManager.ts'],
        confidenceScore: 0.92,
      });
    });

    it('searches experiences by query keywords', async () => {
      const results = await manager.searchExperiences({ query: 'vitest ESM' });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('exp-vitest-bug');
      expect(results[0].category).toBe('bug_fix');
    });

    it('filters strictly by category when category option is provided', async () => {
      const results = await manager.searchExperiences({ category: 'pitfall' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('exp-sqlite-pitfall');
      expect(results[0].category).toBe('pitfall');

      const bugResults = await manager.searchExperiences({ category: 'bug_fix' });
      expect(bugResults).toHaveLength(1);
      expect(bugResults[0].id).toBe('exp-vitest-bug');
    });

    it('matches and scores by tags', async () => {
      const results = await manager.searchExperiences({ tags: ['git', 'vcs'] });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('exp-git-workflow');
    });

    it('ranks experiences with higher keyword and tag intersection higher', async () => {
      // Both mention 'refactor' or related, but git-workflow has tag 'workflow'
      const results = await manager.searchExperiences({
        query: 'refactoring',
        tags: ['workflow'],
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('exp-git-workflow');
    });

    it('respects limit and minScore options', async () => {
      // Default limit is 3 (F10)
      const defaultResults = await manager.searchExperiences({});
      expect(defaultResults).toHaveLength(3);

      const allResults = await manager.searchExperiences({ limit: 10 });
      expect(allResults).toHaveLength(4);

      const limitedResults = await manager.searchExperiences({ limit: 2 });
      expect(limitedResults).toHaveLength(2);

      // High minScore filters out low-matching results
      const strictResults = await manager.searchExperiences({
        query: 'vitest',
        minScore: 10,
      });
      // exp-vitest-bug has title match (+5), tags match (+3), summary match (+2), confidence (+0.95) >= 10
      expect(strictResults.length).toBe(1);
      expect(strictResults[0].id).toBe('exp-vitest-bug');

      const impossibleResults = await manager.searchExperiences({
        query: 'vitest',
        minScore: 100,
      });
      expect(impossibleResults).toHaveLength(0);
    });
  });

  describe('3. Dynamic Harness Synthesis (synthesizeFromResolution)', () => {
    it('synthesizes bug_fix experience when errors are encountered', () => {
      const input: HarnessSynthesisInput = {
        taskDescription: 'Fix Vitest module resolution failure with NodeNext',
        successfulActions: [
          'Added .js extension to relative import in src/index.ts',
          'Updated tsconfig.json moduleResolution to NodeNext',
          'Ran vitest run and verified all 5 tests passed',
        ],
        encounteredErrors: [
          'Error [ERR_MODULE_NOT_FOUND]: Cannot find module ./harness',
          'TypeScript compile error TS2835',
        ],
        keyFiles: ['src/index.ts', 'tsconfig.json'],
      };

      const exp = manager.synthesizeFromResolution(input);

      expect(exp.id).toBeDefined();
      expect(exp.category).toBe('bug_fix');
      expect(exp.title).toContain('Vitest module resolution');
      expect(exp.summary).toContain('Overcame 2 error(s)');
      expect(exp.triggerCondition).toContain('When encountering error(s)');
      expect(exp.triggerCondition).toContain('ERR_MODULE_NOT_FOUND');
      expect(exp.actionableGuidance).toContain('1. Added .js extension');
      expect(exp.actionableGuidance).toContain('Error avoidance');
      expect(exp.relatedFiles).toEqual(['src/index.ts', 'tsconfig.json']);
      expect(exp.tags).toContain('bug_fix');
      expect(exp.tags).toContain('ts');
      expect(exp.tags).toContain('json');
      expect(exp.confidenceScore).toBeGreaterThanOrEqual(0.9);
    });

    it('synthesizes workflow experience for smooth tasks without errors', () => {
      const input: HarnessSynthesisInput = {
        taskDescription: 'Setup automated CI workflow with GitHub Actions',
        successfulActions: [
          'Created .github/workflows/ci.yml',
          'Configured pnpm cache and node setup',
          'Added vitest and typecheck matrix jobs',
        ],
        keyFiles: ['.github/workflows/ci.yml'],
        tags: ['ci', 'github-actions'],
      };

      const exp = ExperienceManager.synthesizeFromResolution(input);

      expect(exp.category).toBe('workflow');
      expect(exp.triggerCondition).toContain('When performing task');
      expect(exp.actionableGuidance).toContain('1. Created .github/workflows/ci.yml');
      expect(exp.tags).toContain('ci');
      expect(exp.tags).toContain('github-actions');
      expect(exp.tags).toContain('yml');
    });

    it('respects explicitly provided category and tags', () => {
      const input: HarnessSynthesisInput = {
        taskDescription: 'Refactor tool adapter layer to support MCP tools',
        successfulActions: ['Implemented McpToolAdapter', 'Added schema conversion'],
        category: 'architectural',
        tags: ['mcp', 'adapter'],
      };

      const exp = manager.synthesizeFromResolution(input);
      expect(exp.category).toBe('architectural');
      expect(exp.tags).toContain('mcp');
      expect(exp.tags).toContain('adapter');
    });

    it('can save synthesized experience directly and retrieve it via search', async () => {
      const input: HarnessSynthesisInput = {
        taskDescription: 'Fix rate limiter token bucket burst overflow',
        successfulActions: ['Clamped remaining tokens to bucketCapacity in rateLimit.ts'],
        encounteredErrors: ['Burst token capacity exceeded error'],
        keyFiles: ['packages/agent-core/src/utils/rateLimit.ts'],
        tags: ['ratelimit', 'concurrency'],
      };

      const synthesized = manager.synthesizeFromResolution(input);
      const saved = await manager.saveExperience(synthesized);

      expect(saved.id).toBe(synthesized.id);

      const found = await manager.searchExperiences({ query: 'rate limiter token bucket' });
      expect(found.length).toBeGreaterThan(0);
      expect(found[0].id).toBe(synthesized.id);
      expect(found[0].category).toBe('bug_fix');
    });
  });

  describe('4. SystemPrompt Integration with Learned Experiences', () => {
    const sampleExperiences: HarnessExperience[] = [
      {
        id: 'exp-1',
        title: 'Explicit .js import extensions in NodeNext',
        category: 'bug_fix',
        tags: ['esm', 'typescript'],
        summary: 'NodeNext ESM loader requires relative specifiers to have .js extensions.',
        triggerCondition: 'When writing TypeScript imports under NodeNext resolution',
        actionableGuidance: 'Always specify ./module.js rather than ./module in import declarations.',
        relatedFiles: ['tsconfig.base.json'],
        confidenceScore: 0.95,
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: 'exp-2',
        title: 'Git Checkpoint before large refactor',
        category: 'workflow',
        tags: ['git'],
        summary: 'Safe refactoring procedure using Git checkpoints.',
        actionableGuidance: 'Run git status and create a temporary checkpoint before modifying code.',
        confidenceScore: 0.9,
        createdAt: 2000,
        updatedAt: 2000,
      },
    ];

    it('formats experiences properly with formatForPrompt', () => {
      const formatted = manager.formatForPrompt(sampleExperiences);

      expect(formatted).toContain('==== HARNESS LEARNED EXPERIENCES ====');
      expect(formatted).toContain('[BUG_FIX] Explicit .js import extensions in NodeNext');
      expect(formatted).toContain('**Summary**: NodeNext ESM loader requires');
      expect(formatted).toContain('**Trigger Condition**: When writing TypeScript imports');
      expect(formatted).toContain('**Actionable Guidance**: Always specify ./module.js');
      expect(formatted).toContain('**Related Files**: tsconfig.base.json');
      expect(formatted).toContain('**Tags**: esm, typescript');
      expect(formatted).toContain('[WORKFLOW] Git Checkpoint before large refactor');
    });

    it('returns empty string when experiences array is empty', () => {
      expect(manager.formatForPrompt([])).toBe('');
      expect(ExperienceManager.formatForPrompt([])).toBe('');
    });

    it('injects experiences into SystemPromptBuilder.build via experiences option', () => {
      const prompt = SystemPromptBuilder.build({
        workspaceRoot: '/workspace/project',
        mode: 'code',
        experiences: sampleExperiences,
      });

      expect(prompt).toContain('==== HARNESS LEARNED EXPERIENCES ====');
      expect(prompt).toContain('[BUG_FIX] Explicit .js import extensions in NodeNext');
      expect(prompt).toContain('Always specify ./module.js');
      expect(prompt).toContain('[WORKFLOW] Git Checkpoint before large refactor');

      // Verify prompt structure: experiences should be present and operating principles follow
      expect(prompt).toContain('==== OPERATING PRINCIPLES ====');
      const expIndex = prompt.indexOf('==== HARNESS LEARNED EXPERIENCES ====');
      const opIndex = prompt.indexOf('==== OPERATING PRINCIPLES ====');
      expect(expIndex).toBeGreaterThan(0);
      expect(opIndex).toBeGreaterThan(expIndex);
    });

    it('injects custom experiencesFormatted string when provided', () => {
      const customFormatted = `==== HARNESS LEARNED EXPERIENCES ====
- Custom experience snippet passed directly`;

      const prompt = SystemPromptBuilder.build({
        workspaceRoot: '/workspace/project',
        mode: 'code',
        experiencesFormatted: customFormatted,
      });

      expect(prompt).toContain('==== HARNESS LEARNED EXPERIENCES ====');
      expect(prompt).toContain('Custom experience snippet passed directly');
    });

    it('does not inject experiences section when neither is provided', () => {
      const prompt = SystemPromptBuilder.build({
        workspaceRoot: '/workspace/project',
        mode: 'code',
      });

      expect(prompt).not.toContain('==== HARNESS LEARNED EXPERIENCES ====');
    });
  });

  describe('5. Security, Tokenization, and Formatting Regressions (F3, F7, F8, F9, F10)', () => {
    it('rejects path traversal id and does not write files outside storageDir (F3)', async () => {
      await expect(
        manager.saveExperience({
          id: '../escaped',
          title: 'Malicious Traversal',
          category: 'workflow',
          summary: 'Attempting to escape storageDir',
          actionableGuidance: 'Should fail',
        }),
      ).rejects.toThrow(/Invalid experience ID/);

      await expect(
        manager.saveExperience({
          id: '..\\escaped',
          title: 'Windows Traversal',
          category: 'workflow',
          summary: 'Attempting windows traversal',
          actionableGuidance: 'Should fail',
        }),
      ).rejects.toThrow();

      // Verify no file was written outside storageDir
      const parentDir = path.dirname(tempDir);
      const escapedFile = path.join(parentDir, 'escaped.json');
      let exists = false;
      try {
        await fs.stat(escapedFile);
        exists = true;
      } catch {}
      expect(exists).toBe(false);
    });

    it('preserves existing createdAt when updating an experience without createdAt (F9)', async () => {
      const original = await manager.saveExperience({
        id: 'preserve-created-at',
        title: 'Original Title',
        category: 'workflow',
        summary: 'Original Summary',
        actionableGuidance: 'Step 1',
      });

      const originalCreatedAt = original.createdAt;
      expect(originalCreatedAt).toBeDefined();

      await new Promise((r) => setTimeout(r, 20));

      const updated = await manager.saveExperience({
        id: 'preserve-created-at',
        title: 'Updated Title',
        category: 'workflow',
        summary: 'Updated Summary',
        actionableGuidance: 'Step 1 updated',
      });

      expect(updated.createdAt).toBe(originalCreatedAt);
      expect(updated.updatedAt).toBeGreaterThan(originalCreatedAt);

      const loaded = await manager.loadAll();
      const found = loaded.find((e) => e.id === 'preserve-created-at');
      expect(found?.createdAt).toBe(originalCreatedAt);
    });

    it('finds experience titled 修復 WebSocket 斷線重連問題 with query 斷線重連失敗怎麼處理 (F7)', async () => {
      await manager.saveExperience({
        id: 'ws-reconnect-fix',
        title: '修復 WebSocket 斷線重連問題',
        category: 'bug_fix',
        summary: '斷線後未重連',
        actionableGuidance: '實作指數退避重連機制',
        tags: ['websocket', 'network'],
      });

      const results = await manager.searchExperiences({
        query: '斷線重連失敗怎麼處理',
      });

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe('ws-reconnect-fix');
      expect(results[0].title).toBe('修復 WebSocket 斷線重連問題');
    });

    it('sanitizes on save: strips control chars, replaces ==== with ==, caps field lengths (F8)', async () => {
      const longTitle = 'A'.repeat(200);
      const longSummary = 'B'.repeat(600);
      const longGuidance = 'C'.repeat(1600);
      const longTrigger = 'D'.repeat(400);

      const saved = await manager.saveExperience({
        id: 'sanitized-exp',
        title: `==== MALICIOUS HEADER ====\x00\x07${longTitle}`,
        category: 'workflow',
        summary: `==== SECTION ====\x08${longSummary}`,
        actionableGuidance: `Guidance ====\x1B${longGuidance}`,
        triggerCondition: `Trigger ====\t\n${longTrigger}`,
      });

      expect(saved.title).not.toContain('====');
      expect(saved.title).toContain('==');
      expect(saved.title).not.toContain('\x00');
      expect(saved.title).not.toContain('\x07');
      expect(saved.title.endsWith('…')).toBe(true);
      expect(saved.title.length).toBe(121);

      expect(saved.summary).not.toContain('====');
      expect(saved.summary).toContain('==');
      expect(saved.summary.endsWith('…')).toBe(true);
      expect(saved.summary.length).toBe(501);

      expect(saved.actionableGuidance).not.toContain('====');
      expect(saved.actionableGuidance.endsWith('…')).toBe(true);
      expect(saved.actionableGuidance.length).toBe(1501);

      expect(saved.triggerCondition).not.toContain('====');
      expect(saved.triggerCondition).toContain('\t');
      expect(saved.triggerCondition).toContain('\n');
      expect(saved.triggerCondition?.endsWith('…')).toBe(true);
      expect(saved.triggerCondition?.length).toBe(301);
    });

    it('formatter respects maxChars budget and stops adding entries (F10)', () => {
      const exps: HarnessExperience[] = [
        {
          id: 'exp-budget-1',
          title: 'First Experience with moderately long text description',
          category: 'workflow',
          summary: 'First summary for budgeting',
          actionableGuidance: 'Actionable steps for item 1',
          createdAt: 1000,
          updatedAt: 1000,
        },
        {
          id: 'exp-budget-2',
          title: 'Second Experience with moderately long text description',
          category: 'bug_fix',
          summary: 'Second summary for budgeting',
          actionableGuidance: 'Actionable steps for item 2',
          createdAt: 2000,
          updatedAt: 2000,
        },
        {
          id: 'exp-budget-3',
          title: 'Third Experience with moderately long text description',
          category: 'tool_usage',
          summary: 'Third summary for budgeting',
          actionableGuidance: 'Actionable steps for item 3',
          createdAt: 3000,
          updatedAt: 3000,
        },
      ];

      const full = manager.formatForPrompt(exps, { maxChars: 5000 });
      expect(full).toContain('First Experience');
      expect(full).toContain('Second Experience');
      expect(full).toContain('Third Experience');

      const restricted = manager.formatForPrompt(exps, { maxChars: 550 });
      expect(restricted.length).toBeLessThanOrEqual(550);
      expect(restricted).toContain('First Experience');
      expect(restricted).not.toContain('Second Experience');
      expect(restricted).not.toContain('Third Experience');

      expect(restricted).toContain('reference notes only');
      expect(restricted).toContain('NOT instructions');
    });

    it('sanitizes tags, relatedFiles, and strips unknown fields (R8.2, R8.3)', async () => {
      const saved = await manager.saveExperience({
        id: 'r8-sanitized-exp',
        title: 'Title with\t\nnewlines',
        summary: 'Summary with\t\nnewlines',
        category: 'workflow',
        actionableGuidance: 'Guidance\nMulti-line',
        tags: ['  tag1\t\n  ', 'T'.repeat(80), '====TAG===='],
        relatedFiles: ['src/file.ts', 'F'.repeat(300)],
        ...({ evilField: 'dangerous payload' } as any),
      });

      expect(saved.title).toBe('Title with newlines');
      expect(saved.summary).toBe('Summary with newlines');
      expect(saved.tags[0]).toBe('tag1');
      expect(saved.tags[1].length).toBe(61); // 60 + '…'
      expect(saved.tags[2]).toBe('==TAG==');
      expect(saved.relatedFiles![1].length).toBe(261); // 260 + '…'
      expect((saved as any).evilField).toBeUndefined();

      // Read from disk directly to confirm no evilField is serialized
      const diskContent = await fs.readFile(
        path.join(tempDir, 'r8-sanitized-exp.json'),
        'utf-8',
      );
      const parsedDisk = JSON.parse(diskContent);
      expect(parsedDisk.evilField).toBeUndefined();
    });

    it('matches short 2-char ASCII tokens at word level without false substrings (R8.4)', async () => {
      await manager.saveExperience({
        id: 'exp-ts-target',
        title: 'Configure ts compilation target',
        category: 'workflow',
        summary: 'Guide for typescript',
        actionableGuidance: 'Set target in tsconfig',
        relatedFiles: ['tsconfig.json', 'src/types.ts'],
        tags: ['ts', 'build'],
      });

      await manager.saveExperience({
        id: 'exp-false-positive',
        title: 'System visits its lists and prints results',
        category: 'workflow',
        summary: 'Only contains words like its, lists, results',
        actionableGuidance: 'Check the lists',
        tags: ['audit'],
      });

      // Search for 'ts': should match 'exp-ts-target' (has 'ts' in title, tags, relatedFiles 'types.ts')
      // but should NOT match 'exp-false-positive' despite having 'its', 'lists', 'results'
      const results = await manager.searchExperiences({ query: 'ts' });
      const ids = results.map((r) => r.id);
      expect(ids).toContain('exp-ts-target');
      expect(ids).not.toContain('exp-false-positive');
    });
  });
});
