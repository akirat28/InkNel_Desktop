import { useEffect, useMemo, useState } from 'react';
import {
  AI_PROVIDER_OPTIONS,
  CALENDAR_TITLE_FORMAT_OPTIONS,
  DATE_FORMAT_OPTIONS,
  DEFAULT_SETTINGS,
  FONT_FAMILY_OPTIONS,
  FONT_SIZE_OPTIONS,
  SIDEBAR_ITEM_VISIBILITY_OPTIONS,
  isValidProtectionPassword,
  type AiProvider,
  type AiProviderSettings,
  type AppSettings,
  type CalendarPluginSettings,
  type FontFamily,
  type FontSize,
  type Language,
  type OpenHistoryLimit,
  type SearchHistoryLimit,
  type SearchHistoryMode,
  type SidebarItemVisibility,
  type Theme,
} from '../settings';
import { SUPPORTED_HIGHLIGHT_LANGS } from '../utils/highlight';
import { LANGUAGE_OPTIONS, useT } from '../i18n';
import { listPlugins } from '../plugins/registry';
import {
  getRuntimePlugins,
  importPluginById,
  unloadPluginById,
  subscribeRuntimePlugins,
} from '../plugins/runtimeLoader';
import PinInput from './PinInput';

const CHATGPT_MODEL_OPTIONS = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'];

/**
 * Gemini で選択できるモデル一覧。
 * Google AI Studio で公開されている現行モデルのみ（gemini-1.5 系は v1beta の
 * generateContent から外れているため除外）。
 * 既定は gemini-2.0-flash（高速・無料枠で扱いやすい）。
 */
const GEMINI_MODEL_OPTIONS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];

/**
 * Claude (Anthropic) で選択できるモデル一覧。
 * 既定は claude-3-5-sonnet-latest（defaultAiModel('claudeCode') と揃える）。
 * 4 系（Opus 4.x / Sonnet 4.x / Haiku 4.x）は精度・速度のバランスで選ぶ。
 */
const CLAUDECODE_MODEL_OPTIONS = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-3-5-sonnet-latest',
];

interface Props {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
  onChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  standalone?: boolean;
}

type CategoryKey =
  | 'general'
  | 'ai'
  | 'codeBlock'
  | 'template'
  | 'protection'
  | 'storage'
  | 'calendar'
  | 'plugins'
  | 'maintenance'
  | 'reset'
  | 'about';

interface Category {
  key: CategoryKey;
  label: string;
}

/** カテゴリのラベルは現在ロケールから取得（コンポーネント内で生成） */

