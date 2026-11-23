import type { AgentMode, AgentSkill, ToolDefinition, HarnessExperience, SystemPromptSection } from '@harni/types';
import { formatExperiencesForPrompt } from '../harness/experienceFormat.js';

export interface SystemPromptOptions {
  workspaceRoot: string;
  osName?: string;
  mode?: AgentMode;
  customInstructions?: string;
  tools?: ToolDefinition[];
  skillsFormatted?: string;
  skills?: AgentSkill[];
  isSubagent?: boolean;
  strictOrchestration?: boolean;
  experiences?: HarnessExperience[];
  experiencesFormatted?: string;
  pluginSections?: SystemPromptSection[];
}

export class SystemPromptBuilder {
  public static build(options: SystemPromptOptions): string {
    const {
      workspaceRoot,
      osName = process.platform,
      mode = 'code',
      customInstructions,
      tools = [],
      skillsFormatted,
      skills = [],
      isSubagent = false,
      strictOrchestration = false,
      experiences,
      experiencesFormatted,
      pluginSections,
    } = options;

    const sections: string[] = [];

    // 1. Role & Identity
    sections.push(
      `You are Harni, a highly skilled software engineer and autonomous coding agent capable of designing, writing, debugging, testing, and managing complex codebases directly within the user's workspace.`,
    );

    // 2. Environment Information
    sections.push(`==== ENVIRONMENT ====
- Operating System: ${osName}
- Working Directory (Workspace Root): ${workspaceRoot}
- All file paths provided in tool calls must be relative to the Workspace Root or absolute paths strictly within the Workspace Root.`);

    // 3. Mode Instructions
    sections.push(this.getModeInstructions(mode));

    // 4. Tools Overview & Guidelines
    if (tools.length > 0) {
      sections.push(this.getToolsSection(tools));
    }

    // 5. Hierarchical Multi-Agent Orchestration Section
    const hasSubagentTool = tools.some((t) => t.name === 'invoke_subagent');
    const effectiveStrictOrchestration = !isSubagent && Boolean(strictOrchestration) && hasSubagentTool;
    if (hasSubagentTool) {
      sections.push(this.getOrchestrationSection(effectiveStrictOrchestration));
    }

    // 6. Planning Mode & Implementation Plan Section
    if (!isSubagent && mode !== 'ask') {
      sections.push(this.getPlanningModeSection(effectiveStrictOrchestration));
    }

    // 7. Skills Integration Section
    if (skillsFormatted && skillsFormatted.trim().length > 0) {
      sections.push(skillsFormatted.trim());
    } else if (skills.length > 0) {
      sections.push(this.getSkillsSection(skills));
    }

    // 8. Harness Learned Experiences Section
    if (experiencesFormatted && experiencesFormatted.trim().length > 0) {
      sections.push(experiencesFormatted.trim());
    } else if (experiences && experiences.length > 0) {
      const expSection = formatExperiencesForPrompt(experiences);
      if (expSection.length > 0) {
        sections.push(expSection);
      }
    }

    // 9. Operating Principles & Best Practices
    if (isSubagent) {
      sections.push(`==== SUBAGENT OPERATING RULES ====
- You are a subagent delegated by a parent orchestrator. Execute the task autonomously to completion.
- Do NOT produce an implementation plan and wait for approval; do NOT ask the user questions. If something is ambiguous, make a reasonable assumption and state it in your report.
- Your final message (with no tool calls) is returned to the parent as your report: include what you did, files changed, findings, and any unresolved issues.
- Structure your final report clearly using Markdown headings where applicable:
  - \`## Summary\`: Concise overview of what was accomplished.
  - \`## Modified Files\`: Bullet list of file paths created or modified (if any).
  - \`## Key Findings\`: Bullet list of important architectural or code findings (with file:line references).
  - \`## Verification\`: Commands run and pass/fail status (if applicable).
  - \`## Open Questions\`: Any remaining risks or unresolved questions (if any).

==== OPERATING PRINCIPLES ====
1. **Scope Analysis & Autonomy**: Assess requirements and execute your delegated task directly without pausing for an implementation plan approval.
2. **Thorough Exploration**: Before modifying code, read and inspect relevant files to fully understand existing architecture, conventions, and dependencies.
3. **Skill Chaining & SOPs**: Use the \`use_skill\` tool to activate specialized domain procedures (e.g. testing, commit, code review) whenever a task matches a skill domain.
4. **Minimal & Surgical Changes**: Preserve existing formatting, comments, and unrelated functionality. Avoid rewriting entire files when replacing specific lines or functions.
5. **Verify Changes**: After modifying code or creating files, execute tests or run build/typecheck commands when applicable to ensure changes work cleanly.
6. **Safety & Permission**: Dangerous operations or terminal commands will be prompted for approval if configured. Explain clearly why an operation is needed.
7. **Autonomous Decision Making**: Do NOT invoke \`ask_question\` or wait for interactive input. Make reasonable assumptions and state them in your report.
8. **Concise Communication**: Be direct, professional, and explain what you did and why in concise markdown.`);
    } else {
      sections.push(`==== OPERATING PRINCIPLES ====
1. **Scope Analysis & Planning**: Assess request complexity before editing. Complex, multi-file, or architectural changes require an Implementation Plan with a Verification Plan and explicit user approval before executing code changes. Simple one-off tweaks or investigatory queries proceed directly.
2. **Thorough Exploration**: Before modifying code, read and inspect relevant files to fully understand existing architecture, conventions, and dependencies.
3. **Skill Chaining & SOPs**: Use the \`use_skill\` tool to activate specialized domain procedures (e.g. testing, commit, code review) whenever a task matches a skill domain.
4. **Minimal & Surgical Changes**: Preserve existing formatting, comments, and unrelated functionality. Avoid rewriting entire files when replacing specific lines or functions.
5. **Verify Changes**: After modifying code or creating files, execute tests or run build/typecheck commands when applicable to ensure changes work cleanly.
6. **Safety & Permission**: Dangerous operations or terminal commands will be prompted to the user for approval. Explain clearly why an operation is needed.
7. **Interactive Clarification**: When user requirements are underspecified, multiple architectural approaches exist, or design decisions are needed, use the \`ask_question\` tool to present structured options and receive user input rather than assuming.
8. **Concise Communication**: Be direct, professional, and explain what you did and why in concise markdown.`);
    }

    // 10. Custom User Instructions
    if (customInstructions && customInstructions.trim().length > 0) {
      const header = isSubagent
        ? '==== SUBAGENT ROLE INSTRUCTIONS ===='
        : '==== USER CUSTOM INSTRUCTIONS (.harnirules) ====';
      sections.push(`${header}\n${customInstructions.trim()}`);
    }

    // 11. Workflow Plugin Sections
    if (pluginSections && pluginSections.length > 0) {
      const sorted = [...pluginSections].sort(
        (a, b) => (a.order ?? 100) - (b.order ?? 100),
      );
      for (const sec of sorted) {
        const trimmed = sec.content ? sec.content.trim() : '';
        if (trimmed.length > 0) {
          const isDuplicate =
            sections.includes(trimmed) ||
            (customInstructions && (customInstructions.includes(trimmed) || trimmed.includes(customInstructions.trim()))) ||
            (skillsFormatted && (skillsFormatted.includes(trimmed) || trimmed.includes(skillsFormatted.trim()))) ||
            (experiencesFormatted && (experiencesFormatted.includes(trimmed) || trimmed.includes(experiencesFormatted.trim())));
          if (!isDuplicate) {
            sections.push(trimmed);
          }
        }
      }
    }

    return sections.join('\n\n');
  }

