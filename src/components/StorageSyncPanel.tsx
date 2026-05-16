import { useEffect, useState } from 'react';
import { useT } from '../i18n';

interface SyncTarget {
  id: string;
  title: string;
  reason: 'missing' | 'newer';
}

interface ScanResult {
  storageRoot: string;
  dbNoteCount: number;
  diskFileCount: number;
  lastSync: number;
  dbToDiskTargets: SyncTarget[];
  diskToDbTargets: SyncTarget[];
}

interface Props {
  /** 同期完了後にノート一覧などを再取得するためのフック */
  onAfterSync?: () => void;
}

/** epoch ms を `YYYY/MM/DD HH:mm` 形式に。0 や 不正な値は never ラベル */
function formatLastSync(ms: number, neverLabel: string): string {
  if (!ms || ms <= 0) return neverLabel;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return neverLabel;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * サイドバーの「同期」モードに表示するパネル。
 * タイムスタンプベースの双方向同期:
 *  - DB.updated_at > lastSync → ディスクに書き出し
 *  - disk.updated_at > lastSync → DB に取り込み
 *  - どちらかにしか無い → 存在する側を真として反映
 */
export default function StorageSyncPanel({ onAfterSync }: Props) {
  const t = useT();
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    type: 'ok' | 'error';
    text: string;
  } | null>(null);

  const refresh = async () => {
    try {
      const result = await window.api.storage.scan();
      setScan(result);
    } catch (err) {
      setScan(null);
      setMessage({
        type: 'error',
        text:
          t.syncPanel.error.scanFailed +
          ': ' +
          (err instanceof Error ? err.message : String(err)),
      });
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleSync = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.api.storage.sync();
      setMessage({
        type: 'ok',
        text: t.syncPanel.okMessage
          .replace('{{saved}}', String(result.saved))
          .replace('{{imported}}', String(result.imported)),
      });
      await refresh();
      onAfterSync?.();
      window.dispatchEvent(new CustomEvent('inknel:notes-changed'));
    } catch (err) {
      setMessage({
        type: 'error',
        text:
          t.syncPanel.error.syncFailed +
          ': ' +
          (err instanceof Error ? err.message : String(err)),
      });
    } finally {
      setBusy(false);
    }
  };

  const dbToDiskCount = scan?.dbToDiskTargets.length ?? 0;
  const diskToDbCount = scan?.diskToDbTargets.length ?? 0;
  const diffCount = dbToDiskCount + diskToDbCount;
  const isInSync = scan !== null && diffCount === 0;

  return (
    <div className="storage-sync">
      {/* ヒーロー: HDD アイコン + 保存先パス + 最終同期日時 */}
      <section
        className={
          'storage-sync__hero' +
          (isInSync ? ' storage-sync__hero--ok' : '')
        }
      >
        <div className="storage-sync__hero-icon">
          <HddIcon spinning={busy} />
        </div>
        <div className="storage-sync__hero-meta">
          <div className="storage-sync__hero-label">
            {t.syncPanel.hero.storageLabel}
          </div>
          {scan ? (
            <div
              className="storage-sync__hero-path"
              title={scan.storageRoot}
            >
              {scan.storageRoot}
            </div>
          ) : (
            <div className="storage-sync__hero-path is-loading">
              {t.syncPanel.hero.scanning}
            </div>
          )}
          {scan && (
            <div className="storage-sync__hero-status">
              {isInSync ? (
                <>
                  <CheckIcon />
                  <span>{t.syncPanel.hero.synced}</span>
                </>
              ) : (
                <>
                  <DiffIcon />
                  <span>
                    {t.syncPanel.hero.diffCount.replace(
                      '{{count}}',
                      String(diffCount),
                    )}
                  </span>
                </>
              )}
              <span className="storage-sync__hero-divider">·</span>
              <span className="storage-sync__hero-last-sync">
                {t.syncPanel.hero.lastSyncPrefix}
                {formatLastSync(
                  scan.lastSync,
                  t.syncPanel.hero.lastSyncNever,
                )}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* 統計カード */}
      {scan && (
        <section className="storage-sync__stats">
          <div className="storage-sync__stat">
            <div className="storage-sync__stat-icon">
              <DbIcon />
            </div>
            <div className="storage-sync__stat-value">{scan.dbNoteCount}</div>
            <div className="storage-sync__stat-label">
              {t.syncPanel.stat.dbNotes}
            </div>
          </div>
          <div className="storage-sync__stat">
            <div className="storage-sync__stat-icon">
              <FileIcon />
            </div>
            <div className="storage-sync__stat-value">
              {scan.diskFileCount}
            </div>
            <div className="storage-sync__stat-label">
              {t.syncPanel.stat.mdFiles}
            </div>
          </div>
          <div
            className={
              'storage-sync__stat' +
              (diffCount > 0 ? ' storage-sync__stat--warn' : '')
            }
          >
            <div className="storage-sync__stat-icon">
              <DiffIcon />
            </div>
            <div className="storage-sync__stat-value">{diffCount}</div>
            <div className="storage-sync__stat-label">
              {t.syncPanel.stat.diff}
            </div>
          </div>
        </section>
      )}

      {/* アクション */}
      <section className="storage-sync__actions">
        <button
          type="button"
          className="storage-sync__sync-btn"
          onClick={() => void handleSync()}
          disabled={busy || !scan}
        >
          {busy ? (
            <>
              <SpinnerIcon />
              <span>{t.syncPanel.action.syncing}</span>
            </>
          ) : (
            <>
              <SyncIcon />
              <span>{t.syncPanel.action.syncBtn}</span>
            </>
          )}
        </button>
        <button
          type="button"
          className="storage-sync__rescan-btn"
          onClick={() => void refresh()}
          disabled={busy}
          title={t.syncPanel.action.scanTitle}
          aria-label={t.syncPanel.action.scanAriaLabel}
        >
          <RescanIcon />
          <span>{t.syncPanel.action.scanBtn}</span>
        </button>
      </section>

      {/* ステータスメッセージ */}
      {message && (
        <div
          className={
            'storage-sync__message' +
            (message.type === 'error'
              ? ' storage-sync__message--error'
              : ' storage-sync__message--ok')
          }
          role={message.type === 'error' ? 'alert' : 'status'}
        >
          {message.type === 'ok' ? <CheckIcon /> : <ErrorIcon />}
          <span>{message.text}</span>
        </div>
      )}

      {/* 更新対象リスト */}
      {scan && (dbToDiskCount > 0 || diskToDbCount > 0) && (
        <section className="storage-sync__targets">
          {dbToDiskCount > 0 && (
            <TargetList
              title={t.syncPanel.targets.writeOut}
              direction="up"
              targets={scan.dbToDiskTargets}
            />
          )}
          {diskToDbCount > 0 && (
            <TargetList
              title={t.syncPanel.targets.importIn}
              direction="down"
              targets={scan.diskToDbTargets}
            />
          )}
        </section>
      )}

      {/* ヘルプ */}
      <p className="storage-sync__help">
        <InfoIcon />
        <span>{t.syncPanel.help.paragraph}</span>
      </p>
    </div>
  );
}

interface TargetListProps {
  title: string;
  direction: 'up' | 'down';
  targets: SyncTarget[];
}

function TargetList({ title, direction, targets }: TargetListProps) {
  const tt = useT();
  return (
    <div className="storage-sync__target-section">
      <div className="storage-sync__target-header">
        {direction === 'up' ? <ArrowUpIcon /> : <ArrowDownIcon />}
        <span className="storage-sync__target-title">{title}</span>
        <span className="storage-sync__target-count">{targets.length}</span>
      </div>
      <ul className="storage-sync__target-list">
        {targets.map((target) => (
          <li
            key={target.id}
            className="storage-sync__target-item"
            title={target.title}
          >
            <span
              className={
                'storage-sync__target-badge' +
                (target.reason === 'newer'
                  ? ' storage-sync__target-badge--newer'
                  : ' storage-sync__target-badge--missing')
              }
            >
              {target.reason === 'newer'
                ? tt.syncPanel.targets.badgeNewer
                : tt.syncPanel.targets.badgeMissing}
            </span>
            <span className="storage-sync__target-name">
              {target.title || tt.common.untitled}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----- 各種アイコン（line / fill 統一して currentColor で塗る） ----- */

function HddIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={spinning ? 'activity__icon--spinning' : undefined}
    >
      <rect x="3" y="5" width="18" height="6" rx="1.2" />
      <rect x="3" y="13" width="18" height="6" rx="1.2" />
      <circle cx="17.5" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="16" r="0.9" fill="currentColor" stroke="none" />
      <line x1="6" y1="8" x2="13" y2="8" />
      <line x1="6" y1="16" x2="13" y2="16" />
    </svg>
  );
}

function DbIcon() {
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
      aria-hidden="true"
    >
      <ellipse cx="12" cy="5" rx="8" ry="2.5" />
      <path d="M4 5 V12 C4 13.4 7.6 14.5 12 14.5 S20 13.4 20 12 V5" />
      <path d="M4 12 V19 C4 20.4 7.6 21.5 12 21.5 S20 20.4 20 19 V12" />
    </svg>
  );
}

function FileIcon() {
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
      aria-hidden="true"
    >
      <path d="M5 3 h9 L19 8 v12 a1 1 0 0 1 -1 1 H5 a1 1 0 0 1 -1 -1 V4 a1 1 0 0 1 1 -1 z" />
      <path d="M14 3 v5 h5" />
      <path d="M8 13 h7 M8 16.5 h7" />
    </svg>
  );
}

function DiffIcon() {
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
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <circle cx="12" cy="16" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="5 12 10 17 19 7" />
    </svg>
  );
}

function ErrorIcon() {
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
      <circle cx="12" cy="12" r="9" />
      <line x1="9" y1="9" x2="15" y2="15" />
      <line x1="15" y1="9" x2="9" y2="15" />
    </svg>
  );
}

function ArrowUpIcon() {
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
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function ArrowDownIcon() {
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
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="5 12 12 19 19 12" />
    </svg>
  );
}

function SyncIcon() {
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
      aria-hidden="true"
    >
      <path d="M21 12 a9 9 0 0 1 -15 6.7 L3 16" />
      <polyline points="3 21 3 16 8 16" />
      <path d="M3 12 a9 9 0 0 1 15 -6.7 L21 8" />
      <polyline points="21 3 21 8 16 8" />
    </svg>
  );
}

function RescanIcon() {
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
      aria-hidden="true"
    >
      <path d="M3 12 a9 9 0 1 0 3.5 -7" />
      <polyline points="3 4 3 9 8 9" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
      className="activity__icon--spinning"
    >
      <path d="M12 3 a9 9 0 1 0 9 9" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}
