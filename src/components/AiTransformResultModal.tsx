import { useEffect, useMemo, useState } from 'react';
import MarkdownIt from 'markdown-it';
import { useT } from '../i18n';

/**
 * AI 整形・要約の実行結果をモーダルで表示し、ユーザーが「適用」したときだけ
 * ノートに書き戻す。エラー時は理由を表示するだけで何もしない。
 *
 * `kind` の使い分け:
 *  - body : 本文を書き換える種類 (要約、文体変換、表整形 等)
 *  - title: タイトル生成 (1 行のテキスト結果)
 *  - error: 変換失敗 (理由を表示)
 */
export type AiResultPayload =
  | {
      kind: 'body';
      /** AI から返ってきた変換後本文 */
      transformed: string;
      /** 整形前の本文 (差分表示・参考表示用) */
      original: string;
    }
  | {
      kind: 'title';
      /** 整形済みタイトル文字列 (20 文字以内に整形済み) */
      title: string;
    }
  | {
      kind: 'error';
      /** 失敗理由 (ユーザーに見せる文章) */
      message: string;
    };

interface Props {
  open: boolean;
  /** メニュー項目のラベル (例: 「📝 ノートを要約する」) */
  actionLabel: string;
  /** 整形対象ノートのタイトル (実行時に固定された snapshotNoteId のもの) */
  noteTitle: string;
  /**
   * 実行時のノートが現在のアクティブノートと異なるかどうか。
   * 異なる場合は「裏のタブに対する整形」だと UI で示す。
   */
  isBackground: boolean;
  payload: AiResultPayload;
  onApply: () => void;
  onClose: () => void;
}

export default function AiTransformResultModal({
  open,
  actionLabel,
  noteTitle,
  isBackground,
  payload,
  onApply,
  onClose,
}: Props) {
  const t = useT();
  const [previewMode, setPreviewMode] = useState<'rendered' | 'raw'>(
    'rendered',
  );

  // モーダルを開くたびにレンダリングモードをリセット
  useEffect(() => {
    if (open) setPreviewMode('rendered');
  }, [open]);

  // ESC で閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // markdown-it: AiChatPanel と同じく安全側 (html: false)
  const md = useMemo(
    () => new MarkdownIt({ html: false, linkify: true, breaks: false }),
    [],
  );

  if (!open) return null;

  const isError = payload.kind === 'error';
  const isTitle = payload.kind === 'title';

  return (
    <div
      className="modal__backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal modal--ai-result"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-result-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__header">
          <h2 id="ai-result-title" className="modal__title">
            {actionLabel}
          </h2>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label={t.tabBar.close}
          >
            ×
          </button>
        </header>

        <div className="modal__body ai-result-body">
          <div className="ai-result-body__meta">
            <span className="ai-result-body__meta-label">対象ノート:</span>
            <span className="ai-result-body__meta-value">
              {noteTitle || '(無題)'}
            </span>
            {isBackground && (
              <span className="ai-result-body__meta-badge">
                バックグラウンド
              </span>
            )}
          </div>

          {isError ? (
            <div className="ai-result-body__error">
              <p className="ai-result-body__error-title">
                変換できませんでした
              </p>
              <p className="ai-result-body__error-message">
                {(payload as { kind: 'error'; message: string }).message}
              </p>
            </div>
          ) : isTitle ? (
            <div className="ai-result-body__title-preview">
              <p className="ai-result-body__hint">
                以下のタイトルに変更します。
              </p>
              <div className="ai-result-body__title-value">
                {(payload as { kind: 'title'; title: string }).title}
              </div>
            </div>
          ) : (
            <>
              <div className="ai-result-body__toolbar">
                <div
                  className="ai-result-body__tabs"
                  role="tablist"
                  aria-label="表示形式"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={previewMode === 'rendered'}
                    className={`ai-result-body__tab ${previewMode === 'rendered' ? 'is-active' : ''}`}
                    onClick={() => setPreviewMode('rendered')}
                  >
                    プレビュー
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={previewMode === 'raw'}
                    className={`ai-result-body__tab ${previewMode === 'raw' ? 'is-active' : ''}`}
                    onClick={() => setPreviewMode('raw')}
                  >
                    Markdown ソース
                  </button>
                </div>
              </div>
              <div className="ai-result-body__content">
                {previewMode === 'rendered' ? (
                  <div
                    className="ai-result-body__rendered"
                    // markdown-it: html:false なので XSS リスクは小さい
                    dangerouslySetInnerHTML={{
                      __html: md.render(
                        (payload as { transformed: string }).transformed,
                      ),
                    }}
                  />
                ) : (
                  <pre className="ai-result-body__raw">
                    <code>
                      {(payload as { transformed: string }).transformed}
                    </code>
                  </pre>
                )}
              </div>
            </>
          )}
        </div>

        <footer className="modal__footer">
          {isError ? (
            <button
              type="button"
              className="modal__btn modal__btn--primary"
              onClick={onClose}
            >
              閉じる
            </button>
          ) : (
            <>
              <button
                type="button"
                className="modal__btn"
                onClick={onClose}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="modal__btn modal__btn--primary"
                onClick={onApply}
                autoFocus
              >
                適用
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
