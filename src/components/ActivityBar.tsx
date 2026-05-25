import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { getEnabledPlugins } from '../plugins/registry';
import { subscribeRuntimePlugins } from '../plugins/runtimeLoader';

/**
 * サイドバーのモード ID。本体組み込みは 'files' / 'search' / 'tags' /
 * 'history' / 'sync'。プラグインが activityBarItem.mode で任意の文字列を
 * 宣言すれば、その mode もここに乗る（型としては string で受ける）。
 */
export type SidebarMode = string;

interface Props {
  sidebarMode: SidebarMode;
  onSelectFiles: () => void;
  onSelectSearch: () => void;
  onSelectTags: () => void;
  /** 履歴ボタン押下時のコールバック。未指定なら履歴ボタンは非表示 */
  onSelectHistory?: () => void;
  /** カレンダーボタン押下時のコールバック (組み込み機能) */
  onSelectCalendar: () => void;
  /** カレンダーボタンを表示するか (設定の calendarEnabled) */
  calendarEnabled?: boolean;
  /** 履歴ボタンを表示するか（設定の historyEnabled） */
  historyEnabled?: boolean;
  /** 有効化中プラグインの enabledPlugins 配列 */
  enabledPlugins: readonly string[];
  /** プラグイン由来のサイドバーモードへ切り替えるコールバック */
  onSelectPluginMode: (mode: string) => void;
  onOpenSettings: () => void;
  /** 保存先（ストレージ）ボタン押下時のコールバック */
  onSelectStorage: () => void;
  /** 同期中ローディング表示 */
  sharing: boolean;
  /**
   * クラウド同期の進捗 %。null/undefined ならリング非表示。
   * 0-100 のとき保存先アイコンの外周にプログレスリングを描画する。
   * 進捗反映と完了後の保持・フェードアウトは App.tsx 側で管理する。
   */
  syncProgressPercent?: number | null;
}

interface IconButtonProps {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  /**
   * 円形プログレスリングをアイコンの外周に描画する。
   * - null/undefined: リング非表示 (アイドル)
   * - 0..100: その % だけ円弧を埋める
   * クラウド同期の進捗表示に使う (保存先アイコン専用想定)。
   */
  progressPercent?: number | null;
}

function IconButton({
  active,
  label,
  onClick,
  children,
  progressPercent,
}: IconButtonProps) {
  const showRing =
    typeof progressPercent === 'number' && Number.isFinite(progressPercent);
  // SVG 円弧: viewBox 32, radius 14 (= 直径 28 でアイコン 22px 周りに少しだけ余白)
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const pct = showRing
    ? Math.max(0, Math.min(100, progressPercent as number))
    : 0;
  const dashOffset = circumference * (1 - pct / 100);
  return (
    <button
      type="button"
      className={`activity__btn ${active ? 'is-active' : ''}`}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      {showRing && (
        <svg
          className="activity__ring"
          viewBox="0 0 32 32"
          width="32"
          height="32"
          aria-hidden="true"
        >
          {/* 背景の薄い円 (どの程度進んでいるか直感的に見せるための土台) */}
          <circle
            cx="16"
            cy="16"
            r={radius}
            fill="none"
            className="activity__ring-track"
          />
          {/* 進捗部分。 -90deg 回転で 12 時方向から時計回りに伸びる。 */}
          <circle
            cx="16"
            cy="16"
            r={radius}
            fill="none"
            className="activity__ring-fill"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 16 16)"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </svg>
      )}
      <span className="activity__btn-inner">{children}</span>
    </button>
  );
}

