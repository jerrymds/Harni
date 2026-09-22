import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import type { AgentSkill } from '@harni/types';
import { useAgentStore } from '../../store/useAgentStore.js';

export interface SkillDropdownProps {
  onSelectPrompt: (prompt: string) => void;
  disabled?: boolean;
}

const DEFAULT_BUILTIN_SKILLS: AgentSkill[] = [
  {
    name: 'find-skills',
    description: '尋找與探索所需的 Agent 技能',
    instructions: '',
  },
  {
    name: 'frontend-design',
    description: '打造高品質、精美的前端介面與視覺體驗',
    instructions: '',
  },
  {
    name: 'git-commit-from-memory',
    description: '根據對話脈絡與變更產生標準 Commit Message',
    instructions: '',
  },
  {
    name: 'grill-me',
    description: '透過深度訪談對齊實作計畫與架構決策',
    instructions: '',
  },
  {
    name: 'llm-as-verifier',
    description: '執行測試與靜態檢查驗證程式碼正確性',
    instructions: '',
  },
  {
    name: 'memory-bank',
    description: '更新與維護專案架構脈絡與 Memory Bank',
    instructions: '',
  },
  {
    name: 'skill-creator',
    description: '建立與設計全新客製化 Agent 技能',
    instructions: '',
  },
];

export function isAntigravitySkill(skill: AgentSkill): boolean {
  const allowedBuiltin = ['memory-bank', 'git-commit-from-memory', 'grill-me'];
  if (allowedBuiltin.includes(skill.name.toLowerCase())) {
    return false;
  }

  const isAntigravityPath = !!(
    skill.sourcePath &&
    (skill.sourcePath.toLowerCase().includes('antigravity') ||
      skill.sourcePath.toLowerCase().includes('.gemini'))
  );
  const antigravityNames = [
    'agy-customizations',
    'antigravity_guide',
    'antigravity-guide',
    'generative_ui',
    'migrate-workflows',
    'permissioned-github',
  ];
  const nameLower = skill.name.toLowerCase();
  const isAntigravityName =
    antigravityNames.includes(nameLower) ||
    nameLower.startsWith('antigravity') ||
    nameLower.startsWith('agy-');

  return isAntigravityPath || isAntigravityName;
}

export function getSkillPrompt(skill: { name: string; description?: string }): string {
  const knownPrompts: Record<string, string> = {
    'find-skill': '請使用 find-skills 技能幫我找 [輸入要找的技能] 技能',
    'find-skills': '請使用 find-skills 技能幫我找 [輸入要找的技能] 技能',
    'frontend-design': '請使用 frontend-design 技能幫我 [輸入想設計的外觀]',
    'git-commit-from-memory': '請使用 git-commit-from-memory 技能幫我產生 Commit Message，不要執行測試',
    'grill-me': '請使用 grill-me 技能幫我透過深度訪談對齊實作計畫與架構決策',
    'llm-as-verifier': '請使用 llm-as-verifier 技能幫我驗證程式碼，會實際執行測試和靜態檢查，而非只看表面。',
    'memory-bank': '請使用 memory-bank 技能幫我更新 Memory Bank，不要執行測試',
    'skill-creator': '請使用 skill-creator 技能幫我建立 [輸入要建立的技能]',
    architecture_audit: '請使用 architecture_audit 技能幫我分析專案結構、模組相依與資料流程說明',
    run_test_suite: '請使用 run_test_suite 技能執行專案測試，並回報詳細結果與修復建議',
    code_review: '請使用 code_review 技能審查現有代碼的安全性、型別與最佳實踐',
    git_smart_commit: '請使用 git_smart_commit 技能檢查當前 Git 異動並生成標準 Commit Message，不要執行測試',
  };

  if (knownPrompts[skill.name]) {
    return knownPrompts[skill.name];
  }

  if (skill.description && skill.description.trim()) {
    const desc = skill.description.trim();
    // Strip leading colon/prefix if present
    const cleanDesc = desc.replace(/^([：:])\s*/, '');
    if (cleanDesc.startsWith('請') || cleanDesc.startsWith('幫')) {
      return `請使用 ${skill.name} 技能${cleanDesc.startsWith('請') ? cleanDesc.slice(1) : cleanDesc}`;
    }
    return `請使用 ${skill.name} 技能幫我${cleanDesc}`;
  }

  return `請使用 ${skill.name} 技能處理目前的任務`;
}

