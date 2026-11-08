import type { SubagentDefinition } from './agent.js';
import type { HarnessExperience } from './harness.js';

/**
 * High-level intent classification for tailored subagent delegation.
 */
export type SubagentTaskIntent =
  | 'investigation'
  | 'surgical_edit'
  | 'implementation'
  | 'review_testing'
  | 'general';

/**
 * Resulting tailored harness configuration for subagents.
 */
export interface TailoredSubagentConfig {
  intent: SubagentTaskIntent;
  prunedTools: string[];
  systemPrompt: string;
  confidenceScore: number;
  appliedExperiences?: string[];
  constraints: string[];
}

/**
 * Options provided to the subagent tailoring process.
 */
export interface TailorSubagentOptions {
  taskPrompt: string;
  role?: string;
  baseDefinition?: SubagentDefinition;
  availableTools?: string[];
  experiences?: HarnessExperience[];
  customConstraints?: string[];
  skipIntentPruning?: boolean;
}
