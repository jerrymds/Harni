export type HarnessExperienceCategory =
  | 'bug_fix'
  | 'workflow'
  | 'architectural'
  | 'tool_usage'
  | 'pitfall';

export interface HarnessExperience {
  id: string;
  title: string;
  category: HarnessExperienceCategory;
  tags: string[];
  summary: string;
  triggerCondition?: string;
  actionableGuidance: string;
  relatedFiles?: string[];
  confidenceScore?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ExperienceSearchOptions {
  query?: string;
  category?: HarnessExperienceCategory;
  tags?: string[];
  limit?: number;
  minScore?: number;
}

export interface HarnessSynthesisInput {
  taskDescription: string;
  successfulActions: string[];
  encounteredErrors?: string[];
  keyFiles?: string[];
  category?: HarnessExperienceCategory;
  tags?: string[];
}
