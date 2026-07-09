import React, { useState, useRef } from 'react';
import { Client, ClientDocument, DocumentType } from '../types';
import {
  uploadClientDocument,
  deleteClientDocument,
  getDocumentUrl,
  uploadSignedDocument,
} from '../src/services/documentService';
import SignatureModal from './SignatureModal';

interface DocumentsTabProps {
  client: Client;
  onUpdateClient: (updatedClient: Client) => void;
}

const DOCUMENT_TYPES: DocumentType[] = ['計画書', 'モニタリング', 'その他'];

const DOC_TYPE_COLORS: Record<DocumentType, string> = {
  '計画書': 'bg-blue-100 text-blue-800',
  'モニタリング': 'bg-green-100 text-green-800',
  'その他': 'bg-gray-100 text-gray-700',
};

function formatBytes(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DocumentsTab: React.FC<DocumentsTabProps> = ({ client, onUpdateClient }) => {
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [selectedType, setSelectedType] = useState<DocumentType>('計画書');
  const [note, setNote] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [loadingSignId, setLoadingSignId] = useState<string | null>(null);
  const [signingDoc, setSigningDoc] = useState<{ url: string; doc: ClientDocument } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const documents = (client.documents || []).slice().sort(
    (a, b) => b.uploadedAt.localeCompare(a.uploadedAt)
  );

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      setUploadError('PDFファイルのみアップロードできます');
      e.target.value = '';
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setUploadError('ファイルサイズは20MB以下にしてください');
      e.target.value = '';
      return;
    }

    setUploadError('');
    setIsUploading(true);
    try {
      const newDoc = await uploadClientDocument(client.aozoraId, file, selectedType, note);
      onUpdateClient({
        ...client,
        documents: [...(client.documents || []), newDoc],
      });
      setShowUploadForm(false);
      setNote('');
      setSelectedType('計画書');
    } catch {
      setUploadError('アップロードに失敗しました。再度お試しください。');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleDelete = async (docItem: ClientDocument) => {
    if (!window.confirm(`「${docItem.fileName}」を削除しますか？\nこの操作は元に戻せません。`)) return;
    setDeletingId(docItem.id);
    try {
      await deleteClientDocument(docItem.storagePath);
      onUpdateClient({
        ...client,
        documents: (client.documents || []).filter(d => d.id !== docItem.id),
      });
    } catch {
      alert('削除に失敗しました。再度お試しください。');
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpen = async (docItem: ClientDocument) => {
    setOpeningId(docItem.id);
    try {
      const url = await getDocumentUrl(docItem.storagePath);
      window.open(url, '_blank');
    } catch {
      alert('ファイルを開けませんでした。');
    } finally {
      setOpeningId(null);
    }
  };

  const signedOriginalIds = new Set(
    (client.documents || []).filter(d => d.originalDocumentId).map(d => d.originalDocumentId as string)
  );

  const handleStartSign = async (docItem: ClientDocument) => {
    setLoadingSignId(docItem.id);
    try {
      const url = await getDocumentUrl(docItem.storagePath);
      setSigningDoc({ url, doc: docItem });
    } catch {
      alert('ファイルを開けませんでした。');
    } finally {
      setLoadingSignId(null);
    }
  };

  const handleSignSave = async (blob: Blob, signedFileName: string) => {
    if (!signingDoc) return;
    try {
      const newDoc = await uploadSignedDocument(
        client.aozoraId,
        blob,
        signedFileName,
        signingDoc.doc.documentType,
        signingDoc.doc.id
      );
      onUpdateClient({
        ...client,
        documents: [...(client.documents || []), newDoc],
      });
      setSigningDoc(null);
    } catch {
      alert('署名済みファイルの保存に失敗しました。');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      {signingDoc && (
        <SignatureModal
          pdfUrl={signingDoc.url}
          fileName={signingDoc.doc.fileName}
          onSave={handleSignSave}
          onClose={() => setSigningDoc(null)}
        />
      )}
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-gray-800">書類管理</h3>
        <button
          onClick={() => { setShowUploadForm(true); setUploadError(''); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          書類をアップロード
        </button>
      </div>

      {/* アップロードフォーム */}
      {showUploadForm && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-4">
          <h4 className="font-semibold text-blue-900">新しい書類をアップロード</h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">書類の種類</label>
              <select
                value={selectedType}
                onChange={e => setSelectedType(e.target.value as DocumentType)}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:border-blue-500 outline-none"
              >
                {DOCUMENT_TYPES.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">メモ（任意）</label>
              <input
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="例: 2026年4月分"
                className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          {uploadError && (
            <p className="text-sm text-red-600">{uploadError}</p>
          )}

          <div className="flex items-center gap-3">
            <label
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
                isUploading
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {isUploading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  アップロード中...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  PDFファイルを選択
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                disabled={isUploading}
                onChange={handleFileChange}
              />
            </label>
            <button
              onClick={() => { setShowUploadForm(false); setUploadError(''); setNote(''); }}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              disabled={isUploading}
            >
              キャンセル
            </button>
          </div>
          <p className="text-xs text-gray-500">PDF形式・20MB以下</p>
        </div>
      )}

      {/* 書類一覧 */}
      {documents.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm">アップロードされた書類はありません</p>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map(docItem => (
            <div
              key={docItem.id}
              className="flex items-center gap-3 p-4 bg-white border border-gray-200 rounded-xl hover:border-gray-300 transition-colors"
            >
              {/* PDFアイコン */}
              <div className="flex-shrink-0 w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                </svg>
              </div>

              {/* 書類情報 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${DOC_TYPE_COLORS[docItem.documentType]}`}>
                    {docItem.documentType}
                  </span>
                  <span className="text-sm font-medium text-gray-800 truncate">{docItem.fileName}</span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-gray-500">{docItem.uploadedAt}</span>
                  {docItem.fileSize && (
                    <span className="text-xs text-gray-400">{formatBytes(docItem.fileSize)}</span>
                  )}
                  {docItem.note && (
                    <span className="text-xs text-gray-500 italic">{docItem.note}</span>
                  )}
                </div>
              </div>

              {/* アクションボタン */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {docItem.documentType === '計画書' && !docItem.isSigned && !signedOriginalIds.has(docItem.id) && (
                  <button
                    onClick={() => handleStartSign(docItem)}
                    disabled={loadingSignId === docItem.id}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-purple-600 border border-purple-200 rounded-lg hover:bg-purple-50 transition-colors disabled:opacity-50"
                  >
                    {loadingSignId === docItem.id ? (
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    )}
                    サイン取得
                  </button>
                )}
                {docItem.isSigned && (
                  <span className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    署名済み
                  </span>
                )}
                <button
                  onClick={() => handleOpen(docItem)}
                  disabled={openingId === docItem.id}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50"
                >
                  {openingId === docItem.id ? (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  )}
                  開く
                </button>
                <button
                  onClick={() => handleDelete(docItem)}
                  disabled={deletingId === docItem.id}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  {deletingId === docItem.id ? (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  )}
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DocumentsTab;
