export interface ProbeCandidate {
  id: string;
  name: string;
  description: string;
  patchDiff?: string;
  codeSnippets?: Array<{ file: string; content: string }>;
  metadata?: Record<string, unknown>;
}

export interface ProbeEvaluationCriteria {
  correctnessWeight?: number;
  minimalInvasivenessWeight?: number;
  safetyWeight?: number;
  maintainabilityWeight?: number;
}

export interface CandidateEvaluationScore {
  candidateId: string;
  correctness: number;
  minimalInvasiveness: number;
  safety: number;
  maintainability: number;
  totalScore: number;
  pros: string[];
  cons: string[];
}

export interface ContrastiveProbeResult {
  status: 'ok' | 'parse_failed' | 'no_valid_candidates';
  winnerId: string;
  winnerName: string;
  confidence: number;
  comparisonSummary: string;
  rationale: string;
  candidateScores: Record<string, CandidateEvaluationScore>;
  improvementSuggestions?: string[];
}
