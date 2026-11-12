import type {
  SubagentTaskIntent,
  TailoredSubagentConfig,
  TailorSubagentOptions,
  HarnessExperience,
} from '@harni/types';
import { formatExperiencesForPrompt } from './experienceFormat.js';

interface IntentPattern {
  intent: SubagentTaskIntent;
  phrases: RegExp[];
  keywords: RegExp[];
  roleKeywords: RegExp[];
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    intent: 'surgical_edit',
    phrases: [
      /\bfix\s+single\s+line\b/i,
      /\brename\s+variable\b/i,
      /\breplace\s+string\b/i,
      /\bquick\s+fix\b/i,
      /\bone-?line\s+(fix|edit|change)\b/i,
      /\bminor\s+(fix|edit|tweak)\b/i,
      /\bfix\s+(a\s+)?typo\b/i,
      /單檔小修/i,
      /拼寫修正/i,
      /局部微調/i,
      /打字錯誤/i,
      /單行修正/i,
      /重命名變數/i,
      /變數重命名/i,
    ],
    keywords: [
      /\btypo(s)?\b/i,
      /\bsurgical\b/i,
      /\bmisspelling\b/i,
      /\bspelling\b/i,
      /錯字/i,
      /微調/i,
      /小修/i,
      /補丁/i,
    ],
    roleKeywords: [/\bfixer\b/i, /\beditor\b/i, /\bsurgical\b/i, /\bpatcher\b/i],
  },
  {
    intent: 'investigation',
    phrases: [
      /\bcheck\s+architecture\b/i,
      /\bexplore\s+codebase\b/i,
      /\btrace\s+path\b/i,
      /\blook\s+into\b/i,
      /\bfind\s+out\b/i,
      /\bunderstand\s+architecture\b/i,
      /架構理解/i,
      /深入調查/i,
      /搜尋程式碼/i,
      /探索專案/i,
      /查閱代碼/i,
    ],
    keywords: [
      /\binvestigat(e|ion|ing)\b/i,
      /\bsearch\b/i,
      /\bexplor(e|ation|ing)\b/i,
      /\bread\b/i,
      /\bfind\b/i,
      /\barchitectur(e|al)\b/i,
      /\binspect(ion)?\b/i,
      /\btrace\b/i,
      /\bdiscover(y)?\b/i,
      /\bunderstand(ing)?\b/i,
      /\banalyz(e|is|ing)\b/i,
      /\banalysis\b/i,
      /搜尋/i,
      /閱讀/i,
      /探索/i,
      /分析/i,
      /調查/i,
      /查閱/i,
      /尋找/i,
      /查看/i,
      /追蹤/i,
    ],
    roleKeywords: [
      /\bresearcher\b/i,
      /\bexplorer\b/i,
      /\binvestigator\b/i,
      /\banalyzer\b/i,
      /\barchitect\b/i,
    ],
  },
  {
    intent: 'review_testing',
    phrases: [
      /\bcheck\s+coverage\b/i,
      /\brun\s+test(s)?\b/i,
      /\bunit\s+test(s)?\b/i,
      /\btest\s+suite\b/i,
      /\bcode\s+review\b/i,
      /\bquality\s+check\b/i,
      /\brun\s+vitest\b/i,
      /\brun\s+jest\b/i,
      /代碼審查/i,
      /跑測試/i,
      /品質檢查/i,
      /覆蓋率/i,
      /靜態檢查/i,
    ],
    keywords: [
      /\btest(s|ing|ed)?\b/i,
      /\breview(s|ing|ed)?\b/i,
      /\baudit(s|ing|ed)?\b/i,
      /\bverify\b/i,
      /\bverif(ication|ied|ying)\b/i,
      /\blint(er|ing)?\b/i,
      /\bcoverag(e)?\b/i,
      /\bassert(ion)?\b/i,
      /\bvalidat(e|ion|ing)\b/i,
      /審查/i,
      /測試/i,
      /驗證/i,
      /質檢/i,
      /稽核/i,
    ],
    roleKeywords: [
      /\breviewer\b/i,
      /\btester\b/i,
      /\bqa\b/i,
      /\bauditor\b/i,
      /\binspector\b/i,
      /\bvalidator\b/i,
    ],
  },
  {
    intent: 'implementation',
    phrases: [
      /\badd\s+feature\b/i,
      /\bwrite\s+module\b/i,
      /\bcreate\s+module\b/i,
      /\bnew\s+feature\b/i,
      /\bbuild\s+feature\b/i,
      /\bscaffold\s+project\b/i,
      /撰寫新功能/i,
      /建立模組/i,
      /編寫新功能/i,
      /建立新功能/i,
      /重構代碼/i,
    ],
    keywords: [
      /\bfix(es|ed|ing)?\b/i,
      /\bbug(s)?\b/i,
      /\bdebug\b/i,
      /\bimplement(s|ed|ing|ation)?\b/i,
      /\bcreat(e|ed|ing)\b/i,
      /\bbuild(s|ing)?\b/i,
      /\brefactor(s|ed|ing)?\b/i,
      /\bdevelop(s|ed|ing|ment)?\b/i,
      /\bscaffold\b/i,
      /\bconstruct\b/i,
      /實作/i,
      /重構/i,
      /新功能/i,
      /開發/i,
      /建立/i,
      /編寫/i,
      /實現/i,
      /修/i,
      /修復/i,
      /修正/i,
      /修好/i,
    ],
    roleKeywords: [
      /\bcoder\b/i,
      /\bimplementer\b/i,
      /\bdeveloper\b/i,
      /\bengineer\b/i,
      /\bbuilder\b/i,
      /\bprogrammer\b/i,
    ],
  },
];

