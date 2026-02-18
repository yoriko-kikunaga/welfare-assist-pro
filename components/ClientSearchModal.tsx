/**
 * ClientSearchModal - 利用者検索モーダル（インライン紐づけ編集用）
 *
 * 仕入のみ/突合済みタブから呼び出し、利用者を検索・選択する軽量モーダル。
 * UnmatchedNamesList.tsx の検索UIパターンを抽出。
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Client } from '../types';

interface ClientSearchModalProps {
  title: string;
  subtitle?: string;  // 請求書の利用者名・商品名・金額など補足情報
  clients: Client[];
  currentAozoraId?: string;  // 現在紐づいているあおぞらID（突合済みタブ用）
  showUnlink?: boolean;       // 紐づけ解除ボタンを表示するか
  onSelect: (aozoraId: string, clientName: string) => void;
  onUnlink?: () => void;
  onClose: () => void;
}

export default function ClientSearchModal({
  title,
  subtitle,
  clients,
  currentAozoraId,
  showUnlink,
  onSelect,
  onUnlink,
  onClose,
}: ClientSearchModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 自動フォーカス
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 現在の紐づけ先
  const currentClient = useMemo(() => {
    if (!currentAozoraId) return null;
    return clients.find(c => c.aozoraId === currentAozoraId) || null;
  }, [currentAozoraId, clients]);

  // 検索結果
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || searchQuery.length < 1) return [];

    const query = searchQuery.toLowerCase();
    return clients
      .filter(c =>
        c.name?.toLowerCase().includes(query) ||
        c.nameKana?.toLowerCase().includes(query) ||
        c.aozoraId?.toLowerCase().includes(query)
      )
      .filter(c => c.aozoraId !== currentAozoraId)  // 現在の紐づけ先を除外
      .slice(0, 15);
  }, [searchQuery, clients, currentAozoraId]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[70vh] overflow-hidden flex flex-col">
        {/* ヘッダー */}
        <div className="px-6 py-4 border-b bg-blue-50">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {subtitle && (
            <p className="text-sm text-gray-600 mt-1">{subtitle}</p>
          )}
        </div>

        {/* 現在の紐づけ表示 + 解除ボタン */}
        {currentClient && showUnlink && (
          <div className="px-6 py-3 bg-green-50 border-b flex items-center justify-between">
            <div className="text-sm">
              <span className="text-gray-500">現在の紐づけ: </span>
              <span className="font-medium text-green-800">{currentClient.name}</span>
              <span className="ml-1 text-xs text-green-600">({currentClient.aozoraId})</span>
            </div>
            <button
              onClick={onUnlink}
              className="px-3 py-1 text-xs text-red-700 bg-red-100 rounded hover:bg-red-200 transition-colors"
            >
              紐づけ解除
            </button>
          </div>
        )}

        {/* 検索フィールド */}
        <div className="px-6 py-3 border-b">
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="名前・カナ・あおぞらIDで検索..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* 検索結果 */}
        <div className="flex-1 overflow-y-auto px-6 py-2">
          {searchQuery.trim() ? (
            searchResults.length > 0 ? (
              <div className="space-y-1">
                {searchResults.map((client) => (
                  <button
                    key={client.aozoraId}
                    onClick={() => onSelect(client.aozoraId, client.name)}
                    className="w-full text-left p-3 bg-white border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors flex items-center justify-between"
                  >
                    <div>
                      <span className="font-medium text-gray-800">{client.name}</span>
                      {client.nameKana && (
                        <span className="ml-2 text-xs text-gray-400">{client.nameKana}</span>
                      )}
                    </div>
                    <span className="text-xs text-gray-500">{client.aozoraId}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-sm text-gray-500">
                該当する利用者が見つかりません
              </div>
            )
          ) : (
            <div className="text-center py-8 text-sm text-gray-400">
              検索キーワードを入力してください
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="px-6 py-3 border-t bg-gray-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
