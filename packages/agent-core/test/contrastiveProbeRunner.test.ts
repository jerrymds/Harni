import { describe, it, expect, vi } from 'vitest';
import {
  ContrastiveProbeRunner,
  DEFAULT_PROBE_EVALUATION_CRITERIA,
  type ProbeCandidate,
  type ProbeEvaluationCriteria,
  type ContrastiveProbeResult,
} from '../src/index.js';

describe('ContrastiveProbeRunner', () => {
  describe('1. Static Syntax Diagnostics (runStaticDiagnostics)', () => {
    it('returns valid: true for empty or undefined snippets', () => {
      expect(ContrastiveProbeRunner.runStaticDiagnostics()).toEqual({
        valid: true,
        errors: [],
      });
      expect(ContrastiveProbeRunner.runStaticDiagnostics([])).toEqual({
        valid: true,
        errors: [],
      });
    });

    it('returns valid: true for valid TypeScript and TSX code', () => {
      const snippets = [
        {
          file: 'src/utils/math.ts',
          content: 'export const add = (a: number, b: number): number => a + b;\n',
        },
        {
          file: 'src/components/Button.tsx',
          content: `import React from 'react';\nexport const Button = () => <button>Click</button>;\n`,
        },
      ];

      const result = ContrastiveProbeRunner.runStaticDiagnostics(snippets);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('returns valid: false and captures syntax error details for broken TypeScript', () => {
      const brokenSnippet = [
        {
          file: 'src/broken.ts',
          content: `export function broken(a: number { return a + 1; }`, // missing closing parenthesis
        },
      ];

      const result = ContrastiveProbeRunner.runStaticDiagnostics(brokenSnippet);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('src/broken.ts');
      expect(result.errors[0]).toMatch(/\(\s*TS\d+\s*\)/);
    });

    it('collects errors from multiple files if syntax errors exist', () => {
      const snippets = [
        {
          file: 'src/ok.ts',
          content: 'export const x = 10;',
        },
        {
          file: 'src/bad1.ts',
          content: 'const a: = 1;',
        },
        {
          file: 'src/bad2.ts',
          content: 'function {',
        },
      ];

      const result = ContrastiveProbeRunner.runStaticDiagnostics(snippets);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('src/bad1.ts'))).toBe(true);
      expect(result.errors.some((e) => e.includes('src/bad2.ts'))).toBe(true);
      expect(result.errors.some((e) => e.includes('src/ok.ts'))).toBe(false);
    });
  });

  describe('2. Comparison Prompt Construction (buildComparisonPrompt)', () => {
    const candidates: ProbeCandidate[] = [
      {
        id: 'cand-1',
        name: 'In-place Patch',
        description: 'Directly modifies existing handler to catch errors.',
        patchDiff: `@@ -10,2 +10,4 @@\n+ try {\n   doSomething();\n+ } catch(e) {}\n`,
        metadata: { estimatedComplexity: 'low' },
      },
      {
        id: 'cand-2',
        name: 'Middleware Wrapper',
        description: 'Adds an abstraction layer around handlers.',
        codeSnippets: [
          {
            file: 'src/middleware.ts',
            content: 'export const wrap = (fn: Function) => () => { try { fn(); } catch(e){} };',
          },
        ],
      },
    ];

    it('builds a structured prompt containing task, criteria, and candidates', () => {
      const prompt = ContrastiveProbeRunner.buildComparisonPrompt({
        taskDescription: 'Fix unhandled promise rejection in API server',
        candidates,
      });

      expect(prompt).toContain('Fix unhandled promise rejection in API server');
      expect(prompt).toContain('Candidate 1: In-place Patch (ID: cand-1)');
      expect(prompt).toContain('Directly modifies existing handler to catch errors.');
      expect(prompt).toContain('Candidate 2: Middleware Wrapper (ID: cand-2)');
      expect(prompt).toContain('Adds an abstraction layer around handlers.');
      expect(prompt).toContain('Patch Diff:');
      expect(prompt).toContain('Code Snippets:');
      expect(prompt).toContain('estimatedComplexity');
      expect(prompt).toContain('"winnerId":');
      expect(prompt).toContain('"candidateScores":');
    });

    it('uses custom criteria weights when provided', () => {
      const customCriteria: ProbeEvaluationCriteria = {
        correctnessWeight: 0.5,
        minimalInvasivenessWeight: 0.3,
        safetyWeight: 0.1,
        maintainabilityWeight: 0.1,
      };

      const prompt = ContrastiveProbeRunner.buildComparisonPrompt({
        taskDescription: 'Refactor query parser',
        candidates,
        criteria: customCriteria,
      });

      expect(prompt).toContain('Correctness (Weight: 0.5)');
      expect(prompt).toContain('Minimal Invasiveness (Weight: 0.3)');
      expect(prompt).toContain('Safety (Weight: 0.1)');
      expect(prompt).toContain('Maintainability (Weight: 0.1)');
    });

    it('injects static syntax warnings when staticDiagnostics detects errors', () => {
      const staticDiagnostics = {
        'cand-1': { valid: true, errors: [] },
        'cand-2': {
          valid: false,
          errors: ['[src/middleware.ts:1:10] (TS1005) Identifier expected.'],
        },
      };

      const prompt = ContrastiveProbeRunner.buildComparisonPrompt({
        taskDescription: 'Fix error handler',
        candidates,
        staticDiagnostics,
      });

      expect(prompt).toContain('✅ PASSED (No syntax errors detected)');
      expect(prompt).toContain('⚠️ WARNING: Static syntax errors detected in this candidate:');
      expect(prompt).toContain('[src/middleware.ts:1:10] (TS1005) Identifier expected.');
    });
  });

  describe('3. Output Parsing and Fault Tolerance (parseEvaluationOutput)', () => {
    const candidates: ProbeCandidate[] = [
      { id: 'c1', name: 'Option Alpha', description: 'Approach A' },
      { id: 'c2', name: 'Option Beta', description: 'Approach B' },
    ];

    it('parses raw bare JSON correctly', () => {
      const rawJson = JSON.stringify({
        winnerId: 'c1',
        winnerName: 'Option Alpha',
        confidence: 0.9,
        comparisonSummary: 'Alpha is cleaner.',
        rationale: 'Lower footprint.',
        candidateScores: {
          c1: {
            candidateId: 'c1',
            correctness: 90,
            minimalInvasiveness: 85,
            safety: 90,
            maintainability: 85,
            pros: ['Clean', 'Concise'],
            cons: [],
          },
          c2: {
            candidateId: 'c2',
            correctness: 80,
            minimalInvasiveness: 60,
            safety: 80,
            maintainability: 70,
            pros: ['Robust'],
            cons: ['Too invasive'],
          },
        },
        improvementSuggestions: ['Add unit tests'],
      });

      const result = ContrastiveProbeRunner.parseEvaluationOutput(rawJson, candidates);
      expect(result.winnerId).toBe('c1');
      expect(result.winnerName).toBe('Option Alpha');
      expect(result.confidence).toBe(0.9);
      expect(result.candidateScores.c1.totalScore).toBeCloseTo(
        90 * 0.35 + 85 * 0.25 + 90 * 0.2 + 85 * 0.2, // 31.5 + 21.25 + 18 + 17 = 87.75
        2,
      );
      expect(result.candidateScores.c2.totalScore).toBeCloseTo(
        80 * 0.35 + 60 * 0.25 + 80 * 0.2 + 70 * 0.2, // 28 + 15 + 16 + 14 = 73
        2,
      );
      expect(result.improvementSuggestions).toEqual(['Add unit tests']);
    });

    it('parses markdown code blocks (```json ... ```)', () => {
      const wrapped = `
Here is the evaluation result:
\`\`\`json
{
  "winnerId": "c2",
  "winnerName": "Option Beta",
  "confidence": 0.85,
  "comparisonSummary": "Beta is more comprehensive.",
  "rationale": "Better safety guarantees.",
  "candidateScores": {
    "c1": { "correctness": 70, "minimalInvasiveness": 70, "safety": 70, "maintainability": 70 },
    "c2": { "correctness": 95, "minimalInvasiveness": 80, "safety": 95, "maintainability": 90 }
  }
}
\`\`\`
Hope this helps!
`;
      const result = ContrastiveProbeRunner.parseEvaluationOutput(wrapped, candidates);
      expect(result.winnerId).toBe('c2');
      expect(result.winnerName).toBe('Option Beta');
      expect(result.confidence).toBe(0.85);
      expect(result.candidateScores.c2.totalScore).toBeGreaterThan(
        result.candidateScores.c1.totalScore,
      );
    });

    it('recalculates totalScore using custom criteria weights', () => {
      const customCriteria: ProbeEvaluationCriteria = {
        correctnessWeight: 0.8,
        minimalInvasivenessWeight: 0.1,
        safetyWeight: 0.05,
        maintainabilityWeight: 0.05,
      };

      const jsonStr = JSON.stringify({
        candidateScores: {
          c1: { correctness: 100, minimalInvasiveness: 0, safety: 0, maintainability: 0 },
          c2: { correctness: 0, minimalInvasiveness: 100, safety: 100, maintainability: 100 },
        },
      });

      const result = ContrastiveProbeRunner.parseEvaluationOutput(
        jsonStr,
        candidates,
        customCriteria,
      );
      // c1 totalScore: 100 * 0.8 = 80
      // c2 totalScore: 0 + 100*0.1 + 100*0.05 + 100*0.05 = 20
      expect(result.candidateScores.c1.totalScore).toBe(80);
      expect(result.candidateScores.c2.totalScore).toBe(20);
      expect(result.winnerId).toBe('c1');
    });

    it('resolves ties by choosing the candidate with higher minimalInvasiveness', () => {
      // Both candidates will have totalScore = 80
      // c1: correctness: 80, minimalInvasiveness: 70, safety: 85, maintainability: 85
      // weights: 0.25 each -> (80 + 70 + 85 + 85) / 4 = 320 / 4 = 80
      // c2: correctness: 75, minimalInvasiveness: 90, safety: 75, maintainability: 80
      // weights: 0.25 each -> (75 + 90 + 75 + 80) / 4 = 320 / 4 = 80
      const equalWeightCriteria: ProbeEvaluationCriteria = {
        correctnessWeight: 0.25,
        minimalInvasivenessWeight: 0.25,
        safetyWeight: 0.25,
        maintainabilityWeight: 0.25,
      };

      const jsonStr = JSON.stringify({
        winnerId: 'c1', // LLM mistakenly chose c1 despite tie
        candidateScores: {
          c1: { correctness: 80, minimalInvasiveness: 70, safety: 85, maintainability: 85 },
          c2: { correctness: 75, minimalInvasiveness: 90, safety: 75, maintainability: 80 },
        },
      });

      const result = ContrastiveProbeRunner.parseEvaluationOutput(
        jsonStr,
        candidates,
        equalWeightCriteria,
      );
      expect(result.candidateScores.c1.totalScore).toBe(80);
      expect(result.candidateScores.c2.totalScore).toBe(80);
      // Because minimalInvasiveness of c2 (90) > c1 (70), c2 wins the tie break!
      expect(result.winnerId).toBe('c2');
      expect(result.winnerName).toBe('Option Beta');
    });

    it('handles malformed / non-JSON output gracefully with safe fallback', () => {
      const corruptedOutput = 'Error 500: Server overloaded, cannot generate JSON response!';

      const result = ContrastiveProbeRunner.parseEvaluationOutput(corruptedOutput, candidates);
      expect(result.status).toBe('parse_failed');
      expect(result.confidence).toBe(0);
      expect(result.winnerId).toBe('');
      expect(result.winnerName).toBe('');
      expect(result.comparisonSummary).toContain('Safe fallback');
      expect(result.candidateScores.c1).toBeDefined();
      expect(result.candidateScores.c2).toBeDefined();
      expect(result.candidateScores.c1.cons[0]).toContain('could not be parsed');
    });

    it('handles empty candidates gracefully without throwing', () => {
      const result = ContrastiveProbeRunner.parseEvaluationOutput('{}', []);
      expect(result.winnerId).toBe('');
      expect(result.winnerName).toBe('');
      expect(result.confidence).toBe(0);
      expect(result.candidateScores).toEqual({});
    });

    it('handles missing candidate in candidateScores with safe defaults', () => {
      const partialJson = JSON.stringify({
        candidateScores: {
          c1: { correctness: 90, minimalInvasiveness: 90, safety: 90, maintainability: 90 },
          // c2 is omitted
        },
      });

      const result = ContrastiveProbeRunner.parseEvaluationOutput(partialJson, candidates);
      expect(result.candidateScores.c1.totalScore).toBe(90);
      expect(result.candidateScores.c2.totalScore).toBe(0);
      expect(result.winnerId).toBe('c1');
    });
  });

  describe('4. Full End-to-End Evaluation (evaluateCandidates)', () => {
    it('executes static diagnostics, sends prompt to LLM caller, and returns winning candidate', async () => {
      const candidates: ProbeCandidate[] = [
        {
          id: 'sol-syntax-err',
          name: 'Broken Candidate',
          description: 'Contains a syntax error in snippet',
          codeSnippets: [
            {
              file: 'src/calc.ts',
              content: 'export const calc = (a: number => a * 2;', // missing closing paren
            },
          ],
        },
        {
          id: 'sol-clean',
          name: 'Clean Candidate',
          description: 'Clean and fully typed implementation',
          codeSnippets: [
            {
              file: 'src/calc.ts',
              content: 'export const calc = (a: number): number => a * 2;',
            },
          ],
        },
      ];

      let receivedPrompt = '';
      const mockLlmCaller = vi.fn(async (prompt: string) => {
        receivedPrompt = prompt;
        return JSON.stringify({
          winnerId: 'sol-clean',
          winnerName: 'Clean Candidate',
          confidence: 0.95,
          comparisonSummary: 'Clean Candidate has valid syntax and clean typing.',
          rationale: 'Broken Candidate suffers from syntax errors.',
          candidateScores: {
            'sol-syntax-err': {
              correctness: 20,
              minimalInvasiveness: 50,
              safety: 20,
              maintainability: 30,
              pros: [],
              cons: ['Syntax error present'],
            },
            'sol-clean': {
              correctness: 98,
              minimalInvasiveness: 95,
              safety: 95,
              maintainability: 95,
              pros: ['Correct TypeScript', 'Proper return types'],
              cons: [],
            },
          },
          improvementSuggestions: ['Add property-based testing'],
        });
      });

      const result = await ContrastiveProbeRunner.evaluateCandidates({
        taskDescription: 'Implement multiply-by-two calculator function',
        candidates,
        llmCaller: mockLlmCaller,
      });

      // Assert LLM was called with diagnostic warnings
      expect(mockLlmCaller).toHaveBeenCalledTimes(1);
      expect(receivedPrompt).toContain('⚠️ WARNING: Static syntax errors detected in this candidate:');
      expect(receivedPrompt).toContain('src/calc.ts');

      // Assert evaluation result
      expect(result.winnerId).toBe('sol-clean');
      expect(result.winnerName).toBe('Clean Candidate');
      expect(result.confidence).toBe(0.95);
      expect(result.candidateScores['sol-clean'].totalScore).toBeGreaterThan(90);
      expect(result.candidateScores['sol-syntax-err'].totalScore).toBeLessThan(40);
      expect(result.improvementSuggestions).toEqual(['Add property-based testing']);
    });

    it('works identically when called via instance method', async () => {
      const runner = new ContrastiveProbeRunner();
      const candidates: ProbeCandidate[] = [
        {
          id: 'opt-1',
          name: 'First',
          description: 'First solution',
        },
      ];

      const mockLlm = vi.fn(async () =>
        JSON.stringify({
          winnerId: 'opt-1',
          winnerName: 'First',
          confidence: 0.8,
          candidateScores: {
            'opt-1': { correctness: 80, minimalInvasiveness: 80, safety: 80, maintainability: 80 },
          },
        }),
      );

      const result = await runner.evaluateCandidates({
        taskDescription: 'Simple task',
        candidates,
        llmCaller: mockLlm,
      });

      expect(result.winnerId).toBe('opt-1');
      expect(result.confidence).toBe(0.8);
      expect(result.candidateScores['opt-1'].totalScore).toBe(80);
    });
  });

  describe('5. Robustness, Guardrails, and Regression Tests (F4, F5, F6, F14)', () => {
    it('ensures syntax-invalid candidate never wins when a valid candidate exists (F4)', async () => {
      const candidates: ProbeCandidate[] = [
        {
          id: 'cand-broken',
          name: 'Broken Candidate',
          description: 'Has syntax error',
          codeSnippets: [
            {
              file: 'src/a.ts',
              content: 'const x = ;',
            },
          ],
        },
        {
          id: 'cand-valid',
          name: 'Valid Candidate',
          description: 'Clean syntax',
          codeSnippets: [
            {
              file: 'src/b.ts',
              content: 'const x = 42;',
            },
          ],
        },
      ];

      const mockLlm = vi.fn(async () =>
        JSON.stringify({
          winnerId: 'cand-broken',
          winnerName: 'Broken Candidate',
          confidence: 0.99,
          candidateScores: {
            'cand-broken': {
              correctness: 95,
              minimalInvasiveness: 90,
              safety: 95,
              maintainability: 90,
            },
            'cand-valid': {
              correctness: 70,
              minimalInvasiveness: 70,
              safety: 70,
              maintainability: 70,
            },
          },
        }),
      );

      const result = await ContrastiveProbeRunner.evaluateCandidates({
        taskDescription: 'Define constant x',
        candidates,
        llmCaller: mockLlm,
      });

      expect(result.candidateScores['cand-broken'].correctness).toBeLessThanOrEqual(20);
      expect(result.candidateScores['cand-broken'].safety).toBeLessThanOrEqual(20);
      expect(result.candidateScores['cand-broken'].cons).toContain('Static syntax errors detected');

      expect(result.status).toBe('ok');
      expect(result.winnerId).toBe('cand-valid');
      expect(result.winnerName).toBe('Valid Candidate');
    });

    it('returns status no_valid_candidates when all candidates have syntax errors (F4)', async () => {
      const candidates: ProbeCandidate[] = [
        {
          id: 'cand-broken-1',
          name: 'Broken 1',
          description: 'Missing value',
          codeSnippets: [{ file: 'src/a.ts', content: 'const x = ;' }],
        },
        {
          id: 'cand-broken-2',
          name: 'Broken 2',
          description: 'Malformed function',
          codeSnippets: [{ file: 'src/b.ts', content: 'function {' }],
        },
      ];

      const mockLlm = vi.fn(async () =>
        JSON.stringify({
          winnerId: 'cand-broken-1',
          winnerName: 'Broken 1',
          confidence: 0.8,
          candidateScores: {
            'cand-broken-1': { correctness: 80, minimalInvasiveness: 80, safety: 80, maintainability: 80 },
            'cand-broken-2': { correctness: 60, minimalInvasiveness: 60, safety: 60, maintainability: 60 },
          },
        }),
      );

      const result = await ContrastiveProbeRunner.evaluateCandidates({
        taskDescription: 'Fix code',
        candidates,
        llmCaller: mockLlm,
      });

      expect(result.status).toBe('no_valid_candidates');
      expect(result.winnerId).toBe('cand-broken-1');
    });

    it('clamps scores to [0, 100] when LLM returns out-of-range numbers (F5)', () => {
      const candidates: ProbeCandidate[] = [
        { id: 'c1', name: 'Alpha', description: 'Alpha approach' },
      ];

      const rawJson = JSON.stringify({
        winnerId: 'c1',
        candidateScores: {
          c1: {
            correctness: 900,
            minimalInvasiveness: -50,
            safety: 200,
            maintainability: 50,
          },
        },
      });

      const result = ContrastiveProbeRunner.parseEvaluationOutput(rawJson, candidates);
      expect(result.candidateScores.c1.correctness).toBe(100);
      expect(result.candidateScores.c1.minimalInvasiveness).toBe(0);
      expect(result.candidateScores.c1.safety).toBe(100);
      expect(result.candidateScores.c1.maintainability).toBe(50);
      expect(result.candidateScores.c1.totalScore).toBeLessThanOrEqual(100);
    });

    it('returns status parse_failed with empty winnerId and 0 confidence for sorry I cannot (F6)', () => {
      const candidates: ProbeCandidate[] = [
        { id: 'c1', name: 'Alpha', description: 'Alpha approach' },
      ];

      const result = ContrastiveProbeRunner.parseEvaluationOutput('sorry I cannot', candidates);
      expect(result.status).toBe('parse_failed');
      expect(result.winnerId).toBe('');
      expect(result.winnerName).toBe('');
      expect(result.confidence).toBe(0);
    });

    it('maps candidateScores keyed by candidate name back to candidate ID (F6)', () => {
      const candidates: ProbeCandidate[] = [
        { id: 'uuid-101', name: 'Alpha Strategy', description: 'Strategy Alpha' },
        { id: 'uuid-102', name: 'Beta Strategy', description: 'Strategy Beta' },
      ];

      const nameKeyedJson = JSON.stringify({
        winnerId: 'uuid-101',
        winnerName: 'Alpha Strategy',
        confidence: 0.9,
        candidateScores: {
          'Alpha Strategy': {
            correctness: 85,
            minimalInvasiveness: 90,
            safety: 85,
            maintainability: 85,
          },
          'Beta Strategy': {
            correctness: 70,
            minimalInvasiveness: 70,
            safety: 70,
            maintainability: 70,
          },
        },
      });

      const result = ContrastiveProbeRunner.parseEvaluationOutput(nameKeyedJson, candidates);
      expect(result.status).toBe('ok');
      expect(result.candidateScores['uuid-101']).toBeDefined();
      expect(result.candidateScores['uuid-101'].correctness).toBe(85);
      expect(result.candidateScores['uuid-102']).toBeDefined();
      expect(result.candidateScores['uuid-102'].correctness).toBe(70);
      expect(result.winnerId).toBe('uuid-101');
    });

    it('chooses dynamic backtick fences longer than internal backticks (F14)', () => {
      const candidate: ProbeCandidate = {
        id: 'c-markdown',
        name: 'Markdown Generator',
        description: 'Contains triple and quadruple backticks',
        patchDiff: '@@ -1 +1 @@\n+ ``````markdown\n+ embedded code\n+ ``````',
        codeSnippets: [
          {
            file: 'template.ts',
            content: 'const code = "```js\\nconsole.log(1);\\n```";',
          },
        ],
      };

      const prompt = ContrastiveProbeRunner.buildComparisonPrompt({
        taskDescription: 'Format markdown',
        candidates: [candidate],
        criteria: {
          correctnessWeight: -1,
          minimalInvasivenessWeight: NaN,
        },
      });

      expect(prompt).toContain('```````diff');
      expect(prompt).toContain('````\nconst code =');
    });

    it('skips static AST check for patch-diff only candidates without codeSnippets (R5.1)', async () => {
      const candidates: ProbeCandidate[] = [
        {
          id: 'diff-only',
          name: 'Diff Only Candidate',
          description: 'A patch diff candidate without code snippets',
          patchDiff: '@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;',
        },
      ];

      const prompt = ContrastiveProbeRunner.buildComparisonPrompt({
        taskDescription: 'Patch review',
        candidates,
      });

      expect(prompt).toContain('ℹ️ SKIPPED (Patch-diff only; static AST check not applicable)');

      const result = await ContrastiveProbeRunner.evaluateCandidates({
        taskDescription: 'Patch review',
        candidates,
        llmCaller: async () =>
          JSON.stringify({
            winnerId: 'diff-only',
            winnerName: 'Diff Only Candidate',
            confidence: 0.9,
            candidateScores: {
              'diff-only': { correctness: 90, minimalInvasiveness: 90, safety: 90, maintainability: 90 },
            },
          }),
      });

      expect(result.status).toBe('ok');
      expect(result.winnerId).toBe('diff-only');
    });

    it('overrides comparisonSummary and rationale when LLM winner is disqualified due to syntax errors (R5.3)', () => {
      const candidates: ProbeCandidate[] = [
        {
          id: 'cand-bad',
          name: 'Broken Syntax',
          description: 'Has syntax error',
        },
        {
          id: 'cand-good',
          name: 'Valid Solution',
          description: 'Valid syntax',
        },
      ];

      const staticDiagnostics = {
        'cand-bad': { valid: false, errors: ['Parse error at line 1'] },
        'cand-good': { valid: true, errors: [] },
      };

      const rawLlmOutput = JSON.stringify({
        winnerId: 'cand-bad',
        winnerName: 'Broken Syntax',
        confidence: 0.9,
        comparisonSummary: 'Broken Syntax has great design ideas.',
        rationale: 'Best approach if it worked.',
        candidateScores: {
          'cand-bad': { correctness: 95, minimalInvasiveness: 90, safety: 90, maintainability: 90 },
          'cand-good': { correctness: 80, minimalInvasiveness: 80, safety: 80, maintainability: 80 },
        },
      });

      const result = ContrastiveProbeRunner.parseEvaluationOutput(
        rawLlmOutput,
        candidates,
        undefined,
        staticDiagnostics,
      );

      expect(result.winnerId).toBe('cand-good');
      expect(result.comparisonSummary).toContain('LLM initially favored "cand-bad"');
      expect(result.comparisonSummary).toContain('disqualified due to static syntax errors');
      expect(result.comparisonSummary).toContain('"Valid Solution" (cand-good) was selected instead');
      expect(result.rationale).toContain('selected as the highest-scoring syntactically valid solution after "cand-bad" failed static syntax diagnostics');
    });
  });
});
