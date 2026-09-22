/**
 * Skill category classification
 */
export type SkillCategory =
  | 'workflow'
  | 'testing'
  | 'git'
  | 'refactor'
  | 'architecture'
  | 'mcp'
  | 'custom';

/**
 * Definition of an Agent Skill
 */
export interface AgentSkill {
  name: string;
  description: string;
  category?: SkillCategory;
  /**
   * Detailed domain-specific SOP instructions injected when the skill is used
   */
  instructions: string;
  /**
   * Tools required or recommended for this skill
   */
  requiredTools?: string[];
  /**
   * Optional custom parameters schema if the skill accepts arguments
   */
  parameters?: Record<string, unknown>;
  /**
   * File path where the skill was loaded from (if from workspace .skills/)
   */
  sourcePath?: string;
  /**
   * Optional direct execution handler
   */
  execute?: (
    params: Record<string, unknown>,
    context: unknown,
  ) => Promise<{
    output: string | Record<string, unknown>;
    isError?: boolean;
    summary?: string;
  }>;
}

/**
 * Parameters for invoking the use_skill tool
 */
export interface UseSkillParams {
  skillName: string;
  input?: string | Record<string, unknown>;
}

/**
 * Result of skill execution or activation
 */
export interface SkillResult {
  skillName: string;
  status: 'activated' | 'completed' | 'error';
  instructions: string;
  output?: string | Record<string, unknown>;
}
