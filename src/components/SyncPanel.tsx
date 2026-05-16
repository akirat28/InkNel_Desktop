import { useEffect, useState } from 'react';
import type {
  ShareProviderId,
  ShareStatus,
  ShareSyncProgress,
  ShareSyncResult,
} from '../global';

interface Props {
  /** 現在の共有プロバイダ（'none' 以外が有効） */
  provider: Exclude<ShareProviderId, 'none'>;
  /** 同期開始をトリガーする（App 側で実行） */
  onStartSync: () => Promise<void>;
  /** 現在同期実行中か */
  syncing: boolean;
  /** 最新の進捗イベント（実行中のみ） */
  progress: ShareSyncProgress | null;
  /** 前回同期の結果（表示用） */
  lastResult: ShareSyncResult | null;
  /** 前回同期でのエラー */
  lastError: string | null;
}

const PROVIDER_LABEL: Record<Exclude<ShareProviderId, 'none'>, string> = {
  icloud: 'iCloud Drive',
  dropbox: 'Dropbox',
  gdrive: 'Google Drive',
};

const PHASE_LABEL: Record<ShareSyncProgress['phase'], string> = {
  start: '同期を開始しています',
  push: 'クラウドへアップロード中',
  pull: 'クラウドから取得中',
  skip: '変更なし',
  media: 'メディアを同期中',
  finalizing: 'マニフェスト書き込み中',
  done: '完了',
};

/**
 * サイドバーの「同期」モードで表示される共有状態パネル。
 * 先頭に「同期開始」ボタン、下にステータスと進捗表示。
 */
export default function SyncPanel({
  provider,
  onStartSync,
  syncing,
  progress,
  lastResult,
  lastError,
}: Props) {
  const [status, setStatus] = useState<ShareStatus | null>(null);

  // マウント時と同期完了時にステータス再取得
  useEffect(() => {
    let cancelled = false;
    void window.api.share
      .getStatus(provider)
      .then((st) => {
        if (!cancelled) setStatus(st);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [provider, lastResult]);

  const formatLastSync = (ms: number): string => {
    if (!ms) return '未同期';
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  };

  // プログレス率の算出
  let progressPercent = 0;
  let progressText = '';
  if (progress) {
    const total =
      'total' in progress && progress.total > 0 ? progress.total : 0;
    const current =
      'current' in progress ? progress.current : progress.phase === 'done' ? total : 0;
    progressPercent = total > 0 ? Math.round((current / total) * 100) : 0;
    if (progress.phase === 'push' || progress.phase === 'pull' || progress.phase === 'skip') {
      progressText = `${PHASE_LABEL[progress.phase]}: ${progress.noteTitle} (${current}/${total})`;
    } else if (progress.phase === 'start') {
      progressText = `${PHASE_LABEL.start} (対象 ${total} 件)`;
    } else if (progress.phase === 'media') {
      const kindLabel = progress.kind === 'images' ? '画像' : '添付ファイル';
      progressText = `${kindLabel}を同期中 (↑${progress.pushed} / ↓${progress.pulled} / 全${progress.total})`;
      progressPercent = 85 + (progress.kind === 'attachments' ? 7 : 0);
    } else if (progress.phase === 'finalizing') {
      progressText = PHASE_LABEL.finalizing;
      progressPercent = 99;
    } else if (progress.phase === 'done') {
      progressText = PHASE_LABEL.done;
      progressPercent = 100;
    }
  }

  return (
    <div className="sync-panel">
      {/* 先頭: 同期開始ボタン */}
      <div className="sync-panel__header">
        <button
          type="button"
          className="sync-panel__start-btn"
          onClick={() => void onStartSync()}
          disabled={syncing || !status?.available}
        >
          {syncing ? '同期中…' : '同期開始'}
        </button>
      </div>

      {/* ステータス情報 */}
      <div className="sync-panel__section">
        <div className="sync-panel__row">
          <span className="sync-panel__label">プロバイダ</span>
          <span className="sync-panel__value">{PROVIDER_LABEL[provider]}</span>
        </div>
        <div className="sync-panel__row">
          <span className="sync-panel__label">状態</span>
          <span
            className={`sync-panel__value ${status?.available ? 'is-ok' : 'is-warn'}`}
          >
            {status?.available ? '利用可能' : '未検出'}
          </span>
        </div>
        <div className="sync-panel__row">
          <span className="sync-panel__label">最終同期</span>
          <span className="sync-panel__value">
            {formatLastSync(status?.lastSync ?? 0)}
          </span>
        </div>
        <div className="sync-panel__row">
          <span className="sync-panel__label">クラウド件数</span>
          <span className="sync-panel__value">
            {status?.cloudNoteCount ?? 0} 件
          </span>
        </div>
        {status?.path && (
          <div className="sync-panel__row sync-panel__row--stack">
            <span className="sync-panel__label">フォルダ</span>
            <code className="sync-panel__path">{status.path}</code>
          </div>
        )}
      </div>

      {/* プログレス表示（実行中のみ） */}
      {syncing && (
        <div className="sync-panel__section">
          <div className="sync-panel__section-title">進捗</div>
          <div className="sync-panel__progress-bar">
            <div
              className="sync-panel__progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="sync-panel__progress-text">
            {progressText || '準備中…'}
          </div>
        </div>
      )}

      {/* 前回結果（実行中でない時） */}
      {!syncing && lastResult && (
        <div className="sync-panel__section">
          <div className="sync-panel__section-title">前回の結果</div>
          <dl className="sync-panel__result">
            <dt>ノート ↑</dt>
            <dd>{lastResult.pushed} 件</dd>
            <dt>ノート ↓</dt>
            <dd>{lastResult.pulled} 件</dd>
            <dt>変更なし</dt>
            <dd>{lastResult.unchanged} 件</dd>
            <dt>ノート合計</dt>
            <dd>{lastResult.total} 件</dd>
            {(lastResult.mediaPushed > 0 || lastResult.mediaPulled > 0) && (
              <>
                <dt>メディア ↑</dt>
                <dd>{lastResult.mediaPushed} 件</dd>
                <dt>メディア ↓</dt>
                <dd>{lastResult.mediaPulled} 件</dd>
              </>
            )}
          </dl>
        </div>
      )}

      {/* エラー表示 */}
      {!syncing && lastError && (
        <div className="sync-panel__section">
          <div className="sync-panel__error">{lastError}</div>
        </div>
      )}
    </div>
  );
}
