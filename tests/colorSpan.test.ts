import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import { colorSpanPlugin, normalizeColorStyle } from '../src/utils/colorSpan';

const md = new MarkdownIt({ html: false, linkify: true, breaks: true }).use(
  colorSpanPlugin,
);

const inline = (src: string) => md.renderInline(src);

describe('normalizeColorStyle', () => {
  it('color / background-color を受け入れる', () => {
    expect(normalizeColorStyle('color:red')).toBe('color:red');
    expect(normalizeColorStyle('color: #3498db ')).toBe('color:#3498db');
    expect(normalizeColorStyle('background-color:yellow')).toBe(
      'background-color:yellow',
    );
    expect(normalizeColorStyle('color:#fff;background-color:navy')).toBe(
      'color:#fff;background-color:navy',
    );
    expect(normalizeColorStyle('color:rgba(255, 0, 0, 0.5)')).toBe(
      'color:rgba(255, 0, 0, 0.5)',
    );
  });

  it('color 以外のプロパティや危険な値を拒否する', () => {
    expect(normalizeColorStyle('position:fixed')).toBeNull();
    expect(normalizeColorStyle('color:red;position:fixed')).toBeNull();
    expect(normalizeColorStyle('background-image:url(x)')).toBeNull();
    expect(normalizeColorStyle('background-color:url(javascript:alert(1))'))
      .toBeNull();
    expect(normalizeColorStyle('color:expression(alert(1))')).toBeNull();
    expect(normalizeColorStyle('')).toBeNull();
    expect(normalizeColorStyle('color')).toBeNull();
  });
});

describe('colorSpanPlugin', () => {
  it('文字色を span として描画する', () => {
    expect(inline('<span style="color:red">赤い文字</span>')).toBe(
      '<span style="color:red">赤い文字</span>',
    );
    expect(inline('<span style="color:#3498db">青い文字</span>')).toBe(
      '<span style="color:#3498db">青い文字</span>',
    );
  });

  it('背景色を span として描画する', () => {
    expect(inline('<span style="background-color:yellow">黄色の背景</span>')).toBe(
      '<span style="background-color:yellow">黄色の背景</span>',
    );
    expect(
      inline('<span style="background-color:#ffe0e0">薄い赤の背景</span>'),
    ).toBe('<span style="background-color:#ffe0e0">薄い赤の背景</span>');
  });

  it('中身のマークダウンを解釈する', () => {
    expect(inline('<span style="color:red">**太字**</span>')).toBe(
      '<span style="color:red"><strong>太字</strong></span>',
    );
  });

  it('入れ子を正しい相手と対応付ける', () => {
    expect(
      inline(
        '<span style="color:red">外<span style="color:blue">内</span>側</span>',
      ),
    ).toBe(
      '<span style="color:red">外<span style="color:blue">内</span>側</span>',
    );
  });

  it('閉じタグが無ければ素のテキストとして扱う', () => {
    const out = inline('<span style="color:red">閉じない');
    expect(out).toContain('&lt;span');
    expect(out).not.toContain('<span');
  });

  it('孤立した閉じタグをエスケープする', () => {
    const out = inline('foo</span>bar');
    expect(out).toBe('foo&lt;/span&gt;bar');
  });

  it('許可されていない属性・タグは通さない', () => {
    for (const src of [
      '<span onclick="alert(1)">x</span>',
      '<span style="color:red" onclick="alert(1)">x</span>',
      '<span style="position:fixed;top:0">x</span>',
      '<img src=x onerror=alert(1)>',
      '<script>alert(1)</script>',
      '<div style="color:red">x</div>',
    ]) {
      const out = md.render(src);
      expect(out).not.toMatch(/<(span|img|script|div)[\s>]/);
    }
  });

  it('属性値のクォートを閉じ込める', () => {
    const out = inline('<span style="color:red&quot; onmouseover=&quot;x">y</span>');
    expect(out).not.toContain('onmouseover="');
  });

  it('通常の Markdown を壊さない', () => {
    expect(md.render('# 見出し\n\n本文 **太字**\n')).toContain('<h1');
    expect(inline('<https://example.com>')).toContain('<a href="https://example.com"');
  });
});

describe('stripColorSpans', () => {
  it('色指定 span を外して中身を残す', async () => {
    const { stripColorSpans } = await import('../src/utils/colorSpan');
    expect(stripColorSpans('<span style="color:red">赤</span>')).toBe('赤');
    expect(
      stripColorSpans('前<span style="background-color:yellow">中</span>後'),
    ).toBe('前中後');
    expect(
      stripColorSpans(
        '<span style="color:red">外<span style="color:blue">内</span></span>',
      ),
    ).toBe('外内');
  });

  it('色指定でない span や閉じていない span は触らない', async () => {
    const { stripColorSpans } = await import('../src/utils/colorSpan');
    expect(stripColorSpans('<span class="x">y</span>')).toBe(
      '<span class="x">y</span>',
    );
    expect(stripColorSpans('<span style="color:red">閉じない')).toBe(
      '<span style="color:red">閉じない',
    );
    expect(stripColorSpans('色なしテキスト')).toBe('色なしテキスト');
  });
});
