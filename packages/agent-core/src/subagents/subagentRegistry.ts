import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SubagentDefinition } from '@harni/types';
import { ClinerulesParser } from './clinerulesParser.js';

export class SubagentRegistry {
  private definitions = new Map<string, SubagentDefinition>();

  constructor(registerDefaults = true) {
    if (registerDefaults) {
      this.registerDefaults();
    }
  }

  public register(def: SubagentDefinition): void {
    this.definitions.set(def.name.toLowerCase(), def);
  }

  public get(name: string): SubagentDefinition | undefined {
    return this.definitions.get(name.toLowerCase());
  }

  public has(name: string): boolean {
    return this.definitions.has(name.toLowerCase());
  }

  public getAll(): SubagentDefinition[] {
    return Array.from(this.definitions.values());
  }

  public remove(name: string): boolean {
    return this.definitions.delete(name.toLowerCase());
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
      allowedTools: ['read_file', 'list_files', 'search_files'],
      enableWriteTools: false,
      enableSubagentTools: false,
      enableMcpTools: false,
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
      ],
      enableWriteTools: true,
      enableSubagentTools: false,
      enableMcpTools: true,
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
      allowedTools: ['read_file', 'list_files', 'search_files', 'execute_command'],
      enableWriteTools: false,
      enableSubagentTools: false,
      enableMcpTools: false,
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
      allowedTools: ['read_file', 'list_files', 'search_files'],
      enableWriteTools: false,
      enableSubagentTools: false,
      enableMcpTools: false,
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
      maxTurns: 20,
    });

    // 6. AGY Worker / Antigravity CLI Autonomous Subagent
    this.register({
      name: 'agy',
      role: 'Antigravity Autonomous Subagent',
      description:
        'Executes autonomous tasks via Antigravity CLI (agy) child process with full tool and reasoning capabilities.',
      systemPrompt:
        'You are an autonomous subagent powered by Antigravity CLI. Accomplish the assigned coding task precisely and efficiently.',
      runnerType: 'agy',
      agyOptions: {
        timeoutMs: 300_000,
      },
      maxTurns: 20,
    });

    this.register({
      name: 'agy-worker',
      role: 'Antigravity Autonomous Worker',
      description:
        'Executes autonomous full-stack coding tasks via Antigravity CLI (agy) with file and command tools.',
      systemPrompt:
        'You are an autonomous coding worker powered by Antigravity CLI. Write clean code, run tests, and report results concisely.',
      runnerType: 'agy',
      agyOptions: {
        mode: 'accept-edits',
        timeoutMs: 300_000,
      },
      maxTurns: 25,
    });

    // 7. AGY Researcher
    this.register({
      name: 'agy-researcher',
      role: 'Antigravity Codebase Researcher',
      description:
        'Specialized in codebase exploration, architecture analysis, and search using Antigravity CLI.',
      systemPrompt:
        'You are a specialized codebase researcher powered by Antigravity CLI. Investigate and provide structured reports. Keep your file exploration efficient: avoid deep recursive exploration into build outputs, dist, or node_modules. Focus on package.json, main configuration files, and core architectural components to deliver a clear and comprehensive summary promptly.',
      runnerType: 'agy',
      agyOptions: {
        mode: 'plan',
        effort: 'medium',
        timeoutMs: 300_000,
      },
      maxTurns: 15,
    });

    // 8. AGY Tester
    this.register({
      name: 'agy-tester',
      role: 'Antigravity Automated Tester',
      description:
        'Specialized in running test suites, analyzing failures, and repairing broken tests via Antigravity CLI.',
      systemPrompt:
        'You are a testing and quality engineer powered by Antigravity CLI. Run test suites and fix broken tests.',
      runnerType: 'agy',
      agyOptions: {
        effort: 'high',
        timeoutMs: 300_000,
      },
      maxTurns: 20,
    });
  }
}