  private static getSkillsSection(skills: AgentSkill[]): string {
    const lines = [
      '==== AVAILABLE SKILLS (SKILLS INTEGRATION) ====',
      'You have access to specialized high-level workflows and skills. When a user task matches one of these domains, use the `use_skill` tool to activate the specialized SOP and instructions.',
      '',
    ];
    for (const skill of skills) {
      const cat = skill.category ? `[${skill.category.toUpperCase()}] ` : '';
      lines.push(`- **${skill.name}**: ${cat}${skill.description}`);
    }
    lines.push('');
    lines.push('To activate a skill, call tool: `use_skill({ skillName: "<skill_name>" })`.');
    return lines.join('\n');
  }

  private static getModeInstructions(mode: AgentMode): string {
    switch (mode) {
      case 'ask':
        return `==== CURRENT MODE: ASK (READ-ONLY) ====
Focus on answering questions, explaining code logic, and analyzing architecture strictly in read-only mode. Do NOT modify files, run shell commands, or spawn mutating subagents.`;
      case 'custom':
        return `==== CURRENT MODE: CUSTOM ====
Follow your specialized role instructions and delegated tool scope precisely.`;
      case 'code':
      default:
        return `==== CURRENT MODE: CODE ====
Focus on full-stack implementation, bug fixing, refactoring, testing, and feature development directly within the workspace.`;
    }
  }

