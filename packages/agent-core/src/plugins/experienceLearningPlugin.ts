import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import {
  PluginPriority,
  type HarnessExperience,
  type SystemPromptSection,
  type ToolCallMiddlewareContext,
  type ToolCallNext,
  type ToolResult,
  type WorkflowPlugin,
  type WorkflowPluginCategory,
  type WorkflowPluginContext,
} from '@harni/types';
import { ExperienceManager } from '../harness/experienceManager.js';
import { formatExperiencesForPrompt } from '../harness/experienceFormat.js';

export interface ExperienceLearningPluginOptions {
  workspaceRoot: string;
  storageDir?: string;
  getIsEnabled: () => boolean;
  experienceManagersByRoot?: Map<string, ExperienceManager>;
}

export interface ExperiencePluginState {
  cachedExperiences?: HarnessExperience[];
  successfulActions: string[];
  encounteredErrors: string[];
  modifiedFiles: Set<string>;
  experienceSaved?: boolean;
  pendingExperiencePromise?: Promise<void>;
}

export class ExperienceLearningPlugin implements WorkflowPlugin {
  public readonly id = 'harni.experience-learning';
  public readonly name = 'Experience Learning Plugin';
  public readonly description =
    'Captures successful actions, errors, and resolutions to synthesize reusable experiences.';
  public readonly priority = PluginPriority.CONTEXT;
  public readonly category: WorkflowPluginCategory = 'context';
  public readonly isBuiltin = true;
  public enabled = true;
  public applyToSubagents = false;

  private primaryExperienceManager?: ExperienceManager;
  private experienceManagersByRoot: Map<string, ExperienceManager>;
  private pendingPromisesBySession = new Map<string, Promise<void>>();

  constructor(private options: ExperienceLearningPluginOptions) {
    this.experienceManagersByRoot =
      this.options.experienceManagersByRoot ?? new Map<string, ExperienceManager>();
    if (this.options.getIsEnabled()) {
      this.primaryExperienceManager = this.getExperienceManagerForRoot(
        this.options.workspaceRoot,
      );
    }
  }

  public getPrimaryExperienceManager(): ExperienceManager | undefined {
    if (!this.primaryExperienceManager && this.options.getIsEnabled()) {
      this.primaryExperienceManager = this.getExperienceManagerForRoot(
        this.options.workspaceRoot,
      );
    }
    return this.primaryExperienceManager;
  }

  public recordModifiedFile(ctx: WorkflowPluginContext, filePath: string): void {
    const state = ctx.getPluginState<ExperiencePluginState>(this.id, () => ({
      successfulActions: [],
      encounteredErrors: [],
      modifiedFiles: new Set<string>(),
    }));
    state.modifiedFiles.add(filePath);
  }

  public getExperienceManagerForRoot(rootPath: string): ExperienceManager | undefined {
    if (!this.options.getIsEnabled() && !this.enabled) return undefined;
    const resolvedRoot = path.resolve(rootPath);
    let mgr = this.experienceManagersByRoot.get(resolvedRoot);
    if (mgr) {
      this.experienceManagersByRoot.delete(resolvedRoot);
      this.experienceManagersByRoot.set(resolvedRoot, mgr);
      return mgr;
    }

    const MAX_EXPERIENCE_MANAGERS = 20;
    while (this.experienceManagersByRoot.size >= MAX_EXPERIENCE_MANAGERS) {
      let evicted = false;
      for (const [key, val] of this.experienceManagersByRoot.entries()) {
        if (val !== this.primaryExperienceManager) {
          this.experienceManagersByRoot.delete(key);
          evicted = true;
          break;
        }
      }
      if (!evicted) break;
    }

    const hash = crypto
      .createHash('sha1')
      .update(resolvedRoot)
      .digest('hex')
      .slice(0, 12);
    const storage = path.join(
      this.options.storageDir || path.join(os.homedir(), '.harni', 'experiences'),
      hash,
    );
    mgr = new ExperienceManager({ storageDir: storage, maxRetained: 200 });
    this.experienceManagersByRoot.set(resolvedRoot, mgr);
    return mgr;
  }

  public async getCachedExperiences(
    ctx: WorkflowPluginContext,
  ): Promise<HarnessExperience[]> {
    if (!this.options.getIsEnabled() || !this.enabled) return [];
    const state = ctx.getPluginState<ExperiencePluginState>(this.id, () => ({
      successfulActions: [],
      encounteredErrors: [],
      modifiedFiles: new Set<string>(),
    }));

    if (state.cachedExperiences) {
      return state.cachedExperiences;
    }

    const targetRoot = ctx.getMainWorkspaceRoot() || ctx.getWorkspaceRoot();
    const expManager =
      this.getExperienceManagerForRoot(targetRoot) ?? this.primaryExperienceManager;
    if (!expManager) {
      state.cachedExperiences = [];
      return [];
    }

    try {
      const userMessages = ctx.getMessages().filter((m) => m.role === 'user');
      const lastUserMsg = userMessages[userMessages.length - 1];
      const currentPrompt =
        ctx.taskState?.prompt?.trim() || (lastUserMsg ? lastUserMsg.content : '');
      state.cachedExperiences = await expManager.searchExperiences({
        query: currentPrompt,
        limit: 3,
      });
    } catch (expErr) {
      console.warn('[ExperienceLearningPlugin] Failed to retrieve experiences:', expErr);
      state.cachedExperiences = [];
    }

    return state.cachedExperiences;
  }

