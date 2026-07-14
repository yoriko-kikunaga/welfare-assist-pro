import React, { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { PDFDocument, rgb } from 'pdf-lib';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

// 署名位置（A4 = 595 x 842 pt、原点は左下）
const SIG_X = 352;
const SIG_Y = 88;
const SIG_W = 230;
const SIG_H = 38;

// チェックボックス確認項目
const CHECKBOX_ITEMS = [
  '私は、貸与の候補となる福祉用具の全国平均貸与価格等の説明を受けました。',
  '私は、貸与の候補となる機能や価格の異なる複数の福祉用具の提示を受けました。',
  '私は、福祉用具サービス計画の内容について説明を受け、内容に同意し、計画書の交付を受けました。',
] as const;

// PDF上のチェックボックス □ の位置（左下原点）
const CB_POSITIONS = [
  { x: 32, y: 162 }, // 項目1（上）
  { x: 32, y: 143 }, // 項目2（中）
  { x: 32, y: 124 }, // 項目3（下）
];
const CB_SIZE = 7;

interface SignatureModalProps {
  pdfUrl: string;
  fileName: string;
  onSave: (signedBlob: Blob, signedFileName: string) => void;
  onClose: () => void;
}

const SignatureModal: React.FC<SignatureModalProps> = ({ pdfUrl, fileName, onSave, onClose }) => {
  const sigCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [checkedItems, setCheckedItems] = useState([false, false, false]);
  const [pdfPageUrls, setPdfPageUrls] = useState<string[]>([]);
  const [pdfPageSize, setPdfPageSize] = useState({ width: 595, height: 842 });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const pdfBytesRef = useRef<ArrayBuffer | null>(null);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(pdfUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = await res.arrayBuffer();
        if (cancelled) return;
        pdfBytesRef.current = bytes;

        const pdf = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
        const urls: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const vp = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.width = vp.width;
          canvas.height = vp.height;
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
          urls.push(canvas.toDataURL());
          if (i === pdf.numPages) {
            setPdfPageSize({ width: page.getViewport({ scale: 1 }).width, height: page.getViewport({ scale: 1 }).height });
          }
        }
        if (!cancelled) {
          setPdfPageUrls(urls);
          setIsLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError('PDFの読み込みに失敗しました。');
          setIsLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [pdfUrl]);

  const getCanvasPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = sigCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDrawing(true);
    setHasSignature(true);
    const pos = getCanvasPos(e);
    lastPosRef.current = pos;
    const ctx = sigCanvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 1, 0, Math.PI * 2);
      ctx.fillStyle = '#1e3a8a';
      ctx.fill();
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !lastPosRef.current) return;
    const ctx = sigCanvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pos = getCanvasPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1e3a8a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    lastPosRef.current = pos;
  };

  const handlePointerUp = () => {
    setIsDrawing(false);
    lastPosRef.current = null;
  };

  const handleClear = () => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const toggleCheck = (i: number) => {
    setCheckedItems(prev => prev.map((v, idx) => idx === i ? !v : v));
  };

  const handleSave = async () => {
    if (!hasSignature || !pdfBytesRef.current) return;
    const sigCanvas = sigCanvasRef.current;
    if (!sigCanvas) return;
    setIsSaving(true);
    try {
      const sigDataUrl = sigCanvas.toDataURL('image/png');
      const pdfDoc = await PDFDocument.load(pdfBytesRef.current);
      const pages = pdfDoc.getPages();
      const lastPage = pages[pages.length - 1];

      // 署名画像を埋め込む
      const pngBytes = await (await fetch(sigDataUrl)).arrayBuffer();
      const pngImage = await pdfDoc.embedPng(pngBytes);
      lastPage.drawImage(pngImage, { x: SIG_X, y: SIG_Y, width: SIG_W, height: SIG_H });

      // チェックされた項目に ✓ を描画
      for (let i = 0; i < checkedItems.length; i++) {
        if (!checkedItems[i]) continue;
        const { x, y } = CB_POSITIONS[i];
        const blue = rgb(0.05, 0.1, 0.75);
        lastPage.drawLine({
          start: { x: x + 0.5, y: y + CB_SIZE * 0.45 },
          end:   { x: x + CB_SIZE * 0.38, y: y + 0.5 },
          color: blue, thickness: 1.5,
        });
        lastPage.drawLine({
          start: { x: x + CB_SIZE * 0.38, y: y + 0.5 },
          end:   { x: x + CB_SIZE, y: y + CB_SIZE * 0.85 },
          color: blue, thickness: 1.5,
        });
      }

      const signedBytes = await pdfDoc.save();
      const blob = new Blob([signedBytes], { type: 'application/pdf' });
      const dotIdx = fileName.lastIndexOf('.');
      const base = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
      onSave(blob, `${base}_署名済み.pdf`);
    } catch {
      alert('署名の保存に失敗しました。再度お試しください。');
    } finally {
      setIsSaving(false);
    }
  };

  // 最終ページの署名枠オーバーレイ位置
  const pw = pdfPageSize.width;
  const ph = pdfPageSize.height;
  const overlayStyle = {
    right:  `${((pw - SIG_X - SIG_W) / pw) * 100}%`,
    bottom: `${(SIG_Y / ph) * 100}%`,
    width:  `${(SIG_W / pw) * 100}%`,
    height: `${(SIG_H / ph) * 100}%`,
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/70">
      {/* ヘッダー */}
      <div className="bg-white border-b px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
          <span className="font-bold text-gray-800 truncate max-w-xs sm:max-w-md">{fileName}</span>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* ボディ */}
      <div className="flex-1 overflow-auto bg-gray-200 p-4 flex flex-col items-center gap-4">
        {isLoading && (
          <div className="mt-16 flex flex-col items-center gap-3 text-gray-400">
            <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span className="text-sm">PDF読み込み中...</span>
          </div>
        )}
        {loadError && <p className="mt-16 text-red-500 text-sm">{loadError}</p>}

        {/* 最終ページ表示（署名位置確認） */}
        {pdfPageUrls.length > 0 && (
          <div className="relative shadow-lg">
            <img src={pdfPageUrls[pdfPageUrls.length - 1]} alt="署名ページ" className="max-w-full block" />
            <div className="absolute border-2 border-red-500 bg-yellow-200/40 pointer-events-none" style={overlayStyle} />
            <div className="absolute pointer-events-none flex items-center justify-center"
              style={{ ...overlayStyle, fontSize: '10px', color: '#dc2626', fontWeight: 'bold' }}>
              ここに署名
            </div>
          </div>
        )}
        {pdfPageUrls.length > 1 && (
          <p className="text-xs text-gray-400">※ 最終ページ（署名欄）を表示しています</p>
        )}

        {/* 確認チェックボックス */}
        {!isLoading && !loadError && (
          <div className="bg-white rounded-xl shadow-lg p-5 w-full max-w-2xl">
            <p className="text-sm font-semibold text-gray-700 mb-3">確認事項（タップでチェック）</p>
            <div className="space-y-3">
              {CHECKBOX_ITEMS.map((item, i) => (
                <label key={i} className="flex items-start gap-3 cursor-pointer select-none" onClick={() => toggleCheck(i)}>
                  <div className={`mt-0.5 w-5 h-5 flex-shrink-0 border-2 rounded flex items-center justify-center transition-colors ${
                    checkedItems[i] ? 'bg-blue-600 border-blue-600' : 'border-gray-400 bg-white'
                  }`}>
                    {checkedItems[i] && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm text-gray-700 leading-relaxed">{item}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* 署名キャンバス */}
        {!isLoading && !loadError && (
          <div className="bg-white rounded-xl shadow-lg p-5 w-full max-w-2xl">
            <p className="text-sm font-semibold text-gray-700 mb-1 text-center">
              ✏️ こちらにご署名ください（上の赤枠の位置に反映されます）
            </p>
            <p className="text-xs text-gray-400 text-center mb-3">タッチペン・指・マウスで署名できます</p>
            <canvas
              ref={sigCanvasRef}
              width={700}
              height={220}
              className="w-full border-2 border-dashed border-blue-300 rounded-lg bg-gray-50 cursor-crosshair"
              style={{ touchAction: 'none' }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            />
            <div className="mt-2 flex justify-end">
              <button onClick={handleClear} className="text-xs text-gray-400 hover:text-gray-600 underline">
                署名をクリア
              </button>
            </div>
          </div>
        )}
      </div>

      {/* フッター */}
      <div className="bg-white border-t px-6 py-3 flex items-center justify-end gap-3 flex-shrink-0">
        <button onClick={onClose} disabled={isSaving} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors">
          キャンセル
        </button>
        <button
          onClick={handleSave}
          disabled={!hasSignature || isSaving || isLoading}
          className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSaving ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              保存中...
            </>
          ) : '署名して保存'}
        </button>
      </div>
    </div>
  );
};

export default SignatureModal;
