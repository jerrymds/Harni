import type { SubagentDefinition } from '@harni/types';

export interface ParsedSubagentRule {
  name: string;
  role?: string;
  model?: string;
  allowedTools?: string[];
  systemPrompt?: string;
  maxTurns?: number;
}

export class ClinerulesParser {
  /**
   * Parse markdown content from .clinerules or sub-agent.md to extract subagent roles and models.
   * @param content Markdown file contents.
   * @param isDedicatedSubagentFile When true (e.g. sub-agent.md), parses all role headings directly.
   */
  public static parse(content: string, isDedicatedSubagentFile = false): ParsedSubagentRule[] {
    if (!content || content.trim().length === 0) {
      return [];
    }

    const lines = content.split(/\r?\n/);
    const rules: ParsedSubagentRule[] = [];

    // If it's a dedicated sub-agent.md file, treat the whole file as inSubagentSection by default
    let inSubagentSection = isDedicatedSubagentFile;
    let currentRule: ParsedSubagentRule | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for section or role headers (#, ##, ###, ####)
      const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const title = headingMatch[2].trim();
        const lowerTitle = title.toLowerCase();

        // 1. Detect entering a subagent section
        if (
          lowerTitle.includes('subagent') ||
          lowerTitle.includes('子代理人') ||
          lowerTitle.includes('多代理') ||
          lowerTitle.includes('multi-agent') ||
          lowerTitle.includes('roles & models')
        ) {
          inSubagentSection = true;
          if (currentRule) {
            rules.push(currentRule);
            currentRule = null;
          }
          continue;
        }

        // 2. In a subagent section (or dedicated subagent file), detect a role definition
        if (inSubagentSection && (level === 2 || level === 3 || level === 4)) {
          const rawName = title.split(/[\s(]/)[0].toLowerCase();
          const metaTitles = ['overview', 'instructions', 'notes', 'rules', 'summary', '說明', '規範', '介紹'];
          if (!metaTitles.includes(rawName)) {
            if (currentRule) {
              rules.push(currentRule);
            }
            currentRule = {
              name: rawName,
            };
            continue;
          }
        }

        // 3. Exiting subagent section if hitting an unrelated top-level H1 or H2 in a general file
        if (!isDedicatedSubagentFile && inSubagentSection && level <= 2) {
          if (currentRule) {
            rules.push(currentRule);
            currentRule = null;
          }
          inSubagentSection = false;
        }
      }

      if (!inSubagentSection) {
        continue;
      }

      // Inside a subagent definition, parse bullet points
      if (currentRule) {
        const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
        if (bulletMatch) {
          const itemText = bulletMatch[1].trim();

          // Model: gemini-3.8-flash
          const modelMatch = itemText.match(
            /^(?:\*{1,2}|_{1,2})?model(?:\*{1,2}|_{1,2})?\s*:\s*[`'"]?([^`'"\r\n]+)[`'"]?/i,
          );
          if (modelMatch) {
            currentRule.model = modelMatch[1].trim();
            continue;
          }

          // Role: 代碼庫深度檢索
          const roleMatch = itemText.match(
            /^(?:\*{1,2}|_{1,2})?(?:role|title|角色)(?:\*{1,2}|_{1,2})?\s*:\s*[`'"]?([^`'"\r\n]+)[`'"]?/i,
          );
          if (roleMatch) {
            currentRule.role = roleMatch[1].trim();
            continue;
          }

          // Allowed Tools: read_file, search_files
          const toolsMatch = itemText.match(
            /^(?:\*{1,2}|_{1,2})?(?:allowed\s*tools|tools|工具)(?:\*{1,2}|_{1,2})?\s*:\s*([^`'"\r\n]+)/i,
          );
          if (toolsMatch) {
            const rawTools = toolsMatch[1]
              .replace(/[`'"]/g, '')
              .split(/[,，]/)
              .map((t) => t.trim())
              .filter(Boolean);
            currentRule.allowedTools = rawTools;
            continue;
          }

          // Instructions: 專門進行長上下文搜索
          const instMatch = itemText.match(
            /^(?:\*{1,2}|_{1,2})?(?:instructions?|system\s*prompt|prompt|指引|提示詞)(?:\*{1,2}|_{1,2})?\s*:\s*(.+)$/i,
          );
          if (instMatch) {
            currentRule.systemPrompt = instMatch[1].trim();
            continue;
          }

          // Max Turns: 20
          const turnsMatch = itemText.match(
            /^(?:\*{1,2}|_{1,2})?(?:max\s*turns?|輪次上限)(?:\*{1,2}|_{1,2})?\s*:\s*(\d+)/i,
          );
          if (turnsMatch) {
            currentRule.maxTurns = parseInt(turnsMatch[1], 10);
            continue;
          }
        }
      }
    }

    if (currentRule) {
      rules.push(currentRule);
    }

    return rules;
  }

  /**
   * Apply parsed rules onto a target SubagentDefinition Map or SubagentRegistry
   */
  public static applyRules(
    rules: ParsedSubagentRule[],
    definitions: Map<string, SubagentDefinition>,
  ): number {
    let appliedCount = 0;

    for (const rule of rules) {
      const existing = definitions.get(rule.name.toLowerCase());
      if (existing) {
        // Update existing definition with specified model, role, instructions, tools
        if (rule.model) existing.model = rule.model;
        if (rule.role) existing.role = rule.role;
        if (rule.allowedTools && rule.allowedTools.length > 0) {
          existing.allowedTools = rule.allowedTools;
        }
        if (rule.systemPrompt) {
          existing.systemPrompt = `${existing.systemPrompt}\n\n[Project Custom Instructions (.clinerules)]:\n${rule.systemPrompt}`;
        }
        if (rule.maxTurns) existing.maxTurns = rule.maxTurns;
        appliedCount++;
      } else {
        // Create new dynamic subagent definition
        const newDef: SubagentDefinition = {
          name: rule.name.toLowerCase(),
          role: rule.role || rule.name,
          description: `Custom subagent defined in .clinerules`,
          systemPrompt: rule.systemPrompt || `You are a specialized subagent for ${rule.role || rule.name}.`,
          model: rule.model,
          allowedTools: rule.allowedTools,
          enableWriteTools: rule.allowedTools
            ? rule.allowedTools.includes('write_to_file') || rule.allowedTools.includes('replace_file_content')
            : true,
          maxTurns: rule.maxTurns || 15,
        };
        definitions.set(newDef.name, newDef);
        appliedCount++;
      }
    }

    return appliedCount;
  }
}