export default function PreferencesModal({
  open,
  onClose,
  settings,
  onChange,
  standalone = false,
}: Props) {
  const [active, setActive] = useState<CategoryKey>('general');
  const t = useT();

  // カテゴリのラベルは現在ロケールから生成
  const categories: Category[] = useMemo(
    () => [
      { key: 'general', label: t.settings.categories.general },
      { key: 'ai', label: t.settings.categories.ai },
      { key: 'codeBlock', label: t.settings.categories.codeBlock },
      { key: 'template', label: t.settings.categories.template },
      { key: 'protection', label: t.settings.categories.protection },
      { key: 'storage', label: t.settings.categories.storage },
      { key: 'calendar', label: t.settings.categories.calendar },
      { key: 'plugins', label: t.settings.categories.plugins },
      { key: 'maintenance', label: t.settings.categories.maintenance },
      { key: 'reset', label: t.settings.categories.reset },
      { key: 'about', label: t.settings.categories.about },
    ],
    [t],
  );

  // ESC で閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const content = (
      <div
        className={`modal modal--prefs ${standalone ? 'modal--prefs-standalone' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="preferences-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__header">
          <h2 id="preferences-title" className="modal__title">
            {t.settings.title}
          </h2>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label={t.common.close}
          >
            ×
          </button>
        </header>

        <div className="prefs">
          <nav className="prefs__nav" aria-label={t.settings.title}>
            <ul>
              {categories.map((cat) => (
                <li key={cat.key}>
                  <button
                    type="button"
                    className={`prefs__nav-item ${active === cat.key ? 'is-active' : ''}`}
                    onClick={() => setActive(cat.key)}
                    aria-current={active === cat.key ? 'page' : undefined}
                  >
                    {cat.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <section className="prefs__panel">
            {active === 'general' && (
              <GeneralPanel settings={settings} onChange={onChange} />
            )}
            {active === 'ai' && (
              <AiPanel settings={settings} onChange={onChange} />
            )}
            {active === 'codeBlock' && (
              <CodeBlockPanel settings={settings} onChange={onChange} />
            )}
            {active === 'template' && (
              <TemplatePanel settings={settings} onChange={onChange} />
            )}
            {active === 'protection' && (
              <ProtectionPanel settings={settings} onChange={onChange} />
            )}
            {active === 'storage' && (
              <>
                <StoragePanel settings={settings} onChange={onChange} />
                <BackupPanel />
                <RestorePanel />
              </>
            )}
            {active === 'calendar' && (
              <CalendarPanel settings={settings} onChange={onChange} />
            )}
            {active === 'plugins' && (
              <PluginsPanel settings={settings} onChange={onChange} />
            )}
            {active === 'maintenance' && <MaintenancePanel />}
            {active === 'reset' && <ResetPanel />}
            {active === 'about' && <AboutPanel />}
          </section>
        </div>
      </div>
  );

  if (standalone) {
    return <div className="prefs-window">{content}</div>;
  }

  return (
    <div className="modal__backdrop" onClick={onClose} role="presentation">
      {content}
    </div>
  );
}

// ----- AI パネル -----

function AiPanel({ settings, onChange }: PanelProps) {
  const t = useT();
  // タブ式: aiProvider が「現在編集中 = 有効化されているプロバイダ」
  // 各プロバイダの token / endpoint / model は aiProviderSettings[provider] に独立保存
  const isChatGpt = settings.aiProvider === 'chatgpt';
  const isGemini = settings.aiProvider === 'gemini';
  const isClaudeCode = settings.aiProvider === 'claudeCode';
  const [showToken, setShowToken] = useState(false);
  const current: AiProviderSettings =
    settings.aiProviderSettings[settings.aiProvider];

  /** 現在編集中プロバイダの 1 フィールドを更新 */
  const updateField = (field: keyof AiProviderSettings, value: string) => {
    onChange('aiProviderSettings', {
      ...settings.aiProviderSettings,
      [settings.aiProvider]: {
        ...current,
        [field]: value,
      },
    });
  };

  const handleProviderChange = (provider: AiProvider) => {
    onChange('aiProvider', provider);
    // ChatGPT に切替時、その枠の model が許可リスト外なら既定値へ
    if (provider === 'chatgpt') {
      const m = settings.aiProviderSettings.chatgpt.model;
      if (!CHATGPT_MODEL_OPTIONS.includes(m)) {
        onChange('aiProviderSettings', {
          ...settings.aiProviderSettings,
          chatgpt: {
            ...settings.aiProviderSettings.chatgpt,
            model: CHATGPT_MODEL_OPTIONS[0],
          },
        });
      }
    }
    // ClaudeCode に切替時、許可リスト外なら既定（claude-3-5-sonnet-latest）へ
    if (provider === 'claudeCode') {
      const m = settings.aiProviderSettings.claudeCode.model;
      if (m.trim() !== '' && !CLAUDECODE_MODEL_OPTIONS.includes(m)) {
        onChange('aiProviderSettings', {
          ...settings.aiProviderSettings,
          claudeCode: {
            ...settings.aiProviderSettings.claudeCode,
            model: 'claude-3-5-sonnet-latest',
          },
        });
      }
    }
    // Gemini に切替時も同様に、許可リスト外なら既定（gemini-2.0-flash）へ
    if (provider === 'gemini') {
      const g = settings.aiProviderSettings.gemini;
      const needModelReset = !GEMINI_MODEL_OPTIONS.includes(g.model);
      // 旧バージョンで OpenAI 互換 URL を保存していると 404 になるためクリア
      const needEndpointReset =
        g.endpoint.includes('/openai/chat/completions') ||
        g.endpoint.includes('/v1/chat/completions');
      if (needModelReset || needEndpointReset) {
        onChange('aiProviderSettings', {
          ...settings.aiProviderSettings,
          gemini: {
            ...g,
            model: needModelReset ? 'gemini-2.0-flash' : g.model,
            endpoint: needEndpointReset ? '' : g.endpoint,
          },
        });
      }
    }
  };

  const tokenIsSet = current.token.trim().length > 0;

  // Gemini 選択中で保存モデルがリスト外（例: 廃止された gemini-1.5-flash）の場合は
  // パネルを開いた時点で gemini-2.0-flash に移行する。
  // 同様に旧 OpenAI 互換 URL が残っていたらクリア。
  useEffect(() => {
    if (settings.aiProvider !== 'gemini') return;
    const g = settings.aiProviderSettings.gemini;
    const modelInvalid =
      g.model.trim() !== '' && !GEMINI_MODEL_OPTIONS.includes(g.model);
    const endpointStale =
      g.endpoint.includes('/openai/chat/completions') ||
      g.endpoint.includes('/v1/chat/completions');
    if (!modelInvalid && !endpointStale) return;
    onChange('aiProviderSettings', {
      ...settings.aiProviderSettings,
      gemini: {
        ...g,
        model: modelInvalid ? 'gemini-2.0-flash' : g.model,
        endpoint: endpointStale ? '' : g.endpoint,
      },
    });
    // 一度だけ実行すればよいので、依存は意図的に空に近い形にせず、
    // settings の変化に合わせて再評価する（既に修正済みなら何もしない）
  }, [settings.aiProvider, settings.aiProviderSettings, onChange]);

  return (
    <div className="prefs__section">
      <h3 className="prefs__section-title">{t.settings.categories.ai}</h3>

      {/* ----- 共通設定 (全プロバイダ共通) -----
          AI チャットから「ノートに変換」した時の既定保存先フォルダ名 +
          チャット/入力のフォントサイズ。プロバイダによらず共通なので
          一番上に配置している。 */}
      <div className="ai-panel__subhead">
        <h4 className="ai-panel__subhead-title">
          {t.settings.ai.commonSection}
        </h4>
      </div>

      <div className="ai-panel__group">
        <div className="ai-panel__row">
          <div className="ai-panel__row-label">
            <span className="ai-panel__row-icon">
              <FolderIcon />
            </span>
            {t.settings.ai.noteFolderLabel}
          </div>
          <input
            id="prefs-ai-note-folder"
            type="text"
            className="ai-panel__row-input"
            value={settings.aiNoteFolder}
            placeholder="AIノート"
            onChange={(e) => onChange('aiNoteFolder', e.target.value)}
            onBlur={(e) => {
              // 空欄のまま blur したら既定値に戻す
              if (!e.target.value.trim()) onChange('aiNoteFolder', 'AIノート');
            }}
          />
          <p className="ai-panel__row-desc">
            {t.settings.ai.noteFolderDesc}
          </p>
        </div>

        {/* チャット表示テキストサイズ (メッセージ吹き出し) */}
        <div className="ai-panel__row">
          <div className="ai-panel__row-label">
            <span className="ai-panel__row-icon">
              <FontIcon />
            </span>
            {t.settings.ai.chatFontSizeLabel}
          </div>
          <select
            id="prefs-ai-chat-font-size"
            className="ai-panel__row-select"
            value={String(settings.aiChatFontSize)}
            onChange={(e) =>
              onChange('aiChatFontSize', Number(e.target.value) as FontSize)
            }
          >
            {FONT_SIZE_OPTIONS.map((s) => (
              <option key={s} value={String(s)}>
                {s} {t.settings.general.fontSizeSuffix}
              </option>
            ))}
          </select>
          <p className="ai-panel__row-desc">
            {t.settings.ai.chatFontSizeDesc}
          </p>
        </div>

        {/* 入力テキストボックスのフォントサイズ */}
        <div className="ai-panel__row">
          <div className="ai-panel__row-label">
            <span className="ai-panel__row-icon">
              <FontIcon />
            </span>
            {t.settings.ai.inputFontSizeLabel}
          </div>
          <select
            id="prefs-ai-input-font-size"
            className="ai-panel__row-select"
            value={String(settings.aiInputFontSize)}
            onChange={(e) =>
              onChange('aiInputFontSize', Number(e.target.value) as FontSize)
            }
          >
            {FONT_SIZE_OPTIONS.map((s) => (
              <option key={s} value={String(s)}>
                {s} {t.settings.general.fontSizeSuffix}
              </option>
            ))}
          </select>
          <p className="ai-panel__row-desc">
            {t.settings.ai.inputFontSizeDesc}
          </p>
        </div>
      </div>

      {/* ============================================================
          プロバイダ選択カード
          ============================================================
          タブで AI を切替 → カード内に接続/モデル/ベースプロンプトを表示。
          プロバイダごとに独立した設定スライス (aiProviderSettings) を持つので、
          タブ切替で内容も切り替わる。 */}
      <div className="ai-card">
        <div
          className="ai-card__tabs"
          role="tablist"
          aria-label={t.settings.ai.provider}
        >
          {AI_PROVIDER_OPTIONS.map((o) => {
            const isActive = settings.aiProvider === o.value;
            const hasToken =
              settings.aiProviderSettings[o.value]?.token.trim().length > 0;
            return (
              <button
                key={o.value}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`ai-card__tab ${isActive ? 'is-active' : ''}`}
                onClick={() => handleProviderChange(o.value)}
                title={
                  hasToken && !isActive
                    ? `${o.label} (${t.settings.ai.tokenSet})`
                    : o.label
                }
              >
                <span className="ai-card__tab-icon">
                  <AiSparkIcon />
                </span>
                <span className="ai-card__tab-label">{o.label}</span>
                {hasToken && (
                  <span
                    className="ai-card__tab-dot"
                    aria-label={t.settings.ai.tokenSet}
                    title={t.settings.ai.tokenSet}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div
          className="ai-card__body"
          role="tabpanel"
          aria-label={current && AI_PROVIDER_OPTIONS.find(
            (o) => o.value === settings.aiProvider,
          )?.label}
        >

      {/* ----- 接続 (Token + Endpoint) — 現在選択中のプロバイダ専用 ----- */}
      <div className="ai-panel__subhead">
        <h4 className="ai-panel__subhead-title">
          {t.settings.ai.connection}
          <span
            className={`ai-panel__status-dot ${tokenIsSet ? 'ai-panel__status-dot--ok' : ''}`}
            title={tokenIsSet ? t.settings.ai.connectionStatusSet : t.settings.ai.connectionStatusUnset}
            aria-label={tokenIsSet ? t.settings.ai.connectionStatusSet : t.settings.ai.connectionStatusUnset}
          />
        </h4>
      </div>

      <div className="ai-panel__group">
        <div className="ai-panel__row">
          <div className="ai-panel__row-label">
            <span className="ai-panel__row-icon">
              <KeyIcon />
            </span>
            {t.settings.ai.apiToken}
          </div>
          <div className="ai-panel__token-wrap">
            <input
              id="prefs-ai-token"
              className="ai-panel__row-input"
              type={showToken ? 'text' : 'password'}
              value={current.token}
              placeholder={t.settings.ai.apiTokenPlaceholder}
              autoComplete="off"
              onChange={(e) => updateField('token', e.target.value)}
            />
            <button
              type="button"
              className="ai-panel__token-toggle"
              onClick={() => setShowToken((v) => !v)}
              title={showToken ? t.settings.ai.tokenHide : t.settings.ai.tokenShow}
              aria-label={showToken ? t.settings.ai.tokenHide : t.settings.ai.tokenShow}
            >
              {showToken ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
          <p className="ai-panel__row-desc">{t.settings.ai.apiTokenDesc}</p>
          {isGemini && (
            <p className="ai-panel__row-desc ai-panel__row-desc--note">
              Gemini API キーの取得手順:
              <br />
              1.{' '}
              <a
                href="#"
                className="ai-panel__row-link"
                onClick={(e) => {
                  e.preventDefault();
                  void window.api.shell.openExternal(
                    'https://aistudio.google.com/apikey',
                  );
                }}
              >
                Google AI Studio (aistudio.google.com/apikey)
              </a>
              {' '}を開く
              <br />
              2. Google アカウントでログイン
              <br />
              3. 「Create API key」をクリックして発行(無料、クレカ登録不要)
              <br />
              4. 発行されたキーをこの欄に貼り付け
              <br />
              ※ 無料枠でも API キーは必須です。レート制限の範囲内なら課金されません。
            </p>
          )}
          {isClaudeCode && (
            <p className="ai-panel__row-desc ai-panel__row-desc--note">
              Claude (Anthropic) API キーの取得手順:
              <br />
              1.{' '}
              <a
                href="#"
                className="ai-panel__row-link"
                onClick={(e) => {
                  e.preventDefault();
                  void window.api.shell.openExternal(
                    'https://console.anthropic.com/settings/keys',
                  );
                }}
              >
                Anthropic Console (console.anthropic.com)
              </a>
              {' '}を開く
              <br />
              2. メールアドレスまたは Google アカウントでサインアップ / ログイン
              <br />
              3. 左メニュー「Settings」→「API Keys」を開く
              <br />
              4. 「Create Key」をクリックし、名前を入力して発行
              <br />
              5. 表示された
              {' '}<code>sk-ant-...</code>
              {' '}で始まるキーをこの欄に貼り付け(再表示不可)
              <br />
              ※ 利用には Anthropic アカウントでのクレジット購入(従量課金)が
              必要です。新規アカウントには$5程度の無料クレジットが
              付与されることがあります(条件はAnthropic側で変動)。
              <br />
              ※ Claude Code CLI のサブスクリプション（Pro / Max）の認証トークンは
              ここでは使えません。API 用キーを別途発行してください。
            </p>
          )}
        </div>

        <div className="ai-panel__row">
          <div className="ai-panel__row-label">
            <span className="ai-panel__row-icon">
              <LinkIcon />
            </span>
            {t.settings.ai.endpoint}
          </div>
          <input
            id="prefs-ai-endpoint"
            className="ai-panel__row-input"
            type="url"
            value={current.endpoint}
            placeholder={t.settings.ai.endpointPlaceholder}
            onChange={(e) => updateField('endpoint', e.target.value)}
          />
          <p className="ai-panel__row-desc">{t.settings.ai.endpointDesc}</p>
        </div>
      </div>

      {/* ----- モデル ----- */}
      <div className="ai-panel__subhead">
        <h4 className="ai-panel__subhead-title">
          {t.settings.ai.modelSection}
        </h4>
      </div>

      <div className="ai-panel__group">
        <div className="ai-panel__row">
          <div className="ai-panel__row-label">
            <span className="ai-panel__row-icon">
              <CpuIcon />
            </span>
            {t.settings.ai.model}
          </div>
          {isChatGpt ? (
            <select
              id="prefs-ai-model"
              className="ai-panel__row-select"
              value={
                CHATGPT_MODEL_OPTIONS.includes(current.model)
                  ? current.model
                  : CHATGPT_MODEL_OPTIONS[0]
              }
              onChange={(e) => updateField('model', e.target.value)}
            >
              {CHATGPT_MODEL_OPTIONS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          ) : isGemini ? (
            <select
              id="prefs-ai-model"
              className="ai-panel__row-select"
              value={
                GEMINI_MODEL_OPTIONS.includes(current.model)
                  ? current.model
                  : 'gemini-2.0-flash'
              }
              onChange={(e) => updateField('model', e.target.value)}
            >
              {GEMINI_MODEL_OPTIONS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          ) : isClaudeCode ? (
            <select
              id="prefs-ai-model"
              className="ai-panel__row-select"
              value={
                CLAUDECODE_MODEL_OPTIONS.includes(current.model)
                  ? current.model
                  : 'claude-3-5-sonnet-latest'
              }
              onChange={(e) => updateField('model', e.target.value)}
            >
              {CLAUDECODE_MODEL_OPTIONS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="prefs-ai-model"
              className="ai-panel__row-input"
              type="text"
              value={current.model}
              placeholder={t.settings.ai.modelPlaceholder}
              onChange={(e) => updateField('model', e.target.value)}
            />
          )}
          <p className="ai-panel__row-desc">
            {isChatGpt
              ? t.settings.ai.modelChatgptDesc
              : isGemini
                ? 'Gemini 用のモデルから選択します。Pro は精度重視、Flash は速度・無料枠重視。'
                : isClaudeCode
                  ? 'Claude 用のモデルから選択します。Opus は最高精度、Sonnet は標準、Haiku は速度・低コスト重視。'
                  : t.settings.ai.modelDefaultDesc}
          </p>
        </div>
      </div>

      {/* ----- ベースプロンプト（役割設定） ----- */}
      <div className="ai-panel__subhead">
        <h4 className="ai-panel__subhead-title">
          {t.settings.ai.basePromptSection}
        </h4>
      </div>

      <div className="ai-panel__group">
        <div className="ai-panel__row">
          <div className="ai-panel__row-label">
            <span className="ai-panel__row-icon">
              <RoleIcon />
            </span>
            {t.settings.ai.basePromptLabel}
          </div>
          <textarea
            id="prefs-ai-base-prompt"
            className="ai-panel__row-input ai-panel__row-textarea"
            rows={5}
            value={current.basePrompt}
            placeholder={t.settings.ai.basePromptPlaceholder}
            onChange={(e) => updateField('basePrompt', e.target.value)}
          />
          <p className="ai-panel__row-desc">
            {t.settings.ai.basePromptDesc}
          </p>
        </div>
      </div>

        </div>{/* /ai-card__body */}
      </div>{/* /ai-card */}

    </div>
  );
}

// ----- AI パネル用アイコン -----

function AiSparkIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4L12 3z" />
      <path d="M19 14l.7 1.8L21 17l-1.3.8L19 19l-.7-1.2L17 17l1.3-1.2L19 14z" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="15" r="4" />
      <path d="M11 13l9-9" />
      <path d="M17 7l3 3" />
      <path d="M19 5l2 2" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </svg>
  );
}

function CpuIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </svg>
  );
}

/** フォントサイズ設定用のアイコン。「A」を 2 サイズ並べたミニアイコン */
function FontIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
    >
      <text x="3" y="18" fontSize="14" fontFamily="sans-serif" fontWeight="700">
        A
      </text>
      <text x="14" y="18" fontSize="9" fontFamily="sans-serif" fontWeight="700">
        A
      </text>
    </svg>
  );
}

/** ベースプロンプト（役割設定）用のアイコン。吹き出しに人型アイコンを重ねた絵 */
function RoleIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 5 h16 a1 1 0 0 1 1 1 v10 a1 1 0 0 1 -1 1 H8 l-4 4 V6 a1 1 0 0 1 1 -1 z" />
      <circle cx="12" cy="10.5" r="2" />
      <path d="M8.5 15 c0.8 -1.7 2.2 -2.5 3.5 -2.5 s2.7 0.8 3.5 2.5" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3l18 18" />
      <path d="M10.5 10.5a3 3 0 0 0 4 4" />
      <path d="M17.5 17.5C16 18.5 14.1 19 12 19c-6.5 0-10-7-10-7a17 17 0 0 1 4.4-5.1" />
      <path d="M9.5 5.2A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.7" />
    </svg>
  );
}

// ----- 基本 (General) パネル -----

interface PanelProps {
  settings: AppSettings;
  onChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

function GeneralPanel({ settings, onChange }: PanelProps) {
  const t = useT();
  return (
    <div className="prefs__section">
      <h3 className="prefs__section-title">{t.settings.categories.general}</h3>

      <div className="prefs__field">
        <div className="prefs__field-main">
          <label className="prefs__field-label">{t.settings.general.theme}</label>
          <p className="prefs__field-desc">{t.settings.general.themeDesc}</p>
        </div>
        <ThemeSegment
          value={settings.theme}
          onChange={(v) => onChange('theme', v)}
        />
      </div>

      <div className="prefs__field">
        <div className="prefs__field-main">
          <label
            className="prefs__field-label"
            htmlFor="prefs-language"
          >
            {t.settings.general.language}
          </label>
          <p className="prefs__field-desc">{t.settings.general.languageDesc}</p>
        </div>
        <select
          id="prefs-language"
          className="prefs__select"
          value={settings.language}
          onChange={(e) => onChange('language', e.target.value as Language)}
        >
          {LANGUAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value === 'auto'
                ? t.settings.general.languageAuto
                : o.nativeLabel}
            </option>
          ))}
        </select>
      </div>

      <div className="prefs__field">
        <div className="prefs__field-main">
          <label className="prefs__field-label" htmlFor="prefs-font-family">
            {t.settings.general.fontFamily}
          </label>
          <p className="prefs__field-desc">
            {t.settings.general.fontFamilyDesc}
          </p>
        </div>
        <select
          id="prefs-font-family"
          className="prefs__select"
          value={settings.fontFamily}
          onChange={(e) => onChange('fontFamily', e.target.value as FontFamily)}
        >
          {FONT_FAMILY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="prefs__field">
        <div className="prefs__field-main">
          <label className="prefs__field-label" htmlFor="prefs-font-size">
            {t.settings.general.fontSize}
          </label>
          <p className="prefs__field-desc">{t.settings.general.fontSizeDesc}</p>
        </div>
        <select
          id="prefs-font-size"
          className="prefs__select"
          value={String(settings.fontSize)}
          onChange={(e) => onChange('fontSize', Number(e.target.value) as FontSize)}
        >
          {FONT_SIZE_OPTIONS.map((s) => (
            <option key={s} value={String(s)}>
              {s} {t.settings.general.fontSizeSuffix}
            </option>
          ))}
        </select>
      </div>

      <div className="prefs__field">
        <div className="prefs__field-main">
          <label
            className="prefs__field-label"
            htmlFor="prefs-sidebar-font-family"
          >
            {t.settings.general.sidebarFontFamily}
          </label>
          <p className="prefs__field-desc">
            {t.settings.general.sidebarFontFamilyDesc}
          </p>
        </div>
        <select
          id="prefs-sidebar-font-family"
          className="prefs__select"
          value={settings.sidebarFontFamily}
          onChange={(e) =>
            onChange('sidebarFontFamily', e.target.value as FontFamily)
          }
        >
          {FONT_FAMILY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="prefs__field">
        <div className="prefs__field-main">
          <label
            className="prefs__field-label"
            htmlFor="prefs-sidebar-font-size"
          >
            {t.settings.general.sidebarFontSize}
          </label>
          <p className="prefs__field-desc">
            {t.settings.general.sidebarFontSizeDesc}
          </p>
        </div>
        <select
          id="prefs-sidebar-font-size"
          className="prefs__select"
          value={String(settings.sidebarFontSize)}
          onChange={(e) =>
            onChange('sidebarFontSize', Number(e.target.value) as FontSize)
          }
        >
          {FONT_SIZE_OPTIONS.map((s) => (
            <option key={s} value={String(s)}>
              {s} {t.settings.general.fontSizeSuffix}
            </option>
          ))}
        </select>
      </div>

      <div className="prefs__field">
        <div className="prefs__field-main">
          <label className="prefs__field-label" htmlFor="prefs-date-format">
            {t.settings.general.dateFormat}
          </label>
          <p className="prefs__field-desc">
            {t.settings.general.dateFormatDesc}
          </p>
        </div>
        <select
          id="prefs-date-format"
          className="prefs__select"
          value={settings.dateFormat}
          onChange={(e) => onChange('dateFormat', e.target.value)}
        >
          {DATE_FORMAT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="prefs__field">
        <div className="prefs__field-main">
          <label className="prefs__field-label">
            {t.settings.general.showInsertButtons}
          </label>
          <p className="prefs__field-desc">
            {t.settings.general.showInsertButtonsDesc}
          </p>
        </div>
        <ToggleSwitch
          checked={settings.showInsertButtons}
          onChange={(v) => onChange('showInsertButtons', v)}
          ariaLabel={t.settings.general.showInsertButtons}
        />
      </div>

      <div className="prefs__field">
        <div className="prefs__field-main">
          <label className="prefs__field-label">
            ノートのクリックで新たなタブで開く
          </label>
          <p className="prefs__field-desc">
            ON: サイドバーでクリックするたびに新しいタブが追加されます。
            <br />
            OFF (既定): 直前にクリックして開いたタブを編集していなければ、
            そのタブを閉じて新しいノートを同じ位置に開きます (プレビュータブ動作)。
            ノートを編集するとそのタブは固定され、自動で閉じなくなります。
          </p>
        </div>
        <ToggleSwitch
          checked={settings.openNoteInNewTab}
          onChange={(v) => onChange('openNoteInNewTab', v)}
          ariaLabel="ノートのクリックで新たなタブで開く"
        />
      </div>

      <div className="prefs__field">
        <div className="prefs__field-main">
          <label className="prefs__field-label">
            {t.settings.general.editorMinimap}
          </label>
          <p className="prefs__field-desc">
            {t.settings.general.editorMinimapDesc}
          </p>
        </div>
        <ToggleSwitch
          checked={settings.editorMinimap}
          onChange={(v) => onChange('editorMinimap', v)}
          ariaLabel={t.settings.general.editorMinimap}
        />
      </div>

      <div className="prefs__field">
        <div className="prefs__field-main">
          <label className="prefs__field-label" htmlFor="prefs-history-mode">
            {t.settings.general.historyMode}
          </label>
          <p className="prefs__field-desc">
            {t.settings.general.historyModeDesc}
          </p>
        </div>
        <select
          id="prefs-history-mode"
          className="prefs__select"
          value={settings.searchHistoryMode}
          onChange={(e) =>
            onChange('searchHistoryMode', e.target.value as SearchHistoryMode)
          }
        >
          <option value="reset">
            {t.settings.general.historyModeOptionReset}
          </option>
          <option value="persist">
            {t.settings.general.historyModeOptionPersist}
          </option>
        </select>
      </div>

      <div className="prefs__field">
        <div className="prefs__field-main">
          <label className="prefs__field-label" htmlFor="prefs-history-limit">
            {t.settings.general.historyLimit}
          </label>
          <p className="prefs__field-desc">
            {t.settings.general.historyLimitDesc}
          </p>
        </div>
        <select
          id="prefs-history-limit"
          className="prefs__select"
          value={String(settings.searchHistoryLimit)}
          onChange={(e) =>
            onChange(
              'searchHistoryLimit',
              Number(e.target.value) as SearchHistoryLimit,
            )
          }
        >
          <option value="100">
            100 {t.settings.general.historyLimitItem}
          </option>
          <option value="1000">
            1000 {t.settings.general.historyLimitItem}
          </option>
        </select>
      </div>

      {/* ----- ノート開封履歴 ----- */}
      <div className="prefs__field">
        <div className="prefs__field-main">
          <label className="prefs__field-label">
            {t.settings.general.openHistory}
          </label>
          <p className="prefs__field-desc">
            {t.settings.general.openHistoryDesc}
          </p>
        </div>
        <ToggleSwitch
          checked={settings.historyEnabled}
          onChange={(v) => onChange('historyEnabled', v)}
          ariaLabel={t.settings.general.openHistoryAria}
        />
      </div>

      <div className="prefs__field">
        <div className="prefs__field-main">
          <label className="prefs__field-label" htmlFor="prefs-open-history-limit">
            {t.settings.general.openHistoryLimit}
          </label>
          <p className="prefs__field-desc">
            {t.settings.general.openHistoryLimitDesc}
          </p>
        </div>
        <select
          id="prefs-open-history-limit"
          className="prefs__select"
          value={String(settings.historyLimit)}
          onChange={(e) =>
            onChange(
              'historyLimit',
              Number(e.target.value) as OpenHistoryLimit,
            )
          }
          disabled={!settings.historyEnabled}
        >
          <option value="100">100 {t.settings.general.historyLimitItem}</option>
          <option value="1000">1000 {t.settings.general.historyLimitItem}</option>
        </select>
      </div>

      {/* ----- サイドバー行内アイテムの表示設定 ----- */}
      <div className="prefs__field">
        <div className="prefs__field-main">
          <label
            className="prefs__field-label"
            htmlFor="prefs-note-kebab-visibility"
          >
            ノートのケバブボタン
          </label>
          <p className="prefs__field-desc">
            ノート行の右端に表示するケバブ (3 点) ボタンの表示方式。
            非表示でも右クリックでメニューを開けます。
          </p>
        </div>
        <select
          id="prefs-note-kebab-visibility"
          className="prefs__select"
          value={settings.noteKebabVisibility}
          onChange={(e) =>
            onChange(
              'noteKebabVisibility',
              e.target.value as SidebarItemVisibility,
            )
          }
        >
          {SIDEBAR_ITEM_VISIBILITY_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {sidebarVisibilityLabel(v)}
            </option>
          ))}
        </select>
      </div>

      <div className="prefs__field">
        <div className="prefs__field-main">
          <label
            className="prefs__field-label"
            htmlFor="prefs-folder-kebab-visibility"
          >
            フォルダのケバブボタン
          </label>
          <p className="prefs__field-desc">
            フォルダ行の右端に表示するケバブ (3 点) ボタンの表示方式。
            非表示でも右クリックでメニューを開けます。
          </p>
        </div>
        <select
          id="prefs-folder-kebab-visibility"
          className="prefs__select"
          value={settings.folderKebabVisibility}
          onChange={(e) =>
            onChange(
              'folderKebabVisibility',
              e.target.value as SidebarItemVisibility,
            )
          }
        >
          {SIDEBAR_ITEM_VISIBILITY_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {sidebarVisibilityLabel(v)}
            </option>
          ))}
        </select>
      </div>

      <div className="prefs__field">
        <div className="prefs__field-main">
          <label
            className="prefs__field-label"
            htmlFor="prefs-folder-count-visibility"
          >
            フォルダのノート数バッジ
          </label>
          <p className="prefs__field-desc">
            フォルダ行の右端に表示する「中に含まれるノート数」バッジの
            表示方式。ケバブボタンと両方表示する場合はバッジを左、
            ケバブを右に配置します。
          </p>
        </div>
        <select
          id="prefs-folder-count-visibility"
          className="prefs__select"
          value={settings.folderCountVisibility}
          onChange={(e) =>
            onChange(
              'folderCountVisibility',
              e.target.value as SidebarItemVisibility,
            )
          }
        >
          {SIDEBAR_ITEM_VISIBILITY_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {sidebarVisibilityLabel(v)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** SidebarItemVisibility を日本語ラベルに変換 */
function sidebarVisibilityLabel(v: SidebarItemVisibility): string {
  switch (v) {
    case 'always':
      return '常に表示';
    case 'hover':
      return 'マウスを乗せたとき';
    case 'hidden':
      return '表示しない (右クリックで対応)';
  }
}

// ----- コードブロックパネル -----

function CodeBlockPanel({ settings, onChange }: PanelProps) {
  const t = useT();
  const enabledSet = useMemo(
    () => new Set(settings.enabledHighlightLangs),
    [settings.enabledHighlightLangs],
  );

  const [filter, setFilter] = useState('');
  const filteredLangs = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return SUPPORTED_HIGHLIGHT_LANGS;
    return SUPPORTED_HIGHLIGHT_LANGS.filter(
      (l) =>
        l.id.toLowerCase().includes(q) || l.label.toLowerCase().includes(q),
    );
  }, [filter]);

  const toggleLang = (id: string) => {
    const next = enabledSet.has(id)
      ? settings.enabledHighlightLangs.filter((x) => x !== id)
      : [...settings.enabledHighlightLangs, id];
    onChange('enabledHighlightLangs', next);
  };

  const enableAll = () => {
    onChange(
      'enabledHighlightLangs',
      SUPPORTED_HIGHLIGHT_LANGS.map((l) => l.id),
    );
  };

  const disableAll = () => {
    onChange('enabledHighlightLangs', []);
  };

  return (
    <div className="prefs__section">
      <h3 className="prefs__section-title">
        {t.settings.categories.codeBlock}
      </h3>

      {/* ----- 表示オプション ----- */}
      <div className="code-panel__subhead code-panel__subhead--first">
        <h4 className="code-panel__subhead-title">
          {t.settings.codeBlock.displayOptions}
        </h4>
      </div>

      <div className="code-panel__group">
        <div className="code-panel__row">
          <span className="code-panel__row-icon">
            <CopyOutlineIcon />
          </span>
          <div className="code-panel__row-body">
            <span className="code-panel__row-title">
              {t.settings.codeBlock.copyAlwaysVisible}
            </span>
            <p className="code-panel__row-desc">
              {t.settings.codeBlock.copyAlwaysVisibleDesc}
            </p>
          </div>
          <div className="code-panel__row-action">
            <ToggleSwitch
              checked={settings.codeCopyAlwaysVisible}
              onChange={(v) => onChange('codeCopyAlwaysVisible', v)}
              ariaLabel={t.settings.codeBlock.copyAlwaysVisible}
            />
          </div>
        </div>

        <div className="code-panel__row">
          <span className="code-panel__row-icon">
            <HashIcon />
          </span>
          <div className="code-panel__row-body">
            <span className="code-panel__row-title">
              {t.settings.codeBlock.showLineNumbers}
            </span>
            <p className="code-panel__row-desc">
              {t.settings.codeBlock.showLineNumbersDesc}
            </p>
          </div>
          <div className="code-panel__row-action">
            <ToggleSwitch
              checked={settings.codeShowLineNumbers}
              onChange={(v) => onChange('codeShowLineNumbers', v)}
              ariaLabel={t.settings.codeBlock.showLineNumbers}
            />
          </div>
        </div>
      </div>

      {/* ----- シンタックスハイライト ----- */}
      <div className="code-panel__subhead">
        <h4 className="code-panel__subhead-title">
          {t.settings.codeBlock.syntaxHighlight}
          <span className="code-panel__count">
            {enabledSet.size}/{SUPPORTED_HIGHLIGHT_LANGS.length}
          </span>
        </h4>
        <div className="code-panel__subhead-actions">
          <button
            type="button"
            className="code-panel__btn"
            onClick={enableAll}
          >
            {t.settings.codeBlock.enableAll}
          </button>
          <button
            type="button"
            className="code-panel__btn"
            onClick={disableAll}
          >
            {t.settings.codeBlock.disableAll}
          </button>
        </div>
      </div>

      <div className="code-panel__search-wrap">
        <span className="code-panel__search-icon">
          <SearchIcon />
        </span>
        <input
          type="search"
          className="code-panel__search-input"
          placeholder={t.settings.codeBlock.langSearchPlaceholder}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {filteredLangs.length === 0 ? (
        <div className="code-panel__lang-empty">
          {t.settings.codeBlock.langSearchEmpty}
        </div>
      ) : (
        <div className="code-panel__lang-grid" role="group">
          {filteredLangs.map((lang) => {
            const on = enabledSet.has(lang.id);
            return (
              <button
                type="button"
                key={lang.id}
                className={`code-panel__lang-chip ${on ? 'is-on' : ''}`}
                onClick={() => toggleLang(lang.id)}
                aria-pressed={on}
              >
                <span className="code-panel__lang-check">
                  <CheckIcon />
                </span>
                {lang.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ----- コードブロックパネル用アイコン -----

function CopyOutlineIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function HashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 9h16" />
      <path d="M4 15h16" />
      <path d="M10 3L8 21" />
      <path d="M16 3l-2 18" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8.5l3.5 3.5L13 4.5" />
    </svg>
  );
}

// ----- セキュリティパネル（旧パスワード + 新パスワード） -----

function ProtectionPanel({ settings, onChange }: PanelProps) {
  const t = useT();
  const [oldDraft, setOldDraft] = useState<string>('');
  const [newDraft, setNewDraft] = useState<string>('');
  const [message, setMessage] = useState<{ type: 'error' | 'ok'; text: string } | null>(
    null,
  );

  const handleSave = () => {
    if (oldDraft !== settings.protectionPassword) {
      setMessage({ type: 'error', text: t.settings.protection.errorWrongCurrent });
      return;
    }
    if (!isValidProtectionPassword(newDraft)) {
      setMessage({ type: 'error', text: t.settings.protection.errorInvalidFormat });
      return;
    }
    if (newDraft === settings.protectionPassword) {
      setMessage({ type: 'error', text: t.settings.protection.errorSameAsCurrent });
      return;
    }
    onChange('protectionPassword', newDraft);
    setOldDraft('');
    setNewDraft('');
    setMessage({ type: 'ok', text: t.settings.protection.okUpdated });
  };

  // 現在の保存済みパスワードが既定値のままなら初期パスワードの案内を表示
  const isDefaultPassword =
    settings.protectionPassword === DEFAULT_SETTINGS.protectionPassword;

  const canSave =
    oldDraft.length === 4 &&
    newDraft.length === 4 &&
    oldDraft !== newDraft;

  return (
    <div className="prefs__section">
      <h3 className="prefs__section-title">
        {t.settings.categories.protection}
      </h3>

      {/* ----- ステータスバナー ----- */}
      {isDefaultPassword ? (
        <div className="security-panel__banner security-panel__banner--warn">
          <span className="security-panel__banner-icon">
            <ShieldWarnIcon />
          </span>
          <div className="security-panel__banner-body">
            <span className="security-panel__banner-title">
              {t.settings.protection.defaultBannerTitle}
            </span>
            <p className="security-panel__banner-desc">
              {t.settings.protection.defaultBannerDesc.replace(
                '{{password}}',
                '1234',
              )}
            </p>
          </div>
        </div>
      ) : (
        <div className="security-panel__banner security-panel__banner--ok">
          <span className="security-panel__banner-icon">
            <ShieldCheckIcon />
          </span>
          <div className="security-panel__banner-body">
            <span className="security-panel__banner-title">
              {t.settings.protection.okBannerTitle}
            </span>
            <p className="security-panel__banner-desc">
              {t.settings.protection.okBannerDesc}
            </p>
          </div>
        </div>
      )}

      {/* ----- パスワード変更 ----- */}
      <div className="security-panel__subhead">
        <h4 className="security-panel__subhead-title">
          {t.settings.protection.changePassword}
        </h4>
      </div>

      <div className="security-panel__group">
        <div className="security-panel__row">
          <span className="security-panel__row-icon">
            <LockIcon />
          </span>
          <div className="security-panel__row-body">
            <span className="security-panel__row-title">
              {t.settings.protection.currentPassword}
            </span>
            <p className="security-panel__row-hint">
              {t.settings.protection.currentPasswordHint}
            </p>
          </div>
          <div className="security-panel__row-input">
            <PinInput
              id="protection-old-password"
              value={oldDraft}
              onChange={(v) => {
                setOldDraft(v);
                setMessage(null);
              }}
              onEnter={handleSave}
              ariaLabel={t.settings.protection.currentPassword}
            />
          </div>
        </div>

        <div className="security-panel__row">
          <span className="security-panel__row-icon">
            <KeyIcon />
          </span>
          <div className="security-panel__row-body">
            <span className="security-panel__row-title">
              {t.settings.protection.newPassword}
            </span>
            <p className="security-panel__row-hint">
              {t.settings.protection.newPasswordHint}
            </p>
          </div>
          <div className="security-panel__row-input">
            <PinInput
              id="protection-new-password"
              value={newDraft}
              onChange={(v) => {
                setNewDraft(v);
                setMessage(null);
              }}
              onEnter={handleSave}
              ariaLabel={t.settings.protection.newPassword}
            />
          </div>
        </div>
      </div>

      <div className="security-panel__actions">
        <button
          type="button"
          className="security-panel__btn"
          onClick={handleSave}
          disabled={!canSave}
        >
          <CheckIcon />
          {t.settings.protection.update}
        </button>
      </div>

      {message && (
        <div
          className={`security-panel__notice ${
            message.type === 'error'
              ? 'security-panel__notice--err'
              : 'security-panel__notice--ok'
          }`}
        >
          {message.type === 'error' ? <AlertIcon /> : <CheckIcon />}
          {message.text}
        </div>
      )}
    </div>
  );
}

// ----- セキュリティパネル用アイコン -----

function ShieldWarnIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
      <path d="M12 9v4" />
      <path d="M12 16v.01" />
    </svg>
  );
}

function ShieldCheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4" />
      <path d="M12 16v.01" />
    </svg>
  );
}

// ----- テンプレートパネル -----

function TemplatePanel({ settings, onChange }: PanelProps) {
  const t = useT();
  const [draft, setDraft] = useState(settings.templateFolder);
  const [saved, setSaved] = useState(false);

  // 設定が外部で変わった場合に追従
  useEffect(() => {
    setDraft(settings.templateFolder);
  }, [settings.templateFolder]);

  const sanitized = draft.trim().replace(/^\/+|\/+$/g, '') || 'template';
  const isDirty = sanitized !== settings.templateFolder;

  const handleSave = () => {
    onChange('templateFolder', sanitized);
    setDraft(sanitized);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="prefs__section">
      <h3 className="prefs__section-title">
        {t.settings.categories.template}
      </h3>

      <div className="template-panel__subhead template-panel__subhead--first">
        <h4 className="template-panel__subhead-title">
          {t.settings.template.folder}
        </h4>
      </div>

      <div className="template-panel__card">
        <span className="template-panel__icon">
          <TemplateIcon />
        </span>
        <div className="template-panel__body">
          <span className="template-panel__label">
            {t.settings.template.label}
          </span>
          <p className="template-panel__desc">
            {t.settings.template.desc.replace('{{path}}', sanitized)}
          </p>
          <div className="template-panel__input-row">
            <div className="template-panel__input-prefix">
              <input
                id="prefs-template-folder"
                className="template-panel__input"
                type="text"
                value={draft}
                placeholder="template"
                onChange={(e) => {
                  setDraft(e.target.value);
                  setSaved(false);
                }}
              />
              <span className="template-panel__slash">/</span>
            </div>
            <button
              type="button"
              className="template-panel__save-btn"
              onClick={handleSave}
              disabled={!isDirty && !saved}
            >
              <CheckIcon />
              {t.common.save}
            </button>
            {saved && (
              <span className="template-panel__saved-flash">
                <CheckIcon />
                {t.settings.template.savedFlash}
              </span>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

// ----- テンプレートパネル用アイコン -----

function TemplateIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 21V9" />
    </svg>
  );
}

// ----- 保存先パネル -----
// ノート (.md) / 画像 / 添付ファイルが書き出されるルートフォルダを設定する。
// 既定は OS の userData フォルダ。ユーザーが任意のフォルダを指定すると、
// 以後の I/O はその直下の notes/, images/, attachments/ に対して行われる。
// 既存のファイルは自動移動しないため、必要なら手動コピーで移行する。

function StoragePanel({ settings, onChange }: PanelProps) {
  const t = useT();
  const [resolvedRoot, setResolvedRoot] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    type: 'error' | 'ok';
    text: string;
  } | null>(null);
  // 保存先変更が完了して再起動を促す段階に入ったか。
  // true のときオーバーレイモーダルが表示され、OK を押すまで他操作不可。
  const [restartPrompt, setRestartPrompt] = useState<string | null>(null);
  // フォルダピッカで選んだ後、「DB も初期化するか」を選ぶモーダルの状態。
  // null のときは非表示。null 以外のときはそのパスで選択待ち。
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);

  const refreshRoot = async () => {
    try {
      const root = await window.api.storage.getRoot();
      setResolvedRoot(root);
    } catch {
      setResolvedRoot('');
    }
  };

  useEffect(() => {
    void refreshRoot();
  }, [settings.storagePath]);

  /**
   * 「保存先の変更」ボタン。フォルダ選択ダイアログを開き、選ばれたら
   * 「DB も初期化するか / DB は保持するか」を選ぶモーダルへ進む。
   */
  const handleChangeFolder = async () => {
    setMessage(null);
    setBusy(true);
    try {
      const picked = await window.api.storage.chooseFolder();
      if (!picked) return;
      // 保留中の保存はフラッシュしておく (どちらの選択肢でも安全側)
      await new Promise<void>((resolve) => {
        window.dispatchEvent(
          new CustomEvent('inknel:flush-pending-saves', {
            detail: { resolve },
          }),
        );
      });
      setPendingTarget(picked);
    } catch (err) {
      setMessage({
        type: 'error',
        text:
          '保存先の変更に失敗しました: ' +
          (err instanceof Error ? err.message : String(err)),
      });
    } finally {
      setBusy(false);
    }
  };

  /**
   * pendingTarget に対し「DB は保持して保存先のみ変更」を実行。
   * 既存内容を新フォルダにコピー + 設定切替 → 再起動プロンプト。
   */
  const handleKeepDbAndMigrate = async () => {
    if (!pendingTarget) return;
    const target = pendingTarget;
    setPendingTarget(null);
    setBusy(true);
    setMessage(null);
    try {
      const res = await window.api.storage.migrateTo(target);
      onChange('storagePath', res.newRoot);
      setRestartPrompt(
        `保存先を変更しました (DB は保持)。\n\n新しい保存先:\n${res.newRoot}\n\n反映には再起動が必要です。OK を押すとアプリを再起動します。`,
      );
    } catch (err) {
      setMessage({
        type: 'error',
        text:
          '保存先の変更に失敗しました: ' +
          (err instanceof Error ? err.message : String(err)),
      });
    } finally {
      setBusy(false);
    }
  };

  /**
   * pendingTarget に対し「DB も初期化して保存先を変更」を実行。
   * DB の notes / folders を空にした上で設定を切替 → 再起動プロンプト。
   */
  const handleResetDbAndMigrate = async () => {
    if (!pendingTarget) return;
    const target = pendingTarget;
    // 二段階確認 (取り消し不可なので明示的な OK を求める)
    if (
      !window.confirm(
        '本当に DB を初期化しますか?\n\n現在のノート・フォルダはすべて削除され、取り消しできません。\n(保存先フォルダの .md ファイルは残ります)',
      )
    ) {
      return;
    }
    setPendingTarget(null);
    setBusy(true);
    setMessage(null);
    try {
      const res = await window.api.storage.resetAndSet(target);
      onChange('storagePath', res.newRoot);
      setRestartPrompt(
        `DB を初期化し、保存先を変更しました。\n\n新しい保存先:\n${res.newRoot}\n\n反映には再起動が必要です。OK を押すとアプリを再起動します。`,
      );
    } catch (err) {
      setMessage({
        type: 'error',
        text:
          '保存先の変更に失敗しました: ' +
          (err instanceof Error ? err.message : String(err)),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="prefs__section storage-panel">
      <h3 className="prefs__section-title">
        {t.settings.categories.storage}
      </h3>

      {/* ----- ヒーロー: 現在の保存先 + 変更ボタン ----- */}
      <div className="storage-hero">
        <div className="storage-hero__glow" aria-hidden="true" />
        <div className="storage-hero__body">
          <div className="storage-hero__label">
            <StorageHeroIcon />
            <span>現在の保存先</span>
          </div>
          <div
            className={`storage-hero__path ${
              !resolvedRoot ? 'is-loading' : ''
            }`}
          >
            {resolvedRoot || '取得中...'}
          </div>
        </div>
        <button
          type="button"
          className="storage-hero__cta"
          onClick={() => void handleChangeFolder()}
          disabled={busy}
        >
          <FolderOpenIcon />
          フォルダを変更
        </button>
      </div>

      {/* ----- 仕組みの説明: 2 カード横並びで DB / .md を視覚化 ----- */}
      <div className="storage-explain">
        <h4 className="storage-explain__title">
          <SparkleIcon />
          ノートはどう保存される?
        </h4>
        <div className="storage-explain__pair">
          <div className="storage-explain__card storage-explain__card--db">
            <div className="storage-explain__card-icon">
              <DatabaseIcon />
            </div>
            <div className="storage-explain__card-title">データベース</div>
            <div className="storage-explain__card-desc">
              アプリ内で<strong>編集・検索・表示</strong>
              に使う場所。<br />
              高速動作のために使われる「真の保管庫」。
            </div>
          </div>
          <div className="storage-explain__arrow" aria-hidden="true">
            <SyncArrowIcon />
            <span>自動同期</span>
          </div>
          <div className="storage-explain__card storage-explain__card--md">
            <div className="storage-explain__card-icon">
              <MarkdownIcon />
            </div>
            <div className="storage-explain__card-title">
              Markdown (.md) ファイル
            </div>
            <div className="storage-explain__card-desc">
              同じ内容を<strong>このフォルダに自動コピー</strong>。
              <br />
              他アプリで開いたり共有するための「共有用コピー」。
            </div>
          </div>
        </div>
        <p className="storage-explain__caption">
          <strong>「保存先」</strong>は右側の
          <strong>.md ファイルを書き出すフォルダ</strong>です。
        </p>
      </div>

      {/* ----- クラウド共有のヒント (アクセント色のチップ) ----- */}
      <div className="storage-tip">
        <span className="storage-tip__chip">
          <CloudIcon />
          クラウド共有
        </span>
        <p className="storage-tip__body">
          保存先を <strong>iCloud Drive</strong> /{' '}
          <strong>Dropbox</strong> / <strong>Google Drive</strong>{' '}
          のフォルダに指定すると、複数 PC で同じノートを共有できます。
          1 台で完結するなら、<strong>既定のまま</strong>でも問題ありません。
        </p>
      </div>

      {message && (
        <div
          className={`storage-panel__notice storage-panel__notice--${
            message.type === 'error' ? 'err' : 'ok'
          }`}
        >
          {message.type === 'error' ? <AlertIcon /> : <CheckIcon />}
          <span>{message.text}</span>
        </div>
      )}

      {pendingTarget !== null && (
        <div
          className="storage-panel__restart-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="storage-choice-title"
        >
          <div className="storage-panel__restart-modal">
            <h4
              id="storage-choice-title"
              className="storage-panel__restart-title"
            >
              DB の扱いを選択してください
            </h4>
            <p className="storage-panel__restart-message">
              新しい保存先:
              {'\n'}
              {pendingTarget}
              {'\n\n'}
              DB (現在のノート・フォルダ) をどう扱いますか?
            </p>
            <div className="storage-panel__choice-actions">
              <button
                type="button"
                className="storage-panel__btn"
                autoFocus
                onClick={() => void handleKeepDbAndMigrate()}
                disabled={busy}
              >
                DB は初期化せずに保存先のみ変更
              </button>
              <button
                type="button"
                className="storage-panel__btn storage-panel__btn--danger"
                onClick={() => void handleResetDbAndMigrate()}
                disabled={busy}
              >
                DB も初期化してすべてクリア
              </button>
              <button
                type="button"
                className="storage-panel__btn storage-panel__btn--ghost"
                onClick={() => setPendingTarget(null)}
                disabled={busy}
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {restartPrompt !== null && (
        <div
          className="storage-panel__restart-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="storage-restart-title"
        >
          <div className="storage-panel__restart-modal">
            <h4
              id="storage-restart-title"
              className="storage-panel__restart-title"
            >
              再起動が必要です
            </h4>
            <p className="storage-panel__restart-message">
              {restartPrompt}
            </p>
            <div className="storage-panel__restart-actions">
              <button
                type="button"
                className="storage-panel__btn"
                autoFocus
                onClick={() => {
                  setRestartPrompt(null);
                  void window.api.app.relaunch();
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// カレンダー設定パネル
// ============================================================
// 旧 calendar プラグインの SettingsComponent (フォルダ名 / 日付書式) を
// 本体設定 (settings.calendarPlugin) として常設化したもの。
function CalendarPanel({ settings, onChange }: PanelProps) {
  const cfg: CalendarPluginSettings = settings.calendarPlugin ?? {
    folder: 'カレンダー',
    titleFormat: 'YYYY-MM-DD',
  };

  const updateFolder = (folder: string) => {
    onChange('calendarPlugin', { ...cfg, folder });
  };
  const updateTitleFormat = (titleFormat: string) => {
    onChange('calendarPlugin', { ...cfg, titleFormat });
  };

  const t = useT();

  return (
    <div className="prefs__section">
      <h3 className="prefs__section-title">{t.settings.categories.calendar}</h3>

      {/* ----- カレンダー機能の有効化 ----- */}
      <div className="prefs__field">
        <div className="prefs__field-main">
          <label className="prefs__field-label">カレンダーを利用する</label>
          <p className="prefs__field-desc">
            OFF にするとアクティビティバーからカレンダーボタンを非表示にします。
          </p>
        </div>
        <ToggleSwitch
          checked={settings.calendarEnabled}
          onChange={(v) => onChange('calendarEnabled', v)}
          ariaLabel="カレンダーを利用する"
        />
      </div>

      <div className="prefs__field">
        <div className="prefs__field-main">
          <label className="prefs__field-label" htmlFor="prefs-calendar-folder">
            ノートフォルダ名
          </label>
          <p className="prefs__field-desc">
            カレンダーから作成したノートを保存するフォルダ名。既定:
            「カレンダー」。
          </p>
        </div>
        <input
          id="prefs-calendar-folder"
          type="text"
          className="prefs__input"
          value={cfg.folder}
          onChange={(e) => updateFolder(e.target.value)}
          placeholder="カレンダー"
          disabled={!settings.calendarEnabled}
        />
      </div>

      <div className="prefs__field">
        <div className="prefs__field-main">
          <label className="prefs__field-label" htmlFor="prefs-calendar-title">
            ノートタイトル書式
          </label>
          <p className="prefs__field-desc">
            日付からノートタイトルを生成する書式。`/` を含めるとサブフォルダになります。
          </p>
        </div>
        <select
          id="prefs-calendar-title"
          className="prefs__select"
          value={cfg.titleFormat}
          onChange={(e) => updateTitleFormat(e.target.value)}
          disabled={!settings.calendarEnabled}
        >
          {CALENDAR_TITLE_FORMAT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ----- 保存先パネル用アイコン -----

function FolderIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

function FolderOpenIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3V8z" />
      <path d="M3 11l1.7 7.5a2 2 0 0 0 2 1.5h11.6a2 2 0 0 0 2-1.5L22 11H3z" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M12 4v12" />
    </svg>
  );
}


// ----- プラグインパネル -----
// `src/plugins/<id>.ts` として配置されたプラグインを registry から自動検出し、
// 検出されたものだけ ON/OFF トグルを表示する。
// - プラグインが 1 つも無ければ「未インストール」案内を表示
// - 無効化された ID は settings.enabledPlugins から外れる
// - registry に存在しない ID が settings に残っていても無視される
/**
 * 公式プラグインカタログ URL（変更不可・常時取得）。
 * ユーザーが settings.pluginCatalogUrls に追加した URL も合わせて取得する。
 */
const PLUGIN_CATALOG_URL = 'https://inknel.ary-ap.com/plugins/plugins.json';

interface RemotePluginRow {
  id: string;
  /** baseUrl からの相対 manifest ファイル名 (mermaid.json 等) */
  filename: string;
  /** 取得済み manifest の中身。失敗時 null */
  manifest: {
    name?: string;
    description?: string;
    version?: string;
    [key: string]: unknown;
  } | null;
  /** このプラグインの取得元 catalog の baseUrl（インストール時にこの URL から DL する） */
  sourceBaseUrl: string;
}

type StoreState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; rows: RemotePluginRow[] }
  | { kind: 'not_found' };

interface DisplayPlugin {
  id: string;
  label: string;
  description: string;
  /** 'bundled' = src/plugins から検出 / 'downloaded' = userData/plugins/ の manifest のみ */
  source: 'bundled' | 'downloaded';
  /**
   * 'imported' = runtime registry に登録済み（bundled は常に true）。
   * 'pending'  = DL 済だが未インポート。トグルではなく「インポート」ボタンを表示。
   */
  state: 'imported' | 'pending';
}

function PluginsPanel({ settings, onChange }: PanelProps) {
  const bundled = useMemo(() => listPlugins(), []);
  // ランタイムロード済みプラグインの変更を購読し、再レンダリングを発火させる。
  // これにより DL 版プラグインの SettingsComponent がロード完了後にも反映される。
  const [runtimePluginsTick, setRuntimePluginsTick] = useState(0);
  useEffect(() => {
    return subscribeRuntimePlugins(() =>
      setRuntimePluginsTick((n) => n + 1),
    );
  }, []);
  const enabledSet = useMemo(
    () => new Set(settings.enabledPlugins),
    [settings.enabledPlugins],
  );

  /**
   * 「ソース materialize 対応」プラグインの一覧。
   * 有効化時に plugin-dev/plugins/<sourceDir>/ から src/plugins/<id>/ へ
   * TS ソースをコピーし、無効化（削除）時に src/plugins/<id>/ を削除する。
   * dev モード限定。
   *
   * 注: カレンダーはランタイムロードのみで動作させる方針のため、
   * このリストには含めない（src/plugins/calendar/ を作らない）。
   */
  const MATERIALIZABLE_PLUGINS: Record<string, { sourceDir: string }> = {};

  const toggle = async (id: string, next: boolean) => {
    // 有効化する瞬間に src/plugins/<id>/ のソースが無ければ
    // plugin-dev/plugins/<sourceDir>/ から materialize しておく。
    // production パッケージでは skipped: true が返って no-op になる。
    if (next && MATERIALIZABLE_PLUGINS[id]) {
      try {
        const result = await window.api.plugins.materializeSource({
          id,
          sourceDir: MATERIALIZABLE_PLUGINS[id].sourceDir,
        });
        if (result.skipped) {
          // production: 既にバンドルされているのでそのまま続行
        } else if (!result.ok) {
          setInstallNotice(
            `プラグイン ${id} のソース展開に失敗: ${result.error ?? '不明なエラー'}`,
          );
        } else if (result.copied && result.copied.length > 0) {
          setInstallNotice(
            `${id} のソースを展開しました (${result.copied.join(', ')})`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setInstallNotice(`プラグイン ${id} のソース展開に失敗: ${msg}`);
      }
    }

    // ON にした瞬間、ダウンロード版プラグインがまだ runtime registry に
    // 登録されていなければ自動的に importPluginById を呼び、再起動なしで
    // アクティビティバーやサイドバーへ反映できるようにする。
    // (bundled プラグインは常に REGISTRY にあるので何もしない)
    if (next) {
      const isBundled = bundled.some((p) => p.id === id);
      const isRuntimeLoaded = getRuntimePlugins().some((p) => p.id === id);
      if (!isBundled && !isRuntimeLoaded) {
        try {
          const result = await importPluginById(id);
          if (!result.ok) {
            setInstallNotice(
              `インポートに失敗しました: ${result.error ?? '不明なエラー'}`,
            );
            // 失敗した場合は enabledPlugins には追加しない（実体が無い）
            return;
          }
          // 永続化（次回起動時にも自動でロードされる）
          if (!settings.importedPlugins.includes(id)) {
            onChange('importedPlugins', [...settings.importedPlugins, id]);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setInstallNotice(`インポートに失敗しました: ${msg}`);
          return;
        }
      }
    }

    const set = new Set(settings.enabledPlugins);
    if (next) set.add(id);
    else set.delete(id);
    onChange('enabledPlugins', Array.from(set));
  };

  // ----- プラグインストア -----
  const [storeState, setStoreState] = useState<StoreState>({ kind: 'idle' });
  // プラグインストアを開いているか (既定は閉じ、ボタンで開閉)。
  // 閉じている間はリモートカタログをフェッチしない (帯域節約 + 静かな初期表示)。
  const [storeOpen, setStoreOpen] = useState(false);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [downloadedManifests, setDownloadedManifests] = useState<
    Array<{ filename: string; content: unknown }>
  >([]);
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [installNotice, setInstallNotice] = useState<string | null>(null);

  // ----- プラグインカタログ URL の追加 -----
  // ユーザーが入力中の新規 URL（追加ボタン押下で settings.pluginCatalogUrls へ反映）
  const [newCatalogUrl, setNewCatalogUrl] = useState('');
  const [catalogUrlError, setCatalogUrlError] = useState<string | null>(null);

  /** 入力欄の URL を pluginCatalogUrls 配列に追加する */
  const handleAddCatalogUrl = () => {
    const u = newCatalogUrl.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) {
      setCatalogUrlError('http(s):// で始まる URL を入力してください');
      return;
    }
    if (u === PLUGIN_CATALOG_URL) {
      setCatalogUrlError('既定の公式カタログと同じ URL は追加できません');
      return;
    }
    if (settings.pluginCatalogUrls.includes(u)) {
      setCatalogUrlError('既に追加済みの URL です');
      return;
    }
    onChange('pluginCatalogUrls', [...settings.pluginCatalogUrls, u]);
    setNewCatalogUrl('');
    setCatalogUrlError(null);
  };

  /** 追加 URL を 1 件削除 */
  const handleRemoveCatalogUrl = (url: string) => {
    onChange(
      'pluginCatalogUrls',
      settings.pluginCatalogUrls.filter((x) => x !== url),
    );
  };

  /**
   * ローカル plugins ディレクトリを再走査し、以下を更新:
   *   - installed: 全ファイル名（DL ボタン状態 / 「N/M ファイル取得済み」表示用）
   *   - downloadedManifests: パース済 manifest（プラグイン一覧トグル表示用）
   */
  const refreshInstalled = async () => {
    try {
      const [files, manifests] = await Promise.all([
        window.api.plugins.listLocalFiles(),
        window.api.plugins.listLocal(),
      ]);
      setInstalled(new Set(files));
      setDownloadedManifests(manifests);
    } catch {
      /* ディレクトリ未作成時など */
    }
  };

  // パネルを開いた時はローカルの DL 済みファイル状態だけを更新する。
  // (旧仕様では自動でリモートカタログ取得まで行っていたが、ストアは
  //  ユーザーが明示的に「プラグインストアを開く」を押した時のみ取得する。)
  useEffect(() => {
    void refreshInstalled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ストアを開く / 閉じる。初回オープン時にカタログを取得する。
  const handleToggleStore = () => {
    setStoreOpen((open) => {
      const next = !open;
      if (next && storeState.kind === 'idle') {
        void handleFetchStore();
      }
      return next;
    });
  };

  // モーダル表示中の Esc キーで閉じる
  useEffect(() => {
    if (!storeOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStoreOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [storeOpen]);

  // id → DL 済 manifest のファイル名（削除ボタン表示判定用）
  const downloadedById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of downloadedManifests) {
      const c = m.content as Record<string, unknown> | null;
      if (c && typeof c.id === 'string') {
        map.set(c.id, m.filename);
      }
    }
    return map;
  }, [downloadedManifests]);

  const handleImport = async (id: string) => {
    setInstallNotice(null);
    const result = await importPluginById(id);
    if (!result.ok) {
      setInstallNotice(`インポートに失敗しました: ${result.error}`);
      return;
    }
    // 永続化（次回起動時にも自動でロードされる）
    if (!settings.importedPlugins.includes(id)) {
      onChange('importedPlugins', [...settings.importedPlugins, id]);
    }
    setInstallNotice(`${id} をインポートしました`);
  };

  const handleUninstall = async (id: string) => {
    const filename = downloadedById.get(id);
    if (!filename) return;
    const ok = window.confirm(
      `プラグイン "${id}" を削除しますか？\n` +
        '（ダウンロードファイル削除 + 一覧から除外 + 有効化解除）',
    );
    if (!ok) return;
    setInstallNotice(null);

    // 1) settings: enabledPlugins から外し、removedPlugins に追加
    const enabledNext = settings.enabledPlugins.filter((x) => x !== id);
    if (enabledNext.length !== settings.enabledPlugins.length) {
      onChange('enabledPlugins', enabledNext);
    }
    if (!settings.removedPlugins.includes(id)) {
      onChange('removedPlugins', [...settings.removedPlugins, id]);
    }

    // 2) ランタイム登録を解除
    unloadPluginById(id);
    // 3) importedPlugins から外す
    if (settings.importedPlugins.includes(id)) {
      onChange(
        'importedPlugins',
        settings.importedPlugins.filter((x) => x !== id),
      );
    }
    // 4) ローカルファイルを削除
    try {
      const res = await window.api.plugins.uninstall(filename);
      await refreshInstalled();
      if (res.failed.length > 0) {
        setInstallNotice(
          `削除: ${res.removed.join(', ')} / 失敗: ${res.failed.join(', ')}`,
        );
      } else {
        setInstallNotice(
          `${id} を削除しました${
            res.removed.length > 0 ? ` (${res.removed.join(', ')})` : ''
          }`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setInstallNotice(`削除に失敗しました: ${msg}`);
    }
    // バンドル版プラグインで `src/plugins/<id>/` のソース展開を行っているものは
    // ここで dematerialize して空ディレクトリを残さないようにする。
    // production パッケージでは skipped: true で no-op になる。
    if (MATERIALIZABLE_PLUGINS[id]) {
      try {
        const res = await window.api.plugins.dematerializeSource({ id });
        if (!res.skipped && res.ok) {
          setInstallNotice((prev) =>
            (prev ?? '') + `（${id} のソース src/plugins/${id}/ も削除しました）`,
          );
        }
      } catch {
        // dematerialize 失敗は致命的ではない（手動で削除可能）
      }
    }
  };

  // バンドル + DL 済 manifest を id 重複排除して合算
  // （bundled が優先：実行可能コードがあるため）
  // settings.removedPlugins に含まれる ID はユーザーが明示的に削除した
  // ものとして一覧から除外する。
  /** バンドル版プラグインを id でルックアップするマップ（SettingsComponent 取得用） */
  const bundledById = useMemo(() => {
    const m = new Map<string, (typeof bundled)[number]>();
    for (const p of bundled) m.set(p.id, p);
    return m;
  }, [bundled]);

  /**
   * ランタイムロード済み (DL 版) プラグインを id でルックアップするマップ。
   * SettingsComponent はバンドル版だけでなく DL 版でも export 可能なので、
   * 両方を見て module を取得できるようにする。
   *
   * useMemo は使わず毎レンダリングで再構築する。コストは小さく (数件程度)、
   * モーダル再オープン時に「実際は loaded なのに lookup が空」のような
   * タイミング不整合を確実に避けられる。再描画のトリガーは
   * runtimePluginsTick が担当。
   */
  // runtimePluginsTick を参照することで「runtime が変更されたら必ず再描画」を保証
  void runtimePluginsTick;
  const runtimeById = new Map<
    string,
    ReturnType<typeof getRuntimePlugins>[number]
  >();
  for (const p of getRuntimePlugins()) runtimeById.set(p.id, p);

  const allPlugins = useMemo<DisplayPlugin[]>(() => {
    const removedSet = new Set(settings.removedPlugins);
    const importedSet = new Set(settings.importedPlugins);
    const map = new Map<string, DisplayPlugin>();
    for (const p of bundled) {
      if (removedSet.has(p.id)) continue;
      map.set(p.id, {
        id: p.id,
        label: p.manifest.label,
        description: p.manifest.description,
        source: 'bundled',
        state: 'imported',
      });
    }
    for (const m of downloadedManifests) {
      const c = m.content as Record<string, unknown> | null;
      if (!c || typeof c !== 'object') continue;
      const id = typeof c.id === 'string' ? c.id : null;
      if (!id || removedSet.has(id) || map.has(id)) continue;
      const label =
        typeof c.label === 'string'
          ? c.label
          : typeof c.name === 'string'
            ? c.name
            : id;
      const description =
        typeof c.description === 'string' ? c.description : '';
      map.set(id, {
        id,
        label,
        description,
        source: 'downloaded',
        state: importedSet.has(id) ? 'imported' : 'pending',
      });
    }
    return Array.from(map.values());
  }, [
    bundled,
    downloadedManifests,
    settings.removedPlugins,
    settings.importedPlugins,
  ]);

  const handleFetchStore = async () => {
    setStoreState({ kind: 'loading' });
    setInstallNotice(null);
    // ストア取得タイミングでローカルファイルも再走査（ユーザーが直接削除した場合の追随）
    await refreshInstalled();

    // ===== 開発モード: HTTP を使わずプロジェクト直下を直接読む =====
    // dev モードでは公式カタログには行かず、`plugin-dev/plugins/plugins.json` を
    // ファイルシステムから読んで一覧化する。これにより:
    //   - 編集中の plugins.json / manifest の変更が即時反映
    //   - 公開カタログがまだ古くても新版で動作確認できる
    //   - sourceBaseUrl は 'inknel-plugin://' とし、ダウンロード処理に
    //     向かないので「インストール」ボタンは出さない設計（後の手当て）
    //
    // `import.meta.env.DEV` ガードは必須: 本番パッケージで誤って
    // `pluginDevMode` が true のまま起動した場合、plugin-dev/ が存在せず
    // 公式カタログにも到達しないため「プラグインが見つかりません」に
    // なってしまう。本番では静的にツリーシェイクで除去される。
    if (import.meta.env.DEV && settings.pluginDevMode) {
      try {
        const dev = await window.api.plugins.fetchDevCatalog();
        if (!dev || dev.rows.length === 0) {
          setStoreState({ kind: 'not_found' });
          return;
        }
        const rows: RemotePluginRow[] = dev.rows.map((r) => ({
          id: r.id,
          filename: r.filename,
          manifest: (r.manifest as RemotePluginRow['manifest']) ?? null,
          sourceBaseUrl: dev.baseUrl,
        }));
        setStoreState({ kind: 'loaded', rows });
        return;
      } catch (err) {
        console.warn('[plugins:dev] fetch-dev-catalog failed', err);
        setStoreState({ kind: 'not_found' });
        return;
      }
    }

    // 取得対象: 公式カタログ（固定） + ユーザーが追加した URL
    const urls = [PLUGIN_CATALOG_URL, ...settings.pluginCatalogUrls];
    // 各 URL を並列にフェッチ。1 つでも到達できなければそれだけスキップ。
    const catalogs = await Promise.all(
      urls.map(async (u) => {
        try {
          return await window.api.plugins.fetchCatalog(u);
        } catch {
          return null;
        }
      }),
    );
    const validCatalogs = catalogs.filter(
      (c): c is NonNullable<typeof c> => c !== null,
    );
    if (validCatalogs.length === 0) {
      setStoreState({ kind: 'not_found' });
      return;
    }

    // 全カタログのプラグインを直列に走査し、id 重複は「先勝ち（公式優先）」で除外
    type ToFetch = { id: string; filename: string; baseUrl: string };
    const toFetch: ToFetch[] = [];
    const seenIds = new Set<string>();
    for (const cat of validCatalogs) {
      for (const p of cat.plugins) {
        if (seenIds.has(p.id)) continue;
        seenIds.add(p.id);
        toFetch.push({ id: p.id, filename: p.manifest, baseUrl: cat.baseUrl });
      }
    }

    // 各 manifest を並列取得（失敗は manifest=null で表示）
    const rows = await Promise.all(
      toFetch.map(async (p): Promise<RemotePluginRow> => {
        const m = await window.api.plugins.fetchManifest(p.baseUrl, p.filename);
        return {
          id: p.id,
          filename: p.filename,
          manifest: (m?.content as RemotePluginRow['manifest']) ?? null,
          sourceBaseUrl: p.baseUrl,
        };
      }),
    );
    setStoreState({ kind: 'loaded', rows });
  };

  const handleInstall = async (row: RemotePluginRow) => {
    if (!row.manifest) return;
    if (storeState.kind !== 'loaded') return;
    setInstalling((prev) => new Set(prev).add(row.filename));
    setInstallNotice(null);
    // 再 DL したら「削除済み」フラグから外して一覧に再表示させる
    if (settings.removedPlugins.includes(row.id)) {
      onChange(
        'removedPlugins',
        settings.removedPlugins.filter((x) => x !== row.id),
      );
    }
    let res: Awaited<ReturnType<typeof window.api.plugins.install>> | null;
    try {
      res = await window.api.plugins.install({
        filename: row.filename,
        content: row.manifest,
        baseUrl: row.sourceBaseUrl,
      });
    } catch (err) {
      // IPC ハンドラ未登録 / Electron 側未再起動などの致命的エラーを可視化
      console.error('[plugins:install] IPC failed', err);
      const msg = err instanceof Error ? err.message : String(err);
      setInstallNotice(
        `ダウンロードに失敗しました: ${msg}\n` +
          'npm run dev を再起動してから再試行してください',
      );
      setInstalling((prev) => {
        const next = new Set(prev);
        next.delete(row.filename);
        return next;
      });
      return;
    }
    setInstalling((prev) => {
      const next = new Set(prev);
      next.delete(row.filename);
      return next;
    });
    if (!res) {
      setInstallNotice('プラグインが見つかりません');
      return;
    }
    // ディスク状態を真とするため、状態のマージではなく再列挙する
    await refreshInstalled();
    // 「ダウンロード = ファイル保存だけ」なので自動 import はしない。
    // 利用するには「インポート」ボタンを押す。
    const savedDetail =
      res.savedFiles.length > 0 ? `保存: ${res.savedFiles.join(', ')}` : '';
    if (res.missingFiles.length > 0) {
      setInstallNotice(
        `一部ファイルが見つかりませんでした: ${res.missingFiles.join(', ')}` +
          (savedDetail ? ` / ${savedDetail}` : ''),
      );
    } else {
      setInstallNotice(`${row.manifest.name ?? row.id} を保存しました (${savedDetail})`);
    }
  };

  return (
    <div className="prefs__section">
      <h3 className="prefs__section-title">プラグイン</h3>

      {/* ===== インストール済み (基本ビュー、最上部に配置) ===== */}
      <div className="plugins-panel__subhead plugins-panel__subhead--first">
        <h4 className="plugins-panel__subhead-title">
          インストール済み
          <span className="plugins-panel__subhead-count">
            {allPlugins.length}
          </span>
        </h4>
      </div>

      {allPlugins.length === 0 ? (
        <div className="plugins-panel__empty">
          <PluginIconLarge />
          <p className="plugins-panel__empty-title">
            プラグインがインストールされていません
          </p>
          <p className="plugins-panel__empty-hint">
            下の「プラグインの取得」からダウンロードしてください
          </p>
        </div>
      ) : (
        <div className="plugins-panel__list">
          {allPlugins.map((p) => {
            const hasLocalCopy = downloadedById.has(p.id);
            // SettingsComponent はバンドル版・ランタイムロード版どちらの module からも
            // 取得を試みる (DL 版プラグインでも設定 UI を出せるようにするため)。
            // 「プラグインが有効化されている」かつ「SettingsComponent を実装」
            // の双方を満たすときだけ、インライン設定 UI を表示する。
            const moduleRef =
              bundledById.get(p.id)?.module ?? runtimeById.get(p.id)?.module;
            const PluginSettingsUI = moduleRef?.SettingsComponent;
            const showPluginSettings =
              !!PluginSettingsUI &&
              p.state === 'imported' &&
              enabledSet.has(p.id);
            return (
              <article className="plugins-panel__card" key={p.id}>
                <div className="plugins-panel__card-icon">
                  <PluginIcon />
                </div>
                <div className="plugins-panel__card-body">
                  <div className="plugins-panel__card-title-row">
                    <span className="plugins-panel__card-name">{p.label}</span>
                  </div>
                  <span className="plugins-panel__card-id">{p.id}</span>
                  {p.description && (
                    <p className="plugins-panel__card-desc">
                      <PluginDescription text={p.description} />
                    </p>
                  )}
                  <div className="plugins-panel__card-meta">
                    <span
                      className={`plugins-panel__badge plugins-panel__badge--${p.source}`}
                    >
                      {p.source === 'bundled' ? 'バンドル版' : 'ダウンロード版'}
                    </span>
                    {p.state === 'pending' && (
                      <span className="plugins-panel__badge plugins-panel__badge--partial">
                        未インポート
                      </span>
                    )}
                  </div>
                </div>
                <div className="plugins-panel__card-actions plugins-panel__card-actions--installed">
                  {/*
                    どの状態でもトグルを表示する。`state === 'pending'`(まだ
                    インポートされていない)の場合、トグル ON 時に
                    `toggle()` 内部で自動的に importPluginById を呼ぶので
                    1 アクションで有効化できる(再起動不要)。
                  */}
                  <ToggleSwitch
                    checked={enabledSet.has(p.id)}
                    onChange={(v) => void toggle(p.id, v)}
                    ariaLabel={`${p.label} を有効化`}
                  />
                  {hasLocalCopy && (
                    <button
                      type="button"
                      className="plugins-panel__delete-link"
                      onClick={() => void handleUninstall(p.id)}
                      title="ダウンロードしたファイルを削除"
                    >
                      <TrashIcon />
                      削除
                    </button>
                  )}
                </div>
                {/*
                  プラグインが SettingsComponent を export していて、かつ有効化
                  されている時のみインライン設定エリアを描画する。
                  全プラグイン共通の機能ではなく、対応プラグインだけのオプション。
                */}
                {showPluginSettings && PluginSettingsUI && (
                  <div className="plugins-panel__card-plugin-settings">
                    <PluginSettingsUI
                      settings={settings}
                      onChange={onChange}
                    />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* ===== プラグインストアを開くボタン (押下 → モーダル表示) ===== */}
      <div className="plugins-panel__subhead">
        <h4 className="plugins-panel__subhead-title">プラグインストア</h4>
        <div className="plugins-panel__subhead-actions">
          <button
            type="button"
            className="plugins-panel__btn plugins-panel__btn--primary"
            onClick={handleToggleStore}
            aria-haspopup="dialog"
            aria-expanded={storeOpen}
          >
            プラグインストアを開く
          </button>
        </div>
      </div>

      {/* ===== プラグインストアモーダル ===== */}
      {storeOpen && (
        <div
          className="plugin-store-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="plugin-store-title"
          onClick={(e) => {
            // 背景クリックで閉じる (モーダル内部は伝播しないように本体側で stopPropagation)
            if (e.target === e.currentTarget) setStoreOpen(false);
          }}
        >
          <div
            className="plugin-store-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="plugin-store-modal__header">
              <h3
                id="plugin-store-title"
                className="plugin-store-modal__title"
              >
                プラグインストア
                {storeState.kind === 'loaded' && (
                  <span className="plugins-panel__subhead-count">
                    {storeState.rows.length}
                  </span>
                )}
              </h3>
              <div className="plugin-store-modal__header-actions">
                <button
                  type="button"
                  className="plugins-panel__btn plugins-panel__btn--ghost"
                  onClick={() => void handleFetchStore()}
                  disabled={storeState.kind === 'loading'}
                  title="カタログを再取得"
                >
                  {storeState.kind === 'loading' ? <Spinner /> : <RefreshIcon />}
                  {storeState.kind === 'loading' ? '取得中…' : '更新'}
                </button>
                <button
                  type="button"
                  className="plugin-store-modal__close"
                  onClick={() => setStoreOpen(false)}
                  aria-label="閉じる"
                  title="閉じる (Esc)"
                >
                  ×
                </button>
              </div>
            </header>

            <div className="plugin-store-modal__body">
              {/* ----- プラグインカタログ URL の管理 ----- */}
              <div className="plugins-panel__subhead plugins-panel__subhead--first">
                <h4 className="plugins-panel__subhead-title">
                  プラグインカタログ URL
                </h4>
              </div>
              <ul className="plugins-panel__url-list">
                <li className="plugins-panel__url-item plugins-panel__url-item--default">
                  <span
                    className="plugins-panel__url-text"
                    title={PLUGIN_CATALOG_URL}
                  >
                    {PLUGIN_CATALOG_URL}
                  </span>
                  <span className="plugins-panel__url-tag">既定(変更不可)</span>
                </li>
                {settings.pluginCatalogUrls.map((u) => (
                  <li key={u} className="plugins-panel__url-item">
                    <span className="plugins-panel__url-text" title={u}>
                      {u}
                    </span>
                    <button
                      type="button"
                      className="plugins-panel__btn plugins-panel__btn--ghost"
                      onClick={() => handleRemoveCatalogUrl(u)}
                      title="この URL を削除"
                      aria-label="この URL を削除"
                    >
                      削除
                    </button>
                  </li>
                ))}
              </ul>
              <div className="plugins-panel__url-add">
                <input
                  type="url"
                  className="plugins-panel__url-input"
                  value={newCatalogUrl}
                  placeholder="https://example.com/plugins.json"
                  onChange={(e) => {
                    setNewCatalogUrl(e.target.value);
                    if (catalogUrlError) setCatalogUrlError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCatalogUrl();
                    }
                  }}
                />
                <button
                  type="button"
                  className="plugins-panel__btn plugins-panel__btn--primary"
                  onClick={handleAddCatalogUrl}
                  disabled={newCatalogUrl.trim().length === 0}
                >
                  追加
                </button>
              </div>
              {catalogUrlError && (
                <p className="plugins-panel__url-error" role="alert">
                  {catalogUrlError}
                </p>
              )}
              <p className="plugins-panel__url-hint">
                追加 URL の plugins.json から取得した結果は、既定カタログのものと
                マージされます。既定カタログと同じ ID のプラグインは既定側が優先されます。
              </p>

              {/* ----- ストア結果 ----- */}
              <div className="plugins-panel__subhead">
                <h4 className="plugins-panel__subhead-title">
                  導入可能なプラグイン
                </h4>
              </div>

              {storeState.kind === 'idle' && (
                <div className="plugins-panel__empty">
                  <p className="plugins-panel__empty-title">
                    カタログを取得していません
                  </p>
                  <p className="plugins-panel__empty-hint">
                    右上の「更新」ボタンを押してください
                  </p>
                </div>
              )}

              {storeState.kind === 'loading' && (
                <div className="plugins-panel__loading">
                  <Spinner />
                  カタログを取得しています…
                </div>
              )}

              {storeState.kind === 'not_found' && (
                <div className="plugins-panel__empty">
                  <p className="plugins-panel__empty-title">
                    プラグインが見つかりません
                  </p>
                  <p className="plugins-panel__empty-hint">
                    カタログ URL に到達できませんでした
                  </p>
                </div>
              )}

              {storeState.kind === 'loaded' &&
                storeState.rows.length === 0 && (
                  <div className="plugins-panel__empty">
                    <p className="plugins-panel__empty-title">
                      利用可能なプラグインがありません
                    </p>
                  </div>
                )}

              {storeState.kind === 'loaded' && storeState.rows.length > 0 && (
        <div className="plugins-panel__list">
          {storeState.rows.map((row) => {
            const declaredFiles = Array.isArray(row.manifest?.files)
              ? (row.manifest!.files as unknown[]).filter(
                  (f): f is string => typeof f === 'string',
                )
              : [];
            const requiredFiles = [row.filename, ...declaredFiles];
            const presentCount = requiredFiles.filter((f) =>
              installed.has(f),
            ).length;
            const isFullyInstalled =
              presentCount === requiredFiles.length &&
              requiredFiles.length > 0;
            const isInstalling = installing.has(row.filename);
            const name = row.manifest?.name ?? row.id;
            const description =
              row.manifest?.description ??
              (row.manifest === null
                ? 'マニフェストの取得に失敗しました'
                : '');
            return (
              <article className="plugins-panel__card" key={row.id}>
                <div className="plugins-panel__card-icon">
                  <PluginIcon />
                </div>
                <div className="plugins-panel__card-body">
                  <div className="plugins-panel__card-title-row">
                    <span className="plugins-panel__card-name">{name}</span>
                    {row.manifest?.version && (
                      <span className="plugins-panel__card-version">
                        v{row.manifest.version}
                      </span>
                    )}
                  </div>
                  <span className="plugins-panel__card-id">{row.id}</span>
                  {description && (
                    <p className="plugins-panel__card-desc">
                      <PluginDescription text={description} />
                    </p>
                  )}
                  <div className="plugins-panel__card-meta">
                    {requiredFiles.length > 0 && (
                      <span
                        className={`plugins-panel__badge ${
                          isFullyInstalled
                            ? 'plugins-panel__badge--ok'
                            : presentCount > 0
                              ? 'plugins-panel__badge--partial'
                              : ''
                        }`}
                      >
                        {isFullyInstalled
                          ? '✓ '
                          : ''}
                        {presentCount}/{requiredFiles.length} ファイル
                      </span>
                    )}
                  </div>
                </div>
                <div className="plugins-panel__card-actions">
                  <button
                    type="button"
                    className={`plugins-panel__btn ${
                      isFullyInstalled ? '' : 'plugins-panel__btn--primary'
                    }`}
                    onClick={() => void handleInstall(row)}
                    disabled={!row.manifest || isInstalling}
                  >
                    {isInstalling ? (
                      <>
                        <Spinner />
                        保存中…
                      </>
                    ) : isFullyInstalled ? (
                      <>
                        <RefreshIcon />
                        再ダウンロード
                      </>
                    ) : (
                      <>
                        <DownloadIcon />
                        ダウンロード
                      </>
                    )}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
              )}
            </div>{/* /plugin-store-modal__body */}
          </div>{/* /plugin-store-modal */}
        </div>
      )}

      {installNotice && (
        <div
          className={`plugins-panel__notice plugins-panel__notice--${
            installNotice.includes('失敗') ||
            installNotice.includes('見つかりません')
              ? 'warn'
              : 'info'
          }`}
        >
          {installNotice}
        </div>
      )}

      {/*
        ===== プラグイン開発モード (最下部に配置) =====
        `import.meta.env.DEV` は Vite が `npm run dev` の dev サーバー実行時に
        true、`npm run build` 済みの本番パッケージでは false に展開する定数。
        本番ビルドでは静的に false 評価され、このブロック全体がツリーシェイクで
        削除される（ユーザー設定での暴露も含めて完全に隠れる）。
      */}
      {import.meta.env.DEV && (
        <>
          <div className="plugins-panel__subhead">
            <h4 className="plugins-panel__subhead-title">プラグイン開発</h4>
          </div>
          <div className="prefs__field">
            <div className="prefs__field-main">
              <label className="prefs__field-label">プラグイン開発モード</label>
              <p className="prefs__field-desc">
                ON にすると <code>inknel-plugin://</code> プロトコルが
                <code>userData/plugins/</code> ではなくプロジェクト直下の
                <code>plugin-dev/plugins/</code> を直接配信します。ダウンロード /
                インポート不要で、<code>plugin-dev/plugins/&lt;id&gt;/</code>{' '}
                の中のファイルを編集して Cmd+R すれば即反映されます。
                開発 (npm run dev) 時のみ有効。production パッケージでは無視されます。
              </p>
            </div>
            <ToggleSwitch
              checked={settings.pluginDevMode}
              onChange={(v) => onChange('pluginDevMode', v)}
              ariaLabel="プラグイン開発モード"
            />
          </div>
          {settings.pluginDevMode && (
            <p className="prefs__field-desc" style={{ marginTop: 8 }}>
              ✓ 開発モード ON — ロード先:{' '}
              <code>&lt;project&gt;/plugin-dev/plugins/&lt;id&gt;/</code>
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * プラグイン説明文を描画する。
 * `\`code\`` 表記を `<code>` 要素として表示する（manifest 内のコード片を強調）。
 * 三連バックティック (\`\`\`xxx) も "xxx" として code 表示する。
 */
function PluginDescription({ text }: { text: string }) {
  // 1) ``` 三連バックティック の塊を最優先で抽出（言語名などの fence 開始記法）
  // 2) 残りの中の ` 単体バックティック を抽出
  // 結果を React ノード配列にまとめる
  const nodes: React.ReactNode[] = [];
  let key = 0;
  // ``` 言語 もしくは ``` xxx ``` どちらの形でも対応
  const re = /(`{3}([\w-]+)|`([^`]+)`)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      nodes.push(text.slice(lastIndex, m.index));
    }
    const codeContent = m[2] ?? m[3] ?? '';
    nodes.push(<code key={`c-${key++}`}>{codeContent}</code>);
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return <>{nodes}</>;
}

// ----- プラグイン関連アイコン (16px ストローク 1.5px) -----

function PluginIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 3v3a2 2 0 0 0 4 0V3" />
      <path d="M3 9h3a2 2 0 0 1 0 4H3" />
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M15 13.5v3a2.5 2.5 0 0 0 5 0" opacity=".5" />
    </svg>
  );
}

function PluginIconLarge() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="plugins-panel__empty-icon"
    >
      <path d="M9 3v3a2 2 0 0 0 4 0V3" />
      <path d="M3 9h3a2 2 0 0 1 0 4H3" />
      <rect x="3" y="3" width="18" height="18" rx="3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      className="plugins-panel__spinner"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M21 12a9 9 0 1 1-6.2-8.55" />
    </svg>
  );
}

