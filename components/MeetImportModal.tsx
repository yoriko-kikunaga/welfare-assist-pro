import React, { useState } from 'react';
import { fetchGoogleDocContent, extractMeetingNotes } from '../services/geminiService';

interface MeetImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (text: string) => void;
}

const MeetImportModal: React.FC<MeetImportModalProps> = ({ isOpen, onClose, onImport }) => {
  const [activeTab, setActiveTab] = useState<'url' | 'text' | 'file'>('url');
  const [docUrl, setDocUrl] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewText, setPreviewText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleFetchDoc = async () => {
    const match = docUrl.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) {
      setError('有効なGoogle Docs URLを入力してください。');
      return;
    }
    const docId = match[1];
    setIsLoading(true);
    setError('');
    try {
      const text = await fetchGoogleDocContent(docId);
      setPreviewText(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ドキュメントの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTextChange = (value: string) => {
    setPastedText(value);
    setPreviewText(value);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFile(file);
    setError('');

    if (file.type === 'text/plain') {
      const text = await file.text();
      setPreviewText(text);
    } else {
      setIsLoading(true);
      try {
        const text = await extractMeetingNotes(file);
        setPreviewText(text);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'ファイルの読み取りに失敗しました');
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleImport = () => {
    if (!previewText.trim()) {
      setError('インポートするテキストがありません。');
      return;
    }
    onImport(previewText);
  };

  const handleTabChange = (tab: 'url' | 'text' | 'file') => {
    setActiveTab(tab);
    setError('');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z" />
            </svg>
            Meetメモから議事録を作成
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Tabs */}
          <div className="flex border-b">
            {(['url', 'text', 'file'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === tab ? 'border-green-600 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                {tab === 'url' ? 'Google Docs URL' : tab === 'text' ? 'テキスト貼り付け' : 'ファイルアップロード'}
              </button>
            ))}
          </div>

          {/* Tab: Google Docs URL */}
          {activeTab === 'url' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Google Docsのドキュメントから直接メモを取り込みます。ドキュメントをサービスアカウントに共有、またはリンク共有（閲覧可）設定にしてください。
              </p>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={docUrl}
                  onChange={(e) => setDocUrl(e.target.value)}
                  placeholder="https://docs.google.com/document/d/..."
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <button
                  onClick={handleFetchDoc}
                  disabled={isLoading || !docUrl.trim()}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {isLoading ? '取得中...' : '取得'}
                </button>
              </div>
            </div>
          )}

          {/* Tab: テキスト貼り付け */}
          {activeTab === 'text' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Google Docsや他のメモアプリからテキストをコピーして貼り付けてください。
              </p>
              <textarea
                value={pastedText}
                onChange={(e) => handleTextChange(e.target.value)}
                placeholder="Google Docsからコピーしたメモを貼り付け..."
                rows={8}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
              />
            </div>
          )}

          {/* Tab: ファイルアップロード */}
          {activeTab === 'file' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                テキストファイル（.txt）またはPDFファイルをアップロードします。PDFはAIでテキストを抽出します。
              </p>
              <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <svg className="w-8 h-8 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                </svg>
                <span className="text-sm text-gray-500">{uploadedFile ? uploadedFile.name : 'クリックしてファイルを選択'}</span>
                <span className="text-xs text-gray-400 mt-1">.txt, .pdf</span>
                <input type="file" accept=".txt,.pdf" className="hidden" onChange={handleFileChange} />
              </label>
              {isLoading && (
                <p className="text-sm text-gray-500 text-center">AIでテキストを抽出中...</p>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {/* Preview */}
          {previewText && (
            <div className="space-y-2">
              <label className="text-sm font-bold text-gray-600">取込テキストのプレビュー</label>
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 text-sm text-gray-700 max-h-48 overflow-y-auto whitespace-pre-wrap">
                {previewText}
              </div>
              <p className="text-xs text-gray-400">{previewText.length}文字</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 justify-end p-6 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            キャンセル
          </button>
          <button
            onClick={handleImport}
            disabled={!previewText.trim()}
            className="bg-green-600 text-white px-6 py-2 rounded-lg text-sm font-bold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
            </svg>
            この内容でAI議事録を作成
          </button>
        </div>
      </div>
    </div>
  );
};

export default MeetImportModal;
