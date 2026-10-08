import type { ChatMessage, TokenUsage } from '@harni/types';

export interface ContextManagerOptions {
  maxContextTokens?: number;
  slidingWindowTurnLimit?: number;
}

export class ContextManager {
  private messages: ChatMessage[] = [];
  private tokenUsage: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  private maxContextTokens: number;
  private slidingWindowTurnLimit: number;

  constructor(options: ContextManagerOptions = {}) {
    this.maxContextTokens = options.maxContextTokens ?? 160000;
    this.slidingWindowTurnLimit = options.slidingWindowTurnLimit ?? 30;
  }

  public setMaxContextTokens(max: number): void {
    if (max > 0) {
      this.maxContextTokens = max;
      this.maybePrune();
    }
  }

  public getMaxContextTokens(): number {
    return this.maxContextTokens;
  }

  public addMessage(message: ChatMessage): void {
    this.messages.push(message);
    this.estimateTokens();
    this.maybePrune();
  }

  public setMessages(messages: ChatMessage[]): void {
    this.messages = [...messages];
    this.estimateTokens();
    this.maybePrune();
  }

  public getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  public getTokenUsage(): TokenUsage {
    return { ...this.tokenUsage };
  }

  public setTokenUsage(usage: Partial<TokenUsage>): void {
    this.tokenUsage = {
      ...this.tokenUsage,
      ...usage,
      totalTokens: (usage.promptTokens ?? this.tokenUsage.promptTokens) +
        (usage.completionTokens ?? this.tokenUsage.completionTokens),
    };
  }

  public clear(): void {
    this.messages = [];
    this.tokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
  }

  /**
   * Estimate token usage based on characters (~4 chars/token heuristic)
   */
  public estimateTokens(): number {
    let totalChars = 0;
    for (const msg of this.messages) {
      totalChars += msg.content ? msg.content.length : 0;
      if (msg.thinking) totalChars += msg.thinking.length;
      if (msg.toolCalls) {
        totalChars += JSON.stringify(msg.toolCalls).length;
      }
      if (msg.toolResult) {
        totalChars += JSON.stringify(msg.toolResult).length;
      }
    }
    const estimated = Math.ceil(totalChars / 4);
    this.tokenUsage.promptTokens = estimated;
    this.tokenUsage.totalTokens = estimated + this.tokenUsage.completionTokens;
    return estimated;
  }

  /**
   * Multi-stage Context pruning to prevent context overflow:
   * 1. Preserves initial user prompt and latest active turns.
   * 2. Truncates middle oversized tool outputs.
   * 3. Drops oldest middle turns if still exceeding token limits.
   */
  public maybePrune(): void {
    let estimatedTokens = this.estimateTokens();
    if (estimatedTokens <= this.maxContextTokens) return;

    // Stage 1: Truncate oversized tool outputs across messages
    for (let i = 0; i < this.messages.length; i++) {
      const msg = this.messages[i];
      if (msg && msg.role === 'tool') {
        const rawContent =
          typeof msg.content === 'string' && msg.content.length > 0
            ? msg.content
            : typeof msg.toolResult?.output === 'string'
              ? msg.toolResult.output
              : '';

        if (rawContent && rawContent.length > 2000) {
          const compressed = `${rawContent.slice(0, 1000)}\n...[中間輸出已由 Context 管理器自動壓縮以節省 Token]...\n${rawContent.slice(-600)}`;
          msg.content = compressed;
          if (msg.toolResult && typeof msg.toolResult.output === 'string') {
            msg.toolResult.output = compressed;
          }
        }
      }
    }

    estimatedTokens = this.estimateTokens();
    if (estimatedTokens <= this.maxContextTokens) return;

    // Stage 2: If still too large, slide window by removing oldest middle turns (preserving first user msg and latest turn)
    const minRetainedMessages = Math.min(3, this.slidingWindowTurnLimit);
    while (this.messages.length > minRetainedMessages && this.estimateTokens() > this.maxContextTokens) {
      // Remove message at index 1 (right after initial user prompt)
      this.messages.splice(1, 1);
    }


    this.estimateTokens();
  }
}

