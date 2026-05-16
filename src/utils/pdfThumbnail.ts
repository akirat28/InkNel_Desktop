import * as pdfjsLib from 'pdfjs-dist';
// Vite の `?url` インポートで worker のバンドル URL を取得
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// pdfjs-dist の Worker を一度だけセットアップ
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfThumbnailOptions {
  /** 最大幅（px）。アスペクト比保持で縦は自動 */
  maxWidth?: number;
  /** 最大スケール倍率（高 DPI 対策） */
  maxScale?: number;
}

/**
 * PDF バイナリの 1 ページ目を canvas にレンダリングしてサムネイル PNG の
 * ArrayBuffer を返す。失敗時は null を返し、呼び出し側でフォールバック処理する。
 */
export async function generatePdfThumbnail(
  pdfData: ArrayBuffer,
  options: PdfThumbnailOptions = {},
): Promise<ArrayBuffer | null> {
  const maxWidth = options.maxWidth ?? 240;
  const maxScale = options.maxScale ?? 2;

  try {
    // pdfjs は内部で TypedArray を使うため Uint8Array に変換
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfData),
      // ワーカーが無効化されているケースに備えてフラグを立てない
    });
    const doc = await loadingTask.promise;
    try {
      const page = await doc.getPage(1);

      // viewport を計算（最大幅を超えない範囲で scale を決定）
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(maxWidth / baseViewport.width, maxScale);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) return null;

      // 背景を白で塗りつぶし（透過 PDF 対策）
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: context,
        viewport,
        canvas,
      } as Parameters<typeof page.render>[0]).promise;

      // canvas を PNG Blob → ArrayBuffer に変換
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/png');
      });
      if (!blob) return null;
      return await blob.arrayBuffer();
    } finally {
      await doc.destroy();
    }
  } catch (err) {
    console.warn('PDF thumbnail generation failed:', err);
    return null;
  }
}