export function getSkillIcon(name: string, category?: string): string {
  if (name.includes('find') || name.includes('search')) return '🔍';
  if (name.includes('frontend') || name.includes('design') || name.includes('ui')) return '🎨';
  if (name.includes('commit') || name.includes('git')) return '📦';
  if (name.includes('verifier') || name.includes('verify') || name.includes('review')) return '🛡️';
  if (name.includes('memory') || name.includes('bank')) return '🧠';
  if (name.includes('grill') || name.includes('interview')) return '🔥';
  if (name.includes('creator') || name.includes('create') || name.includes('custom')) return '✨';
  if (name.includes('test')) return '🧪';
  if (name.includes('arch') || name.includes('structure')) return '🏗️';
  switch (category) {
    case 'testing': return '🧪';
    case 'git': return '📦';
    case 'refactor': return '🛡️';
    case 'architecture': return '🏗️';
    case 'workflow': return '⚡';
    default: return '✨';
  }
}

export function getSkillDisplayName(skill: AgentSkill): string {
  const knownTitles: Record<string, string> = {
    'find-skill': '尋找技能 (find-skills)',
    'find-skills': '尋找技能 (find-skills)',
    'frontend-design': '前端外觀設計 (frontend-design)',
    'git-commit-from-memory': 'Git 記憶提交 (git-commit-from-memory)',
    'grill-me': '決策訪談 (grill-me)',
    'llm-as-verifier': '程式碼驗證 (llm-as-verifier)',
    'memory-bank': '更新記憶庫 (memory-bank)',
    'skill-creator': '建立新技能 (skill-creator)',
    architecture_audit: '專案架構審查 (architecture_audit)',
    run_test_suite: '執行測試套件 (run_test_suite)',
    code_review: '全面代碼審查 (code_review)',
    git_smart_commit: 'Git 智慧提交 (git_smart_commit)',
  };
  return knownTitles[skill.name] || skill.name;
}

export const SkillDropdown: React.FC<SkillDropdownProps> = memo(({
  onSelectPrompt,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const skills = useAgentStore((s) => s.skills);
  const fetchSkills = useAgentStore((s) => s.fetchSkills);

  // Available skills list: combine store skills or fallback to built-in defaults, filtering out antigravity builtin skills
  const rawSkills = skills && skills.length > 0 ? skills : DEFAULT_BUILTIN_SKILLS;
  const availableSkills = rawSkills.filter((s) => !isAntigravitySkill(s));

  useEffect(() => {
    // If skills are not yet loaded, trigger fetch
    if (!skills || skills.length === 0) {
      fetchSkills?.();
    }
  }, [skills, fetchSkills]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = useCallback(
    (skill: AgentSkill) => {
      const prompt = getSkillPrompt(skill);
      onSelectPrompt(prompt);
      setIsOpen(false);
    },
    [onSelectPrompt]
  );

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center space-x-1.5 px-2.5 py-0.5 rounded-lg border text-[10.5px] font-medium transition-all cursor-pointer select-none disabled:opacity-40 disabled:cursor-not-allowed ${
          isOpen
            ? 'border-ag-primary/40 bg-ag-primaryLight text-ag-primary shadow-soft font-semibold'
            : 'border-ag-border bg-ag-sidebar/60 text-ag-textMuted hover:text-ag-textPrimary hover:border-ag-primary/30'
        }`}
        title="選擇 Agent 技能並填入對應的口語化指令"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <Sparkles className="h-3 w-3 text-ag-primary" />
        <span>技能選單</span>
        <ChevronDown
          className={`h-3 w-3 text-ag-textMuted transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-ag-primary' : ''
          }`}
        />
      </button>

      {/* Popover Dropdown Menu */}
      {isOpen && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-2 w-72 sm:w-80 rounded-2xl border border-ag-border bg-ag-panel shadow-soft p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150 backdrop-blur-md"
        >
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-ag-border/50 text-[10.5px] text-ag-textMuted font-medium">
            <div className="flex items-center space-x-1 text-ag-textPrimary font-semibold">
              <Sparkles className="h-3 w-3 text-ag-primary" />
              <span>Agent 專業技能</span>
            </div>
            <span className="font-mono text-[10px] text-ag-primary bg-ag-primaryLight px-1.5 py-0.5 rounded-md">
              {availableSkills.length} 款可用
            </span>
          </div>

          <div className="max-h-64 overflow-y-auto p-1 custom-scrollbar space-y-1">
            {availableSkills.map((skill) => {
              const icon = getSkillIcon(skill.name, skill.category);
              const displayName = getSkillDisplayName(skill);

              return (
                <button
                  key={skill.name}
                  type="button"
                  role="menuitem"
                  onClick={() => handleSelect(skill)}
                  className="flex items-start space-x-2.5 w-full p-2 rounded-xl text-left transition-all hover:bg-ag-primaryLight hover:border-ag-primary/30 border border-transparent group cursor-pointer"
                >
                  <span className="text-sm shrink-0 mt-0.5 select-none">{icon}</span>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-medium text-xs text-ag-textPrimary group-hover:text-ag-primary transition-colors truncate">
                      {displayName}
                    </span>
                    <span className="text-[11px] text-ag-textMuted line-clamp-1 leading-snug mt-0.5">
                      {skill.description}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

SkillDropdown.displayName = 'SkillDropdown';

