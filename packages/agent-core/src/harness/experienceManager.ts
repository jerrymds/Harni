import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type {
  HarnessExperience,
  HarnessExperienceCategory,
  ExperienceSearchOptions,
  HarnessSynthesisInput,
} from '@harni/types';
import type { ExperienceManagerOptions } from './types.js';
import {
  formatExperiencesForPrompt,
  type FormatExperiencesOptions,
} from './experienceFormat.js';

const ENGLISH_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'of',
  'to',
  'and',
  'or',
  'in',
  'on',
  'for',
  'with',
  'how',
  'what',
]);

/**
 * Tokenizes text for experience retrieval:
 * - Lowercases input
 * - ASCII/digit words split on non-word chars, drops length < 2 and English stopwords
 * - CJK runs emit character bigrams (or single char if run length is 1)
 */
export function tokenizeExperienceQuery(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const tokens: string[] = [];

  // 1. ASCII/digit words: split on non-word chars
  const asciiWords = lower.split(/[^a-z0-9]+/);
  for (const word of asciiWords) {
    if (word.length >= 2 && !ENGLISH_STOPWORDS.has(word)) {
      tokens.push(word);
    }
  }

  // 2. CJK character runs (\u4e00-\u9fff, \u3400-\u4dbf)
  const cjkRuns = lower.match(/[\u4e00-\u9fff\u3400-\u4dbf]+/g);
  if (cjkRuns) {
    for (const run of cjkRuns) {
      if (run.length === 1) {
        tokens.push(run);
      } else {
        for (let i = 0; i < run.length - 1; i++) {
          tokens.push(run.slice(i, i + 2));
        }
      }
    }
  }

  return tokens;
}

/**
 * Sanitizes an experience text field:
 * - Strips control characters except \n and \t
 * - If singleLine is true, replaces [\r\n\t]+ with ' ' and trims
 * - Replaces runs of 4+ '=' with '=='
 * - Caps length to maxLen, appending '…' if truncated
 */
function sanitizeExperienceField(value: string, maxLen: number, singleLine = false): string {
  let s = value.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '');
  if (singleLine) {
    s = s.replace(/[\r\n\t]+/g, ' ').trim();
  }
  s = s.replace(/={4,}/g, '==');
  if (s.length > maxLen) {
    s = s.slice(0, maxLen) + '…';
  }
  return s;
}

export class ExperienceManager {
  private storageDir: string;
  private maxRetained?: number;

  constructor(options: ExperienceManagerOptions) {
    this.storageDir = options.storageDir;
    this.maxRetained = options.maxRetained;
  }

  /**
   * Persists an experience to disk in JSON format.
   * If `id` is not provided, one is generated automatically.
   */
  public async saveExperience(
    exp: Omit<HarnessExperience, 'id' | 'createdAt' | 'updatedAt'> & {
      id?: string;
      createdAt?: number;
      updatedAt?: number;
    },
  ): Promise<HarnessExperience> {
    await fs.mkdir(this.storageDir, { recursive: true });

    const now = Date.now();
    const id =
      exp.id?.trim() ||
      (crypto.randomUUID ? crypto.randomUUID() : `exp_${now}_${Math.random().toString(36).slice(2, 8)}`);

    // 1. F3: Validate id with /^[A-Za-z0-9_-]{1,64}$/ and assert path stays inside storageDir
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      throw new Error(`Invalid experience ID: "${id}". ID must match /^[A-Za-z0-9_-]{1,64}$/.`);
    }

