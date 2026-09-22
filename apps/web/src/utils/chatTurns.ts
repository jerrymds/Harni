import type { ChatMessage } from '@harni/types';

export interface ChatTurn {
  id: string;
  userMessage?: ChatMessage;
  intermediateCommands: ChatMessage[];
  finalAssistantMessage?: ChatMessage;
  isFinished: boolean;
}

/**
 * Builds a single turn object from a set of turn messages.
 */
function buildTurn(
  turnId: string,
  turnMessages: ChatMessage[],
  isFinished: boolean,
): ChatTurn {
  let userMessage: ChatMessage | undefined;
  const remainingMessages: ChatMessage[] = [];

  for (const msg of turnMessages) {
    if (msg.role === 'user' && !userMessage) {
      userMessage = msg;
    } else {
      remainingMessages.push(msg);
    }
  }

  // Find the last assistant message in remainingMessages to serve as the final answer
  let finalAssistantMessageIndex = -1;
  for (let i = remainingMessages.length - 1; i >= 0; i--) {
    if (remainingMessages[i].role === 'assistant') {
      finalAssistantMessageIndex = i;
      break;
    }
  }

  let finalAssistantMessage: ChatMessage | undefined;
  const intermediateCommands: ChatMessage[] = [];

  if (finalAssistantMessageIndex !== -1) {
    finalAssistantMessage = remainingMessages[finalAssistantMessageIndex];
    for (let i = 0; i < remainingMessages.length; i++) {
      if (i !== finalAssistantMessageIndex) {
        intermediateCommands.push(remainingMessages[i]);
      }
    }
  } else {
    // No assistant message yet (tools running or user-only message)
    intermediateCommands.push(...remainingMessages);
  }

  return {
    id: userMessage?.id ? `turn_${userMessage.id}` : turnId,
    userMessage,
    intermediateCommands,
    finalAssistantMessage,
    isFinished,
  };
}

/**
 * Groups a flat array of ChatMessage items into structured dialogue turns.
 * - Each turn starts with a user message (or initial non-user messages if before first prompt).
 * - Intermediate tool execution messages and transitional messages are collected into intermediateCommands.
 * - The final assistant message represents the final generated answer.
 * - If isBusy is true, the latest turn is marked as isFinished = false; previous turns are isFinished = true.
 */
export function groupMessagesIntoTurns(
  messages: ChatMessage[],
  isBusy: boolean,
): ChatTurn[] {
  if (!messages || messages.length === 0) {
    return [];
  }

  const turns: ChatTurn[] = [];
  let currentTurnMessages: ChatMessage[] = [];
  let currentTurnIndex = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === 'user') {
      if (currentTurnMessages.length > 0) {
        turns.push(buildTurn(`turn_${currentTurnIndex++}`, currentTurnMessages, true));
        currentTurnMessages = [];
      }
    }
    currentTurnMessages.push(msg);
  }

  if (currentTurnMessages.length > 0) {
    turns.push(buildTurn(`turn_${currentTurnIndex}`, currentTurnMessages, !isBusy));
  }

  return turns;
}
