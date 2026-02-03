/**
 * UnmatchedNamesList - OCR利用者名照合UI
 *
 * 請求書OCRで抽出した利用者名のうち、自動照合できなかったものを
 * ユーザーに確認してもらうためのコンポーネント
 */

import React, { useState, useCallback } from 'react';
import { UnmatchedItem, MatchCandidate, OcrNameMapping } from '../types';

interface Props {
  unmatchedItems: UnmatchedItem[];
  wholesaleCompany: string;
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
  onConfirm,
  onCancel,
}: Props) {
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
  const handleConfirm = useCallback(() => {
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
        </div>
      </div>

      {/* リスト */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 候補ありのアイテム */}
        {itemsWithCandidates.map((item, index) => (
          <UnmatchedItemCard
            key={`candidates-${index}`}
            item={item}
            selection={selections[item.matchResult.ocrName] || { selectedAozoraId: null, selectedMasterName: null }}
            onSelectionChange={(candidate) =>
              handleSelectionChange(item.matchResult.ocrName, candidate)
            }
          />
        ))}

        {/* 候補なしのアイテム */}
        {itemsWithoutCandidates.length > 0 && (
          <>
            <div className="border-t pt-4 mt-4">
              <h3 className="text-sm font-medium text-red-700 mb-2">
                候補が見つからない利用者（照合対象外）
              </h3>
            </div>
            {itemsWithoutCandidates.map((item, index) => (
              <div
                key={`unmatched-${index}`}
                className="p-3 bg-red-50 rounded-lg border border-red-200"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-gray-800">
                      {item.matchResult.ocrName}
                    </span>
                    <span className="ml-2 text-xs text-gray-500">
                      ({item.invoiceItem.itemName}, {item.invoiceItem.amount.toLocaleString()}円)
                    </span>
                  </div>
                  <span className="text-xs text-red-600 bg-red-100 px-2 py-1 rounded">
                    該当なし
                  </span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* フッター */}
      <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        >
          キャンセル
        </button>
        <button
          onClick={handleConfirm}
          className="px-4 py-2 text-white bg-blue-600 rounded-md hover:bg-blue-700"
        >
          確定して照合を実行
        </button>
      </div>
    </div>
  );
}

/**
 * 個別アイテムカード
 */
interface UnmatchedItemCardProps {
  item: UnmatchedItem;
  selection: { selectedAozoraId: string | null; selectedMasterName: string | null };
  onSelectionChange: (candidate: MatchCandidate | null) => void;
}

function UnmatchedItemCard({
  item,
  selection,
  onSelectionChange,
}: UnmatchedItemCardProps) {
  const { matchResult, invoiceItem } = item;
  const candidates = matchResult.candidates || [];

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
              onChange={() => onSelectionChange(candidate)}
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

        {/* 該当なしオプション */}
        <label
          className={`flex items-center p-2 rounded cursor-pointer transition-colors ${
            selection.selectedAozoraId === null
              ? 'bg-gray-200 border border-gray-400'
              : 'bg-white border border-gray-200 hover:bg-gray-50'
          }`}
        >
          <input
            type="radio"
            name={`candidate-${matchResult.ocrName}`}
            checked={selection.selectedAozoraId === null}
            onChange={() => onSelectionChange(null)}
            className="mr-3"
          />
          <span className="text-gray-600">該当なし（照合対象外）</span>
        </label>
      </div>
    </div>
  );
}
