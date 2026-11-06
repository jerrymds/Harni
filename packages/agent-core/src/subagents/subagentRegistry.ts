import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { LLMProviderType, SubagentDefinition, SubagentModelTier } from '@harni/types';
import { ClinerulesParser } from './clinerulesParser.js';

export class SubagentRegistry {
  private definitions = new Map<string, SubagentDefinition>();
  private modelTierMap: Partial<Record<SubagentModelTier, string>> = {};

  public setModelTierMap(map: Partial<Record<SubagentModelTier, string>>): void {
    this.modelTierMap = { ...this.modelTierMap, ...map };
  }

  public getModelTierMap(): Partial<Record<SubagentModelTier, string>> {
    return { ...this.modelTierMap };
  }

  public static resolveModel(options: {
    explicitModel?: string;
    definition?: SubagentDefinition;
    provider?: LLMProviderType;
    parentModel?: string;
    customTierMap?: Partial<Record<SubagentModelTier, string>>;
  }): string | undefined {
    const { explicitModel, definition, provider, parentModel, customTierMap } = options;

    const isTierKeyword = (m?: string): m is SubagentModelTier =>
      m === 'fast' || m === 'reasoning' || m === 'inherit';

    if (explicitModel && !isTierKeyword(explicitModel)) {
      return explicitModel;
    }

    if (definition?.model && !isTierKeyword(definition.model) && !explicitModel) {
      return definition.model;
    }

    const tier: SubagentModelTier = isTierKeyword(explicitModel)
      ? explicitModel
      : (definition?.modelTier || (isTierKeyword(definition?.model) ? definition.model : undefined) || 'inherit');

    if (customTierMap?.[tier]) {
      return customTierMap[tier];
    }

    if (tier === 'fast') {
      if (provider === 'antigravity') return 'gemini-3.8-flash';
      if (provider === 'anthropic') return 'claude-3-5-haiku-latest';
      if (provider === 'openai') return 'gpt-4o-mini';
      return parentModel || definition?.model;
    }

    if (tier === 'reasoning') {
      if (provider === 'antigravity') return 'gemini-3.8-pro';
      if (provider === 'anthropic') return 'claude-3-7-sonnet-latest';
      if (provider === 'openai') return 'o3-mini';
      return parentModel || definition?.model;
    }

    return parentModel || definition?.model;
  }

  public resolveModel(options: {
    explicitModel?: string;
    definition?: SubagentDefinition;
    provider?: LLMProviderType;
    parentModel?: string;
    customTierMap?: Partial<Record<SubagentModelTier, string>>;
  }): string | undefined {
    return SubagentRegistry.resolveModel({
      ...options,
      customTierMap: options.customTierMap || this.modelTierMap,
    });
  }

  constructor(registerDefaults = true) {
    if (registerDefaults) {
      this.registerDefaults();
    }
  }

  public register(def: SubagentDefinition): void {
    this.definitions.set(def.name.toLowerCase(), def);
  }

  public normalizeArchetypeName(name: string): string {
    const lower = name.toLowerCase();
    if (lower === 'agy-researcher') return 'researcher';
    if (lower === 'agy-worker' || lower === 'agy') return 'coder';
    if (lower === 'agy-tester') return 'reviewer';
    return lower;
  }

  public get(name: string): SubagentDefinition | undefined {
    return this.definitions.get(this.normalizeArchetypeName(name));
  }

  public has(name: string): boolean {
    return this.definitions.has(this.normalizeArchetypeName(name));
  }

  public getAll(): SubagentDefinition[] {
    return Array.from(this.definitions.values());
  }

  public remove(name: string): boolean {
    return this.definitions.delete(this.normalizeArchetypeName(name));
  }

  /**
   * Parse markdown rules and apply subagent roles and models
   */
  public loadRulesFromContent(content: string, isDedicatedSubagentFile = false): number {
    const rules = ClinerulesParser.parse(content, isDedicatedSubagentFile);
    return ClinerulesParser.applyRules(rules, this.definitions);
  }

  /**
   * Discover and parse .clinerules in the workspace root.
   * Supports .clinerules as a directory (with sub-agent.md and various markdown files)
   * as well as a single .clinerules file for backward compatibility.
   */
  public async loadFromWorkspace(workspaceRoot: string): Promise<number> {
    const clinerulesDir = path.join(workspaceRoot, '.clinerules');
    let totalApplied = 0;

    try {
      const stats = await fs.stat(clinerulesDir);
      if (stats.isDirectory()) {
        const files = await fs.readdir(clinerulesDir);
        const dedicatedNames = ['sub-agent.md', 'subagent.md', 'subagents.md'];

        for (const file of files) {
          if (!file.endsWith('.md')) continue;
          const filePath = path.join(clinerulesDir, file);
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            const isDedicated = dedicatedNames.includes(file.toLowerCase());
            totalApplied += this.loadRulesFromContent(content, isDedicated);
          } catch {
            // Ignore unreadable file
          }
        }
        return totalApplied;
      }
    } catch {
      // .clinerules is not a directory or does not exist
    }

