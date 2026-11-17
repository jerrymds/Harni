import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  PluginPriority,
  type SystemPromptSection,
  type WorkflowPlugin,
  type WorkflowPluginCategory,
  type WorkflowPluginContext,
} from '@harni/types';
import type { SkillRegistry } from '../skills/skillRegistry.js';
import type { SubagentManager } from '../subagents/subagentManager.js';

export interface RulesAndSkillsPluginOptions {
  skillRegistry: SkillRegistry;
  subagentManager: SubagentManager;
  getBaseCustomInstructions?: () => string | undefined;
}

interface FileCacheEntry {
  mtimeMs: number;
  content: string;
}

export class RulesAndSkillsPlugin implements WorkflowPlugin {
  public readonly id = 'harni.rules-skills';
  public readonly name = 'Rules & Skills Discovery Plugin';
  public readonly description =
    'Discovers workspace skills and parses .harnirules custom instructions.';
  public readonly priority = PluginPriority.DISCOVERY;
  public readonly category: WorkflowPluginCategory = 'context';
  public readonly isBuiltin = true;
  public enabled = true;
  public applyToSubagents = false;

  private harnirulesCache = new Map<string, FileCacheEntry>();

  constructor(private options: RulesAndSkillsPluginOptions) {}

  public async onTaskStart(ctx: WorkflowPluginContext): Promise<void> {
    try {
      await this.options.skillRegistry.discoverWorkspaceSkills(ctx.getWorkspaceRoot());
      await this.options.subagentManager.loadWorkspaceHarnirules(ctx.getWorkspaceRoot());
    } catch {
      // Safe to ignore skill/rules discovery failure
    }
  }

  public async readHarnirules(workspaceRoot: string): Promise<string | undefined> {
    try {
      const rulesTarget = path.join(workspaceRoot, '.harnirules');
      const stats = await fs.stat(rulesTarget);

      if (stats.isDirectory()) {
        const files = await fs.readdir(rulesTarget);
        const mdFiles = files.filter((f) => f.endsWith('.md')).sort();
        const contents: string[] = [];

        for (const mdFile of mdFiles) {
          try {
            const filePath = path.join(rulesTarget, mdFile);
            const fileStat = await fs.stat(filePath);
            const cached = this.harnirulesCache.get(filePath);

            let fileContent: string;
            if (cached && cached.mtimeMs === fileStat.mtimeMs) {
              fileContent = cached.content;
            } else {
              fileContent = await fs.readFile(filePath, 'utf-8');
              this.harnirulesCache.set(filePath, {
                mtimeMs: fileStat.mtimeMs,
                content: fileContent,
              });
            }

            if (fileContent.trim()) {
              contents.push(`=== .harnirules/${mdFile} ===\n${fileContent.trim()}`);
            }
          } catch {
            // Ignore unreadable file
          }
        }

        if (contents.length > 0) {
          return contents.join('\n\n');
        }
      } else {
        const cached = this.harnirulesCache.get(rulesTarget);
        let rulesText: string;

        if (cached && cached.mtimeMs === stats.mtimeMs) {
          rulesText = cached.content;
        } else {
          rulesText = await fs.readFile(rulesTarget, 'utf-8');
          this.harnirulesCache.set(rulesTarget, {
            mtimeMs: stats.mtimeMs,
            content: rulesText,
          });
        }

        if (rulesText.trim()) {
          return rulesText.trim();
        }
      }
    } catch {
      // Safe to ignore if .harnirules does not exist
    }

    return undefined;
  }

  public async resolveEffectiveCustomInstructions(
    workspaceRoot: string,
    baseCustomInstructions?: string,
  ): Promise<string | undefined> {
    let effective =
      baseCustomInstructions ??
      (this.options.getBaseCustomInstructions ? this.options.getBaseCustomInstructions() : undefined);

    const rules = await this.readHarnirules(workspaceRoot);
    if (rules) {
      effective = effective ? `${effective}\n\n${rules}` : rules;
    }

    return effective;
  }

  public getSkillsFormatted(): string {
    return this.options.skillRegistry.formatSkillsForPrompt();
  }

  public async onBuildSystemPrompt(
    ctx: WorkflowPluginContext,
  ): Promise<SystemPromptSection[]> {
    if (!this.enabled) return [];
    const sections: SystemPromptSection[] = [];

    const formattedSkills = this.options.skillRegistry.formatSkillsForPrompt();
    if (formattedSkills && formattedSkills.trim()) {
      sections.push({
        id: 'harni.skills',
        content: formattedSkills.trim(),
        order: 70,
      });
    }

    const rulesContent = await this.readHarnirules(ctx.getWorkspaceRoot());
    if (rulesContent && rulesContent.trim()) {
      sections.push({
        id: 'harni.harnirules',
        content: `==== WORKSPACE RULES (.harnirules) ====\n${rulesContent.trim()}`,
        order: 100,
      });
    }

    return sections;
  }
}