const INTENT_ALLOWED_TOOLS: Record<SubagentTaskIntent, string[]> = {
  investigation: [
    'read_file',
    'list_files',
    'search_files',
    'use_skill',
    'ask_question',
    'contrastive_probe',
  ],
  surgical_edit: [
    'read_file',
    'edit_file',
    'write_file',
    'replace_file_content',
    'write_to_file',
    'list_files',
    'search_files',
  ],
  review_testing: [
    'read_file',
    'write_file',
    'edit_file',
    'write_to_file',
    'replace_file_content',
    'list_files',
    'search_files',
    'run_command',
    'execute_command',
    'ask_question',
    'contrastive_probe',
  ],
  implementation: [
    'read_file',
    'write_file',
    'edit_file',
    'write_to_file',
    'replace_file_content',
    'list_files',
    'search_files',
    'run_command',
    'execute_command',
    'use_skill',
    'ask_question',
  ],
  general: [
    'read_file',
    'write_file',
    'edit_file',
    'write_to_file',
    'replace_file_content',
    'list_files',
    'search_files',
    'run_command',
    'execute_command',
    'use_skill',
    'ask_question',
    'invoke_subagent',
    'manage_subagents',
    'define_subagent',
    'send_message',
    'contrastive_probe',
  ],
};

const INTENT_DEFAULT_CONSTRAINTS: Record<SubagentTaskIntent, string[]> = {
  investigation: [
    'Operate strictly in READ-ONLY mode. Do NOT attempt to modify, create, or delete any files.',
    'When referencing code findings, always cite exact file paths and line numbers (e.g. path/to/file.ts#L10-L25).',
    'Deliver structured, factual reports with concise executive summaries and actionable findings.',
    'Do NOT run modifying tools or terminal command scripts that alter disk state.',
  ],
  surgical_edit: [
    'Make minimal surgical edits to the target file; avoid touching unrelated lines or surrounding blocks.',
    'Verify syntax and ensure all imports, exports, and interfaces remain intact.',
    'Do NOT reformat or refactor unrequested sections of code.',
    'Report the exact file and lines modified upon completion.',
  ],
  review_testing: [
    'Focus on code quality inspection, automated test suite verification, and edge-case discovery.',
    'Run tests via run_command and analyze full diagnostic output and stack traces.',
    'Do not modify production code beyond what is required; test files may be created or edited.',
    'Provide clear pass/fail status, coverage summary, and risk assessments.',
  ],
  implementation: [
    'Implement requested features, refactorings, or fixes adhering strictly to existing workspace conventions.',
    'Ensure clean syntax, complete type definitions, and robust error handling.',
    'Report all modified, created, or deleted files upon completion.',
  ],
  general: [
    'Execute assigned tasks safely, validating results at each step.',
    'Adhere to workspace coding standards and safety constraints.',
  ],
};

