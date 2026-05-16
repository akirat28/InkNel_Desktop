import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';

// ===== React マウント前にテーマ属性を確定 =====
// CSS の `:root` 既定値はダーク色。React が `data-theme="light"` を付与する
// useEffect が走るまでに数フレームの間があり、ライトテーマ設定でも一瞬黒く
// 見える（フラッシュ）。これを避けるため、前回起動時に保存しておいた
// `data-theme` を localStorage から同期読み出しし、`<html>` に最速で反映。
// localStorage は同期 API なので CSS 評価開始前に間に合う。
//
// 値は App.tsx 側でテーマ変更のたびに更新される。
try {
  const cached = localStorage.getItem('inknel.theme');
  if (cached === 'dark' || cached === 'light') {
    document.documentElement.dataset.theme = cached;
  }
} catch {
  // localStorage が無効な環境では何もしない（ダーク既定で続行）
}

// ===== ランタイムロードされるプラグイン用に React API を window に露出 =====
// 通常 `import React from 'react'` は Vite が解決するが、ランタイムプラグインは
// `inknel-plugin://...` 経由でロードされるため Vite の解決対象外。
// プラグインは `const { React, useState, ... } = window.InkNelPluginAPI` で
// 必要なフックを取り出せる。
//
// (window as any) は型定義を緩めるための一時キャスト。
(window as unknown as { InkNelPluginAPI: unknown }).InkNelPluginAPI = {
  React,
  // よく使うフック
  useState: React.useState,
  useEffect: React.useEffect,
  useMemo: React.useMemo,
  useCallback: React.useCallback,
  useRef: React.useRef,
  // JSX 風の便利関数（プラグイン側で使いやすいよう createElement のエイリアス）
  h: React.createElement,
  Fragment: React.Fragment,
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