  public async onBuildSystemPrompt(
    ctx: WorkflowPluginContext,
  ): Promise<SystemPromptSection[]> {
    if (!this.enabled || !this.options.getIsEnabled()) {
      return [];
    }

    const experiences = await this.getCachedExperiences(ctx);
    if (!experiences || experiences.length === 0) {
      return [];
    }

    const formatted = formatExperiencesForPrompt(experiences);
    if (!formatted || !formatted.trim()) {
      return [];
    }

    return [
      {
        id: 'harni.experiences',
        content: formatted.trim(),
        order: 80,
      },
    ];
  }

  public async onToolCall(
    ctx: WorkflowPluginContext,
    toolCtx: ToolCallMiddlewareContext,
    next: ToolCallNext,
  ): Promise<ToolResult> {
    const result = await next();

    const state = ctx.getPluginState<ExperiencePluginState>(this.id, () => ({
      successfulActions: [],
      encounteredErrors: [],
      modifiedFiles: new Set<string>(),
    }));

    if (!result.isError) {
      const toolSummary =
        result.summary || `${toolCtx.canonicalToolName} executed successfully`;
      state.successfulActions.push(toolSummary);
      if (state.successfulActions.length > 15) {
        state.successfulActions.shift();
      }

      const writingTools = [
        'write_file',
        'edit_file',
        'write_to_file',
        'replace_file_content',
      ];
      if (writingTools.includes(toolCtx.canonicalToolName)) {
        const targetPath = String(
          toolCtx.toolCall.arguments.path ??
            toolCtx.toolCall.arguments.TargetFile ??
            toolCtx.toolCall.arguments.AbsolutePath ??
            '',
        ).trim();
        if (targetPath) {
          state.modifiedFiles.add(targetPath);
        }
      }
    } else {
      const errSummary =
        result.summary ||
        (typeof result.output === 'string'
          ? result.output.slice(0, 200)
          : `Error executing ${toolCtx.canonicalToolName}`);
      state.encounteredErrors.push(errSummary);
      if (state.encounteredErrors.length > 5) {
        state.encounteredErrors.shift();
      }
    }

    return result;
  }

  public async onTaskCompleted(ctx: WorkflowPluginContext): Promise<void> {
    if (!this.options.getIsEnabled() || !this.enabled) return;
    const state = ctx.getPluginState<ExperiencePluginState>(this.id, () => ({
      successfulActions: [],
      encounteredErrors: [],
      modifiedFiles: new Set<string>(),
    }));

    if (state.experienceSaved) return;
    if (state.modifiedFiles.size === 0) return;

    state.experienceSaved = true;
    const promise = this.autoSynthesizeAndSaveExperience(ctx, state);
    state.pendingExperiencePromise = promise;
    this.pendingPromisesBySession.set(ctx.sessionId, promise);
  }

  public async awaitPendingSaves(sessionId?: string): Promise<void> {
    if (sessionId) {
      const promise = this.pendingPromisesBySession.get(sessionId);
      if (promise) {
        try {
          await promise;
        } catch {
          // Non-blocking
        }
        this.pendingPromisesBySession.delete(sessionId);
      }
      return;
    }

    const promises = Array.from(this.pendingPromisesBySession.values());
    this.pendingPromisesBySession.clear();
    await Promise.allSettled(promises);
  }

  private async autoSynthesizeAndSaveExperience(
    ctx: WorkflowPluginContext,
    state: ExperiencePluginState,
  ): Promise<void> {
    const targetRoot = ctx.getMainWorkspaceRoot() || ctx.getWorkspaceRoot();
    const expManager =
      this.getExperienceManagerForRoot(targetRoot) ?? this.primaryExperienceManager;
    if (!expManager) return;

    try {
      const userMessages = ctx.getMessages().filter((m) => m.role === 'user');
      const lastUserMsg = userMessages[userMessages.length - 1];
      const taskDescription =
        ctx.taskState?.prompt?.trim() || (lastUserMsg ? lastUserMsg.content : '');
      if (!taskDescription.trim()) return;

      const synthesized = expManager.synthesizeFromResolution({
        taskDescription,
        successfulActions: [...state.successfulActions],
        encounteredErrors: [...state.encounteredErrors],
        keyFiles: Array.from(state.modifiedFiles),
      });

      await expManager.saveExperience(synthesized);
    } catch (expErr) {
      console.warn(
        '[ExperienceLearningPlugin] Failed to auto-synthesize and save experience:',
        expErr,
      );
    }
  }
}