const KNOWN_BUILTIN_TOOLS = new Set([
  'read_file',
  'write_file',
  'edit_file',
  'run_command',
  'write_to_file',
  'replace_file_content',
  'execute_command',
  'list_files',
  'search_files',
  'use_skill',
  'ask_question',
  'invoke_subagent',
  'manage_subagents',
  'define_subagent',
  'send_message',
  'contrastive_probe',
]);

const WRITE_TOOLS = new Set([
  'write_file',
  'edit_file',
  'write_to_file',
  'replace_file_content',
]);
const WRITE_AND_EXEC_TOOLS = new Set([
  'write_file',
  'edit_file',
  'run_command',
  'write_to_file',
  'replace_file_content',
  'execute_command',
]);

/**
 * DynamicSubagentHarness
 * Tailors subagents dynamically by classifying intent, pruning toolsets to the minimal
 * necessary capability boundary, synthesizing scope-aware system prompts, and injecting
 * verified historical experiences.
 */
export class DynamicSubagentHarness {
  public static readonly DEFAULT_AVAILABLE_TOOLS = [
    'read_file',
    'edit_file',
    'write_file',
    'list_files',
    'search_files',
    'run_command',
    'use_skill',
    'ask_question',
  ];

  /**
   * Returns default behavioral constraints for a given intent.
   */
  public static getDefaultConstraints(intent: SubagentTaskIntent): string[] {
    return [...(INTENT_DEFAULT_CONSTRAINTS[intent] || [])];
  }

  /**
   * Returns standard allowed tools for a given intent.
   */
  public static getStandardAllowedTools(intent: SubagentTaskIntent): string[] {
    return [...(INTENT_ALLOWED_TOOLS[intent] || [])];
  }

  /**
   * Intelligently analyzes task prompt and subagent role to determine intent and confidence score.
   * If confidence < 0.85, intent falls back to 'general' (F2).
   */
  public static analyzeIntent(
    taskPrompt: string,
    role?: string,
  ): { intent: SubagentTaskIntent; confidence: number } {
    const prompt = (taskPrompt || '').trim();
    const roleStr = (role || '').trim();

    if (!prompt && !roleStr) {
      return { intent: 'general', confidence: 0.5 };
    }

    const scores: Record<
      SubagentTaskIntent,
      { score: number; roleMatched: boolean; phraseMatched: boolean }
    > = {
      surgical_edit: { score: 0, roleMatched: false, phraseMatched: false },
      investigation: { score: 0, roleMatched: false, phraseMatched: false },
      review_testing: { score: 0, roleMatched: false, phraseMatched: false },
      implementation: { score: 0, roleMatched: false, phraseMatched: false },
      general: { score: 0, roleMatched: false, phraseMatched: false },
    };

    for (const pattern of INTENT_PATTERNS) {
      const intentKey = pattern.intent;

      // 1. Check multi-word phrases
      for (const phraseRegex of pattern.phrases) {
        if (phraseRegex.test(prompt)) {
          scores[intentKey].score += 3.0;
          scores[intentKey].phraseMatched = true;
        }
      }

      // 2. Check individual keywords
      for (const kwRegex of pattern.keywords) {
        if (kwRegex.test(prompt)) {
          scores[intentKey].score += 1.5;
        }
      }

      // 3. Check role hints
      if (roleStr) {
        for (const roleRegex of pattern.roleKeywords) {
          if (roleRegex.test(roleStr)) {
            scores[intentKey].score += 2.5;
            scores[intentKey].roleMatched = true;
            break;
          }
        }
      }
    }

    // Determine top scoring intent among the 4 specialized intents
    const candidateIntents: SubagentTaskIntent[] = [
      'surgical_edit',
      'investigation',
      'review_testing',
      'implementation',
    ];

    let bestIntent: SubagentTaskIntent = 'general';
    let highestScore = 0;
    let tie = false;

    for (const intent of candidateIntents) {
      const { score } = scores[intent];
      if (score > highestScore) {
        highestScore = score;
        bestIntent = intent;
        tie = false;
      } else if (score > 0 && score === highestScore) {
        tie = true;
      }
    }

    // In case of tie or zero score, fallback to general
    if (highestScore === 0) {
      return { intent: 'general', confidence: 0.5 };
    }

    if (tie) {
      // Check if one candidate has roleMatched
      const matchingRoleIntents = candidateIntents.filter(
        (i) => scores[i].score === highestScore && scores[i].roleMatched,
      );
      if (matchingRoleIntents.length === 1) {
        bestIntent = matchingRoleIntents[0];
      } else {
        return { intent: 'general', confidence: 0.5 };
      }
    }

    // Calculate confidence score
    let confidence: number;
    if (highestScore >= 5.0) {
      confidence = 0.95;
    } else if (highestScore >= 3.0) {
      confidence = 0.9;
    } else if (highestScore >= 1.5) {
      confidence = 0.8;
    } else {
      confidence = 0.65;
    }

    if (scores[bestIntent].roleMatched) {
      confidence = Math.min(0.98, confidence + 0.05);
    }

    const roundedConfidence = Math.round(confidence * 100) / 100;

    // F2: If confidence < 0.85 -> intent 'general'
    if (roundedConfidence < 0.85) {
      return {
        intent: 'general',
        confidence: roundedConfidence,
      };
    }

    return {
      intent: bestIntent,
      confidence: roundedConfidence,
    };
  }

