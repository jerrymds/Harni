import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { SystemPromptBuilder } from '../src/index.js';

describe('SystemPromptBuilder', () => {
  it('builds system prompt with custom instructions, mode instructions, and tool definitions', () => {
    const tempDir = path.resolve('temp_test_system_prompt');
    const prompt = SystemPromptBuilder.build({
      workspaceRoot: tempDir,
      mode: 'code',
      customInstructions: 'Always follow SOLID principles.',
      tools: [{ name: 'read_file', description: 'Read file', parameters: { type: 'object', properties: {} } }],
    });

    expect(prompt).toContain('SOLID principles');
    expect(prompt).toContain('CURRENT MODE: CODE');
    expect(prompt).toContain('read_file');
  });

  it('handles architect mode and empty custom instructions', () => {
    const prompt = SystemPromptBuilder.build({
      workspaceRoot: '/test',
      mode: 'architect',
    });

    expect(prompt).toContain('CURRENT MODE: ARCHITECT');
    expect(prompt).toBeDefined();
  });

  it('injects Planning Mode and Implementation Plan workflow with scope analysis and verification plan', () => {
    const prompt = SystemPromptBuilder.build({
      workspaceRoot: '/workspace/project',
      mode: 'code',
      tools: [
        { name: 'read_file', description: 'Read file', parameters: { type: 'object', properties: {} } },
        { name: 'ask_question', description: 'Ask question', parameters: { type: 'object', properties: {} } },
      ],
    });

    // Planning mode section
    expect(prompt).toContain('==== PLANNING MODE & IMPLEMENTATION PLAN WORKFLOW ====');
    // Scope analysis
    expect(prompt).toContain('[When to Plan]');
    expect(prompt).toContain('[When NOT to Plan]');
    expect(prompt).toContain('Major architectural or systemic changes');
    expect(prompt).toContain('Is investigatory in nature');
    // 5-step workflow
    expect(prompt).toContain('1. **Research (調研階段)**:');
    expect(prompt).toContain('2. **Create Implementation Plan (產生實作與驗證計劃)**:');
    expect(prompt).toContain('3. **Obtain User Approval (暫停等待使用者批准)**:');
    expect(prompt).toContain('4. **Execute (執行修改)**:');
    expect(prompt).toContain('5. **Verify (驗證成果)**:');
    // Plan structure & Verification Plan
    expect(prompt).toContain('## Proposed Changes');
    expect(prompt).toContain('## Verification Plan');
    expect(prompt).toContain('Automated Tests');
    expect(prompt).toContain('Manual Verification');
    expect(prompt).toContain('ask_question');
  });
});

