import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import MarkdownIt from 'markdown-it';
import {
  highlightCode,
  resolveHighlightLangId,
} from '../utils/highlight';
import { getEnabledPlugins } from '../plugins/registry';
import { subscribeRuntimePlugins } from '../plugins/runtimeLoader';

interface Props {
  value: string;
  /** TagBar で設定された、このノートに紐づくタグ一覧（プレビュー先頭に表示） */
  tags?: string[];
  /** コードブロックのコピーボタンを常に表示するか（false ならホバー時のみ） */
  codeCopyAlwaysVisible?: boolean;
  /** コードブロックに行番号を表示するか */
  showLineNumbers?: boolean;
  /** シンタックスハイライトを適用する言語の id 一覧 */
  enabledHighlightLangs?: string[];
  /** 有効化されているプラグイン ID の一覧（registry にあるもののみ実行される） */
  enabledPlugins?: string[];
  /** プラグインに渡す UI テーマ（テーマ追従するプラグイン用） */
  theme?: 'dark' | 'light';
  /**
   * プレビュー上の操作で本文を更新した時に呼ばれる（タスクリストのチェック切替）。
   * 渡されない場合はチェックボックスは表示されるがクリックしても変化しない。
   */
  onChange?: (next: string) => void;
  /**
   * プレビュー領域がスクロールされたとき呼ばれる。MIX モードの同期スクロール用。
   * スクロール要素自体を渡すので、scrollTop / scrollHeight / clientHeight を直接参照可能。
   */
  onScroll?: (scrollEl: HTMLElement) => void;
}

/**
 * ハイライト済み HTML（または escapeHtml 済みプレーン）を行ごとに分割し、
 * 各行を `<span class="hljs-line">...</span>` で包んだ HTML を返す。
 *
 * 複数行にまたがる span（多行コメントや複数行文字列）を壊さないため、
 * 各行末で開いている span を一旦閉じ、次行頭で同じ属性で開き直す。
 */
function wrapLinesForLineNumbers(html: string): string {
  const rawLines = html.split('\n');
  // マークダウンのコードブロックは末尾に `\n` が付くことが多く、
  // split の結果、末尾に空文字列が 1 個生まれる。これをそのまま行に変換すると
  // 「存在しない余分な行」が最後に表示されるため、末尾の空要素を 1 つ削る。
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }
  const result: string[] = [];
  // 各行の境界で「現在開いている span 開始タグ」のスタックを保持
  let openTagStack: string[] = [];
  const tagRe = /<\/?span[^>]*>/g;

  for (const rawLine of rawLines) {
    const prefix = openTagStack.join('');

    // この行のタグを処理して新しいスタック状態を計算
    const newStack = [...openTagStack];
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(rawLine)) !== null) {
      const tag = m[0];
      if (tag.startsWith('</')) {
        newStack.pop();
      } else {
        newStack.push(tag);
      }
    }
    tagRe.lastIndex = 0;

    const suffix = '</span>'.repeat(newStack.length);
    // 空行は &nbsp; を入れて高さを確保
    const inner = rawLine.length === 0 && newStack.length === 0
      ? '&#8203;'
      : prefix + rawLine + suffix;
    result.push(`<span class="hljs-line">${inner}</span>`);
    openTagStack = newStack;
  }

  // 各 .hljs-line は display:block なので、結合は改行なしで OK
  // （改行を入れると <pre> の white-space:pre で二重改行になる）
  return result.join('');
}

/**
 * 見出しテキストから anchor 用の slug を生成する。
 * - 空白 (半角・全角) → ハイフン
 * - ASCII 記号は削除
 * - 大文字 → 小文字
 * - 日本語・絵文字はそのまま保持
 *
 * クリック時の id 解決と heading レンダリング両方で使うので
 * モジュールレベルに置く。
 */
