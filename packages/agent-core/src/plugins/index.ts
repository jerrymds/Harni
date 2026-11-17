import type { WorkflowPlugin } from '@harni/types';
import { WorkflowPluginManager } from './pluginManager.js';
import { GitWorkspacePlugin, type GitWorkspacePluginOptions } from './gitWorkspacePlugin.js';
import { RulesAndSkillsPlugin, type RulesAndSkillsPluginOptions } from './rulesAndSkillsPlugin.js';
import {
  ExperienceLearningPlugin,
  type ExperienceLearningPluginOptions,
  type ExperiencePluginState,
} from './experienceLearningPlugin.js';
import { ToolGuardPlugin } from './toolGuardPlugin.js';
import { SyntaxDiagnosticsPlugin } from './syntaxDiagnosticsPlugin.js';
import {
  AutoTestRepairPlugin,
  type AutoTestRepairPluginOptions,
  type AutoTestPluginState,
} from './autoTestRepairPlugin.js';
import { RateLimitPlugin } from './rateLimitPlugin.js';

export {
  WorkflowPluginManager,
  GitWorkspacePlugin,
  type GitWorkspacePluginOptions,
  RulesAndSkillsPlugin,
  type RulesAndSkillsPluginOptions,
  ExperienceLearningPlugin,
  type ExperienceLearningPluginOptions,
  type ExperiencePluginState,
  ToolGuardPlugin,
  SyntaxDiagnosticsPlugin,
  AutoTestRepairPlugin,
  type AutoTestRepairPluginOptions,
  type AutoTestPluginState,
  RateLimitPlugin,
};

export interface DefaultWorkflowPluginsConfig {
  gitCheckpointService: import('../git/gitCheckpointService.js').GitCheckpointService;
  skillRegistry: import('../skills/skillRegistry.js').SkillRegistry;
  subagentManager: import('../subagents/subagentManager.js').SubagentManager;
  workspaceRoot: string;
  storageDir?: string;
  getDefaultWorktreeEnabled: () => boolean;
  getDefaultCheckpointEnabled: () => boolean;
  getWorktreeTimeoutMs: () => number;
  getExperienceLearningEnabled: () => boolean;
  getDefaultAutoTestEnabled?: () => boolean;
  getDefaultTestCommand?: () => string | undefined;
  getDefaultMaxTestRetries?: () => number;
  executeTerminalCommand?: (
    command: string,
    cwd?: string,
    onData?: (data: string) => void,
  ) => Promise<{ exitCode: number; output: string }>;
  getBaseCustomInstructions?: () => string | undefined;
  experienceManagersByRoot?: Map<string, import('../harness/experienceManager.js').ExperienceManager>;
}

export function createDefaultWorkflowPlugins(
  config: DefaultWorkflowPluginsConfig,
): WorkflowPlugin[] {
  return [
    new GitWorkspacePlugin({
      gitCheckpointService: config.gitCheckpointService,
      getDefaultWorktreeEnabled: config.getDefaultWorktreeEnabled,
      getDefaultCheckpointEnabled: config.getDefaultCheckpointEnabled,
      getWorktreeTimeoutMs: config.getWorktreeTimeoutMs,
    }),
    new RulesAndSkillsPlugin({
      skillRegistry: config.skillRegistry,
      subagentManager: config.subagentManager,
      getBaseCustomInstructions: config.getBaseCustomInstructions,
    }),
    new ExperienceLearningPlugin({
      workspaceRoot: config.workspaceRoot,
      storageDir: config.storageDir,
      getIsEnabled: config.getExperienceLearningEnabled,
      experienceManagersByRoot: config.experienceManagersByRoot,
    }),
    new ToolGuardPlugin(),
    new SyntaxDiagnosticsPlugin(),
    new AutoTestRepairPlugin({
      gitCheckpointService: config.gitCheckpointService,
      executeTerminalCommand: config.executeTerminalCommand,
      getDefaultEnabled: config.getDefaultAutoTestEnabled,
      getDefaultTestCommand: config.getDefaultTestCommand,
      getDefaultMaxRetries: config.getDefaultMaxTestRetries,
    }),
    new RateLimitPlugin(),
  ];
}
