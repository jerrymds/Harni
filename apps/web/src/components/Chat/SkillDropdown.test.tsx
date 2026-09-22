import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  SkillDropdown,
  getSkillPrompt,
  getSkillIcon,
  getSkillDisplayName,
  isAntigravitySkill,
} from './SkillDropdown.js';
import { useAgentStore } from '../../store/useAgentStore.js';
import type { AgentSkill } from '@harni/types';

describe('SkillDropdown Component', () => {
  beforeEach(() => {
    useAgentStore.setState({
      skills: [
        {
          name: 'find-skills',
          category: 'workflow',
          description: '尋找與探索所需的 Agent 技能',
          instructions: '',
        },
        {
          name: 'frontend-design',
          category: 'custom',
          description: '打造高品質、精美的前端介面與視覺體驗',
          instructions: '',
        },
        {
          name: 'git-commit-from-memory',
          category: 'git',
          description: '根據對話脈絡與變更產生標準 Commit Message',
          instructions: '',
        },
        {
          name: 'grill-me',
          category: 'workflow',
          description: '透過深度訪談對齊實作計畫與架構決策',
          instructions: '',
        },
        {
          name: 'llm-as-verifier',
          category: 'refactor',
          description: '執行測試與靜態檢查驗證程式碼正確性',
          instructions: '',
        },
        {
          name: 'memory-bank',
          category: 'workflow',
          description: '更新與維護專案架構脈絡與 Memory Bank',
          instructions: '',
        },
        {
          name: 'skill-creator',
          category: 'workflow',
          description: '建立與設計全新客製化 Agent 技能',
          instructions: '',
        },
        // Antigravity builtin skill (should be excluded)
        {
          name: 'antigravity_guide',
          category: 'custom',
          description: 'Antigravity guide',
          instructions: '',
          sourcePath: 'C:\\Users\\wistronits\\.gemini\\antigravity\\builtin\\skills\\antigravity_guide\\SKILL.md',
        },
      ],
    });
  });

  it('renders skill trigger button', () => {
    const onSelectPrompt = vi.fn();
    render(<SkillDropdown onSelectPrompt={onSelectPrompt} />);

    const triggerBtn = screen.getByRole('button', { name: /技能選單/i });
    expect(triggerBtn).toBeInTheDocument();
  });

  it('opens popup menu on click and lists available skills while filtering out antigravity skills', () => {
    const onSelectPrompt = vi.fn();
    render(<SkillDropdown onSelectPrompt={onSelectPrompt} />);

    const triggerBtn = screen.getByRole('button', { name: /技能選單/i });
    fireEvent.click(triggerBtn);

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Agent 專業技能')).toBeInTheDocument();
    expect(screen.getByText(/尋找技能 \(find-skills\)/)).toBeInTheDocument();
    expect(screen.getByText(/前端外觀設計 \(frontend-design\)/)).toBeInTheDocument();
    expect(screen.getByText(/Git 記憶提交 \(git-commit-from-memory\)/)).toBeInTheDocument();
    expect(screen.getByText(/決策訪談 \(grill-me\)/)).toBeInTheDocument();
    expect(screen.getByText(/程式碼驗證 \(llm-as-verifier\)/)).toBeInTheDocument();
    expect(screen.getByText(/更新記憶庫 \(memory-bank\)/)).toBeInTheDocument();
    expect(screen.getByText(/建立新技能 \(skill-creator\)/)).toBeInTheDocument();

    // Verify antigravity skill is NOT in the document
    expect(screen.queryByText(/antigravity_guide/)).not.toBeInTheDocument();
  });

  it('calls onSelectPrompt with colloquial prompt and closes menu when a skill is clicked', () => {
    const onSelectPrompt = vi.fn();
    render(<SkillDropdown onSelectPrompt={onSelectPrompt} />);

    const triggerBtn = screen.getByRole('button', { name: /技能選單/i });
    fireEvent.click(triggerBtn);

    const testSkillItem = screen.getByText(/尋找技能 \(find-skills\)/);
    fireEvent.click(testSkillItem);

    expect(onSelectPrompt).toHaveBeenCalledWith(
      '請使用 find-skills 技能幫我找 [輸入要找的技能] 技能'
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('calls onSelectPrompt with specific prompt for memory-bank and llm-as-verifier', () => {
    const onSelectPrompt = vi.fn();
    render(<SkillDropdown onSelectPrompt={onSelectPrompt} />);

    const triggerBtn = screen.getByRole('button', { name: /技能選單/i });
    fireEvent.click(triggerBtn);

    const memoryBankItem = screen.getByText(/更新記憶庫 \(memory-bank\)/);
    fireEvent.click(memoryBankItem);

    expect(onSelectPrompt).toHaveBeenCalledWith(
      '請使用 memory-bank 技能幫我更新 Memory Bank，不要執行測試'
    );
  });

  it('closes menu when pressing Escape', () => {
    const onSelectPrompt = vi.fn();
    render(<SkillDropdown onSelectPrompt={onSelectPrompt} />);

    const triggerBtn = screen.getByRole('button', { name: /技能選單/i });
    fireEvent.click(triggerBtn);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes menu on click outside', () => {
    const onSelectPrompt = vi.fn();
    render(
      <div>
        <div data-testid="outside">Outside area</div>
        <SkillDropdown onSelectPrompt={onSelectPrompt} />
      </div>
    );

    const triggerBtn = screen.getByRole('button', { name: /技能選單/i });
    fireEvent.click(triggerBtn);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('is disabled when disabled prop is true', () => {
    const onSelectPrompt = vi.fn();
    render(<SkillDropdown onSelectPrompt={onSelectPrompt} disabled={true} />);

    const triggerBtn = screen.getByRole('button', { name: /技能選單/i });
    expect(triggerBtn).toBeDisabled();

    fireEvent.click(triggerBtn);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('SkillDropdown Helper Functions', () => {
  it('getSkillPrompt generates exact colloquial prompts requested by user', () => {
    expect(getSkillPrompt({ name: 'find-skill' })).toBe(
      '請使用 find-skills 技能幫我找 [輸入要找的技能] 技能'
    );
    expect(getSkillPrompt({ name: 'find-skills' })).toBe(
      '請使用 find-skills 技能幫我找 [輸入要找的技能] 技能'
    );
    expect(getSkillPrompt({ name: 'frontend-design' })).toBe(
      '請使用 frontend-design 技能幫我 [輸入想設計的外觀]'
    );
    expect(getSkillPrompt({ name: 'git-commit-from-memory' })).toBe(
      '請使用 git-commit-from-memory 技能幫我產生 Commit Message，不要執行測試'
    );
    expect(getSkillPrompt({ name: 'grill-me' })).toBe(
      '請使用 grill-me 技能幫我透過深度訪談對齊實作計畫與架構決策'
    );
    expect(getSkillPrompt({ name: 'llm-as-verifier' })).toBe(
      '請使用 llm-as-verifier 技能幫我驗證程式碼，會實際執行測試和靜態檢查，而非只看表面。'
    );
    expect(getSkillPrompt({ name: 'memory-bank' })).toBe(
      '請使用 memory-bank 技能幫我更新 Memory Bank，不要執行測試'
    );
    expect(getSkillPrompt({ name: 'git_smart_commit' })).toBe(
      '請使用 git_smart_commit 技能檢查當前 Git 異動並生成標準 Commit Message，不要執行測試'
    );
    expect(getSkillPrompt({ name: 'skill-creator' })).toBe(
      '請使用 skill-creator 技能幫我建立 [輸入要建立的技能]'
    );
  });

  it('isAntigravitySkill accurately filters out antigravity builtin skills while retaining allowed skills', () => {
    expect(
      isAntigravitySkill({
        name: 'antigravity_guide',
        description: 'guide',
        instructions: '',
      })
    ).toBe(true);

    expect(
      isAntigravitySkill({
        name: 'agy-customizations',
        description: 'customizations',
        instructions: '',
      })
    ).toBe(true);

    expect(
      isAntigravitySkill({
        name: 'generative_ui',
        description: 'ui',
        instructions: '',
      })
    ).toBe(true);

    expect(
      isAntigravitySkill({
        name: 'my-custom-skill',
        description: 'custom',
        instructions: '',
        sourcePath: 'C:\\Users\\user\\.gemini\\antigravity\\builtin\\skills\\my-skill\\SKILL.md',
      })
    ).toBe(true);

    expect(
      isAntigravitySkill({
        name: 'memory-bank',
        description: 'memory bank',
        instructions: '',
        sourcePath: 'C:\\Users\\user\\.gemini\\antigravity\\builtin\\skills\\memory-bank\\SKILL.md',
      })
    ).toBe(false);

    expect(
      isAntigravitySkill({
        name: 'grill-me',
        description: 'grill me',
        instructions: '',
        sourcePath: 'C:\\Users\\user\\.gemini\\antigravity\\builtin\\skills\\grill-me\\SKILL.md',
      })
    ).toBe(false);

    expect(
      isAntigravitySkill({
        name: 'find-skills',
        description: 'find skills',
        instructions: '',
        sourcePath: 'C:\\Users\\user\\.agents\\skills\\find-skills\\SKILL.md',
      })
    ).toBe(false);
  });

  it('getSkillIcon returns appropriate icons', () => {
    expect(getSkillIcon('find-skills')).toBe('🔍');
    expect(getSkillIcon('frontend-design')).toBe('🎨');
    expect(getSkillIcon('git-commit-from-memory')).toBe('📦');
    expect(getSkillIcon('grill-me')).toBe('🔥');
    expect(getSkillIcon('llm-as-verifier')).toBe('🛡️');
    expect(getSkillIcon('memory-bank')).toBe('🧠');
    expect(getSkillIcon('skill-creator')).toBe('✨');
  });

  it('getSkillDisplayName returns friendly title for known skills', () => {
    expect(
      getSkillDisplayName({
        name: 'frontend-design',
        description: 'desc',
        instructions: '',
      })
    ).toBe('前端外觀設計 (frontend-design)');
    expect(
      getSkillDisplayName({
        name: 'grill-me',
        description: 'desc',
        instructions: '',
      })
    ).toBe('決策訪談 (grill-me)');
  });
});