    const resolvedStorageDir = path.resolve(this.storageDir);
    const filePath = path.resolve(resolvedStorageDir, `${id}.json`);
    const relative = path.relative(resolvedStorageDir, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Path traversal detected: "${id}" escapes storage directory.`);
    }

    // 2. F9: Preserve original createdAt from existing file on update
    let existingCreatedAt: number | undefined;
    try {
      const existingContent = await fs.readFile(filePath, 'utf-8');
      const existing = JSON.parse(existingContent);
      if (existing && typeof existing.createdAt === 'number') {
        existingCreatedAt = existing.createdAt;
      }
    } catch {
      // File does not exist yet or is invalid
    }

    const createdAt = exp.createdAt ?? existingCreatedAt ?? now;
    const updatedAt = exp.updatedAt ?? now;

    // 3. F8 & R8: Sanitize fields on save: strip control chars except \n and \t, replace 4+ '=' with '==',
    // cap lengths: title 120 / summary 500 / actionableGuidance 1500 / triggerCondition 300
    const title = sanitizeExperienceField(exp.title, 120, true);
    const summary = sanitizeExperienceField(exp.summary, 500, true);
    const actionableGuidance = sanitizeExperienceField(exp.actionableGuidance, 1500, false);
    const triggerCondition =
      exp.triggerCondition !== undefined
        ? sanitizeExperienceField(exp.triggerCondition, 300, false)
        : undefined;
    const tags = (exp.tags ?? [])
      .map((t) => sanitizeExperienceField(String(t), 60, true))
      .filter(Boolean)
      .slice(0, 20);
    const relatedFiles = (exp.relatedFiles ?? [])
      .map((f) => sanitizeExperienceField(String(f), 260, true))
      .filter(Boolean)
      .slice(0, 50);

    const experience: HarnessExperience = {
      id,
      title,
      category: exp.category,
      summary,
      actionableGuidance,
      ...(triggerCondition !== undefined ? { triggerCondition } : {}),
      tags,
      ...(relatedFiles.length > 0 || exp.relatedFiles !== undefined ? { relatedFiles } : {}),
      ...(typeof exp.confidenceScore === 'number' ? { confidenceScore: exp.confidenceScore } : {}),
      createdAt,
      updatedAt,
    };

    await fs.writeFile(filePath, JSON.stringify(experience, null, 2), 'utf-8');

    if (this.maxRetained && this.maxRetained > 0) {
      await this.pruneExcess();
    }

    return experience;
  }

  /**
   * Search experiences based on keyword intersection, tags matching, and category.
   * Results are scored and sorted descending, returning Top-K.
   * Default limit is 3 (F10).
   */
  public async searchExperiences(
    options: ExperienceSearchOptions = {},
  ): Promise<HarnessExperience[]> {
    const all = await this.loadAll();
    const { query, category, tags, limit = 3, minScore } = options;

    const hasCriteria = Boolean(query?.trim() || category || (tags && tags.length > 0));
    if (!hasCriteria) {
      return all
        .sort(
          (a, b) =>
            (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0) || b.updatedAt - a.updatedAt,
        )
        .slice(0, limit);
    }

    const queryTokens = query ? Array.from(new Set(tokenizeExperienceQuery(query))) : [];
    const normalizedTags = tags ? tags.map((t) => t.toLowerCase().trim()).filter(Boolean) : [];

    const scored: Array<{ exp: HarnessExperience; score: number }> = [];

    for (const exp of all) {
      // If category is specified, only include matching category
      if (category && exp.category !== category) {
        continue;
      }

      let score = 0;

      // Category match score
      if (category && exp.category === category) {
        score += 5;
      }

      // Tag match score
      if (normalizedTags.length > 0) {
        const expTagsLower = exp.tags.map((t) => t.toLowerCase());
        let matchedCount = 0;
        for (const t of normalizedTags) {
          if (expTagsLower.includes(t)) {
            matchedCount++;
          }
        }
        score += matchedCount * 4;
      }

      // Query token intersection score (F7, R8.4)
      if (queryTokens.length > 0) {
        const titleLower = exp.title.toLowerCase();
        const summaryLower = exp.summary.toLowerCase();
        const guidanceLower = exp.actionableGuidance.toLowerCase();
        const triggerLower = (exp.triggerCondition ?? '').toLowerCase();
        const tagsJoined = exp.tags.join(' ').toLowerCase();
        const relatedFilesJoined = (exp.relatedFiles ?? []).join(' ').toLowerCase();
        const categoryLower = exp.category.toLowerCase();

        // Word sets for exact word-level matching of short ASCII tokens (R8.4)
        const titleWords = new Set(titleLower.split(/[^a-z0-9]+/));
        const tagsWords = new Set(tagsJoined.split(/[^a-z0-9]+/));
        const summaryWords = new Set(summaryLower.split(/[^a-z0-9]+/));
        const guidanceWords = new Set(guidanceLower.split(/[^a-z0-9]+/));
        const triggerWords = new Set(triggerLower.split(/[^a-z0-9]+/));
        const categoryWords = new Set(categoryLower.split(/[^a-z0-9]+/));
        const relatedFilesWords = new Set(relatedFilesJoined.split(/[^a-z0-9]+/));

        const matchField = (
          fieldLower: string,
          fieldWords: Set<string>,
          token: string,
          isShort: boolean,
        ): boolean => {
          return isShort ? fieldWords.has(token) : fieldLower.includes(token);
        };

        for (const token of queryTokens) {
          const isShort = /^[a-z0-9]{1,2}$/.test(token);
          if (matchField(titleLower, titleWords, token, isShort)) score += 5;
          if (matchField(tagsJoined, tagsWords, token, isShort)) score += 3;
          if (matchField(summaryLower, summaryWords, token, isShort)) score += 2;
          if (matchField(guidanceLower, guidanceWords, token, isShort)) score += 2;
          if (matchField(triggerLower, triggerWords, token, isShort)) score += 2;
          if (matchField(categoryLower, categoryWords, token, isShort)) score += 2;
          if (matchField(relatedFilesJoined, relatedFilesWords, token, isShort)) score += 1;
        }
      }

      // Confidence score bonus
      if (score > 0 && exp.confidenceScore) {
        score += exp.confidenceScore;
      }

      const threshold = minScore !== undefined ? minScore : 1;
      if (score >= threshold) {
        scored.push({ exp, score });
      }
    }

    scored.sort((a, b) => b.score - a.score || b.exp.updatedAt - a.exp.updatedAt);
    return scored.slice(0, limit).map((s) => s.exp);
  }

  /**
   * Formats experiences into a section suitable for System Prompt inclusion.
   * Delegates to formatExperiencesForPrompt.
   */
  public formatForPrompt(
    experiences: HarnessExperience[],
    options?: FormatExperiencesOptions,
  ): string {
    return ExperienceManager.formatForPrompt(experiences, options);
  }

  /**
   * Static method to format experiences into a section suitable for System Prompt inclusion.
   * Delegates to formatExperiencesForPrompt.
   */
  public static formatForPrompt(
    experiences: HarnessExperience[],
    options?: FormatExperiencesOptions,
  ): string {
    return formatExperiencesForPrompt(experiences, options);
  }

  /**
   * Synthesize a structured HarnessExperience from resolution information.
   */
  public synthesizeFromResolution(input: HarnessSynthesisInput): HarnessExperience {
    return ExperienceManager.synthesizeFromResolution(input);
  }

  /**
   * Static method to synthesize a structured HarnessExperience from resolution information.
   */
  public static synthesizeFromResolution(input: HarnessSynthesisInput): HarnessExperience {
    const now = Date.now();
    const id = crypto.randomUUID
      ? crypto.randomUUID()
      : `exp_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const cleanTask = input.taskDescription.trim().replace(/\r?\n/g, ' ');
    const hasErrors = Boolean(input.encounteredErrors && input.encounteredErrors.length > 0);

    // 1. Determine category
    let category: HarnessExperienceCategory = input.category ?? 'workflow';
    if (!input.category) {
      if (hasErrors) {
        category = 'bug_fix';
      } else {
        const lowerDesc = cleanTask.toLowerCase();
        if (/(bug|fix|error|fail|issue|exception)/i.test(lowerDesc)) {
          category = 'bug_fix';
        } else if (/(arch|design|refactor|structure|pattern)/i.test(lowerDesc)) {
          category = 'architectural';
        } else if (/(tool|cli|command|script|mcp)/i.test(lowerDesc)) {
          category = 'tool_usage';
        } else if (/(pitfall|trap|warning|gotcha|caution)/i.test(lowerDesc)) {
          category = 'pitfall';
        } else {
          category = 'workflow';
        }
      }
    }

    // 2. Title
    let title: string;
    if (cleanTask.length <= 70) {
      title = cleanTask;
    } else {
      title = cleanTask.slice(0, 67) + '...';
    }

    // 3. Summary
    let summary = `Resolution for task: ${cleanTask}`;
    if (input.successfulActions.length > 0) {
      summary += ` (${input.successfulActions.length} action(s) executed)`;
    }
    if (hasErrors && input.encounteredErrors) {
      summary += `. Overcame ${input.encounteredErrors.length} error(s): ${input.encounteredErrors.slice(0, 2).join('; ')}`;
    }

    // 4. Trigger Condition
    let triggerCondition: string;
    if (hasErrors && input.encounteredErrors) {
      triggerCondition = `When encountering error(s): ${input.encounteredErrors.join(' | ')}`;
    } else {
      triggerCondition = `When performing task: ${cleanTask}`;
    }

    // 5. Actionable Guidance
    const guidanceLines: string[] = [];
    if (input.successfulActions.length > 0) {
      guidanceLines.push('Recommended action steps:');
      input.successfulActions.forEach((act, idx) => {
        guidanceLines.push(`${idx + 1}. ${act}`);
      });
    }
    if (hasErrors && input.encounteredErrors) {
      if (guidanceLines.length > 0) guidanceLines.push('');
      guidanceLines.push(`Error avoidance: Watch out for ${input.encounteredErrors.join('; ')}`);
    }
    const actionableGuidance = guidanceLines.join('\n') || cleanTask;

    // 6. Tags
    const tagsSet = new Set<string>();
    if (input.tags) {
      input.tags.forEach((t) => tagsSet.add(t.toLowerCase().trim()));
    }
    tagsSet.add(category);
    if (input.keyFiles) {
      for (const file of input.keyFiles) {
        const ext = path.extname(file).replace(/^\./, '');
        if (ext) tagsSet.add(ext.toLowerCase());
      }
    }

    // 7. Confidence Score
    let confidenceScore = 0.9;
    if (hasErrors && input.successfulActions.length > 0) {
      confidenceScore = 0.95;
    } else if (input.successfulActions.length > 0) {
      confidenceScore = 0.9;
    }

    return {
      id,
      title,
      category,
      tags: Array.from(tagsSet).filter(Boolean),
      summary,
      triggerCondition,
      actionableGuidance,
      relatedFiles: input.keyFiles ? [...input.keyFiles] : [],
      confidenceScore,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Loads all experiences stored in storageDir.
   */
  public async loadAll(): Promise<HarnessExperience[]> {
    try {
      const entries = await fs.readdir(this.storageDir);
      const jsonFiles = entries.filter((f) => f.endsWith('.json'));
      const experiences: HarnessExperience[] = [];

      for (const file of jsonFiles) {
        try {
          const content = await fs.readFile(path.join(this.storageDir, file), 'utf-8');
          const parsed = JSON.parse(content) as HarnessExperience;
          if (parsed && parsed.id && parsed.title && parsed.category) {
            experiences.push(parsed);
          }
        } catch {
          // Ignore corrupt files
        }
      }

      // Sort newest first
      experiences.sort((a, b) => b.updatedAt - a.updatedAt);
      return experiences;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  /**
   * Clears all stored experiences in storageDir.
   */
  public async clear(): Promise<void> {
    try {
      const entries = await fs.readdir(this.storageDir);
      const jsonFiles = entries.filter((f) => f.endsWith('.json'));
      await Promise.all(
        jsonFiles.map((file) => fs.unlink(path.join(this.storageDir, file)).catch(() => {})),
      );
    } catch (err: unknown) {
      if (!err || typeof err !== 'object' || !('code' in err) || (err as { code: string }).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  /**
   * Internal helper to prune experiences exceeding maxRetained.
   */
  private async pruneExcess(): Promise<void> {
    if (!this.maxRetained || this.maxRetained <= 0) return;
    try {
      const all = await this.loadAll();
      if (all.length > this.maxRetained) {
        // Sort oldest first
        all.sort((a, b) => a.updatedAt - b.updatedAt);
        const toRemove = all.slice(0, all.length - this.maxRetained);
        for (const item of toRemove) {
          const filePath = path.join(this.storageDir, `${item.id}.json`);
          await fs.unlink(filePath).catch(() => {});
        }
      }
    } catch {
      // Ignore pruning errors
    }
  }
}
