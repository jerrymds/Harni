/**
 * Tool Alias & Parameter Adapter for Antigravity CLI (`agy`) and cross-provider compatibility.
 *
 * `agy` has a built-in system prompt and fine-tuned weights that bias the model toward its own
 * native tool names (`view_file`, `run_command`, `grep_search`, `list_dir`, `find_by_name`,
 * `multi_replace_file_content`) and PascalCase argument keys (`TargetFile`, `CodeContent`,
 * `TargetContent`, `ReplacementContent`, `AbsolutePath`, `CommandLine`, `Cwd`, etc.).
 *
 * This adapter transparently maps `agy` tool names and parameter schemas to Harni's canonical
 * `ToolRegistry` definitions so Harni can control tool execution, Git Checkpoints, Monaco Diff
 * previews, and Linter feedback without single-turn monolith timeouts.
 */

export const AGY_TOOL_NAME_ALIASES: Readonly<Record<string, string>> = {
  // File reading
  view_file: 'read_file',
  view_file_outline: 'read_file',
  view_code_item: 'read_file',
  read: 'read_file',

  // File writing
  write_file: 'write_to_file',
  create_file: 'write_to_file',

  // File editing / replacement
  multi_replace_file_content: 'replace_file_content',
  edit_file: 'replace_file_content',
  str_replace_editor: 'replace_file_content',

  // Command execution
  run_command: 'execute_command',
  bash: 'execute_command',
  shell: 'execute_command',

  // Directory listing & file finding
  list_dir: 'list_files',
  find_by_name: 'list_files',
  ls: 'list_files',

  // Code / content search
  grep_search: 'search_files',
  grep: 'search_files',
  ripgrep: 'search_files',
};

/**
 * Resolves an incoming tool name (including `agy` built-in tool names) to Harni's canonical tool name.
 */
export function resolveCanonicalToolName(rawName: string): string {
  if (!rawName) return rawName;
  const trimmed = rawName.trim();
  return (
    AGY_TOOL_NAME_ALIASES[trimmed] ??
    AGY_TOOL_NAME_ALIASES[trimmed.toLowerCase()] ??
    trimmed
  );
}

function firstDefined<T = unknown>(
  obj: Record<string, unknown>,
  keys: string[],
): T | undefined {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      return obj[key] as T;
    }
  }
  return undefined;
}

function toOptionalNumber(val: unknown): number | undefined {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function toOptionalBoolean(val: unknown): boolean | undefined {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
  }
  return undefined;
}

/**
 * Normalizes tool arguments from `agy` (PascalCase / native schema) or other LLM variants
 * into Harni's canonical camelCase tool parameter schema.
 */
