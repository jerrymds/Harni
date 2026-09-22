import { create } from 'zustand';
import type { AgentStoreState } from './types.js';
import { createChatSlice } from './slices/createChatSlice.js';
import { createWorkspaceSlice } from './slices/createWorkspaceSlice.js';
import { createSettingsSlice } from './slices/createSettingsSlice.js';
import { createAuthSlice } from './slices/createAuthSlice.js';

export const useAgentStore = create<AgentStoreState>()((...a) => ({
  ...createChatSlice(...a),
  ...createWorkspaceSlice(...a),
  ...createSettingsSlice(...a),
  ...createAuthSlice(...a),
}));

export { useShallow } from 'zustand/react/shallow';
export * from './types.js';
export * from './utils.js';