// ----- バックアップパネル -----
// 手順:
//   1. (UI) DB→MD 同期で .md ファイルを最新にする
//   2. (Electron) ストレージルート (notes/ images/ attachments/) を ZIP 化して保存
function BackupPanel() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<
    'idle' | 'syncing' | 'zipping'
  >('idle');
  const [message, setMessage] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const handleBackup = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await new Promise<void>((resolve) => {
        window.dispatchEvent(
          new CustomEvent('inknel:flush-pending-saves', {
            detail: { resolve },
          }),
        );
      });
      setPhase('syncing');
      try {
        await window.api.storage.sync();
      } catch (err) {
        console.warn('[backup] DB↔MD sync failed:', err);
      }
      setPhase('zipping');
      const result = await window.api.backup.create();
      if (!result) {
        setMessage({ type: 'ok', text: t.settings.backup.cancelled });
        return;
      }
      setMessage({
        type: 'ok',
        text: t.settings.backup.okSaved
          .replace('{{count}}', String(result.fileCount))
          .replace('{{path}}', result.savedPath),
      });
    } catch (err) {
      setMessage({
        type: 'err',
        text:
          t.settings.backup.failed +
          ': ' +
          (err instanceof Error ? err.message : String(err)),
      });
    } finally {
      setBusy(false);
      setPhase('idle');
    }
  };

  return (
    <div className="prefs__section">
      <h3 className="prefs__section-title">{t.settings.backup.title}</h3>

      <div className="backup-panel__card">
        <span className="backup-panel__card-icon">
          <ArchiveIcon />
        </span>
        <div className="backup-panel__card-body">
          <span className="backup-panel__card-title">
            {t.settings.backup.cardTitle}
          </span>
          <p className="backup-panel__card-desc">{t.settings.backup.cardDesc}</p>

          <ol className="backup-panel__steps">
            <li className="backup-panel__step">
              <span className="backup-panel__step-num">1</span>
              <span className="backup-panel__step-text">
                {t.settings.backup.step1}
              </span>
            </li>
            <li className="backup-panel__step">
              <span className="backup-panel__step-num">2</span>
              <span className="backup-panel__step-text">
                {t.settings.backup.step2}
              </span>
            </li>
            <li className="backup-panel__step">
              <span className="backup-panel__step-num">3</span>
              <span className="backup-panel__step-text">
                {t.settings.backup.step3}
              </span>
            </li>
          </ol>

          <div className="backup-panel__actions">
            <button
              type="button"
              className="backup-panel__btn"
              onClick={() => void handleBackup()}
              disabled={busy}
            >
              {busy ? (
                <>
                  <Spinner />
                  {phase === 'syncing'
                    ? t.settings.backup.syncing
                    : phase === 'zipping'
                      ? t.settings.backup.zipping
                      : t.settings.backup.working}
                </>
              ) : (
                <>
                  <DownloadIcon />
                  {t.settings.backup.createBtn}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {message && (
        <div
          className={`backup-panel__notice backup-panel__notice--${
            message.type === 'err' ? 'err' : 'ok'
          }`}
        >
          {message.type === 'err' ? <AlertIcon /> : <CheckIcon />}
          <span>{message.text}</span>
        </div>
      )}
    </div>
  );
}

// ----- リストアパネル -----
// 手順:
//   1. (Electron) ZIP 選択ダイアログでファイル指定
//   2. (Electron) ストレージルート配下を入れ替え
//   3. (UI) MD→DB 同期で取り込み直す
function RestorePanel() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<
    'idle' | 'extracting' | 'importing'
  >('idle');
  const [message, setMessage] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  // リストア完了時に表示する再起動プロンプト (null = 非表示)
  const [restartPrompt, setRestartPrompt] = useState<string | null>(null);

  const handleRestore = async () => {
    if (!window.confirm(t.settings.restore.confirm)) return;
    setBusy(true);
    setMessage(null);
    try {
      await new Promise<void>((resolve) => {
        window.dispatchEvent(
          new CustomEvent('inknel:flush-pending-saves', {
            detail: { resolve },
          }),
        );
      });

      setPhase('extracting');
      const result = await window.api.backup.restore();
      if (!result) {
        setMessage({ type: 'ok', text: t.settings.backup.cancelled });
        return;
      }

      setPhase('importing');
      let importedCount = 0;
      try {
        const r = await window.api.storage.rebuildFromMd();
        importedCount = r.imported;
      } catch (err) {
        console.warn('[restore] rebuildFromMd failed:', err);
      }
      window.dispatchEvent(new CustomEvent('inknel:notes-changed'));

      setMessage({
        type: 'ok',
        text:
          t.settings.restore.okDone
            .replace('{{files}}', String(result.fileCount))
            .replace('{{imported}}', String(importedCount)) +
          ` (${result.restoredPath})`,
      });
      // リストアは DB 全置換 + ファイル全置換のため、各種キャッシュ・タブ・
      // 検索インデックス等を確実に整合させるためにアプリ再起動が必要。
      setRestartPrompt(
        `リストアが完了しました。\n\n` +
          `復元ファイル: ${result.fileCount} 件\n` +
          `DB へのインポート: ${importedCount} 件\n` +
          `保存先: ${result.restoredPath}\n\n` +
          `反映には再起動が必要です。OK を押すとアプリを再起動します。`,
      );
    } catch (err) {
      setMessage({
        type: 'err',
        text:
          t.settings.restore.failed +
          ': ' +
          (err instanceof Error ? err.message : String(err)),
      });
    } finally {
      setBusy(false);
      setPhase('idle');
    }
  };

  return (
    <div className="prefs__section">
      <h3 className="prefs__section-title">{t.settings.restore.title}</h3>

      <div className="backup-panel__warn">
        <span className="backup-panel__warn-icon">
          <AlertIcon />
        </span>
        <span>{t.settings.restore.warn}</span>
      </div>

      <div className="backup-panel__card">
        <span className="backup-panel__card-icon">
          <RestoreIcon />
        </span>
        <div className="backup-panel__card-body">
          <span className="backup-panel__card-title">
            {t.settings.restore.cardTitle}
          </span>
          <p className="backup-panel__card-desc">
            {t.settings.restore.cardDesc}
          </p>

          <ol className="backup-panel__steps">
            <li className="backup-panel__step">
              <span className="backup-panel__step-num">1</span>
              <span className="backup-panel__step-text">
                {t.settings.restore.step1}
              </span>
            </li>
            <li className="backup-panel__step">
              <span className="backup-panel__step-num">2</span>
              <span className="backup-panel__step-text">
                {t.settings.restore.step2}
              </span>
            </li>
            <li className="backup-panel__step">
              <span className="backup-panel__step-num">3</span>
              <span className="backup-panel__step-text">
                {t.settings.restore.step3}
              </span>
            </li>
          </ol>

          <div className="backup-panel__actions">
            <button
              type="button"
              className="backup-panel__btn backup-panel__btn--danger"
              onClick={() => void handleRestore()}
              disabled={busy}
            >
              {busy ? (
                <>
                  <Spinner />
                  {phase === 'extracting'
                    ? t.settings.restore.extracting
                    : phase === 'importing'
                      ? t.settings.restore.rebuilding
                      : t.settings.restore.working}
                </>
              ) : (
                <>
                  <RestoreIcon />
                  {t.settings.restore.restoreBtn}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {message && (
        <div
          className={`backup-panel__notice backup-panel__notice--${
            message.type === 'err' ? 'err' : 'ok'
          }`}
        >
          {message.type === 'err' ? <AlertIcon /> : <CheckIcon />}
          <span>{message.text}</span>
        </div>
      )}

      {restartPrompt !== null && (
        <div
          className="storage-panel__restart-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="restore-restart-title"
        >
          <div className="storage-panel__restart-modal">
            <h4
              id="restore-restart-title"
              className="storage-panel__restart-title"
            >
              再起動が必要です
            </h4>
            <p className="storage-panel__restart-message">{restartPrompt}</p>
            <div className="storage-panel__restart-actions">
              <button
                type="button"
                className="storage-panel__btn"
                autoFocus
                onClick={() => {
                  setRestartPrompt(null);
                  void window.api.app.relaunch();
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ----- バックアップ / リストア用アイコン -----

function ArchiveIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="5" rx="1" />
      <path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
      <path d="M10 13h4" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

// ============================================================
// メンテナンスパネル
// ============================================================
// リンク切れ (orphan) の画像 / 添付ファイルを検出・削除する。
// 元は ResetPanel 内にあった機能を独立カテゴリに切り出したもの。
function MaintenancePanel() {
  type Orphan = {
    filename: string;
    kind: 'images' | 'attachments';
    size: number;
  };
  const [orphans, setOrphans] = useState<Orphan[] | null>(null);
  const [orphanBusy, setOrphanBusy] = useState(false);
  const [orphanMessage, setOrphanMessage] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const handleScanOrphans = async () => {
    setOrphanBusy(true);
    setOrphanMessage(null);
    try {
      const list = await window.api.storage.scanOrphans();
      setOrphans(list);
      if (list.length === 0) {
        setOrphanMessage({
          type: 'ok',
          text: 'リンク切れのファイルは見つかりませんでした。',
        });
      }
    } catch (err) {
      setOrphanMessage({
        type: 'err',
        text:
          'スキャンに失敗しました: ' +
          (err instanceof Error ? err.message : String(err)),
      });
    } finally {
      setOrphanBusy(false);
    }
  };

  const handleDeleteOrphans = async () => {
    if (!orphans || orphans.length === 0) return;
    if (
      !window.confirm(
        `${orphans.length} 件のリンク切れファイルを削除します。\n取り消しできません。よろしいですか?`,
      )
    )
      return;
    setOrphanBusy(true);
    setOrphanMessage(null);
    try {
      const targets = orphans.map((o) => ({
        filename: o.filename,
        kind: o.kind,
      }));
      const res = await window.api.storage.deleteOrphans(targets);
      setOrphanMessage({
        type: res.failed === 0 ? 'ok' : 'err',
        text: `${res.deleted} 件削除しました${
          res.failed > 0 ? ` (${res.failed} 件失敗)` : ''
        }。`,
      });
      const list = await window.api.storage.scanOrphans();
      setOrphans(list);
    } catch (err) {
      setOrphanMessage({
        type: 'err',
        text:
          '削除に失敗しました: ' +
          (err instanceof Error ? err.message : String(err)),
      });
    } finally {
      setOrphanBusy(false);
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };
  const orphanTotalSize = orphans
    ? orphans.reduce((acc, o) => acc + o.size, 0)
    : 0;

  return (
    <div className="prefs__section">
      <h3 className="prefs__section-title">メンテナンス</h3>

      <div className="reset-panel__subhead">
        <h4 className="reset-panel__subhead-title">
          リンク切れの画像・ファイルを削除
        </h4>
      </div>
      <div className="orphan-panel__card">
        <p className="orphan-panel__desc">
          どのノートからも参照されていない画像 / 添付ファイルを検出して削除
          します。ノート本文を編集中に画像を貼り直したり、ノートを削除した
          ときに残ったファイルを整理する用途で使ってください。
        </p>
        <div className="orphan-panel__actions">
          <button
            type="button"
            className="orphan-panel__btn"
            onClick={() => void handleScanOrphans()}
            disabled={orphanBusy}
          >
            {orphanBusy && orphans === null ? (
              <>
                <Spinner />
                スキャン中...
              </>
            ) : (
              'リンク切れをスキャン'
            )}
          </button>
          <button
            type="button"
            className="orphan-panel__btn orphan-panel__btn--danger"
            onClick={() => void handleDeleteOrphans()}
            disabled={
              orphanBusy || orphans === null || orphans.length === 0
            }
          >
            {orphanBusy && orphans !== null && orphans.length > 0 ? (
              <>
                <Spinner />
                削除中...
              </>
            ) : (
              `削除${
                orphans && orphans.length > 0 ? ` (${orphans.length})` : ''
              }`
            )}
          </button>
        </div>

        {orphans !== null && orphans.length > 0 && (
          <div className="orphan-panel__list-wrap">
            <div className="orphan-panel__list-summary">
              {orphans.length} 件 / 合計 {formatSize(orphanTotalSize)}
            </div>
            <ul className="orphan-panel__list">
              {orphans.map((o) => (
                <li
                  key={`${o.kind}/${o.filename}`}
                  className="orphan-panel__list-item"
                >
                  <span
                    className={`orphan-panel__preview orphan-panel__preview--${o.kind}`}
                  >
                    {o.kind === 'images' ? (
                      <img
                        className="orphan-panel__thumb"
                        src={`inknel-image://${o.filename}`}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <FileGlyphIcon />
                    )}
                  </span>
                  <span className="orphan-panel__filename">{o.filename}</span>
                  <span className="orphan-panel__size">
                    {formatSize(o.size)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {orphanMessage && (
          <div
            className={`orphan-panel__notice orphan-panel__notice--${
              orphanMessage.type === 'err' ? 'err' : 'ok'
            }`}
          >
            {orphanMessage.type === 'err' ? <AlertIcon /> : <CheckIcon />}
            <span>{orphanMessage.text}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ----- 初期化パネル -----
// ノート / フォルダ / 設定 / メディアファイルを **すべて削除** して再起動する。
// 誤操作防止のため、テキストボックスに正確に「初期化」と入力されないと
// 実行ボタンが押せないようにしている。
function ResetPanel() {
  const t = useT();
  const REQUIRED = t.settings.reset.confirmInputWord;
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const canReset = confirmText === REQUIRED && !busy;

  const handleReset = async () => {
    if (!canReset) return;
    if (!window.confirm(t.settings.reset.confirmDialog)) return;
    setBusy(true);
    try {
      await window.api.app.resetAll();
    } catch (err) {
      setBusy(false);
      window.alert(
        t.settings.reset.failed +
          ': ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  };

  const isConfirmValid = confirmText === REQUIRED;

  return (
    <div className="prefs__section">
      <h3 className="prefs__section-title">{t.settings.reset.title}</h3>

      {/* ----- 危険性バナー ----- */}
      <div className="reset-panel__banner">
        <span className="reset-panel__banner-icon">
          <ResetWarnIcon />
        </span>
        <div className="reset-panel__banner-body">
          <span className="reset-panel__banner-title">
            {t.settings.reset.bannerTitle}
          </span>
          <p className="reset-panel__banner-desc">
            {t.settings.reset.bannerDesc}
          </p>
        </div>
      </div>

      {/* ----- 削除されるもの / 残るもの ----- */}
      <div className="reset-panel__lists">
        <div className="reset-panel__list-card">
          <h4 className="reset-panel__list-title reset-panel__list-title--del">
            <ResetTrashIcon />
            {t.settings.reset.willBeDeleted}
          </h4>
          <ul className="reset-panel__list-items">
            <li className="reset-panel__list-item">
              <span className="reset-panel__list-icon reset-panel__list-icon--del">
                <CrossSmallIcon />
              </span>
              {t.settings.reset.delDbNotes}
            </li>
            <li className="reset-panel__list-item">
              <span className="reset-panel__list-icon reset-panel__list-icon--del">
                <CrossSmallIcon />
              </span>
              {t.settings.reset.delFolders}
            </li>
            <li className="reset-panel__list-item">
              <span className="reset-panel__list-icon reset-panel__list-icon--del">
                <CrossSmallIcon />
              </span>
              {t.settings.reset.delAppSettings}
            </li>
            <li className="reset-panel__list-item">
              <span className="reset-panel__list-icon reset-panel__list-icon--del">
                <CrossSmallIcon />
              </span>
              {t.settings.reset.delTabState}
            </li>
          </ul>
        </div>

        <div className="reset-panel__list-card">
          <h4 className="reset-panel__list-title reset-panel__list-title--keep">
            <ResetKeepIcon />
            {t.settings.reset.willRemain}
          </h4>
          <ul className="reset-panel__list-items">
            <li className="reset-panel__list-item">
              <span className="reset-panel__list-icon reset-panel__list-icon--keep">
                <CheckIcon />
              </span>
              {t.settings.reset.keepMdFiles}
            </li>
            <li className="reset-panel__list-item">
              <span className="reset-panel__list-icon reset-panel__list-icon--keep">
                <CheckIcon />
              </span>
              {t.settings.reset.keepMedia}
            </li>
            <li className="reset-panel__list-item">
              <span className="reset-panel__list-icon reset-panel__list-icon--keep">
                <CheckIcon />
              </span>
              {t.settings.reset.keepOtherDevices}
            </li>
            <li className="reset-panel__list-item">
              <span className="reset-panel__list-icon reset-panel__list-icon--keep">
                <CheckIcon />
              </span>
              {t.settings.reset.keepPlugins}
            </li>
          </ul>
        </div>
      </div>

      {/* ----- 確認入力 ----- */}
      <div className="reset-panel__subhead">
        <h4 className="reset-panel__subhead-title">
          {t.settings.reset.confirmHeading}
        </h4>
      </div>

      <div className="reset-panel__confirm-card">
        <span className="reset-panel__confirm-label">
          {t.settings.reset.confirmInstructions.replace('{{word}}', REQUIRED)}
        </span>
        <input
          type="text"
          className={`reset-panel__confirm-input ${
            isConfirmValid ? 'is-valid' : ''
          }`}
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={REQUIRED}
          aria-label={t.settings.reset.confirmHeading}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="reset-panel__confirm-hint">
          {t.settings.reset.confirmHint}
        </p>
      </div>

      <div className="reset-panel__actions">
        <button
          type="button"
          className="reset-panel__btn"
          onClick={() => void handleReset()}
          disabled={!canReset}
        >
          {busy ? (
            <>
              <Spinner />
              {t.settings.reset.executingBtn}
            </>
          ) : (
            <>
              <ResetTrashIcon />
              {t.settings.reset.executeBtn}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ----- ライセンス / About パネル -----
// 元プロジェクト由来のコードを利用していることを明記する。
// LICENSE.md の条件に従い、オリジナルプロジェクト名 / 作者 / リポジトリURLを表示。
function AboutPanel() {
  const t = useT();
  const repoUrl = 'https://github.com/akirat28/InkNel_Desktop';
  const licenseUrl =
    'https://github.com/akirat28/InkNel_Desktop/blob/main/LICENSE.md';
  return (
    <div className="prefs__section">
      <h3 className="prefs__section-title">{t.settings.about.title}</h3>

      <div className="about-panel__card">
        <p className="about-panel__intro">{t.settings.about.intro}</p>

        <div className="about-panel__block">
          <div className="about-panel__copyright">
            {t.settings.about.copyright}
          </div>

          <div className="about-panel__originalLabel">
            {t.settings.about.originalLabel}
          </div>
          <a
            href="#"
            className="about-panel__link"
            onClick={(e) => {
              e.preventDefault();
              void window.api.shell.openExternal(repoUrl);
            }}
          >
            {repoUrl}
          </a>

          {/* ----- ライセンス本文へのリンク (GitHub の LICENSE.md) ----- */}
          <div className="about-panel__originalLabel">ライセンス</div>
          <a
            href="#"
            className="about-panel__link"
            onClick={(e) => {
              e.preventDefault();
              void window.api.shell.openExternal(licenseUrl);
            }}
          >
            {licenseUrl}
          </a>
        </div>
      </div>
    </div>
  );
}

// ----- 初期化パネル用アイコン -----

function ResetWarnIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 10v4" />
      <path d="M12 18v.01" />
    </svg>
  );
}

function ResetTrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

function ResetKeepIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l8 4v6a9 9 0 0 1-8 8 9 9 0 0 1-8-8V7l8-4z" />
    </svg>
  );
}

function CrossSmallIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3l10 10M13 3L3 13" />
    </svg>
  );
}

/** 保存先ヒーローカード用フォルダアイコン (大サイズ) */
function StorageHeroIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

/** データベース筒アイコン (3 段の楕円) */
function DatabaseIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <ellipse cx="16" cy="7" rx="10" ry="3.5" />
      <path d="M6 7 v8 a10 3.5 0 0 0 20 0 V7" />
      <path d="M6 15 v8 a10 3.5 0 0 0 20 0 V15" />
    </svg>
  );
}

/** Markdown 記号 (M↓ のロゴ風) */
function MarkdownIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="7" width="26" height="18" rx="3" />
      <path d="M8 21 V13 L12 17 L16 13 V21" />
      <path d="M21 13 V21 M21 21 L24 18 M21 21 L18 18" />
    </svg>
  );
}

/** 双方向矢印 (上下) */
function SyncArrowIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 4 V16 M8 16 L5 13 M8 16 L11 13" />
      <path d="M16 20 V8 M16 8 L13 11 M16 8 L19 11" />
    </svg>
  );
}

/** クラウド (フィルなし) */
function CloudIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 18 a4 4 0 0 1 -0.5 -7.95 a5 5 0 0 1 9.9 -0.5 a4.5 4.5 0 0 1 1.1 8.45 H7 z" />
    </svg>
  );
}

/** 4 ポイントスパークル */
function SparkleIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2 L13.5 9 L20 10.5 L13.5 12 L12 19 L10.5 12 L4 10.5 L10.5 9 Z" />
      <path d="M19 16 L19.7 18.3 L22 19 L19.7 19.7 L19 22 L18.3 19.7 L16 19 L18.3 18.3 Z" />
    </svg>
  );
}

/** 添付ファイル用の汎用ファイルアイコン (折角つき書類) */
function FileGlyphIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3 h8 L18 7 v13 a1 1 0 0 1 -1 1 H6 a1 1 0 0 1 -1 -1 V4 a1 1 0 0 1 1 -1 z" />
      <path d="M14 3 v4 h4" />
    </svg>
  );
}

// ----- テーマ選択（セグメント） -----

interface ThemeSegmentProps {
  value: Theme;
  onChange: (next: Theme) => void;
}

function ThemeSegment({ value, onChange }: ThemeSegmentProps) {
  return (
    <div
      className="theme-seg"
      role="radiogroup"
      aria-label="テーマ"
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === 'dark'}
        className={`theme-seg__btn ${value === 'dark' ? 'is-active' : ''}`}
        onClick={() => onChange('dark')}
      >
        <span className="theme-seg__swatch theme-seg__swatch--dark" />
        ダーク
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'light'}
        className={`theme-seg__btn ${value === 'light' ? 'is-active' : ''}`}
        onClick={() => onChange('light')}
      >
        <span className="theme-seg__swatch theme-seg__swatch--light" />
        ライト
      </button>
    </div>
  );
}

// ----- トグルスイッチ -----

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}

function ToggleSwitch({ checked, onChange, ariaLabel }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`toggle ${checked ? 'is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__thumb" />
    </button>
  );
}