  /**
   * Prunes available tools down to the minimal necessary capability set for the given intent.
   * If explicitAllowed is provided, takes the strict intersection.
   * Tool names not in the known built-in set pass through untouched (F11).
   * Write tools and execute_command are removed ONLY when readOnly is true (F2).
   */
  public static pruneTools(
    availableTools: string[],
    intent: SubagentTaskIntent,
    explicitAllowed?: string[],
    readOnly: boolean = false,
  ): string[] {
    const pool = availableTools || [];

    let pruned: string[];
    if (intent === 'general') {
      pruned = [...pool];
    } else {
      const allowedForIntent = new Set(INTENT_ALLOWED_TOOLS[intent] || []);
      pruned = pool.filter((tool) => {
        // F11: tool names not in the known built-in set pass through untouched
        if (!KNOWN_BUILTIN_TOOLS.has(tool)) {
          return true;
        }
        // When readOnly is false, keep write tools that exist in the pool for any intent (F2)
        if (!readOnly && WRITE_TOOLS.has(tool)) {
          return true;
        }
        return allowedForIntent.has(tool);
      });
    }

    // When readOnly is true, remove write tools and execute_command (F2)
    if (readOnly) {
      pruned = pruned.filter((tool) => !WRITE_AND_EXEC_TOOLS.has(tool));
    }

    if (explicitAllowed !== undefined) {
      const explicitSet = new Set(explicitAllowed);
      pruned = pruned.filter((tool) => explicitSet.has(tool));
    }

    return pruned;
  }