    // Fallback: check .clinerules or .clinerules.md as single files
    const candidateFiles = ['.clinerules', '.clinerules.md'];
    for (const file of candidateFiles) {
      const fullPath = path.join(workspaceRoot, file);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        return this.loadRulesFromContent(content, false);
      } catch {
        // file doesn't exist or cannot be read, continue
      }
    }

    return 0;
  }

  private registerDefaults(): void {
    // 1. Researcher / Codebase Explorer (Read-only)
    this.register({
      name: 'researcher',
      role: 'Codebase Researcher',
      description:
        'Specialized in exploring the codebase, reading files, searching patterns, and analyzing architecture. Read-only access.',
      systemPrompt: `You are a specialized Codebase Researcher subagent.
Your goal is to investigate code, discover patterns, understand architecture, and deliver concise, structured, and factual reports to your parent agent.
- You have read-only access to files and workspace search.
- When referencing code, always cite specific file paths and line ranges.
- Provide actionable findings, structural summaries, and concrete recommendations.
- Do NOT attempt to edit files or run non-existent modifying tools.
- Once you have gathered sufficient information, synthesize your findings and present your complete final report.`,
      allowedTools: ['read_file', 'list_files', 'search_files', 'ask_question'],
      enableWriteTools: false,
      enableSubagentTools: false,
      enableMcpTools: true,
      modelTier: 'fast',
      maxTurns: 15,
    });

    // 2. Coder / Software Implementer (Full read/write)
    this.register({
      name: 'coder',
      role: 'Code Implementer',
      description:
        'Specialized in implementing code changes, creating/editing files, and executing build or format commands.',
      systemPrompt: `You are a specialized Code Implementer subagent.
Your goal is to implement features, bug fixes, or refactoring as requested by your parent orchestrator.
- Adhere strictly to existing coding styles, conventions, and architectural patterns of the workspace.
- Make targeted, precise edits. When creating new files or modifying existing ones, ensure clean syntax and imports.
- After making edits, report exactly which files were modified and summarize what changes were implemented.`,
      allowedTools: [
        'read_file',
        'write_to_file',
        'replace_file_content',
        'list_files',
        'search_files',
        'execute_command',
        'ask_question',
      ],
      enableWriteTools: true,
      enableSubagentTools: false,
      enableMcpTools: true,
      modelTier: 'inherit',
      maxTurns: 20,
    });

    // 3. Reviewer / Test Engineer
    this.register({
      name: 'reviewer',
      role: 'Code Reviewer & Tester',
      description:
        'Specialized in code quality review, running test suites, verifying diffs, and identifying security or edge-case bugs.',
      systemPrompt: `You are a specialized Code Reviewer & Tester subagent.
Your goal is to inspect code quality, run automated tests, identify potential bugs or performance bottlenecks, and verify correctness.
- Use execute_command to run test runners (e.g. vitest, pytest, npm test).
- Analyze failures carefully, pinpoint the root cause, and provide actionable resolution steps.
- Summarize your review findings clearly with pass/fail metrics and identified risks.`,
      allowedTools: ['read_file', 'list_files', 'search_files', 'execute_command', 'ask_question'],
      enableWriteTools: false,
      enableSubagentTools: false,
      enableMcpTools: false,
      modelTier: 'reasoning',
      maxTurns: 15,
    });

    // 4. Architect / High-level Planner
    this.register({
      name: 'architect',
      role: 'System Architect',
      description:
        'Specialized in architectural design, component boundaries, interface contracts, and task decomposition.',
      systemPrompt: `You are a specialized System Architect subagent.
Your goal is to analyze project architecture, evaluate trade-offs, define module interfaces, and produce high-level designs or ADRs.
- Explore existing abstractions, dependencies, and protocols.
- Deliver structured architectural blueprints with clear diagrams, contracts, and component responsibilities.`,
      allowedTools: ['read_file', 'list_files', 'search_files', 'ask_question'],
      enableWriteTools: false,
      enableSubagentTools: false,
      enableMcpTools: false,
      modelTier: 'reasoning',
      maxTurns: 15,
    });

    // 5. Self (Subagent that inherits parent capabilities in an isolated context)
    this.register({
      name: 'self',
      role: 'General Purpose Subagent',
      description:
        'Inherits full tool capabilities from the parent agent in an isolated context window.',
      systemPrompt: `You are a subagent running an isolated task delegated by the parent orchestrator.
Accomplish the requested objective thoroughly and report your results back cleanly.`,
      enableWriteTools: true,
      enableSubagentTools: true,
      enableMcpTools: true,
      modelTier: 'inherit',
      maxTurns: 20,
    });
  }
}