export function normalizeToolArguments(
  rawName: string,
  rawArgs: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  const args: Record<string, unknown> =
    rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? { ...rawArgs } : {};
  const canonical = resolveCanonicalToolName(rawName);

  switch (canonical) {
    case 'read_file': {
      const filePath = firstDefined<string>(args, [
        'path',
        'AbsolutePath',
        'TargetFile',
        'File',
        'file_path',
        'filepath',
        'filePath',
      ]);
      if (filePath !== undefined) args.path = String(filePath);

      const startLine = toOptionalNumber(
        firstDefined(args, ['startLine', 'StartLine', 'start_line']),
      );
      if (startLine !== undefined) args.startLine = startLine;

      const endLine = toOptionalNumber(firstDefined(args, ['endLine', 'EndLine', 'end_line']));
      if (endLine !== undefined) args.endLine = endLine;
      break;
    }

    case 'write_to_file': {
      const filePath = firstDefined<string>(args, [
        'path',
        'TargetFile',
        'AbsolutePath',
        'File',
        'file_path',
        'filepath',
        'filePath',
      ]);
      if (filePath !== undefined) args.path = String(filePath);

      const content = firstDefined<string>(args, [
        'content',
        'CodeContent',
        'code_content',
        'text',
        'fileText',
      ]);
      if (content !== undefined) args.content = String(content);
      delete args.ArtifactMetadata;
      break;
    }

    case 'replace_file_content': {
      const filePath = firstDefined<string>(args, [
        'path',
        'TargetFile',
        'AbsolutePath',
        'File',
        'file_path',
        'filepath',
        'filePath',
      ]);
      if (filePath !== undefined) args.path = String(filePath);

      const targetContent = firstDefined<string>(args, [
        'targetContent',
        'TargetContent',
        'target_content',
        'old_str',
        'oldString',
        'search',
      ]);
      if (targetContent !== undefined) args.targetContent = String(targetContent);

      const replacementContent = firstDefined<string>(args, [
        'replacementContent',
        'ReplacementContent',
        'replacement_content',
        'new_str',
        'newString',
        'replace',
      ]);
      if (replacementContent !== undefined) args.replacementContent = String(replacementContent);

      const allowMultiple = toOptionalBoolean(
        firstDefined(args, ['allowMultiple', 'AllowMultiple', 'allow_multiple']),
      );
      if (allowMultiple !== undefined) args.allowMultiple = allowMultiple;

      const rawChunks = firstDefined<unknown[]>(args, [
        'replacementChunks',
        'ReplacementChunks',
        'replacement_chunks',
        'chunks',
      ]);
      if (Array.isArray(rawChunks) && rawChunks.length > 0) {
        const normalizedChunks = rawChunks
          .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === 'object'))
          .map((c) => {
            const tc = firstDefined<string>(c, [
              'targetContent',
              'TargetContent',
              'target_content',
              'old_str',
              'search',
            ]);
            const rc = firstDefined<string>(c, [
              'replacementContent',
              'ReplacementContent',
              'replacement_content',
              'new_str',
              'replace',
            ]);
            const am = toOptionalBoolean(
              firstDefined(c, ['allowMultiple', 'AllowMultiple', 'allow_multiple']),
            );
            return {
              targetContent: tc !== undefined ? String(tc) : '',
              replacementContent: rc !== undefined ? String(rc) : '',
              ...(am !== undefined ? { allowMultiple: am } : {}),
            };
          });
        args.replacementChunks = normalizedChunks;

        if (normalizedChunks.length === 1 && args.targetContent === undefined) {
          args.targetContent = normalizedChunks[0]!.targetContent;
          args.replacementContent = normalizedChunks[0]!.replacementContent;
          if (normalizedChunks[0]!.allowMultiple !== undefined && args.allowMultiple === undefined) {
            args.allowMultiple = normalizedChunks[0]!.allowMultiple;
          }
        }
      }
      break;
    }

    case 'execute_command': {
      const command = firstDefined<string>(args, [
        'command',
        'CommandLine',
        'command_line',
        'cmd',
      ]);
      if (command !== undefined) args.command = String(command);

      const cwd = firstDefined<string>(args, [
        'cwd',
        'Cwd',
        'WorkingDirectory',
        'working_directory',
        'DirectoryPath',
      ]);
      if (cwd !== undefined) args.cwd = String(cwd);
      break;
    }

    case 'list_files': {
      const dirPath = firstDefined<string>(args, [
        'path',
        'DirectoryPath',
        'SearchDirectory',
        'TargetDirectory',
        'directory_path',
        'dir',
      ]);
      if (dirPath !== undefined) args.path = String(dirPath);

      const recursive = toOptionalBoolean(firstDefined(args, ['recursive', 'Recursive']));
      if (recursive !== undefined) {
        args.recursive = recursive;
      } else if (rawName.trim().toLowerCase() === 'list_dir') {
        // agy's `list_dir` only lists immediate children of DirectoryPath
        args.recursive = false;
      }

      const pattern = firstDefined<string>(args, ['pattern', 'Pattern', 'glob']);
      if (pattern !== undefined) args.pattern = String(pattern);
      break;
    }

    case 'search_files': {
      const query = firstDefined<string>(args, [
        'query',
        'Query',
        'Pattern',
        'search_term',
        'regex',
      ]);
      if (query !== undefined) args.query = String(query);

      const searchPath = firstDefined<string>(args, [
        'path',
        'SearchPath',
        'SearchDirectory',
        'DirectoryPath',
        'search_path',
      ]);
      if (searchPath !== undefined) args.path = String(searchPath);

      const isRegex = toOptionalBoolean(firstDefined(args, ['isRegex', 'IsRegex', 'is_regex']));
      if (isRegex !== undefined) args.isRegex = isRegex;
      break;
    }

    case 'invoke_subagent': {
      const rawSubagents = firstDefined<unknown[]>(args, ['subagents', 'Subagents']);
      if (Array.isArray(rawSubagents)) {
        args.subagents = rawSubagents
          .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object'))
          .map((s) => {
            const typeName = firstDefined<string>(s, [
              'typeName',
              'TypeName',
              'type_name',
              'type',
            ]);
            const role = firstDefined<string>(s, ['role', 'Role']);
            const prompt = firstDefined<string>(s, ['prompt', 'Prompt']);
            const model = firstDefined<string>(s, ['model', 'Model']);
            return {
              typeName: typeName !== undefined ? String(typeName) : 'self',
              role: role !== undefined ? String(role) : 'Subagent',
              prompt: prompt !== undefined ? String(prompt) : '',
              ...(model !== undefined && model !== 'inherit' ? { model: String(model) } : {}),
            };
          });
      }
      break;
    }

    case 'send_message': {
      const subagentId = firstDefined<string>(args, [
        'subagentId',
        'Recipient',
        'recipient',
        'ConversationId',
        'conversationId',
        'subagent_id',
      ]);
      if (subagentId !== undefined) args.subagentId = String(subagentId);

      const message = firstDefined<string>(args, ['message', 'Message', 'content', 'prompt']);
      if (message !== undefined) args.message = String(message);
      break;
    }

    case 'manage_subagents': {
      const action = firstDefined<string>(args, ['action', 'Action']);
      if (action !== undefined) args.action = String(action).toLowerCase();

      const subagentIds = firstDefined<unknown[]>(args, [
        'subagentIds',
        'ConversationIds',
        'conversationIds',
        'subagent_ids',
      ]);
      if (Array.isArray(subagentIds)) {
        args.subagentIds = subagentIds.map((id) => String(id));
      }
      break;
    }

    case 'define_subagent': {
      const name = firstDefined<string>(args, ['name', 'Name']);
      if (name !== undefined) args.name = String(name);

      const description = firstDefined<string>(args, ['description', 'Description']);
      if (description !== undefined) args.description = String(description);

      const systemPrompt = firstDefined<string>(args, [
        'systemPrompt',
        'system_prompt',
        'SystemPrompt',
      ]);
      if (systemPrompt !== undefined) args.systemPrompt = String(systemPrompt);

      const role = firstDefined<string>(args, ['role', 'Role']);
      if (role !== undefined) args.role = String(role);

      const enableWriteTools = toOptionalBoolean(
        firstDefined(args, ['enableWriteTools', 'enable_write_tools', 'EnableWriteTools']),
      );
      if (enableWriteTools !== undefined) args.enableWriteTools = enableWriteTools;

      const enableSubagentTools = toOptionalBoolean(
        firstDefined(args, ['enableSubagentTools', 'enable_subagent_tools', 'EnableSubagentTools']),
      );
      if (enableSubagentTools !== undefined) args.enableSubagentTools = enableSubagentTools;
      break;
    }

    case 'ask_question': {
      const questionsList = firstDefined<unknown[]>(args, ['questions', 'Questions']);
      if (!args.question && Array.isArray(questionsList) && questionsList.length > 0) {
        const firstQ = questionsList[0];
        if (firstQ && typeof firstQ === 'object' && !Array.isArray(firstQ)) {
          const qObj = firstQ as Record<string, unknown>;
          const qText = firstDefined<string>(qObj, ['question', 'Question']);
          if (qText !== undefined) args.question = String(qText);
          const qOpts = firstDefined<unknown[]>(qObj, ['options', 'Options']);
          if (Array.isArray(qOpts)) args.options = qOpts.map((o) => String(o));
          const qMulti = toOptionalBoolean(
            firstDefined(qObj, ['is_multi_select', 'isMultiSelect', 'IsMultiSelect']),
          );
          if (qMulti !== undefined) args.is_multi_select = qMulti;
        }
      } else {
        const qText = firstDefined<string>(args, ['question', 'Question']);
        if (qText !== undefined) args.question = String(qText);
        const qOpts = firstDefined<unknown[]>(args, ['options', 'Options']);
        if (Array.isArray(qOpts)) args.options = qOpts.map((o) => String(o));
        const qMulti = toOptionalBoolean(
          firstDefined(args, ['is_multi_select', 'isMultiSelect', 'IsMultiSelect']),
        );
        if (qMulti !== undefined) args.is_multi_select = qMulti;
      }
      break;
    }

    case 'use_skill': {
      const skillName = firstDefined<string>(args, [
        'skill_name',
        'skillName',
        'SkillName',
        'name',
        'Name',
      ]);
      if (skillName !== undefined) args.skill_name = String(skillName);
      break;
    }
  }

  return args;
}

/**
 * Normalizes both tool name and arguments in a single call.
 */
export function normalizeToolCall(
  rawName: string,
  rawArgs: Record<string, unknown> | undefined | null,
): { name: string; arguments: Record<string, unknown> } {
  const name = resolveCanonicalToolName(rawName);
  const normalizedArgs = normalizeToolArguments(rawName, rawArgs);
  return { name, arguments: normalizedArgs };
}