  /**
   * Synthesizes a tailored system prompt incorporating scope boundaries, intent constraints,
   * and formatted historical experiences.
   * Removed `Assigned Task: ...` line (F12).
   */
  public static tailorSystemPrompt(options: {
    basePrompt?: string;
    role: string;
    intent: SubagentTaskIntent;
    taskPrompt: string;
    experiences?: HarnessExperience[];
    constraints?: string[];
  }): string {
    const sections: string[] = [];

    if (options.basePrompt && options.basePrompt.trim()) {
      sections.push(options.basePrompt.trim());
    }

    const baseConstraints = INTENT_DEFAULT_CONSTRAINTS[options.intent] || [];
    const customConstraints = options.constraints || [];
    const combinedConstraints = Array.from(
      new Set([...baseConstraints, ...customConstraints]),
    );

    // F12: Remove the Assigned Task line from prompt output
    const scopeLines: string[] = [
      '==== HARNESS TAILORED SUBAGENT SCOPE ====',
      `Role: ${options.role}`,
      `Intent: ${options.intent}`,
      '',
      'Core Constraints & Behavioral Guardrails:',
      ...combinedConstraints.map((c) => `- ${c}`),
    ];

    sections.push(scopeLines.join('\n'));

    if (options.experiences && options.experiences.length > 0) {
      const formattedExp = formatExperiencesForPrompt(options.experiences);
      if (formattedExp && formattedExp.trim()) {
        sections.push(formattedExp.trim());
      }
    }

    return sections.join('\n\n');
  }

  /**
   * Complete end-to-end tailoring: analyzes intent, prunes tools, synthesizes system prompt,
   * and compiles constraints and applied experiences.
   */
  public static tailor(options: TailorSubagentOptions): TailoredSubagentConfig {
    const role =
      options.role ||
      options.baseDefinition?.role ||
      options.baseDefinition?.name ||
      'subagent';

    const { intent, confidence } = DynamicSubagentHarness.analyzeIntent(
      options.taskPrompt,
      role,
    );

    const basePool =
      options.availableTools ??
      options.baseDefinition?.allowedTools ??
      DynamicSubagentHarness.DEFAULT_AVAILABLE_TOOLS;

    const explicitAllowed =
      options.availableTools && options.baseDefinition?.allowedTools
        ? options.baseDefinition.allowedTools
        : undefined;

    // F2: Conservative pruning: readOnly is true ONLY if explicit write disabled
    // OR (role matches /researcher|explorer|investigator|analyzer/i AND intent === 'investigation')
    const isExplicitWriteDisabled = options.baseDefinition?.enableWriteTools === false;
    const explicitlyAllowsExec = Boolean(
      options.baseDefinition?.allowedTools?.includes('run_command') ||
      options.baseDefinition?.allowedTools?.includes('execute_command'),
    );
    const isReadOnlyRoleInvestigation =
      /researcher|explorer|investigator|analyzer/i.test(role) && intent === 'investigation';
    const readOnly = (isExplicitWriteDisabled && !explicitlyAllowsExec) || isReadOnlyRoleInvestigation;

    let prunedTools: string[];
    if (options.skipIntentPruning) {
      prunedTools = [...basePool];
      if (readOnly) {
        prunedTools = prunedTools.filter((t) => !WRITE_AND_EXEC_TOOLS.has(t));
      }
      if (isExplicitWriteDisabled) {
        prunedTools = prunedTools.filter((t) => !WRITE_TOOLS.has(t));
      }
      if (explicitAllowed !== undefined) {
        const explicitSet = new Set(explicitAllowed);
        prunedTools = prunedTools.filter((t) => explicitSet.has(t));
      }
    } else {
      prunedTools = DynamicSubagentHarness.pruneTools(
        basePool,
        intent,
        explicitAllowed,
        readOnly,
      );
      if (isExplicitWriteDisabled) {
        prunedTools = prunedTools.filter((t) => !WRITE_TOOLS.has(t));
      }
    }

    const baseConstraints = INTENT_DEFAULT_CONSTRAINTS[intent] || [];
    const mergedConstraints = Array.from(
      new Set([...baseConstraints, ...(options.customConstraints ?? [])]),
    );

    const basePrompt = options.baseDefinition?.systemPrompt;

    const systemPrompt = DynamicSubagentHarness.tailorSystemPrompt({
      basePrompt,
      role,
      intent,
      taskPrompt: options.taskPrompt,
      experiences: options.experiences,
      constraints: options.customConstraints,
    });

    return {
      intent,
      prunedTools,
      systemPrompt,
      confidenceScore: confidence,
      appliedExperiences: options.experiences?.map((e) => e.id),
      constraints: mergedConstraints,
    };
  }
}