export default function ActivityBar({
  sidebarMode,
  onSelectFiles,
  onSelectSearch,
  onSelectTags,
  onSelectHistory,
  onSelectCalendar,
  calendarEnabled,
  historyEnabled,
  enabledPlugins,
  onSelectPluginMode,
  onOpenSettings,
  onSelectStorage,
  sharing,
  syncProgressPercent,
}: Props) {
  const t = useT();
  const filesActive = sidebarMode === 'files';
  const searchActive = sidebarMode === 'search';
  const tagsActive = sidebarMode === 'tags';
  const historyActive = sidebarMode === 'history';
  const calendarActive = sidebarMode === 'calendar';
  const syncActive = sidebarMode === 'sync';
  const showHistory = !!historyEnabled && !!onSelectHistory;
  // calendarEnabled が undefined のときは「既定: 表示」(後方互換)
  const showCalendar = calendarEnabled !== false;

  // ===== プラグイン由来のアクティビティバーアイテム =====
  // 有効化中プラグインから `activityBarItem` を持つものを集めて
  // 自動的にアイコンボタンを並べる。本体はアイテム名を知らない。
  const [pluginRev, setPluginRev] = useState(0);
  useEffect(
    () => subscribeRuntimePlugins(() => setPluginRev((r) => r + 1)),
    [],
  );
  const pluginItems = useMemo(() => {
    const enabled = getEnabledPlugins(enabledPlugins);
    return enabled
      .map((p) => p.module.activityBarItem)
      .filter(
        (item): item is NonNullable<typeof item> => item !== undefined,
      )
      // 'calendar' は組み込み機能化されたので、旧 calendar プラグインが
      // CDN 経由で残っていても重複してボタンを描画しない。
      .filter((item) => item.mode !== 'calendar');
    // pluginRev は subscribeRuntimePlugins の通知で更新される
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledPlugins, pluginRev]);

  return (
    <nav className="activity" aria-label={t.activity.barLabel}>
      <div className="activity__group activity__group--top">
        <IconButton
          label={t.activity.files}
          active={filesActive}
          onClick={onSelectFiles}
        >
          <FileIcon />
        </IconButton>
        <IconButton
          label={t.activity.search}
          active={searchActive}
          onClick={onSelectSearch}
        >
          <SearchIcon />
        </IconButton>
        <IconButton
          label={t.activity.tags}
          active={tagsActive}
          onClick={onSelectTags}
        >
          <TagIcon />
        </IconButton>
        {showHistory && (
          <IconButton
            label={t.activity.history}
            active={historyActive}
            onClick={onSelectHistory!}
          >
            <HistoryIcon />
          </IconButton>
        )}
        {showCalendar && (
          <IconButton
            label={t.activity.calendar}
            active={calendarActive}
            onClick={onSelectCalendar}
          >
            <CalendarIcon />
          </IconButton>
        )}
        {pluginItems.map((item) => (
          <IconButton
            key={item.mode}
            label={item.label}
            active={sidebarMode === item.mode}
            onClick={() => onSelectPluginMode(item.mode)}
          >
            <item.Icon />
          </IconButton>
        ))}
      </div>
      <div className="activity__group activity__group--bottom">
        <IconButton
          // 同期中はラベルを「保存先 (同期中 XX%)」に動的更新し、ホバーで
          // 進捗を読み取れるようにする (aria-label にもこの文字列が反映される)
          label={
            typeof syncProgressPercent === 'number'
              ? `${t.activity.syncStorage} (${t.activity.syncing} ${Math.round(syncProgressPercent)}%)`
              : t.activity.syncStorage
          }
          active={syncActive}
          onClick={onSelectStorage}
          progressPercent={syncProgressPercent ?? null}
        >
          {/* 進捗リング導入後はアイコンのスピンは廃止。状態は外周リングで表現する。 */}
          <HddIcon spinning={false} />
        </IconButton>
        <IconButton label={t.activity.settings} onClick={onOpenSettings}>
          <SettingsIcon />
        </IconButton>
      </div>
    </nav>
  );
}

// ----- 24x24 SVGアイコン（線画スタイル、currentColor で色追従） -----

function FileIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 3 h9 L19 8 v12 a1 1 0 0 1 -1 1 H5 a1 1 0 0 1 -1 -1 V4 a1 1 0 0 1 1 -1 z" />
      <path d="M14 3 v5 h5" />
      <path d="M8 13 h7 M8 16.5 h7 M8 20 h4" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 L20 20" />
    </svg>
  );
}

/** タグ（値札）アイコン */
function TagIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12 L12 3 H21 V12 L12 21 Z" />
      <circle cx="16.5" cy="7.5" r="1.3" />
    </svg>
  );
}

/** 履歴（時計と反時計回り矢印）アイコン */
function HistoryIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* 反時計回りの巻き戻しを示す上端の矢印 */}
      <path d="M3 5 v4 h4" />
      <path d="M3.5 9 A9 9 0 1 1 3 13" />
      {/* 時計の針 */}
      <path d="M12 7.5 V12 l3 2" />
    </svg>
  );
}

/** HDD（外部ストレージ / 保存先）アイコン。spinning=true で回転 */
function HddIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={spinning ? 'activity__icon--spinning' : undefined}
    >
      {/* 上下に積み重なった HDD 筐体 */}
      <rect x="3" y="5" width="18" height="6" rx="1.2" />
      <rect x="3" y="13" width="18" height="6" rx="1.2" />
      {/* 各筐体右側のステータス LED */}
      <circle cx="17.5" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="16" r="0.9" fill="currentColor" stroke="none" />
      {/* 通気スリット */}
      <line x1="6" y1="8" x2="13" y2="8" />
      <line x1="6" y1="16" x2="13" y2="16" />
    </svg>
  );
}

/** クラウド同期（共有）アイコン（旧。現在未使用） */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ShareIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={spinning ? 'activity__icon--spinning' : undefined}
    >
      {/* クラウドのアウトライン */}
      <path d="M6 16 a4 4 0 0 1 0.5 -7.95 a5 5 0 0 1 9.9 -0.5 a4.5 4.5 0 0 1 1.1 8.45 H6 z" />
      {/* 上下の同期矢印 */}
      <path d="M10 13 L10 17 L8 15 M10 17 L12 15" />
      <path d="M14 17 L14 13 L16 15 M14 13 L12 15" />
    </svg>
  );
}

/** カレンダーアイコン (組み込みカレンダー機能用) */
function CalendarIcon() {
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
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="8" y1="3" x2="8" y2="5" />
      <line x1="16" y1="3" x2="16" y2="5" />
    </svg>
  );
}

/** ギア（歯車）型の設定アイコン */
function SettingsIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19.43 12.98a7.78 7.78 0 0 0 0-1.96l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.6-.22l-2.49 1a7.7 7.7 0 0 0-1.69-.98l-.38-2.65A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.42l-.38 2.65c-.6.24-1.17.57-1.69.98l-2.49-1a.5.5 0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65a7.78 7.78 0 0 0 0 1.96l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46a.5.5 0 0 0 .6.22l2.49-1c.52.41 1.09.74 1.69.98l.38 2.65c.05.24.26.42.5.42h4c.24 0 .45-.18.5-.42l.38-2.65c.6-.24 1.17-.57 1.69-.98l2.49 1a.5.5 0 0 0 .6-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
