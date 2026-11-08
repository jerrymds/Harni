import type {
  ProbeCandidate,
  ProbeEvaluationCriteria,
  CandidateEvaluationScore,
  ContrastiveProbeResult,
} from '@harni/types';
import { SyntaxLinterService } from '../diagnostics/syntaxLinterService.js';

export interface ComparisonPromptOptions {
  taskDescription: string;
  candidates: ProbeCandidate[];
  criteria?: ProbeEvaluationCriteria;
  staticDiagnostics?: Record<string, { valid: boolean; errors: string[] }>;
}

export interface EvaluateCandidatesOptions {
  taskDescription: string;
  candidates: ProbeCandidate[];
  llmCaller: (prompt: string) => Promise<string>;
  criteria?: ProbeEvaluationCriteria;
}

export const DEFAULT_PROBE_EVALUATION_CRITERIA: Required<ProbeEvaluationCriteria> = {
  correctnessWeight: 0.35,
  minimalInvasivenessWeight: 0.25,
  safetyWeight: 0.20,
  maintainabilityWeight: 0.20,
};

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function resolveWeight(weight: number | undefined, defaultWeight: number): number {
  if (typeof weight !== 'number' || isNaN(weight) || weight < 0) {
    return defaultWeight;
  }
  return weight;
}

