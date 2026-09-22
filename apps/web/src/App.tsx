import React, { useEffect } from 'react';
import { Header } from './components/Layout/Header.js';
import { LeftSidebar } from './components/Sidebar/LeftSidebar.js';
import { ChatPanel } from './components/Chat/ChatPanel.js';
import { SettingsModal } from './components/Settings/SettingsModal.js';
import { useAgentStore } from './store/useAgentStore.js';
import { useThemeClasses } from './hooks/useThemeClasses.js';

export function App() {
  const connect = useAgentStore((s) => s.connect);
  const combinedClasses = useThemeClasses();

  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <div className={`flex h-screen w-screen flex-col bg-ag-void text-ag-textPrimary font-sans overflow-hidden transition-colors duration-200 ${combinedClasses}`}>
      {/* Settings Dialog */}
      <SettingsModal />

      {/* Top Application Navigation & Status Beacon */}
      <Header />

      {/* Main 2-Column Antigravity Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Project Explorer & Conversation History */}
        <LeftSidebar />

        {/* Right: Main Agent Conversation Workspace */}
        <ChatPanel />
      </div>
    </div>
  );
}

export default App;
