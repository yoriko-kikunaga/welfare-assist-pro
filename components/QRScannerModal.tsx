import React, { useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';

interface QRScannerModalProps {
  onScan: (decoded: string) => void;
  onClose: () => void;
}

const QRScannerModal: React.FC<QRScannerModalProps> = ({ onScan, onClose }) => {
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    // Delay to allow DOM element to be present
    const timer = setTimeout(() => {
      scannerRef.current = new Html5QrcodeScanner(
        'qr-reader',
        { fps: 10, qrbox: 250 },
        false
      );
      scannerRef.current.render(
        (decoded) => {
          scannerRef.current?.clear().catch(() => {});
          onScan(decoded);
        },
        () => {
          // Frame errors are ignored
        }
      );
    }, 100);

    return () => {
      clearTimeout(timer);
      scannerRef.current?.clear().catch(() => {});
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold text-gray-800">QRコードスキャン</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4">
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-3">
            <p className="text-sm font-medium text-blue-800 mb-1">📷 スキャン手順</p>
            <ol className="text-xs text-blue-700 space-y-1 list-decimal list-inside">
              <li>「カメラを許可」のダイアログが表示されたら <strong>「許可」</strong> を選択</li>
              <li>機材に貼付されたQRコードにカメラを向ける</li>
              <li>QRコードが枠の中央に来るように位置を調整する</li>
              <li>自動的に読み取られ、機材情報が表示されます</li>
            </ol>
            <p className="text-xs text-blue-500 mt-2">
              ※ 暗い場所ではカメラのライトを使用してください
            </p>
          </div>
          <div id="qr-reader" className="w-full" />
        </div>
      </div>
    </div>
  );
};

export default QRScannerModal;