function slugifyForAnchor(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '-')
    .replace(/[!-/:-@[-`{-~]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * 本文中の N 番目のタスクリスト行（`- [ ]` / `- [x]`）の状態をトグルした
 * 新しい本文文字列を返す。コードブロック内は無視。
 */
function toggleTaskInBody(body: string, taskIndex: number): string {
  const lines = body.split('\n');
  let count = 0;
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    // リスト記号 + " [x] " or " [ ] " のパターン
    const m = /^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\](\s)/.exec(line);
    if (!m) continue;
    if (count === taskIndex) {
      const newChar = m[2].toLowerCase() === 'x' ? ' ' : 'x';
      lines[i] =
        line.slice(0, m[1].length) +
        '[' +
        newChar +
        ']' +
        line.slice(m[1].length + 3);
      return lines.join('\n');
    }
    count++;
  }
  return body;
}

export interface PreviewHandle {
  /** プレビューのスクロール要素を返す。MIX モードのスクロール同期で使用。 */
  getScrollElement(): HTMLElement | null;
}

const Preview = forwardRef<PreviewHandle, Props>(function Preview(
  {
    value,
    tags,
    codeCopyAlwaysVisible,
    showLineNumbers,
    enabledHighlightLangs,
    enabledPlugins,
    theme,
    onChange,
    onScroll,
  },
  forwardedRef,
) {
  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;
  // ランタイムプラグインの登録/解除を購読し再レンダリングを誘発するための tick
  const [runtimeRev, setRuntimeRev] = useState(0);
  useEffect(
    () => subscribeRuntimePlugins(() => setRuntimeRev((r) => r + 1)),
    [],
  );
  // 有効化中のプラグインを registry から解決。実体が無い ID は除外される
  const activePlugins = useMemo(
    () => getEnabledPlugins(enabledPlugins ?? []),
    [enabledPlugins, runtimeRev],
  );
  // fence renderer 用に "言語 → プラグイン" の早見表
  const fenceProviders = useMemo(
    () => activePlugins.filter((p) => typeof p.module.renderFence === 'function'),
    [activePlugins],
  );
  // 有効な言語の Set を作って fence ルールから参照
  const enabledLangSet = useMemo(
    () => new Set(enabledHighlightLangs ?? []),
    [enabledHighlightLangs],
  );
  // 行番号有効フラグも fence renderer がクロージャで掴むので useMemo の依存にする
  const lineNumbersEnabled = showLineNumbers === true;
  const md = useMemo(() => {
    const instance = new MarkdownIt({
      html: false,
      linkify: true,
      breaks: true,
    });

    // ----- 見出しに自動で id を付与（アンカーリンク用） -----
    // 見出しテキストから "slug" を生成し、heading_open に id 属性を追加する。
    // 同じ slug が複数あれば -2, -3 等のサフィックスを付ける。
    const slugify = slugifyForAnchor;
    const defaultHeadingOpenRule =
      instance.renderer.rules.heading_open ??
      ((tokens, idx, opts, _env, self) =>
        self.renderToken(tokens, idx, opts));

    instance.renderer.rules.heading_open = (tokens, idx, opts, env, self) => {
      const inlineToken = tokens[idx + 1];
      if (inlineToken && inlineToken.type === 'inline') {
        const text = inlineToken.content;
        const baseSlug = slugify(text);
        if (baseSlug) {
          // env に slug カウンターを保持して重複時にサフィックス付与
          const used = (env.headingSlugs ??= new Map<string, number>());
          let slug = baseSlug;
          if (used.has(baseSlug)) {
            const n = used.get(baseSlug)! + 1;
            used.set(baseSlug, n);
            slug = `${baseSlug}-${n}`;
          } else {
            used.set(baseSlug, 1);
          }
          tokens[idx].attrJoin('id', slug);
        }
      }
      return defaultHeadingOpenRule(tokens, idx, opts, env, self);
    };

    // 画像 src の書き換え:
    //   "images/<sha256>.<ext>" → "inknel-image://<sha256>.<ext>"
    // それ以外（http(s):, data:, file:, 既に inknel-image: など）はそのまま
    const defaultImageRule =
      instance.renderer.rules.image ??
      ((tokens, idx, opts, _env, self) =>
        self.renderToken(tokens, idx, opts));

    instance.renderer.rules.image = (tokens, idx, opts, env, self) => {
      const token = tokens[idx];
      const srcIdx = token.attrIndex('src');
      if (srcIdx >= 0 && token.attrs) {
        const src = token.attrs[srcIdx][1];
        // images/<hash>.<ext> 形式のみ書き換え（パス trasversal は受け付けない）
        if (/^images\/[a-f0-9]{64}\.[a-z0-9]{2,5}$/i.test(src)) {
          const filename = src.slice('images/'.length);
          token.attrs[srcIdx][1] = `inknel-image://${filename}`;
        }
      }
      return defaultImageRule(tokens, idx, opts, env, self);
    };

    // ----- コード（fenced / インデント / インライン）にコピーボタンを埋め込む -----
    // クリック時のハンドラは renderer 側ではなく、上位の handleClick で
    // [data-copy-code] への delegation で処理する。
    // コード本体は data 属性に encodeURIComponent して格納（XSS / 引用符問題を回避）。
    const escapeHtml = instance.utils.escapeHtml;

    // コピー前/コピー後のアイコン (16x16 線画 SVG)。
    // .is-copied クラスで表示が切り替わる。
    const COPY_ICON_SVG =
      '<svg class="code-copy-btn__icon code-copy-btn__icon--copy" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="5" y="5" width="9" height="9" rx="1.4"/>' +
      '<path d="M11 5 V3.4 a1 1 0 0 0 -1 -1 H3.4 a1 1 0 0 0 -1 1 V10 a1 1 0 0 0 1 1 H5"/>' +
      '</svg>';
    const CHECK_ICON_SVG =
      '<svg class="code-copy-btn__icon code-copy-btn__icon--check" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 8.5 L6.5 12 L13 4.5"/>' +
      '</svg>';

    const renderCopyBtn = (code: string, inline: boolean): string => {
      const encoded = encodeURIComponent(code);
      const cls = inline
        ? 'code-copy-btn code-copy-btn--inline'
        : 'code-copy-btn';
      return (
        `<button type="button" class="${cls}" data-copy-code="${encoded}"` +
        ` title="コードをコピー" aria-label="コードをコピー">` +
        COPY_ICON_SVG +
        CHECK_ICON_SVG +
        `</button>`
      );
    };

    instance.renderer.rules.fence = (tokens, idx) => {
      const token = tokens[idx];
      const code = token.content;
      const rawLang = token.info.trim().split(/\s+/)[0];

      // ----- プラグインの fence renderer に委譲を試みる -----
      // 有効化されているプラグインを順に試し、null 以外を返した最初のものを採用。
      // 該当無しなら通常の fence 処理へフォールスルー。
      for (const plugin of fenceProviders) {
        const out = plugin.module.renderFence!({
          code,
          lang: rawLang,
          escapeHtml,
        });
        if (out != null) return out;
      }

      // 設定で有効化されている言語ならハイライトを適用
      const langId = resolveHighlightLangId(rawLang);
      let codeHtml: string;
      let codeClass: string;
      if (langId && enabledLangSet.has(langId)) {
        const highlighted = highlightCode(code, langId);
        if (highlighted !== null) {
          codeHtml = highlighted;
          codeClass = ` class="hljs language-${escapeHtml(langId)}"`;
        } else {
          codeHtml = escapeHtml(code);
          codeClass = ` class="language-${escapeHtml(langId)}"`;
        }
      } else {
        codeHtml = escapeHtml(code);
        codeClass = rawLang
          ? ` class="language-${escapeHtml(rawLang)}"`
          : '';
      }

      // 行番号モード: 各行を <span class="hljs-line"> で包み、code に with-line-numbers クラス
      let codeClassFinal = codeClass;
      if (lineNumbersEnabled) {
        codeHtml = wrapLinesForLineNumbers(codeHtml);
        codeClassFinal = codeClass
          ? codeClass.replace(/"$/, ' with-line-numbers"')
          : ' class="with-line-numbers"';
      }

      const langLabel = rawLang
        ? `<span class="code-block-wrap__lang">${escapeHtml(rawLang)}</span>`
        : '';
      return (
        `<div class="code-block-wrap">` +
        `${langLabel}` +
        `${renderCopyBtn(code, false)}` +
        `<pre><code${codeClassFinal}>${codeHtml}</code></pre>` +
        `</div>`
      );
    };

    instance.renderer.rules.code_block = (tokens, idx) => {
      const code = tokens[idx].content;
      let codeHtml = escapeHtml(code);
      let codeClassAttr = '';
      if (lineNumbersEnabled) {
        codeHtml = wrapLinesForLineNumbers(codeHtml);
        codeClassAttr = ' class="with-line-numbers"';
      }
      return (
        `<div class="code-block-wrap">` +
        `${renderCopyBtn(code, false)}` +
        `<pre><code${codeClassAttr}>${codeHtml}</code></pre>` +
        `</div>`
      );
    };

    instance.renderer.rules.code_inline = (tokens, idx) => {
      const code = tokens[idx].content;
      return (
        `<span class="code-inline-wrap">` +
        `<code>${escapeHtml(code)}</code>` +
        `${renderCopyBtn(code, true)}` +
        `</span>`
      );
    };

    // ----- タスクリスト変換 -----
    // list_item_open に続く inline トークンの content 先頭が `[ ]` / `[x]` の場合、
    // それを <input type="checkbox"> に置き換え、トラッキング用の data-task-index を付与する。
    instance.core.ruler.after('inline', 'task-list', (state) => {
      let taskIdx = 0;
      const tokens = state.tokens;
      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].type !== 'list_item_open') continue;

        // list_item_open の直後にある inline トークンを探す
        // 通常は list_item_open → paragraph_open → inline → ...
        let inlineToken = null;
        for (let j = i + 1; j < tokens.length; j++) {
          if (tokens[j].type === 'list_item_close') break;
          if (tokens[j].type === 'inline') {
            inlineToken = tokens[j];
            break;
          }
        }
        if (!inlineToken) continue;

        const m = /^\[([ xX])\]\s+/.exec(inlineToken.content);
        if (!m) continue;

        const checked = m[1].toLowerCase() === 'x';
        const idx = taskIdx++;
        const stripLen = m[0].length;

        // list_item_open に class を追加（CSS でリストマーカーを消すため）
        tokens[i].attrJoin('class', 'task-list-item');

        // inline.content から先頭のマーカー部分を除去
        inlineToken.content = inlineToken.content.slice(stripLen);

        // children の text トークンの先頭からも同じ長さだけ除去
        if (inlineToken.children && inlineToken.children.length > 0) {
          let remaining = stripLen;
          for (const child of inlineToken.children) {
            if (remaining <= 0) break;
            if (child.type === 'text') {
              const cut = Math.min(remaining, child.content.length);
              child.content = child.content.slice(cut);
              remaining -= cut;
            } else {
              break;
            }
          }

          // 先頭にチェックボックスの html_inline トークンを差し込む
          const checkbox = new state.Token('html_inline', '', 0);
          checkbox.content =
            `<input type="checkbox" class="task-list-checkbox"` +
            ` data-task-index="${idx}"` +
            (checked ? ' checked' : '') +
            `>`;
          inlineToken.children.unshift(checkbox);
        }
      }
    });

    return instance;
    // enabledLangSet / lineNumbersEnabled / fenceProviders が変わったら再生成
    // （fence ルールがクロージャで掴むため）
  }, [enabledLangSet, lineNumbersEnabled, fenceProviders]);

  const html = useMemo(() => md.render(value), [md, value]);

  // ----- プラグインの post-render フック -----
  // 各プラグインの resetInPreview → renderInPreview を順に呼ぶ。
  // テーマや本文 (html) が変わったタイミングで再実行する。
  const previewRef = useRef<HTMLDivElement | null>(null);
  useImperativeHandle(
    forwardedRef,
    () => ({
      getScrollElement() {
        return previewRef.current;
      },
    }),
    [],
  );
  // プレビュー要素のスクロールを購読し、親 (App) に通知する。
  // MIX モードでのみ親で利用されるが、購読自体は常に張っても害はない。
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const handler = () => onScrollRef.current?.(el);
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
  }, []);
  const pluginTheme: 'dark' | 'light' = theme === 'light' ? 'light' : 'dark';
  // プラグインが本文を編集する用 (例: マインドマップ) に getBody/setBody を渡す。
  // ref 経由で最新値を返し、毎回新しい関数参照にしない (useEffect の依存安定化)。
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (activePlugins.length === 0) return;
    const root = previewRef.current;
    if (!root) return;
    let cancelled = false;
    const ctx = {
      theme: pluginTheme,
      getBody: () => valueRef.current,
      setBody: onChange
        ? (next: string) => onChangeRef.current?.(next)
        : undefined,
    };
    void (async () => {
      for (const plugin of activePlugins) {
        if (cancelled) return;
        try {
          plugin.module.resetInPreview?.(root);
          await plugin.module.renderInPreview?.(root, ctx);
        } catch (err) {
          console.error(
            `[plugin:${plugin.id}] renderInPreview failed`,
            err,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [html, activePlugins, pluginTheme, onChange]);

  // ----- ライトボックス（クリックで拡大表示） -----
  const [zoomedSrc, setZoomedSrc] = useState<string | null>(null);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    // -1) タスクリストのチェックボックス: 本文側をトグルして再描画させる
    if (
      target instanceof HTMLInputElement &&
      target.classList.contains('task-list-checkbox')
    ) {
      const indexAttr = target.getAttribute('data-task-index');
      if (indexAttr !== null && onChange) {
        // ブラウザの自動トグルを止め、本文側を更新（戻ってきた本文で正しい状態が描画される）
        e.preventDefault();
        const idx = Number.parseInt(indexAttr, 10);
        if (Number.isFinite(idx)) {
          onChange(toggleTaskInBody(value, idx));
        }
      }
      return;
    }

    // 0) コピーボタン: コード内容をクリップボードへ
    const copyBtn = target.closest('[data-copy-code]') as HTMLButtonElement | null;
    if (copyBtn) {
      e.preventDefault();
      e.stopPropagation();
      const encoded = copyBtn.getAttribute('data-copy-code') ?? '';
      let code = '';
      try {
        code = decodeURIComponent(encoded);
      } catch {
        code = encoded;
      }
      void navigator.clipboard
        .writeText(code)
        .then(() => {
          copyBtn.classList.add('is-copied');
          copyBtn.setAttribute('aria-label', 'コピーしました');
          window.setTimeout(() => {
            copyBtn.classList.remove('is-copied');
            copyBtn.setAttribute('aria-label', 'コードをコピー');
          }, 1500);
        })
        .catch(() => {
          copyBtn.classList.add('is-failed');
          window.setTimeout(() => {
            copyBtn.classList.remove('is-failed');
          }, 1500);
        });
      return;
    }

    // 1) 先にアンカー判定（画像内アンカー = サムネイル付き添付リンクに対応）
    const anchor = target.closest('a');
    if (anchor) {
      const href = anchor.getAttribute('href') ?? '';
      // 添付ファイル: attachments/<hash>.<ext> → OS既定アプリで開く
      const attMatch = href.match(/^attachments\/([a-f0-9]{64}\.[a-z0-9]{2,5})$/i);
      if (attMatch) {
        e.preventDefault();
        const filename = attMatch[1];
        void window.api.attachments.open(filename).catch((err) => {
          window.alert(
            err instanceof Error
              ? err.message
              : 'ファイルを開けませんでした',
          );
        });
        return;
      }
      // 外部URL: 既定ブラウザで開く（レンダラ内遷移を防ぐ）
      if (/^https?:\/\//i.test(href)) {
        e.preventDefault();
        void window.api.shell.openExternal(href);
        return;
      }
      // アンカーリンク (#section) → 同ドキュメント内の見出しへスクロール
      if (href.startsWith('#') && href.length > 1) {
        e.preventDefault();
        const id = decodeURIComponent(href.slice(1));
        // e.currentTarget はクリックハンドラを設定した .preview 要素自身
        const previewEl = e.currentTarget as HTMLElement;

        // 候補 id のリストを試す:
        // 1. URL に書かれた id をそのまま
        // 2. slugify した結果（リンク側で見出しテキストをそのまま書くケース）
        const candidates = new Set<string>();
        candidates.add(id);
        candidates.add(slugifyForAnchor(id));

        let targetEl: HTMLElement | null = null;
        for (const candidate of candidates) {
          if (!candidate) continue;
          try {
            const el = previewEl.querySelector(
              `#${CSS.escape(candidate)}`,
            ) as HTMLElement | null;
            if (el) {
              targetEl = el;
              break;
            }
          } catch {
            // セレクタ構築失敗は次の候補へ
          }
        }

        if (targetEl) {
          // .preview は overflow:auto のスクロールコンテナ。
          // scrollIntoView ではなく、自前で offsetTop ベースでスクロールする。
          const previewRect = previewEl.getBoundingClientRect();
          const targetRect = targetEl.getBoundingClientRect();
          const offset = targetRect.top - previewRect.top + previewEl.scrollTop;
          previewEl.scrollTo({
            top: Math.max(0, offset - 8),
            behavior: 'smooth',
          });
          // 一時的にハイライトしてユーザーに到達位置を示す
          targetEl.classList.add('preview__anchor-flash');
          window.setTimeout(() => {
            targetEl!.classList.remove('preview__anchor-flash');
          }, 1500);
        } else {
          console.warn(`[anchor] 見出しが見つかりません: #${id}`);
        }
        return;
      }
    }

    // 2) スタンドアロン画像（リンク内ではない） → ライトボックスで拡大
    if (target.tagName === 'IMG') {
      e.preventDefault();
      setZoomedSrc((target as HTMLImageElement).src);
      return;
    }
  };

  const visibleTags = tags?.filter((t) => t.length > 0) ?? [];

  return (
    <>
      <div
        ref={previewRef}
        className={`preview markdown-body ${codeCopyAlwaysVisible ? 'is-code-copy-pinned' : ''}`}
        onClick={handleClick}
      >
        {visibleTags.length > 0 && (
          <div className="preview__tags" aria-label="タグ">
            {visibleTags.map((tag, i) => (
              <span key={`${tag}-${i}`} className="preview__tag-badge">
                <span className="preview__tag-hash" aria-hidden="true">
                  #
                </span>
                <span className="preview__tag-name">{tag}</span>
              </span>
            ))}
          </div>
        )}
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      {zoomedSrc && (
        <ImageLightbox
          src={zoomedSrc}
          onClose={() => setZoomedSrc(null)}
        />
      )}
    </>
  );
});

export default Preview;

interface LightboxProps {
  src: string;
  onClose: () => void;
}

function ImageLightbox({ src, onClose }: LightboxProps) {
  // Escape キーで閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="拡大画像"
      onClick={onClose}
    >
      <img
        className="lightbox__img"
        src={src}
        alt=""
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        className="lightbox__close"
        onClick={onClose}
        aria-label="閉じる"
      >
        ×
      </button>
    </div>,
    document.body,
  );
}