function getCodeFence(content: string, lang = ''): { open: string; close: string } {
  const match = content.match(/`+/g);
  const maxRun = match ? Math.max(...match.map((m) => m.length)) : 0;
  const fence = '`'.repeat(Math.max(3, maxRun + 1));
  return {
    open: lang ? `${fence}${lang}\n` : `${fence}\n`,
    close: `\n${fence}`,
  };
}

export class ContrastiveProbeRunner {
  /**
   * Fast in-memory static syntax diagnostics for candidate code snippets.
   * Leverages SyntaxLinterService to validate TypeScript / JavaScript code.
   */
  public static runStaticDiagnostics(
    snippets?: Array<{ file: string; content: string }>,
  ): { valid: boolean; errors: string[] } {
    if (!snippets || snippets.length === 0) {
      return { valid: true, errors: [] };
    }

    const errors: string[] = [];
    for (const snippet of snippets) {
      const diags = SyntaxLinterService.checkTypeScriptSyntax(snippet.file, snippet.content);
      for (const diag of diags) {
        errors.push(`[${snippet.file}:${diag.line}:${diag.column}] (${diag.code}) ${diag.message}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Constructs a structured side-by-side comparison prompt for LLM evaluation.
   */
  public static buildComparisonPrompt(options: {
    taskDescription: string;
    candidates: ProbeCandidate[];
    criteria?: ProbeEvaluationCriteria;
    staticDiagnostics?: Record<string, { valid: boolean; errors: string[] }>;
  }): string {
    const weights = {
      correctnessWeight: resolveWeight(
        options.criteria?.correctnessWeight,
        DEFAULT_PROBE_EVALUATION_CRITERIA.correctnessWeight,
      ),
      minimalInvasivenessWeight: resolveWeight(
        options.criteria?.minimalInvasivenessWeight,
        DEFAULT_PROBE_EVALUATION_CRITERIA.minimalInvasivenessWeight,
      ),
      safetyWeight: resolveWeight(
        options.criteria?.safetyWeight,
        DEFAULT_PROBE_EVALUATION_CRITERIA.safetyWeight,
      ),
      maintainabilityWeight: resolveWeight(
        options.criteria?.maintainabilityWeight,
        DEFAULT_PROBE_EVALUATION_CRITERIA.maintainabilityWeight,
      ),
    };

    const candidatesBlock = options.candidates
      .map((candidate, idx) => {
        const diag = options.staticDiagnostics?.[candidate.id];
        let diagSection = '';
        if (diag) {
          if (!diag.valid && diag.errors.length > 0) {
            diagSection =
              `\n#### Static Syntax Diagnostics:\n⚠️ WARNING: Static syntax errors detected in this candidate:\n` +
              diag.errors.map((e) => `- ${e}`).join('\n') +
              '\n';
          } else {
            diagSection = `\n#### Static Syntax Diagnostics:\n✅ PASSED (No syntax errors detected)\n`;
          }
        } else if (
          !diag &&
          candidate.patchDiff &&
          (!candidate.codeSnippets || candidate.codeSnippets.length === 0)
        ) {
          diagSection = `\n#### Static Syntax Diagnostics:\nℹ️ SKIPPED (Patch-diff only; static AST check not applicable)\n`;
        }

        let patchSection = '';
        if (candidate.patchDiff) {
          const { open, close } = getCodeFence(candidate.patchDiff, 'diff');
          patchSection = `\n#### Patch Diff:\n${open}${candidate.patchDiff}${close}\n`;
        }

        let snippetSection = '';
        if (candidate.codeSnippets && candidate.codeSnippets.length > 0) {
          snippetSection =
            `\n#### Code Snippets:\n` +
            candidate.codeSnippets
              .map((s) => {
                const { open, close } = getCodeFence(s.content);
                return `File: \`${s.file}\`\n${open}${s.content}${close}`;
              })
              .join('\n\n') +
            '\n';
        }

        let metaSection = '';
        if (candidate.metadata && Object.keys(candidate.metadata).length > 0) {
          const metaStr = JSON.stringify(candidate.metadata, null, 2);
          const { open, close } = getCodeFence(metaStr, 'json');
          metaSection = `\n#### Metadata:\n${open}${metaStr}${close}\n`;
        }

        return `### Candidate ${idx + 1}: ${candidate.name} (ID: ${candidate.id})
- **Description**: ${candidate.description}
${diagSection}${metaSection}${patchSection}${snippetSection}`;
      })
      .join('\n---\n\n');

    return `You are an expert software engineer and code reviewer performing a contrastive probe evaluation.
Your task is to compare and evaluate multiple candidate solutions side-by-side for the task described below, and select the best candidate based on weighted evaluation criteria.

## Task Description
${options.taskDescription}

## Evaluation Criteria & Weights
- Correctness (Weight: ${weights.correctnessWeight}): Does the candidate accurately and completely solve the task without regressions?
- Minimal Invasiveness (Weight: ${weights.minimalInvasivenessWeight}): Is the candidate concise and focused, modifying only what is strictly necessary without premature refactoring or bloat?
- Safety (Weight: ${weights.safetyWeight}): Does the candidate handle edge cases, error conditions, exceptions, and avoid security vulnerabilities?
- Maintainability (Weight: ${weights.maintainabilityWeight}): Is the code readable, idiomatic, clean, and easy to maintain?

## Candidate Solutions
${candidatesBlock}

## Evaluation Instructions
1. Conduct a rigorous side-by-side comparative analysis of each candidate against the task requirements.
2. If static diagnostics detected syntax errors in a candidate, penalize its correctness and safety scores heavily.
3. Score each candidate from 0 to 100 for each dimension: correctness, minimalInvasiveness, safety, maintainability.
4. Calculate the weighted totalScore for each candidate based on the specified criteria weights.
5. In case of a tie in totalScore, prefer the candidate with higher minimalInvasiveness.
6. Provide specific pros and cons for each candidate.
7. Return your evaluation strictly as a valid JSON object matching the JSON schema below. Do NOT output any markdown wrappers, conversational text, or explanations outside the JSON object.

\`\`\`json
{
  "winnerId": "<candidate ID of the winning solution>",
  "winnerName": "<name of the winning solution>",
  "confidence": <confidence score between 0.0 and 1.0>,
  "comparisonSummary": "<high-level executive summary comparing the candidates>",
  "rationale": "<in-depth rationale explaining why the winner was chosen>",
  "candidateScores": {
    "<candidateId>": {
      "candidateId": "<candidateId>",
      "correctness": <0-100 score>,
      "minimalInvasiveness": <0-100 score>,
      "safety": <0-100 score>,
      "maintainability": <0-100 score>,
      "totalScore": <0-100 weighted total score>,
      "pros": ["<pro 1>", "<pro 2>"],
      "cons": ["<con 1>", "<con 2>"]
    }
  },
  "improvementSuggestions": ["<suggestion 1>", "<suggestion 2>"]
}
\`\`\`
`;
  }

  /**
   * Parses the raw LLM evaluation output, strips markdown code fences,
   * recalibrates weighted total scores, and applies tie-breaking & syntax guardrail rules.
   */
  public static parseEvaluationOutput(
    output: string,
    candidates: ProbeCandidate[],
    criteria?: ProbeEvaluationCriteria,
    staticDiagnostics?: Record<string, { valid: boolean; errors: string[] }>,
  ): ContrastiveProbeResult {
    const wCorr = resolveWeight(
      criteria?.correctnessWeight,
      DEFAULT_PROBE_EVALUATION_CRITERIA.correctnessWeight,
    );
    const wInv = resolveWeight(
      criteria?.minimalInvasivenessWeight,
      DEFAULT_PROBE_EVALUATION_CRITERIA.minimalInvasivenessWeight,
    );
    const wSafe = resolveWeight(
      criteria?.safetyWeight,
      DEFAULT_PROBE_EVALUATION_CRITERIA.safetyWeight,
    );
    const wMaint = resolveWeight(
      criteria?.maintainabilityWeight,
      DEFAULT_PROBE_EVALUATION_CRITERIA.maintainabilityWeight,
    );
    const totalWeight = wCorr + wInv + wSafe + wMaint || 1;
    const normCorr = wCorr / totalWeight;
    const normInv = wInv / totalWeight;
    const normSafe = wSafe / totalWeight;
    const normMaint = wMaint / totalWeight;

    // Handle empty candidates list
    if (!candidates || candidates.length === 0) {
      return {
        status: 'parse_failed',
        winnerId: '',
        winnerName: '',
        confidence: 0,
        comparisonSummary: 'No candidates provided for evaluation.',
        rationale: 'No candidates available.',
        candidateScores: {},
        improvementSuggestions: [],
      };
    }

    let parsed: unknown = null;
    const trimmed = (output || '').trim();

    // 1. Attempt extracting from markdown code block
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) {
      try {
        parsed = JSON.parse(fenceMatch[1].trim());
      } catch {
        // continue to next attempts
      }
    }

    // 2. Direct JSON parsing
    if (!parsed) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // continue to next attempts
      }
    }

    // 3. Fallback to substring between outermost braces
    if (!parsed) {
      const firstBrace = trimmed.indexOf('{');
      const lastBrace = trimmed.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        try {
          parsed = JSON.parse(trimmed.substring(firstBrace, lastBrace + 1));
        } catch {
          // parsing failed
        }
      }
    }

    // Defensive fallback if parsing completely failed or produced non-object (F6)
    if (!isRecord(parsed)) {
      const fallbackScores: Record<string, CandidateEvaluationScore> = {};
      for (const c of candidates) {
        fallbackScores[c.id] = {
          candidateId: c.id,
          correctness: 50,
          minimalInvasiveness: 50,
          safety: 50,
          maintainability: 50,
          totalScore: Number(
            (50 * normCorr + 50 * normInv + 50 * normSafe + 50 * normMaint).toFixed(2),
          ),
          pros: [],
          cons: ['Evaluation output could not be parsed as valid JSON.'],
        };
      }

      return {
        status: 'parse_failed',
        winnerId: '',
        winnerName: '',
        confidence: 0,
        comparisonSummary:
          'Evaluation output could not be parsed as valid JSON. Safe fallback result generated.',
        rationale: 'LLM returned invalid or malformed output.',
        candidateScores: fallbackScores,
        improvementSuggestions: [],
      };
    }

    const rawScores = isRecord(parsed.candidateScores) ? parsed.candidateScores : {};

    // Check candidateScores keys matching candidate IDs or candidate Names (F6)
    const hasDirectIdMatch = candidates.some((c) => rawScores[c.id] !== undefined);
    const scoresById: Record<string, unknown> = {};

    if (hasDirectIdMatch) {
      for (const c of candidates) {
        if (rawScores[c.id] !== undefined) {
          scoresById[c.id] = rawScores[c.id];
        }
      }
    } else {
      // Try matching by candidate name
      const nameToId = new Map<string, string>();
      for (const c of candidates) {
        nameToId.set(c.name.toLowerCase().trim(), c.id);
      }
      for (const [key, val] of Object.entries(rawScores)) {
        const mappedId = nameToId.get(key.toLowerCase().trim());
        if (mappedId) {
          scoresById[mappedId] = val;
        }
      }
    }

    // If none of candidateScores keys match candidate IDs or names -> parse_failed (F6)
    if (Object.keys(scoresById).length === 0) {
      const fallbackScores: Record<string, CandidateEvaluationScore> = {};
      for (const c of candidates) {
        fallbackScores[c.id] = {
          candidateId: c.id,
          correctness: 50,
          minimalInvasiveness: 50,
          safety: 50,
          maintainability: 50,
          totalScore: Number(
            (50 * normCorr + 50 * normInv + 50 * normSafe + 50 * normMaint).toFixed(2),
          ),
          pros: [],
          cons: ['Evaluation output could not be mapped to candidate IDs or names.'],
        };
      }

      return {
        status: 'parse_failed',
        winnerId: '',
        winnerName: '',
        confidence: 0,
        comparisonSummary: 'Candidate scores could not be mapped to candidate IDs or names.',
        rationale: 'None of candidateScores keys matched candidate IDs or names.',
        candidateScores: fallbackScores,
        improvementSuggestions: [],
      };
    }

    const clampScore = (val: unknown): number => {
      if (typeof val !== 'number' || isNaN(val)) return 0;
      return Math.max(0, Math.min(100, val));
    };

    const candidateScores: Record<string, CandidateEvaluationScore> = {};
    for (const candidate of candidates) {
      const raw = isRecord(scoresById[candidate.id])
        ? (scoresById[candidate.id] as Record<string, unknown>)
        : {};

      let correctness = clampScore(raw.correctness);
      const minimalInvasiveness = clampScore(raw.minimalInvasiveness);
      let safety = clampScore(raw.safety);
      const maintainability = clampScore(raw.maintainability);

      const pros = Array.isArray(raw.pros) ? raw.pros.map(String) : [];
      const cons = Array.isArray(raw.cons) ? raw.cons.map(String) : [];

      // F4: Static syntax diagnostics check
      const diag = staticDiagnostics?.[candidate.id];
      if (diag && !diag.valid) {
        correctness = Math.min(20, correctness);
        safety = Math.min(20, safety);
        if (!cons.includes('Static syntax errors detected')) {
          cons.push('Static syntax errors detected');
        }
      }

      // Recalculate totalScore according to normalized criteria weights
      const totalScore = Number(
        (
          correctness * normCorr +
          minimalInvasiveness * normInv +
          safety * normSafe +
          maintainability * normMaint
        ).toFixed(2),
      );

      candidateScores[candidate.id] = {
        candidateId: candidate.id,
        correctness,
        minimalInvasiveness,
        safety,
        maintainability,
        totalScore,
        pros,
        cons,
      };
    }

    // Determine status & valid candidates (F4, F6)
    const isValidCandidate = (c: ProbeCandidate) => {
      if (!staticDiagnostics || !staticDiagnostics[c.id]) return true;
      return staticDiagnostics[c.id].valid;
    };

    const hasValidCandidate = candidates.some(isValidCandidate);
    const allInvalid =
      staticDiagnostics !== undefined &&
      Object.keys(staticDiagnostics).length > 0 &&
      candidates.length > 0 &&
      candidates.every((c) => !isValidCandidate(c));

    const status: 'ok' | 'parse_failed' | 'no_valid_candidates' = allInvalid
      ? 'no_valid_candidates'
      : 'ok';

    // Sort candidates:
    // 1. Highest totalScore
    // 2. Tie-break: Highest minimalInvasiveness
    const sorted = [...candidates].sort((a, b) => {
      const scoreA = candidateScores[a.id]?.totalScore ?? 0;
      const scoreB = candidateScores[b.id]?.totalScore ?? 0;
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }
      const invA = candidateScores[a.id]?.minimalInvasiveness ?? 0;
      const invB = candidateScores[b.id]?.minimalInvasiveness ?? 0;
      if (invB !== invA) {
        return invB - invA;
      }
      return 0;
    });

    // F4: If at least one valid candidate exists, an invalid one must never be the winner.
    const eligiblePool = hasValidCandidate && staticDiagnostics
      ? sorted.filter(isValidCandidate)
      : sorted;

    const topTotal = candidateScores[eligiblePool[0].id]?.totalScore ?? 0;
    const topInv = candidateScores[eligiblePool[0].id]?.minimalInvasiveness ?? 0;
    const tiedTops = eligiblePool.filter((c) => {
      const s = candidateScores[c.id];
      return s && s.totalScore === topTotal && s.minimalInvasiveness === topInv;
    });

    let winner = eligiblePool[0];
    const parsedWinnerId = typeof parsed.winnerId === 'string' ? parsed.winnerId.trim() : '';
    if (tiedTops.length > 1 && parsedWinnerId) {
      const matched = tiedTops.find((c) => c.id === parsedWinnerId);
      if (matched) {
        winner = matched;
      }
    }

    const confidence =
      typeof parsed.confidence === 'number' && !isNaN(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.8;

    const wasDisqualifiedBySyntax =
      Boolean(parsedWinnerId) &&
      parsedWinnerId !== winner.id &&
      staticDiagnostics?.[parsedWinnerId]?.valid === false;

    const rawSummary =
      typeof parsed.comparisonSummary === 'string' && parsed.comparisonSummary.trim()
        ? parsed.comparisonSummary.trim()
        : '';
    const comparisonSummary = wasDisqualifiedBySyntax
      ? `[Note: LLM initially favored "${parsedWinnerId}", which was disqualified due to static syntax errors. "${winner.name}" (${winner.id}) was selected instead.] ${rawSummary}`.trim()
      : rawSummary || `Evaluated ${candidates.length} candidates. Solution "${winner.name}" selected.`;

    const rawRationale =
      typeof parsed.rationale === 'string' && parsed.rationale.trim()
        ? parsed.rationale.trim()
        : '';
    const rationale = wasDisqualifiedBySyntax
      ? `Candidate "${winner.name}" (${winner.id}) selected as the highest-scoring syntactically valid solution after "${parsedWinnerId}" failed static syntax diagnostics.${rawRationale ? ` (Original LLM rationale: ${rawRationale})` : ''}`
      : rawRationale || `Candidate "${winner.name}" (${winner.id}) achieved the highest weighted score.`;

    const improvementSuggestions = Array.isArray(parsed.improvementSuggestions)
      ? parsed.improvementSuggestions.map(String)
      : [];

    return {
      status,
      winnerId: winner.id,
      winnerName: winner.name,
      confidence,
      comparisonSummary,
      rationale,
      candidateScores,
      improvementSuggestions,
    };
  }

  /**
   * Evaluates candidates end-to-end:
   * 1. Runs static syntax diagnostics.
   * 2. Builds side-by-side comparison prompt.
   * 3. Queries LLM.
   * 4. Parses, recalibrates, and determines winner.
   */
  public static async evaluateCandidates(
    options: EvaluateCandidatesOptions,
  ): Promise<ContrastiveProbeResult> {
    const staticDiagnostics: Record<string, { valid: boolean; errors: string[] }> = {};
    for (const candidate of options.candidates) {
      if (candidate.codeSnippets && candidate.codeSnippets.length > 0) {
        staticDiagnostics[candidate.id] = ContrastiveProbeRunner.runStaticDiagnostics(
          candidate.codeSnippets,
        );
      }
    }

    const prompt = ContrastiveProbeRunner.buildComparisonPrompt({
      taskDescription: options.taskDescription,
      candidates: options.candidates,
      criteria: options.criteria,
      staticDiagnostics,
    });

    const rawOutput = await options.llmCaller(prompt);

    return ContrastiveProbeRunner.parseEvaluationOutput(
      rawOutput,
      options.candidates,
      options.criteria,
      staticDiagnostics,
    );
  }

  /**
   * Instance method wrapper for evaluateCandidates.
   */
  public async evaluateCandidates(
    options: EvaluateCandidatesOptions,
  ): Promise<ContrastiveProbeResult> {
    return ContrastiveProbeRunner.evaluateCandidates(options);
  }
}
