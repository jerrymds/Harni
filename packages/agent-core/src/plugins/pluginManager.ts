import {
  PluginPriority,
  type ChatMessage,
  type CompletionGateResult,
  type SystemPromptSection,
  type ToolCallMiddlewareContext,
  type ToolDefinition,
  type ToolResult,
  type WorkflowPlugin,
  type WorkflowPluginContext,
  type WorkflowPluginMetadata,
} from '@harni/types';

export class WorkflowPluginManager {
  private plugins = new Map<string, WorkflowPlugin>();

  public register(plugin: WorkflowPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  public unregister(pluginId: string): boolean {
    return this.plugins.delete(pluginId);
  }

  public getPlugin<T extends WorkflowPlugin = WorkflowPlugin>(pluginId: string): T | undefined {
    return this.plugins.get(pluginId) as T | undefined;
  }

  public hasPlugin(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  public listPlugins(): WorkflowPlugin[] {
    return Array.from(this.plugins.values());
  }

  public getPluginsMetadata(): WorkflowPluginMetadata[] {
    return Array.from(this.plugins.values()).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      priority: p.priority ?? PluginPriority.CONTEXT,
      enabled: p.enabled !== false,
      category: p.category,
      isBuiltin: p.isBuiltin,
      applyToSubagents: p.applyToSubagents,
    }));
  }

  public isPluginEnabled(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    return plugin !== undefined && plugin.enabled !== false;
  }

  public setPluginEnabled(pluginId: string, enabled: boolean): void {
    const plugin = this.plugins.get(pluginId);
    if (plugin) {
      plugin.enabled = enabled;
    }
  }

  public getActivePlugins(isSubagent: boolean = false): WorkflowPlugin[] {
    return Array.from(this.plugins.values())
      .filter((p) => p.enabled !== false)
      .filter((p) => (isSubagent ? p.applyToSubagents === true : true))
      .sort(
        (a, b) =>
          (a.priority ?? PluginPriority.CONTEXT) -
          (b.priority ?? PluginPriority.CONTEXT),
      );
  }

  public async runTaskStart(
    ctx: WorkflowPluginContext,
    options: Record<string, unknown>,
  ): Promise<void> {
    for (const plugin of this.getActivePlugins(ctx.isSubagent)) {
      if (plugin.onTaskStart) {
        await plugin.onTaskStart(ctx, options);
      }
    }
  }

  public async runResolveTools(
    ctx: WorkflowPluginContext,
    tools: ToolDefinition[],
  ): Promise<ToolDefinition[]> {
    let resolved = tools;
    for (const plugin of this.getActivePlugins(ctx.isSubagent)) {
      if (plugin.onResolveTools) {
        resolved = await plugin.onResolveTools(ctx, resolved);
      }
    }
    return resolved;
  }

  public async runBuildSystemPrompt(
    ctx: WorkflowPluginContext,
  ): Promise<SystemPromptSection[]> {
    const sections: SystemPromptSection[] = [];
    for (const plugin of this.getActivePlugins(ctx.isSubagent)) {
      if (plugin.onBuildSystemPrompt) {
        const pluginSections = await plugin.onBuildSystemPrompt(ctx);
        if (pluginSections && pluginSections.length > 0) {
          sections.push(...pluginSections);
        }
      }
    }
    return sections;
  }

  public async executeToolWithMiddleware(
    ctx: WorkflowPluginContext,
    toolCtx: ToolCallMiddlewareContext,
    coreExecutor: () => Promise<ToolResult>,
  ): Promise<ToolResult> {
    const middlewarePlugins = this.getActivePlugins(ctx.isSubagent).filter(
      (p) => typeof p.onToolCall === 'function',
    );

    let index = -1;

    const dispatch = async (i: number): Promise<ToolResult> => {
      if (i <= index) {
        throw new Error('next() called multiple times in tool middleware');
      }
      index = i;
      if (i < middlewarePlugins.length) {
        const plugin = middlewarePlugins[i];
        return await plugin.onToolCall!(ctx, toolCtx, () => dispatch(i + 1));
      } else {
        return await coreExecutor();
      }
    };

    return await dispatch(0);
  }

  public async runBeforeComplete(
    ctx: WorkflowPluginContext,
  ): Promise<CompletionGateResult> {
    const accumulatedAppended: ChatMessage[] = [];

    for (const plugin of this.getActivePlugins(ctx.isSubagent)) {
      if (plugin.onBeforeComplete) {
        const decision = await plugin.onBeforeComplete(ctx);
        if (decision.action === 'continue_loop') {
          return decision;
        }
        if (decision.action === 'complete_with_messages') {
          return {
            action: 'complete_with_messages',
            appendedMessages: [
              ...accumulatedAppended,
              ...decision.appendedMessages,
            ],
          };
        }
        if (decision.action === 'allow') {
          if (decision.appendedMessages && decision.appendedMessages.length > 0) {
            accumulatedAppended.push(...decision.appendedMessages);
          }
        }
      }
    }

    return {
      action: 'allow',
      appendedMessages:
        accumulatedAppended.length > 0 ? accumulatedAppended : undefined,
    };
  }

  public async runTaskCompleted(ctx: WorkflowPluginContext): Promise<void> {
    for (const plugin of this.getActivePlugins(ctx.isSubagent)) {
      if (plugin.onTaskCompleted) {
        await plugin.onTaskCompleted(ctx);
      }
    }
  }

  public async runTaskError(
    ctx: WorkflowPluginContext,
    error: unknown,
  ): Promise<{ handled: boolean; customMessage?: ChatMessage }> {
    for (const plugin of this.getActivePlugins(ctx.isSubagent)) {
      if (plugin.onTaskError) {
        const result = await plugin.onTaskError(ctx, error);
        if (result && result.handled) {
          return result;
        }
      }
    }
    return { handled: false };
  }

  public async runSessionReset(sessionId?: string): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onSessionReset) {
        await plugin.onSessionReset(sessionId);
      }
    }
  }

  public async runDispose(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onDispose) {
        await plugin.onDispose();
      }
    }
  }
}
