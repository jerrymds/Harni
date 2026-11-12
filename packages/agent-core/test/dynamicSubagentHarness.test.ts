import { describe, it, expect } from 'vitest';
import { DynamicSubagentHarness } from '../src/harness/dynamicSubagentHarness.js';
import type {
  HarnessExperience,
  SubagentDefinition,
  SubagentTaskIntent,
} from '@harni/types';

describe('DynamicSubagentHarness', () => {
  const allTools = [
    'read_file',
    'replace_file_content',
    'write_to_file',
    'list_files',
    'search_files',
    'execute_command',
    'use_skill',
    'ask_question',
    'invoke_subagent',
    'manage_subagents',
  ];

  const mockExperience: HarnessExperience = {
    id: 'exp_investigate_01',
    title: 'Avoid reading binary files as text',
    category: 'pitfall',
    tags: ['filesystem', 'binary', 'encoding'],
    summary: 'Reading binary files causes encoding corruptions and token explosion.',
    triggerCondition: 'When inspecting media or compiled artifact files',
    actionableGuidance: 'Check file extensions before invoking read_file.',
    relatedFiles: ['src/utils/file.ts'],
    confidenceScore: 0.95,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  describe('1. Intent Recognition (analyzeIntent)', () => {
    it('detects investigation intent from English exploration keywords', () => {
      const res = DynamicSubagentHarness.analyzeIntent(
        'Investigate the memory leak in worker pool and explore codebase architecture',
      );
      expect(res.intent).toBe('investigation');
      expect(res.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('detects investigation intent from Chinese keywords and role hints', () => {
      const res = DynamicSubagentHarness.analyzeIntent(
        '請搜尋程式碼並深入調查認證模組的架構理解',
        'researcher',
      );
      expect(res.intent).toBe('investigation');
      expect(res.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('detects surgical_edit intent for typo fixes and small edits', () => {
      const res = DynamicSubagentHarness.analyzeIntent(
        'Fix a typo in the auth middleware and replace string on line 42',
      );
      expect(res.intent).toBe('surgical_edit');
      expect(res.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('detects surgical_edit intent for Chinese single-line fixes', () => {
      const res = DynamicSubagentHarness.analyzeIntent(
        '這是單檔小修，進行拼寫修正與重命名變數',
      );
      expect(res.intent).toBe('surgical_edit');
      expect(res.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('detects review_testing intent for running test suites and linting', () => {
      const res = DynamicSubagentHarness.analyzeIntent(
        'Run test suite with vitest and check coverage for session service',
      );
      expect(res.intent).toBe('review_testing');
      expect(res.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('detects review_testing intent for code review and auditor role', () => {
      const res = DynamicSubagentHarness.analyzeIntent(
        'Perform code review, audit edge cases and verify assertion correctness',
        'reviewer',
      );
      expect(res.intent).toBe('review_testing');
      expect(res.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('detects implementation intent for feature development and refactoring', () => {
      const res = DynamicSubagentHarness.analyzeIntent(
        'Implement OAuth2 Google authentication provider and write module',
      );
      expect(res.intent).toBe('implementation');
      expect(res.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('detects implementation intent from Chinese feature writing and role coder', () => {
      const res = DynamicSubagentHarness.analyzeIntent(
        '撰寫新功能並建立模組，進行核心架構重構',
        'coder',
      );
      expect(res.intent).toBe('implementation');
      expect(res.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('falls back to general intent for vague or ambiguous prompts', () => {
      const res1 = DynamicSubagentHarness.analyzeIntent('Hello agent, how are you?');
      expect(res1.intent).toBe('general');
      expect(res1.confidence).toBe(0.5);

      const res2 = DynamicSubagentHarness.analyzeIntent('');
      expect(res2.intent).toBe('general');
      expect(res2.confidence).toBe(0.5);
    });

    it('resolves surgical_edit over implementation when prompt is a specific typo fix', () => {
      // Even if coder role is passed, prompt specifies typo
      const res = DynamicSubagentHarness.analyzeIntent(
        'Fix typo in user greeting string',
        'coder',
      );
      expect(res.intent).toBe('surgical_edit');
    });
  });

  describe('2. Tool Pruning (pruneTools)', () => {
    it('prunes tools for investigation to read-only tools when readOnly signal is active', () => {
      const pruned = DynamicSubagentHarness.pruneTools(allTools, 'investigation', undefined, true);
      expect(pruned).toEqual([
        'read_file',
        'list_files',
        'search_files',
        'use_skill',
        'ask_question',
      ]);
      expect(pruned).not.toContain('write_to_file');
      expect(pruned).not.toContain('replace_file_content');
      expect(pruned).not.toContain('execute_command');
      expect(pruned).not.toContain('invoke_subagent');
    });

    it('retains write tools for investigation when readOnly is false (conservative pruning)', () => {
      const pruned = DynamicSubagentHarness.pruneTools(allTools, 'investigation', undefined, false);
      expect(pruned).toContain('write_to_file');
      expect(pruned).toContain('replace_file_content');
    });

    it('prunes tools for surgical_edit to precise editing tools', () => {
      const pruned = DynamicSubagentHarness.pruneTools(allTools, 'surgical_edit');
      expect(pruned).toEqual([
        'read_file',
        'replace_file_content',
        'write_to_file',
        'list_files',
        'search_files',
      ]);
      expect(pruned).not.toContain('execute_command');
      expect(pruned).not.toContain('invoke_subagent');
    });

    it('prunes tools for review_testing to testing, reading, and writing tools', () => {
      const pruned = DynamicSubagentHarness.pruneTools(allTools, 'review_testing');
      expect(pruned).toEqual([
        'read_file',
        'replace_file_content',
        'write_to_file',
        'list_files',
        'search_files',
        'execute_command',
        'ask_question',
      ]);
      expect(pruned).not.toContain('invoke_subagent');
    });

    it('retains all standard development tools for implementation', () => {
      const pruned = DynamicSubagentHarness.pruneTools(allTools, 'implementation');
      expect(pruned).toContain('read_file');
      expect(pruned).toContain('write_to_file');
      expect(pruned).toContain('replace_file_content');
      expect(pruned).toContain('execute_command');
      expect(pruned).toContain('list_files');
      expect(pruned).toContain('search_files');
      // Subagent orchestration remains pruned by default
      expect(pruned).not.toContain('invoke_subagent');
    });

    it('retains all tools for general intent', () => {
      const pruned = DynamicSubagentHarness.pruneTools(allTools, 'general');
      expect(pruned).toEqual(allTools);
    });

    it('filters strictly by explicitAllowed intersection', () => {
      const explicit = ['read_file', 'search_files'];
      const pruned = DynamicSubagentHarness.pruneTools(
        allTools,
        'investigation',
        explicit,
      );
      expect(pruned).toEqual(['read_file', 'search_files']);

      const prunedReview = DynamicSubagentHarness.pruneTools(
        allTools,
        'review_testing',
        ['execute_command'],
      );
      expect(prunedReview).toEqual(['execute_command']);

      const prunedEmpty = DynamicSubagentHarness.pruneTools(
        allTools,
        'implementation',
        [],
      );
      expect(prunedEmpty).toEqual([]);
    });

    it('handles empty availableTools gracefully', () => {
      const pruned = DynamicSubagentHarness.pruneTools([], 'investigation');
      expect(pruned).toEqual([]);
    });
  });

  describe('3. Prompt Synthesis (tailorSystemPrompt)', () => {
    it('synthesizes prompt with header, role, intent, task, and default constraints', () => {
      const prompt = DynamicSubagentHarness.tailorSystemPrompt({
        role: 'Explorer',
        intent: 'investigation',
        taskPrompt: 'Locate memory leak in event loop',
      });

      expect(prompt).toContain('==== HARNESS TAILORED SUBAGENT SCOPE ====');
      expect(prompt).toContain('Role: Explorer');
      expect(prompt).toContain('Intent: investigation');
      expect(prompt).not.toContain('Assigned Task:');
      expect(prompt).toContain('READ-ONLY mode');
      expect(prompt).toContain('cite exact file paths and line numbers');
    });

    it('preserves basePrompt before the scope section', () => {
      const basePrompt = 'You are a Senior Security Analyst subagent.';
      const prompt = DynamicSubagentHarness.tailorSystemPrompt({
        basePrompt,
        role: 'Security Analyst',
        intent: 'review_testing',
        taskPrompt: 'Audit code for timing attacks',
      });

      expect(prompt.startsWith(basePrompt)).toBe(true);
      expect(prompt).toContain('==== HARNESS TAILORED SUBAGENT SCOPE ====');
      expect(prompt).toContain('Focus on code quality inspection');
    });

    it('injects surgical edit specific behavioral constraints', () => {
      const prompt = DynamicSubagentHarness.tailorSystemPrompt({
        role: 'Fixer',
        intent: 'surgical_edit',
        taskPrompt: 'Fix typo on line 12 of index.ts',
      });

      expect(prompt).toContain('Make minimal surgical edits to the target file');
      expect(prompt).toContain('avoid touching unrelated lines');
      expect(prompt).toContain('Do NOT reformat or refactor unrequested sections');
    });

    it('merges custom constraints cleanly without duplicates', () => {
      const customConstraints = [
        'Do not touch package.json dependencies.',
        'Never run destructive git commands.',
      ];
      const prompt = DynamicSubagentHarness.tailorSystemPrompt({
        role: 'Developer',
        intent: 'implementation',
        taskPrompt: 'Scaffold new billing endpoints',
        constraints: customConstraints,
      });

      expect(prompt).toContain('Do not touch package.json dependencies.');
      expect(prompt).toContain('Never run destructive git commands.');
      expect(prompt).toContain('Implement requested features');
    });

    it('integrates historical experiences via ExperienceManager format', () => {
      const prompt = DynamicSubagentHarness.tailorSystemPrompt({
        role: 'Researcher',
        intent: 'investigation',
        taskPrompt: 'Inspect image assets and read config',
        experiences: [mockExperience],
      });

      expect(prompt).toContain('==== HARNESS LEARNED EXPERIENCES ====');
      expect(prompt).toContain('Avoid reading binary files as text');
      expect(prompt).toContain('[PITFALL]');
      expect(prompt).toContain('Check file extensions before invoking read_file.');
    });

    it('omits experience section if no experiences provided', () => {
      const prompt = DynamicSubagentHarness.tailorSystemPrompt({
        role: 'Researcher',
        intent: 'investigation',
        taskPrompt: 'Inspect code',
        experiences: [],
      });

      expect(prompt).not.toContain('==== HARNESS LEARNED EXPERIENCES ====');
    });
  });

  describe('4. End-to-End Dynamic Tailoring (tailor)', () => {
    it('produces a full tailored configuration from direct parameters', () => {
      const config = DynamicSubagentHarness.tailor({
        taskPrompt: 'Search codebase and analyze worker thread synchronization',
        role: 'researcher',
        availableTools: allTools,
        experiences: [mockExperience],
        customConstraints: ['Preserve backward compatibility.'],
      });

      expect(config.intent).toBe('investigation');
      expect(config.confidenceScore).toBeGreaterThanOrEqual(0.85);
      expect(config.prunedTools).toEqual([
        'read_file',
        'list_files',
        'search_files',
        'use_skill',
        'ask_question',
      ]);
      expect(config.appliedExperiences).toEqual(['exp_investigate_01']);
      expect(config.constraints).toContain('Preserve backward compatibility.');
      expect(config.constraints).toContain(
        'Operate strictly in READ-ONLY mode. Do NOT attempt to modify, create, or delete any files.',
      );
      expect(config.systemPrompt).toContain('==== HARNESS TAILORED SUBAGENT SCOPE ====');
      expect(config.systemPrompt).toContain('==== HARNESS LEARNED EXPERIENCES ====');
    });

    it('honors baseDefinition fields (role, systemPrompt, allowedTools)', () => {
      const baseDef: SubagentDefinition = {
        name: 'reviewer',
        role: 'Code Auditor',
        description: 'Code audit subagent',
        systemPrompt: 'Base prompt for auditor subagent.',
        allowedTools: [
          'read_file',
          'list_files',
          'search_files',
          'execute_command',
        ],
      };

      const config = DynamicSubagentHarness.tailor({
        taskPrompt: 'Run unit test suite and check code coverage',
        baseDefinition: baseDef,
      });

      expect(config.intent).toBe('review_testing');
      expect(config.prunedTools).toEqual([
        'read_file',
        'list_files',
        'search_files',
        'execute_command',
      ]);
      expect(config.systemPrompt).toContain('Base prompt for auditor subagent.');
      expect(config.systemPrompt).toContain('Role: Code Auditor');
      expect(config.systemPrompt).toContain('Intent: review_testing');
    });

    it('intersects availableTools with baseDefinition allowedTools', () => {
      const baseDef: SubagentDefinition = {
        name: 'coder',
        role: 'Developer',
        description: 'Developer subagent',
        systemPrompt: 'Dev system prompt',
        allowedTools: ['read_file', 'write_to_file'],
      };

      const config = DynamicSubagentHarness.tailor({
        taskPrompt: 'Implement new auth routes and write module',
        availableTools: allTools,
        baseDefinition: baseDef,
      });

      // Implementation would normally allow read_file, write_to_file, replace_file_content, etc.
      // But baseDef restricts to ['read_file', 'write_to_file'].
      expect(config.prunedTools).toEqual(['read_file', 'write_to_file']);
      expect(config.intent).toBe('implementation');
    });

    it('uses fallback default tools when none provided', () => {
      const config = DynamicSubagentHarness.tailor({
        taskPrompt: 'Fix typo in documentation',
      });

      expect(config.intent).toBe('surgical_edit');
      expect(config.prunedTools).toEqual([
        'read_file',
        'edit_file',
        'write_file',
        'list_files',
        'search_files',
      ]);
    });

    it('bypasses intent-based tool pruning when skipIntentPruning is true (U2)', () => {
      const coderDef: SubagentDefinition = {
        name: 'coder',
        role: 'Code Implementer',
        description: 'Coder',
        systemPrompt: 'Coder prompt',
        allowedTools: [
          'read_file',
          'write_to_file',
          'replace_file_content',
          'list_files',
          'search_files',
          'execute_command',
          'ask_question',
        ],
      };

      const config = DynamicSubagentHarness.tailor({
        taskPrompt: 'Fix typo in documentation',
        baseDefinition: coderDef,
        skipIntentPruning: true,
      });

      expect(config.intent).toBe('surgical_edit');
      expect(config.prunedTools).toContain('execute_command');
      expect(config.prunedTools).toContain('ask_question');
      expect(config.prunedTools).toEqual(coderDef.allowedTools);
      expect(config.systemPrompt).toContain('Make minimal surgical edits to the target file');
    });
  });

  describe('5. Conservative Pruning & Regression Tests (F2, F11, F12)', () => {
    it.each([
      'Write unit tests for utils/date.ts',
      'Add tests for the payment service',
      'Find and fix the memory leak in the watcher',
      'Fix the login bug where session expires early',
      '找出登入失敗的原因並修好它',
    ])(
      'retains write_file when no role and no baseDefinition are provided: "%s"',
      (prompt) => {
        const tailored = DynamicSubagentHarness.tailor({ taskPrompt: prompt });
        expect(tailored.prunedTools).toContain('write_file');
      },
    );

    it('removes write_to_file and execute_command for role Codebase Researcher with investigation task', () => {
      const tailored = DynamicSubagentHarness.tailor({
        role: 'Codebase Researcher',
        taskPrompt: 'Explore the auth module architecture',
      });

      expect(tailored.intent).toBe('investigation');
      expect(tailored.prunedTools).not.toContain('write_file');
      expect(tailored.prunedTools).not.toContain('edit_file');
      expect(tailored.prunedTools).not.toContain('run_command');
      expect(tailored.prunedTools).not.toContain('write_to_file');
      expect(tailored.prunedTools).not.toContain('replace_file_content');
      expect(tailored.prunedTools).not.toContain('execute_command');
      expect(tailored.prunedTools).toContain('read_file');
      expect(tailored.prunedTools).toContain('list_files');
      expect(tailored.prunedTools).toContain('search_files');
    });

    it('keeps non-builtin tools like mcp_github_search through pruning untouched (F11)', () => {
      const tools = ['read_file', 'mcp_github_search'];
      const pruned = DynamicSubagentHarness.pruneTools(tools, 'investigation');
      expect(pruned).toContain('mcp_github_search');
      expect(pruned).toContain('read_file');
      expect(pruned).toEqual(['read_file', 'mcp_github_search']);
    });

    it('removes write tools when baseDefinition.enableWriteTools is false', () => {
      const tailored = DynamicSubagentHarness.tailor({
        taskPrompt: 'Implement new billing endpoints',
        baseDefinition: {
          name: 'safe_coder',
          role: 'Coder',
          description: 'Read-only coder definition',
          systemPrompt: 'Read-only dev',
          enableWriteTools: false,
        },
      });

      expect(tailored.prunedTools).not.toContain('write_file');
      expect(tailored.prunedTools).not.toContain('edit_file');
      expect(tailored.prunedTools).not.toContain('run_command');
      expect(tailored.prunedTools).not.toContain('write_to_file');
      expect(tailored.prunedTools).not.toContain('replace_file_content');
      expect(tailored.prunedTools).not.toContain('execute_command');
    });

    it('preserves execute_command when baseDefinition.enableWriteTools is false but allowedTools explicitly includes execute_command', () => {
      const tailored = DynamicSubagentHarness.tailor({
        taskPrompt: 'Review the changes and run the test suite',
        role: 'reviewer',
        baseDefinition: {
          name: 'reviewer',
          role: 'Code Reviewer & Tester',
          description: 'Specialized in code quality review',
          systemPrompt: 'You are a reviewer',
          allowedTools: ['read_file', 'list_files', 'search_files', 'execute_command', 'ask_question', 'contrastive_probe'],
          enableWriteTools: false,
        },
      });

      expect(tailored.prunedTools).toContain('execute_command');
      expect(tailored.prunedTools).toContain('contrastive_probe');
      expect(tailored.prunedTools).not.toContain('write_to_file');
      expect(tailored.prunedTools).not.toContain('replace_file_content');
    });
  });
});
