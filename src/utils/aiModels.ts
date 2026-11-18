import type { AiProvider } from '../settings';

/** OpenAI の現行推奨モデルのうち、Chat Completions に対応するモデル。 */
const CHATGPT_MODEL_OPTIONS: readonly string[] = [
  'gpt-6.2-sol',
  'gpt-6.2-astra',
  'gpt-6.1-terra',
  'gpt-6-luna',
];

const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5';
const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export const AI_MODEL_OPTIONS: Partial<Record<AiProvider, readonly string[]>> = {
  chatgpt: CHATGPT_MODEL_OPTIONS,
  claudeCode: [
    DEFAULT_CLAUDE_MODEL,
    'claude-opus-5-5',
    'claude-haiku-5-5',
    'claude-fable-5-2',
  ],
  gemini: [
    DEFAULT_GEMINI_MODEL,
    'gemini-4-hydrogen',
    'gemini-4-argon',
    'gemini-4-carbon',
    'gemini-3.5-flash-lite',
  ],
};

/** 終了済みの旧モデルから移行し、それ以外の保存済みモデルは保持する。 */
export function resolveAiModel(provider: AiProvider, savedModel: string): string {
  const model = savedModel.trim();
  if (provider === 'claudeCode' && model === 'claude-3-5-sonnet-latest') {
    return DEFAULT_CLAUDE_MODEL;
  }
  if (provider === 'gemini') {
    if (model === 'gemini-2.0-flash-lite') return 'gemini-3.5-flash-lite';
    if (model === 'gemini-2.0-flash' || /^gemini-1\.5-(?:flash|pro)(?:-|$)/.test(model)) {
      return DEFAULT_GEMINI_MODEL;
    }
  }
  return model || AI_MODEL_OPTIONS[provider]?.[0] || (provider === 'copilot' ? '' : 'gpt-4o-mini');
}