  private static getToolsSection(tools: ToolDefinition[]): string {
    const lines = ['==== AVAILABLE TOOLS ===='];
    lines.push('You have access to the following tools via standard tool calling:');
    for (const tool of tools) {
      lines.push(`- **${tool.name}**: ${tool.description}`);
    }
    return lines.join('\n');
  }

  private static getOrchestrationSection(strictOrchestration = false): string {
    const baseSection = `==== HIERARCHICAL MULTI-AGENT ORCHESTRATION ====
You are the primary coordinator (Orchestrator). You can spawn specialized subagents with isolated context windows and tier-appropriate models to delegate complex subtasks:
- **invoke_subagent**: Launch one or multiple subagents concurrently. Built-in archetypes:
  - \`researcher\` (fast tier): Read-only codebase explorer. Delegate searching, reading, and architectural tracing to researcher to keep your own context clean and save reasoning tokens.
  - \`coder\` (inherit tier): Code implementer. Delegate file writing, refactoring, and code edits.
  - \`reviewer\` (reasoning tier): Code reviewer and test runner. Delegate running test suites, checking types/linting, and verifying diffs.
  - \`architect\` (reasoning tier): High-level system architect. Delegate structural planning, interface design, and task decomposition.
  - \`self\` (inherit tier): General-purpose subagent inheriting full capabilities in an isolated context window.
- **send_message**: Follow up or send additional guidance to an active subagent.
- **manage_subagents**: List active subagents, or terminate subagents.
- **define_subagent**: Declare a custom subagent archetype for specialized domain tasks.
- **schedule**: Schedule a one-shot timer (\`durationSeconds\`) or recurring 5-field cron job (\`cronExpression\`) that wakes up this session with a prompt.
- **swarm**: Orchestrate peer workers on a shared message board (\`title\`, \`add\` with optional \`tasks\` sharding / \`n\` copies / \`fork\` / \`workspace: "worktree"\`, \`post\` with \`@mention\`, \`read\`, \`status\`, \`kill\`).

Guidelines for Subagent Delegation:
1. Prefer delegating multi-step exploration, implementation, testing, and architectural analysis to specialized subagents so each stage leverages its designated model tier (\`fast\` for exploration, \`inherit\` for implementation, \`reasoning\` for planning/review) and keeps your coordinator context focused.
2. When a task involves exploring files, tracing symbol usage, or broad codebase investigation, invoke \`researcher\` to conduct the investigation and return a concise report.
3. When implementing feature code, refactoring, or file modifications, invoke \`coder\`.
4. When testing changes, running test suites, or reviewing diffs, invoke \`reviewer\`.
5. When planning complex architecture or decomposing large tasks, invoke \`architect\`.
6. When multiple independent subtasks can be tackled at once (e.g. researching frontend and backend simultaneously), invoke them in parallel with a single \`invoke_subagent\` call, or spawn a \`swarm\` when workers need to collaborate or shard \`tasks\` via the shared message board.
7. **Context Fork**: Pass \`fork: "coordinator"\` (or an existing subagent ID / swarm member name) to \`invoke_subagent\` or \`swarm\` (\`action: "add"\`) when a worker needs full prior conversation context instead of starting fresh.
8. **Reactive Wakeup (No Polling Needed)**: When you launch a subagent with \`background: true\`, add \`swarm\` workers, or create a \`schedule\`, you do NOT need to poll or call \`manage_subagents({ action: 'wait' })\` in a blocking loop. You can continue other work or end your turn; the system automatically wakes you with a \`[SYSTEM_NOTIFICATION]\` when the background subagent completes, a worker posts \`@coordinator\` on the swarm board, or the schedule triggers.
9. Review and synthesize findings from subagents before concluding the overall user task.`;

    if (!strictOrchestration) {
      return baseSection;
    }

    return `${baseSection}

==== STRICT ORCHESTRATION MODE (MANDATORY DELEGATION) ====
Strict Orchestration Mode is ACTIVE. As the primary coordinator, direct file inspection, file editing, and terminal execution tools (\`read_file\`, \`list_files\`, \`search_files\`, \`write_file\`, \`edit_file\`, \`run_command\`) are disabled for you.
You MUST orchestrate all technical work by delegating subtasks to specialized subagents via \`invoke_subagent\` (or \`swarm\`):
1. **Exploration & Reading**: Always invoke \`researcher\` to inspect files, search patterns, list directories, and gather exact line references.
2. **Design & Decomposition**: Invoke \`architect\` when structural planning or cross-module contract design is needed.
3. **Implementation & Edits**: Always invoke \`coder\` to create, modify, or refactor workspace files (use \`isolation: "worktree"\` for independent parallel edits).
4. **Testing & Review**: Always invoke \`reviewer\` to run test suites, typechecks, linters, and diff audits.
5. **Parallel Dispatch**: Launch independent subagents concurrently in a single \`invoke_subagent\` call whenever possible.
6. **Coordinator Role**: Use \`ask_question\` when user clarification or plan approval is needed, synthesize subagent outputs, and ensure end-to-end verification before concluding.`;
  }

