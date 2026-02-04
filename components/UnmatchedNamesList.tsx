/**
 * UnmatchedNamesList - OCR利用者名照合UI
 *
 * 請求書OCRで抽出した利用者名のうち、自動照合できなかったものを
 * ユーザーに確認してもらうためのコンポーネント
 */

import React, { useState, useCallback, useMemo } from 'react';
import { UnmatchedItem, MatchCandidate, OcrNameMapping, Client } from '../types';

interface Props {
  unmatchedItems: UnmatchedItem[];
  wholesaleCompany: string;
  clients: Client[];  // 全利用者リスト（検索用）
  onConfirm: (mappings: Omit<OcrNameMapping, 'id' | 'createdAt' | 'updatedAt'>[]) => void;
  onCancel: () => void;
}

interface SelectionState {
  [ocrName: string]: {
    selectedAozoraId: string | null;
    selectedMasterName: string | null;
  };
}

export default function UnmatchedNamesList({
  unmatchedItems,
  wholesaleCompany,
  clients,
  onConfirm,
  onCancel,
}: Props) {
  // ローディング状態
  const [isProcessing, setIsProcessing] = useState(false);

  // ユーザー選択状態
  const [selections, setSelections] = useState<SelectionState>(() => {
    const initial: SelectionState = {};
    unmatchedItems.forEach(item => {
      const ocrName = item.matchResult.ocrName;
      // 候補がある場合は最初の候補をデフォルト選択
      if (item.matchResult.candidates && item.matchResult.candidates.length > 0) {
        const best = item.matchResult.candidates[0];
        initial[ocrName] = {
          selectedAozoraId: best.aozoraId,
          selectedMasterName: best.masterName,
        };
      } else {
        // 候補なしの場合は「該当なし」をデフォルト
        initial[ocrName] = {
          selectedAozoraId: null,
          selectedMasterName: null,
        };
      }
    });
    return initial;
  });

  // 選択変更ハンドラ
  const handleSelectionChange = useCallback((
    ocrName: string,
    candidate: MatchCandidate | null
  ) => {
    setSelections(prev => ({
      ...prev,
      [ocrName]: {
        selectedAozoraId: candidate?.aozoraId || null,
        selectedMasterName: candidate?.masterName || null,
      },
    }));
  }, []);

  // 確定ハンドラ
  const handleConfirm = useCallback(async () => {
    setIsProcessing(true);
    const mappings: Omit<OcrNameMapping, 'id' | 'createdAt' | 'updatedAt'>[] = [];

    unmatchedItems.forEach(item => {
      const ocrName = item.matchResult.ocrName;
      const selection = selections[ocrName];

      // 「該当なし」以外の場合のみマッピングを作成
      if (selection.selectedAozoraId && selection.selectedMasterName) {
        mappings.push({
          ocrName: item.matchResult.ocrNameNormalized,
          ocrNameOriginal: item.matchResult.ocrName,
          aozoraId: selection.selectedAozoraId,
          masterName: selection.selectedMasterName,
          wholesaleCompany,
          confidence: 1.0, // 手動選択は確信度1.0
          usageCount: 1,
        });
      }
    });

    onConfirm(mappings);
  }, [unmatchedItems, selections, wholesaleCompany, onConfirm]);

  // 候補ありのアイテムと候補なしのアイテムを分離
  const itemsWithCandidates = unmatchedItems.filter(
    item => item.matchResult.status === 'candidates'
  );
  const itemsWithoutCandidates = unmatchedItems.filter(
    item => item.matchResult.status === 'unmatched'
  );

  // 一括選択: 推奨をすべて選択
  const handleSelectAllRecommended = useCallback(() => {
    setSelections(prev => {
      const updated = { ...prev };
      itemsWithCandidates.forEach(item => {
        const ocrName = item.matchResult.ocrName;
        const candidates = item.matchResult.candidates;
        if (candidates && candidates.length > 0) {
          const best = candidates[0];
          updated[ocrName] = {
            selectedAozoraId: best.aozoraId,
            selectedMasterName: best.masterName,
          };
        }
      });
      return updated;
    });
  }, [itemsWithCandidates]);

  // 一括選択: すべて該当なし
  const handleSelectAllNone = useCallback(() => {
    setSelections(prev => {
      const updated = { ...prev };
      unmatchedItems.forEach(item => {
        const ocrName = item.matchResult.ocrName;
        updated[ocrName] = {
          selectedAozoraId: null,
          selectedMasterName: null,
        };
      });
      return updated;
    });
  }, [unmatchedItems]);

  // 選択状態のサマリー
  const selectedCount = useMemo(() => {
    return Object.values(selections).filter(s => s.selectedAozoraId !== null).length;
  }, [selections]);

  return (
    <div className="bg-white rounded-lg shadow-lg max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col">
      {/* ヘッダー */}
      <div className="px-6 py-4 border-b bg-yellow-50">
        <h2 className="text-lg font-semibold text-gray-800">
          請求書OCR結果 - 利用者名照合
        </h2>
        <p className="text-sm text-gray-600 mt-1">
          自動照合できなかった利用者名があります。候補から選択するか、「該当なし」を選んでください。
        </p>
        <div className="mt-2 flex gap-4 text-sm">
          <span className="text-yellow-700">
            候補あり: <strong>{itemsWithCandidates.length}件</strong>
          </span>
          <span className="text-red-700">
            候補なし: <strong>{itemsWithoutCandidates.length}件</strong>
          </span>
          <span className="text-blue-700">
            選択済み: <strong>{selectedCount}件</strong>
          </span>
        </div>
        {/* 一括操作ボタン */}
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleSelectAllRecommended}
            className="px-3 py-1 text-sm text-white bg-green-600 rounded hover:bg-green-700"
          >
            推奨をすべて選択
          </button>
          <button
            onClick={handleSelectAllNone}
            className="px-3 py-1 text-sm text-gray-700 bg-gray-200 rounded hover:bg-gray-300"
          >
            すべて該当なしにする
          </button>
        </div>
      </div>

      {/* リスト */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 候補ありのアイテム */}
        {itemsWithCandidates.map((item, index) => (
          <UnmatchedItemCard
            key={`candidates-${index}`}
            item={item}
            clients={clients}
            selection={selections[item.matchResult.ocrName] || { selectedAozoraId: null, selectedMasterName: null }}
            onSelectionChange={(candidate) =>
              handleSelectionChange(item.matchResult.ocrName, candidate)
            }
          />
        ))}

        {/* 候補なしのアイテム（検索機能付き） */}
        {itemsWithoutCandidates.length > 0 && (
          <>
            <div className="border-t pt-4 mt-4">
              <h3 className="text-sm font-medium text-red-700 mb-2">
                候補が見つからない利用者（名前で検索してください）
              </h3>
            </div>
            {itemsWithoutCandidates.map((item, index) => (
              <UnmatchedItemWithSearch
                key={`unmatched-${index}`}
                item={item}
                clients={clients}
                selection={selections[item.matchResult.ocrName] || { selectedAozoraId: null, selectedMasterName: null }}
                onSelectionChange={(candidate) =>
                  handleSelectionChange(item.matchResult.ocrName, candidate)
                }
              />
            ))}
          </>
        )}
      </div>

      {/* フッター */}
      <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3">
        <button
          onClick={onCancel}
          disabled={isProcessing}
          className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          キャンセル
        </button>
        <button
          onClick={handleConfirm}
          disabled={isProcessing}
          className={`px-4 py-2 text-white rounded-md flex items-center justify-center gap-2 min-w-[180px] transition-all ${
            isProcessing
              ? 'bg-blue-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {isProcessing ? (
            <>
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>処理中...</span>
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <span>確定して照合を実行</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * 個別アイテムカード（候補あり + 全てから選択）
 */
interface UnmatchedItemCardProps {
  item: UnmatchedItem;
  clients: Client[];
  selection: { selectedAozoraId: string | null; selectedMasterName: string | null };
  onSelectionChange: (candidate: MatchCandidate | null) => void;
}

function UnmatchedItemCard({
  item,
  clients,
  selection,
  onSelectionChange,
}: UnmatchedItemCardProps) {
  const { matchResult, invoiceItem } = item;
  const candidates = matchResult.candidates || [];
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // 検索結果
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || searchQuery.length < 1) return [];

    const query = searchQuery.toLowerCase();
    return clients
      .filter(c =>
        c.name?.toLowerCase().includes(query) ||
        c.nameKana?.toLowerCase().includes(query) ||
        c.aozoraId?.includes(query)
      )
      .slice(0, 10)
      .map(c => ({
        aozoraId: c.aozoraId,
        masterName: c.name,
        similarity: 0,
        isExactMatch: false,
        matchSource: 'fuzzy' as const,
      }));
  }, [searchQuery, clients]);

  // 選択が候補リストにあるかチェック
  const isSelectedFromCandidates = selection.selectedAozoraId &&
    candidates.some(c => c.aozoraId === selection.selectedAozoraId);
  const isSelectedFromSearch = selection.selectedAozoraId && !isSelectedFromCandidates;

  return (
    <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
      {/* OCR結果 */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-sm text-gray-500">OCR結果:</span>
          <span className="ml-2 font-semibold text-gray-800">
            {matchResult.ocrName}
          </span>
        </div>
        <div className="text-right text-sm text-gray-600">
          <div>{invoiceItem.itemName}</div>
          <div className="font-medium">{invoiceItem.amount.toLocaleString()}円</div>
        </div>
      </div>

      {/* 候補リスト */}
      <div className="space-y-2">
        <div className="text-sm text-gray-600 mb-1">候補を選択:</div>
        {candidates.map((candidate, index) => (
          <label
            key={candidate.aozoraId}
            className={`flex items-center p-2 rounded cursor-pointer transition-colors ${
              selection.selectedAozoraId === candidate.aozoraId
                ? 'bg-blue-100 border border-blue-300'
                : 'bg-white border border-gray-200 hover:bg-gray-50'
            }`}
          >
            <input
              type="radio"
              name={`candidate-${matchResult.ocrName}`}
              checked={selection.selectedAozoraId === candidate.aozoraId}
              onChange={() => {
                onSelectionChange(candidate);
                setShowSearch(false);
                setSearchQuery('');
              }}
              className="mr-3"
            />
            <div className="flex-1">
              <span className="font-medium text-gray-800">
                {candidate.masterName}
              </span>
              <span className="ml-2 text-xs text-gray-500">
                (ID: {candidate.aozoraId})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs px-2 py-0.5 rounded ${
                  candidate.similarity >= 0.9
                    ? 'bg-green-100 text-green-700'
                    : candidate.similarity >= 0.7
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-orange-100 text-orange-700'
                }`}
              >
                {Math.round(candidate.similarity * 100)}%
              </span>
              {index === 0 && (
                <span className="text-xs text-blue-600">推奨</span>
              )}
            </div>
          </label>
        ))}

        {/* 全てから選択オプション */}
        <div className="border-t pt-2 mt-2">
          {isSelectedFromSearch ? (
            // 検索から選択済みの場合
            <div className="p-2 bg-purple-100 border border-purple-300 rounded flex items-center justify-between">
              <div className="flex items-center">
                <input
                  type="radio"
                  name={`candidate-${matchResult.ocrName}`}
                  checked={true}
                  readOnly
                  className="mr-3"
                />
                <span className="font-medium text-purple-800">{selection.selectedMasterName}</span>
                <span className="ml-2 text-xs text-purple-600">(ID: {selection.selectedAozoraId})</span>
                <span className="ml-2 text-xs bg-purple-200 text-purple-700 px-1.5 py-0.5 rounded">検索から選択</span>
              </div>
              <button
                onClick={() => {
                  setShowSearch(true);
                  onSelectionChange(null);
                }}
                className="text-xs text-purple-600 hover:text-purple-800"
              >
                変更
              </button>
            </div>
          ) : showSearch ? (
            // 検索モード
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-purple-700 font-medium">全てから選択:</span>
                <button
                  onClick={() => {
                    setShowSearch(false);
                    setSearchQuery('');
                  }}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  閉じる
                </button>
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="名前・カナ・あおぞらIDで検索..."
                className="w-full px-3 py-2 border border-purple-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                autoFocus
              />
              {searchQuery && (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {searchResults.length > 0 ? (
                    searchResults.map((result) => (
                      <button
                        key={result.aozoraId}
                        onClick={() => {
                          onSelectionChange(result);
                          setShowSearch(false);
                          setSearchQuery('');
                        }}
                        className="w-full text-left p-2 bg-white border border-gray-200 rounded hover:bg-purple-50 hover:border-purple-300 transition-colors"
                      >
                        <span className="font-medium text-gray-800">{result.masterName}</span>
                        <span className="ml-2 text-xs text-gray-500">(ID: {result.aozoraId})</span>
                      </button>
                    ))
                  ) : (
                    <div className="text-sm text-gray-500 p-2">
                      該当する利用者が見つかりません
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            // 検索ボタン表示
            <button
              onClick={() => setShowSearch(true)}
              className="w-full text-left p-2 bg-purple-50 border border-purple-200 rounded hover:bg-purple-100 transition-colors flex items-center"
            >
              <span className="text-purple-700">🔍 全てから選択...</span>
            </button>
          )}
        </div>

        {/* 該当なしオプション */}
        <label
          className={`flex items-center p-2 rounded cursor-pointer transition-colors ${
            selection.selectedAozoraId === null && !showSearch
              ? 'bg-gray-200 border border-gray-400'
              : 'bg-white border border-gray-200 hover:bg-gray-50'
          }`}
        >
          <input
            type="radio"
            name={`candidate-${matchResult.ocrName}`}
            checked={selection.selectedAozoraId === null && !showSearch}
            onChange={() => {
              onSelectionChange(null);
              setShowSearch(false);
              setSearchQuery('');
            }}
            className="mr-3"
          />
          <span className="text-gray-600">該当なし（照合対象外）</span>
        </label>
      </div>
    </div>
  );
}

/**
 * 検索機能付きのアイテムカード（候補なしの場合用）
 */
interface UnmatchedItemWithSearchProps {
  item: UnmatchedItem;
  clients: Client[];
  selection: { selectedAozoraId: string | null; selectedMasterName: string | null };
  onSelectionChange: (candidate: MatchCandidate | null) => void;
}

function UnmatchedItemWithSearch({
  item,
  clients,
  selection,
  onSelectionChange,
}: UnmatchedItemWithSearchProps) {
  const { matchResult, invoiceItem } = item;
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // 検索結果
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || searchQuery.length < 1) return [];

    const query = searchQuery.toLowerCase();
    return clients
      .filter(c =>
        c.name?.toLowerCase().includes(query) ||
        c.nameKana?.toLowerCase().includes(query) ||
        c.aozoraId?.includes(query)
      )
      .slice(0, 10)  // 最大10件
      .map(c => ({
        aozoraId: c.aozoraId,
        masterName: c.name,
        similarity: 0,
        isExactMatch: false,
        matchSource: 'fuzzy' as const,
      }));
  }, [searchQuery, clients]);

  return (
    <div className="p-4 bg-red-50 rounded-lg border border-red-200">
      {/* OCR結果 */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-sm text-gray-500">OCR結果:</span>
          <span className="ml-2 font-semibold text-gray-800">
            {matchResult.ocrName}
          </span>
        </div>
        <div className="text-right text-sm text-gray-600">
          <div>{invoiceItem.itemName}</div>
          <div className="font-medium">{invoiceItem.amount.toLocaleString()}円</div>
        </div>
      </div>

      {/* 選択済み表示 */}
      {selection.selectedAozoraId && (
        <div className="mb-3 p-2 bg-blue-100 border border-blue-300 rounded flex items-center justify-between">
          <div>
            <span className="font-medium text-blue-800">{selection.selectedMasterName}</span>
            <span className="ml-2 text-xs text-blue-600">(ID: {selection.selectedAozoraId})</span>
          </div>
          <button
            onClick={() => onSelectionChange(null)}
            className="text-xs text-red-600 hover:text-red-800"
          >
            解除
          </button>
        </div>
      )}

      {/* 検索フィールド */}
      {!selection.selectedAozoraId && (
        <>
          <div className="mb-2">
            <div className="text-sm text-gray-600 mb-1">利用者を検索:</div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsSearching(true);
              }}
              placeholder="名前・カナ・あおぞらIDで検索..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* 検索結果 */}
          {isSearching && searchQuery && (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {searchResults.length > 0 ? (
                searchResults.map((result) => (
                  <button
                    key={result.aozoraId}
                    onClick={() => {
                      onSelectionChange(result);
                      setSearchQuery('');
                      setIsSearching(false);
                    }}
                    className="w-full text-left p-2 bg-white border border-gray-200 rounded hover:bg-blue-50 hover:border-blue-300 transition-colors"
                  >
                    <span className="font-medium text-gray-800">{result.masterName}</span>
                    <span className="ml-2 text-xs text-gray-500">(ID: {result.aozoraId})</span>
                  </button>
                ))
              ) : (
                <div className="text-sm text-gray-500 p-2">
                  該当する利用者が見つかりません
                </div>
              )}
            </div>
          )}

          {/* 該当なしオプション */}
          {!isSearching && (
            <div className="mt-2 text-xs text-gray-500">
              検索して利用者を選択するか、そのままにすると「該当なし」として処理されます
            </div>
          )}
        </>
      )}
    </div>
  );
}
