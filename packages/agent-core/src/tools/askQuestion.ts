import { BaseTool, type ToolExecutionContext } from './baseTool.js';
import type { AskQuestionParams, ToolParametersSchema, ToolResult } from '@harni/types';

export class AskQuestionTool extends BaseTool<AskQuestionParams> {
  public readonly name = 'ask_question';
  public readonly description =
    '向使用者提出問題以釐清需求、確認架構方向或進行技術選型。可提供預設選項讓使用者選擇，並可開放自訂輸入。';
  public readonly requiresApproval = false;

  public readonly parameters: ToolParametersSchema = {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: '要詢問使用者的問題內容（清楚說明決策重點與背景）。',
      },
      options: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: '提供給使用者選擇的具體選項清單（建議提供 2 至 4 個明確選項）。',
      },
      is_multi_select: {
        type: 'boolean',
        description: '是否允許多選。若為 true 則使用者可勾選多項；預設為 false（單選）。',
      },
      allow_custom_input: {
        type: 'boolean',
        description: '是否允許使用者自訂文字輸入（補充說明或填寫其他選項），預設為 true。',
      },
    },
    required: ['question'],
  };

  public async execute(
    params: AskQuestionParams,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    if (!params.question || typeof params.question !== 'string' || !params.question.trim()) {
      return {
        toolCallId: '',
        isError: true,
        output: 'ask_question 必須提供非空白的 question 參數。',
        summary: 'ask_question: missing question parameter',
      };
    }

    if (!context.askQuestion) {
      return {
        toolCallId: '',
        isError: false,
        output: '互動提問模式在此執行環境未啟用，請根據既有最佳實踐繼續進行。',
        summary: 'ask_question: interactive mode not available',
      };
    }

    try {
      const response = await context.askQuestion({
        question: params.question,
        options: params.options,
        isMultiSelect: params.is_multi_select,
        allowCustomInput: params.allow_custom_input ?? true,
      });

      const selectedStr =
        response.answers && response.answers.length > 0
          ? response.answers.join(', ')
          : '(無選擇選項)';
      const noteStr = response.customInput ? `補充說明: ${response.customInput}` : '';
      const summary = `使用者已回答: ${[selectedStr, noteStr].filter(Boolean).join(' | ')}`;

      return {
        toolCallId: '',
        isError: false,
        output: JSON.stringify({
          question: params.question,
          selectedOptions: response.answers || [],
          customInput: response.customInput || '',
        }),
        summary,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: '',
        isError: true,
        output: `提問過程中發生錯誤: ${errorMsg}`,
        summary: `ask_question error: ${errorMsg}`,
      };
    }
  }
}