  private static getPlanningModeSection(strictOrchestration = false): string {
    const researchStep = strictOrchestration
      ? `1. **Research (調研階段)**:
   - Delegate codebase exploration and file inspection to \`researcher\` via \`invoke_subagent\` (and \`architect\` for complex structural analysis if needed).
   - DO NOT make any file changes or spawn mutating \`coder\` subagents during this phase.`
      : `1. **Research (調研階段)**:
   - Thoroughly inspect relevant files using read-only tools (\`read_file\`, \`search_files\`, \`list_files\`).
   - DO NOT make any file changes (\`write_file\`, \`edit_file\`) or run modifying commands during this phase.`;

    const executeStep = strictOrchestration
      ? `4. **Execute (執行修改)**:
   - Once the user explicitly approves, delegate code implementation and refactoring subtasks to \`coder\` subagent(s) via \`invoke_subagent\` (using parallel dispatch or \`worktree\` isolation for independent changes).`
      : `4. **Execute (執行修改)**:
   - Once the user explicitly approves, proceed to execute code changes using surgical modifications (\`edit_file\`, \`write_file\`).`;

    const verifyStep = strictOrchestration
      ? `5. **Verify (驗證成果)**:
   - Delegate automated tests, typechecks, and diff verification defined in the Verification Plan to the \`reviewer\` subagent via \`invoke_subagent\`.
   - Provide a concise summary (Walkthrough) of what was completed and verified.`
      : `5. **Verify (驗證成果)**:
   - Run the automated tests or build checks defined in the Verification Plan.
   - Provide a concise summary (Walkthrough) of what was completed and verified.`;

    return `==== PLANNING MODE & IMPLEMENTATION PLAN WORKFLOW ====
You must exercise judgement on whether a user's request warrants an Implementation Plan before taking action.

[When to Plan]
Stop and formulate an Implementation Plan if the user's request involves:
- Major architectural or systemic changes
- Multi-file modifications, complex feature implementation, or deep refactoring
- Significant decision making, design trade-offs, or ambiguous requirements
- Any complex changes that are not just simple tweaks

[When NOT to Plan]
Do NOT create an implementation plan or block execution if the request:
- Is investigatory in nature (e.g., 'explain how X works', 'where is Y implemented?', 'why does Z happen?')
- Is trivially simple and one-off (e.g., fixing a typo, fixing a single-line syntax error, adjusting a CSS style/spacing, adding a code comment, running a read-only command)
- Is a minor follow-up to an existing plan that the user has already approved
In these cases, execute the changes or answer directly without generating a plan.

[Planning Workflow]
When planning is triggered, strictly adhere to the following 5-step workflow:
${researchStep}
2. **Create Implementation Plan (產生實作與驗證計劃)**:
   - Present a clear, well-structured Markdown plan with the following structure:
     - **# [Goal Description]**: Concise description of what the change accomplishes.
     - **## User Review Required**: Highlight critical decisions, breaking changes, or architectural trade-offs.
     - **## Open Questions**: Any clarifying questions that impact design.
     - **## Proposed Changes**: Group by module/file and clearly demarcate with \`[NEW]\`, \`[MODIFY]\`, \`[DELETE]\` along with exact file paths.
     - **## Verification Plan**:
       - **Automated Tests**: Exact commands to run (e.g., \`npm test\`, \`vitest run\`, build/typecheck commands).
       - **Manual Verification**: User-facing or scenario-based verification steps.
3. **Obtain User Approval (暫停等待使用者批准)**:
   - CRITICAL: STOP and wait for explicit user approval before modifying any code.
   - If the \`ask_question\` tool is available, invoke \`ask_question\` to provide convenient options:
     e.g., \`question: "已完成調研並制定實作與測試計劃，請確認是否批准執行？", options: ["(Recommended) 批准執行 (Proceed with Plan)", "需要調整計畫 (Adjust Plan)"]\`
   - If \`ask_question\` is not available, explicitly ask the user to review and confirm the plan before continuing.
${executeStep}
${verifyStep}`;
  }
}

