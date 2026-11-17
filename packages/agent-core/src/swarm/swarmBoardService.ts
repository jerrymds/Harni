import { EventEmitter } from 'node:events';
import type {
  SubagentStatus,
  SwarmBoardState,
  SwarmMemberInfo,
  SwarmMessage,
} from '@harni/types';

interface InternalSwarmBoard {
  sessionId: string;
  title: string;
  members: Map<string, SwarmMemberInfo>;
  subagentToMember: Map<string, string>;
  messages: SwarmMessage[];
  updatedAt: number;
}

export interface RegisterSwarmMemberParams {
  name: string;
  subagentId: string;
  role: string;
  typeName: string;
  model?: string;
  status: SubagentStatus;
  addedBy: string;
  workspaceIsolation?: 'inherit' | 'worktree';
  forkedFrom?: string;
}

export interface PostSwarmMessageParams {
  sessionId: string;
  sender: string;
  senderSubagentId?: string;
  content: string;
}

export function extractMentions(content: string): string[] {
  const mentions: string[] = [];
  const seen = new Set<string>();
  const regex = /(?:^|[\s(,;\[])@([a-zA-Z0-9_-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const tag = match[1];
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      mentions.push(tag);
    }
  }
  return mentions;
}

export class SwarmBoardService extends EventEmitter {
  private boards = new Map<string, InternalSwarmBoard>();
  private msgCounter = 0;

  private getOrCreateBoard(sessionId: string): InternalSwarmBoard {
    let board = this.boards.get(sessionId);
    if (!board) {
      board = {
        sessionId,
        title: '',
        members: new Map<string, SwarmMemberInfo>(),
        subagentToMember: new Map<string, string>(),
        messages: [],
        updatedAt: Date.now(),
      };
      this.boards.set(sessionId, board);
    }
    return board;
  }

  private toPublicBoard(board: InternalSwarmBoard): SwarmBoardState {
    return {
      sessionId: board.sessionId,
      title: board.title,
      members: Array.from(board.members.values()).map((m) => ({ ...m })),
      messages: board.messages.map((m) => ({ ...m, mentions: [...m.mentions] })),
      updatedAt: board.updatedAt,
    };
  }

  public getBoardState(sessionId: string): SwarmBoardState {
    const board = this.boards.get(sessionId);
    if (!board) {
      return {
        sessionId,
        title: '',
        members: [],
        messages: [],
        updatedAt: Date.now(),
      };
    }
    return this.toPublicBoard(board);
  }

  public setTitle(sessionId: string, title: string): SwarmBoardState {
    const board = this.getOrCreateBoard(sessionId);
    board.title = title.trim();
    board.updatedAt = Date.now();
    const snapshot = this.toPublicBoard(board);
    this.emit('swarm:updated', snapshot);
    return snapshot;
  }

  public registerMember(
    sessionId: string,
    params: RegisterSwarmMemberParams,
  ): SwarmMemberInfo {
    const board = this.getOrCreateBoard(sessionId);
    const now = Date.now();
    const info: SwarmMemberInfo = {
      name: params.name,
      subagentId: params.subagentId,
      role: params.role,
      typeName: params.typeName,
      model: params.model,
      status: params.status,
      addedBy: params.addedBy,
      workspaceIsolation: params.workspaceIsolation,
      forkedFrom: params.forkedFrom,
      createdAt: now,
      updatedAt: now,
    };
    board.members.set(params.name, info);
    board.subagentToMember.set(params.subagentId, params.name);
    board.updatedAt = now;
    this.emit('swarm:updated', this.toPublicBoard(board));
    return { ...info };
  }

  public updateMemberStatus(
    sessionId: string,
    subagentId: string,
    status: SubagentStatus,
  ): void {
    const board = this.boards.get(sessionId);
    if (!board) return;
    const memberName = board.subagentToMember.get(subagentId);
    if (!memberName) return;
    const member = board.members.get(memberName);
    if (!member) return;
    if (member.status === status) return;
    member.status = status;
    member.updatedAt = Date.now();
    board.updatedAt = member.updatedAt;
    this.emit('swarm:updated', this.toPublicBoard(board));
  }

  public removeMember(
    sessionId: string,
    nameOrSubagentId: string,
  ): SwarmMemberInfo | undefined {
    const board = this.boards.get(sessionId);
    if (!board) return undefined;
    const member = this.resolveMember(sessionId, nameOrSubagentId);
    if (!member) return undefined;

    board.members.delete(member.name);
    board.subagentToMember.delete(member.subagentId);
    board.updatedAt = Date.now();
    this.emit('swarm:updated', this.toPublicBoard(board));
    return member;
  }

  public resolveMember(
    sessionId: string,
    nameOrSubagentId: string,
  ): SwarmMemberInfo | undefined {
    const board = this.boards.get(sessionId);
    if (!board) return undefined;

    const direct = board.members.get(nameOrSubagentId);
    if (direct) return { ...direct };

    const bySubId = board.subagentToMember.get(nameOrSubagentId);
    if (bySubId) {
      const m = board.members.get(bySubId);
      if (m) return { ...m };
    }

    const lower = nameOrSubagentId.toLowerCase();
    for (const m of board.members.values()) {
      if (m.name.toLowerCase() === lower) {
        return { ...m };
      }
    }
    return undefined;
  }

  public listMembers(sessionId: string): SwarmMemberInfo[] {
    const board = this.boards.get(sessionId);
    if (!board) return [];
    return Array.from(board.members.values()).map((m) => ({ ...m }));
  }

  public postMessage(params: PostSwarmMessageParams): SwarmMessage {
    const board = this.getOrCreateBoard(params.sessionId);
    const now = Date.now();
    const mentions = extractMentions(params.content);
    const message: SwarmMessage = {
      id: `swarm_msg_${now}_${++this.msgCounter}`,
      sessionId: params.sessionId,
      sender: params.sender,
      senderSubagentId: params.senderSubagentId,
      content: params.content,
      mentions,
      timestamp: now,
    };

    board.messages.push(message);
    board.updatedAt = now;

    this.emit('swarm:message', { ...message, mentions: [...message.mentions] });
    this.emit('swarm:updated', this.toPublicBoard(board));
    return { ...message, mentions: [...message.mentions] };
  }

  public getMessages(
    sessionId: string,
    options?: { limit?: number; sinceId?: string },
  ): SwarmMessage[] {
    const board = this.boards.get(sessionId);
    if (!board) return [];

    let msgs = board.messages;
    if (options?.sinceId) {
      const idx = msgs.findIndex((m) => m.id === options.sinceId);
      if (idx >= 0) {
        msgs = msgs.slice(idx + 1);
      }
    }
    if (options?.limit && options.limit > 0 && msgs.length > options.limit) {
      msgs = msgs.slice(-options.limit);
    }

    return msgs.map((m) => ({ ...m, mentions: [...m.mentions] }));
  }

  public clearSession(sessionId?: string): void {
    if (sessionId) {
      this.boards.delete(sessionId);
    } else {
      this.boards.clear();
    }
  }

  public dispose(): void {
    this.boards.clear();
    this.removeAllListeners();
  }
}
