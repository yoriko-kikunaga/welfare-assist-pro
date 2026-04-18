import React, { useState, useEffect } from 'react';
import {
  WholesaleCompany,
  WHOLESALE_COMPANY_NAMES,
  InsuranceRentalItemPair,
  InsuranceRentalClientReconciliation,
} from '../types';
import {
  loadItemMappings,
  saveItemMappings,
  buildItemPairs,
  extractMappingsFromPairs,
  INSURANCE_RENTAL_COLLECTION,
} from '../src/services/insuranceRentalMatchService';

interface Props {
  reconciliation: InsuranceRentalClientReconciliation;
  onClose: () => void;
  onSaved?: () => void; // 保存成功時のコールバック
  collectionName?: string; // Firestoreコレクション名（デフォルト: 介護保険レンタル）
  otherCollectionNames?: string[]; // 他セクションのコレクション名（他セクション突合済チェック用）
  ourAmountLabel?: string; // 弊社金額のラベル（デフォルト: カイポケ合計）
}

const InsuranceRentalClientDetailModal: React.FC<Props> = ({ reconciliation, onClose, onSaved, collectionName = INSURANCE_RENTAL_COLLECTION, otherCollectionNames = [], ourAmountLabel = 'カイポケ合計' }) => {
  const { aozoraId, clientName, wholesaleCompany, ourItems, wholesalerItems, ourAmount } = reconciliation;

  const [pairs, setPairs] = useState<InsuranceRentalItemPair[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  // 追加中の弊社品目ID（ドロップダウンを表示する対象）
  const [addingForOurItemId, setAddingForOurItemId] = useState<string | null>(null);
  // 他セクションで紐づけ済の卸品目名セット
  const [crossSectionLinkedNames, setCrossSectionLinkedNames] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        const [savedMappings, ...otherMappingsArr] = await Promise.all([
          loadItemMappings(wholesaleCompany, aozoraId, collectionName),
          ...otherCollectionNames.map(col => loadItemMappings(wholesaleCompany, aozoraId, col)),
        ]);
        setPairs(buildItemPairs(ourItems, wholesalerItems, savedMappings));

        // 他セクションで紐づけ済の卸品目名を収集
        const linked = new Set<string>();
        for (const mappings of otherMappingsArr) {
          for (const m of mappings) {
            for (const name of m.wholesalerItemNames) {
              linked.add(name);
            }
          }
        }
        setCrossSectionLinkedNames(linked);
      } catch {
        setPairs(buildItemPairs(ourItems, wholesalerItems, []));
      } finally {
        setIsLoading(false);
      }
    })();
  }, [aozoraId, wholesaleCompany, ourItems, wholesalerItems]);

  // 現在使用中の卸品目IDセット
  const usedWholesalerIds = new Set(
    pairs.flatMap(p => p.ourItem ? p.wholesalerItems.map(w => w.id) : [])
  );

  // 未紐づけの卸品目（追加候補）
  const availableWholesalerItems = wholesalerItems.filter(w => !usedWholesalerIds.has(w.id));

  // 卸品目を弊社品目に追加
  const handleAddWholesalerItem = (ourItemId: string, wholesalerItemId: string) => {
    const wItem = wholesalerItems.find(w => w.id === wholesalerItemId);
    if (!wItem) return;

    setPairs(prev => prev.map(p => {
      if (p.ourItem?.id !== ourItemId) return p;
      return {
        ...p,
        wholesalerItems: [
          ...p.wholesalerItems,
          { id: wItem.id, name: wItem.itemName, amount: wItem.amount },
        ],
      };
    }).filter(p =>
      // ourItem=nullで該当品目だったペアを除去
      !(p.ourItem === null && p.wholesalerItems.some(w => w.id === wholesalerItemId))
    ));
    setAddingForOurItemId(null);
  };

  // 卸品目を弊社品目から外す
  const handleRemoveWholesalerItem = (ourItemId: string, wholesalerItemId: string) => {
    setPairs(prev => {
      const newPairs = prev.map(p => {
        if (p.ourItem?.id !== ourItemId) return p;
        return { ...p, wholesalerItems: p.wholesalerItems.filter(w => w.id !== wholesalerItemId) };
      });
      // 外れた品目を「弊社品目なし」として末尾に追加
      const wItem = wholesalerItems.find(w => w.id === wholesalerItemId);
      if (wItem) {
        newPairs.push({
          ourItem: null,
          wholesalerItems: [{ id: wItem.id, name: wItem.itemName, amount: wItem.amount }],
        });
      }
      return newPairs;
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveItemMappings(wholesaleCompany, aozoraId, extractMappingsFromPairs(pairs), collectionName);
      setSaveMessage('保存しました');
      onSaved?.();
      setTimeout(() => setSaveMessage(''), 2000);
    } catch {
      setSaveMessage('保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  // 紐づけ済みの卸品目のみ合計（他セクション突合済・未紐づけ・自社ベッドは除外）
  const wholesalerTotal = pairs
    .filter(p => p.ourItem !== null && !p.ourItem.isCompanyOwned)
    .flatMap(p => p.wholesalerItems)
    .reduce((s, w) => s + w.amount, 0);
  const difference = ourAmount - wholesalerTotal;
  // 未紐づけを「他セクション突合済」と「本当の未紐づけ」に分類
  const allUnmatchedPairs = pairs.filter(p => p.ourItem === null);
  const crossLinkedPairs = allUnmatchedPairs.filter(p =>
    p.wholesalerItems.some(w => crossSectionLinkedNames.has(w.name))
  );
  const unmatchedPairs = allUnmatchedPairs.filter(p =>
    !p.wholesalerItems.some(w => crossSectionLinkedNames.has(w.name))
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* ヘッダー */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{clientName} — 品目突合</h2>
            <p className="text-sm text-gray-500 mt-0.5">{WHOLESALE_COMPANY_NAMES[wholesaleCompany]}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 金額サマリー */}
        <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 flex gap-6 text-sm flex-wrap">
          <div>
            <span className="text-gray-500">{ourAmountLabel}：</span>
            <span className="font-semibold text-blue-700">¥{ourAmount.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-gray-500">卸請求合計：</span>
            <span className="font-semibold text-orange-700">¥{wholesalerTotal.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-gray-500">差額：</span>
            <span className={`font-semibold ${difference === 0 ? 'text-green-700' : 'text-red-600'}`}>
              {difference >= 0 ? '+' : ''}{difference.toLocaleString()}円
            </span>
          </div>
        </div>

        {/* 品目リスト */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <svg className="w-6 h-6 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              読み込み中...
            </div>
          ) : (
            <div className="space-y-3">
              {/* カラムヘッダー */}
              <div className="grid grid-cols-[1fr_auto_1fr] gap-3 px-3 text-xs font-medium text-gray-500 uppercase">
                <div>弊社品目（{ourAmountLabel.replace('合計', '')}）</div>
                <div></div>
                <div>卸品目</div>
              </div>

              {/* 弊社品目ごとの行 */}
              {pairs.filter(p => p.ourItem !== null).map(pair => {
                const ourItem = pair.ourItem!;
                const rowTotal = pair.wholesalerItems.reduce((s, w) => s + w.amount, 0);
                const isAdding = addingForOurItemId === ourItem.id;

                return (
                  <div
                    key={ourItem.id}
                    className={`grid grid-cols-[1fr_auto_1fr] gap-3 items-start px-3 py-3 rounded-lg ${
                      ourItem.isCompanyOwned ? 'bg-purple-50' : pair.wholesalerItems.length > 0 ? 'bg-green-50' : 'bg-amber-50'
                    }`}
                  >
                    {/* 弊社品目 */}
                    <div className="pt-1 leading-snug">
                      <div className="text-sm text-gray-800">{ourItem.name}</div>
                      {ourItem.isCompanyOwned && (
                        <span className="inline-flex items-center px-1.5 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full font-medium mt-0.5">
                          自社ベッド
                        </span>
                      )}
                      {!ourItem.isCompanyOwned && ourItem.salesAmount ? (
                        <div className="text-xs text-gray-500 mt-0.5">¥{ourItem.salesAmount.toLocaleString()}</div>
                      ) : null}
                    </div>

                    {/* 矢印 */}
                    <div className="pt-1.5">
                      {ourItem.isCompanyOwned ? (
                        <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                      ) : pair.wholesalerItems.length > 0 ? (
                        <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      )}
                    </div>

                    {/* 卸品目（タグ形式・複数） */}
                    <div className="space-y-1.5">
                      {/* 紐づき済みタグ */}
                      {pair.wholesalerItems.map(wItem => (
                        <div
                          key={wItem.id}
                          className="flex items-center justify-between gap-2 bg-white border border-green-200 rounded-lg px-2.5 py-1.5"
                        >
                          <span className="text-sm text-gray-800 truncate flex-1">{wItem.name}</span>
                          <span className="text-sm font-medium text-gray-600 whitespace-nowrap">
                            ¥{wItem.amount.toLocaleString()}
                          </span>
                          <button
                            onClick={() => handleRemoveWholesalerItem(ourItem.id, wItem.id)}
                            className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
                            title="紐づけを解除"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}

                      {/* 小計（複数紐づきの場合） */}
                      {pair.wholesalerItems.length >= 2 && (
                        <div className="text-right text-xs text-gray-500 pr-1">
                          小計：¥{rowTotal.toLocaleString()}
                        </div>
                      )}

                      {/* 自社ベッドは仕入不要のため追加不可 */}
                      {ourItem.isCompanyOwned ? (
                        <div className="text-xs text-purple-500 italic">仕入不要（自社ベッド）</div>
                      ) : isAdding ? (
                        <div className="flex items-center gap-2">
                          <select
                            autoFocus
                            defaultValue=""
                            onChange={e => {
                              if (e.target.value) handleAddWholesalerItem(ourItem.id, e.target.value);
                            }}
                            className="flex-1 text-sm border border-blue-300 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-blue-400"
                          >
                            <option value="">— 追加する卸品目を選択 —</option>
                            {availableWholesalerItems.map(w => (
                              <option key={w.id} value={w.id}>
                                {w.itemName}（¥{w.amount.toLocaleString()}）
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => setAddingForOurItemId(null)}
                            className="text-gray-400 hover:text-gray-600 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ) : availableWholesalerItems.length > 0 ? (
                        <button
                          onClick={() => setAddingForOurItemId(ourItem.id)}
                          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          卸品目を追加
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {/* 他セクションで突合済みの卸品目 */}
              {crossLinkedPairs.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    他セクションで突合済み（このセクションでの紐づけ不要）
                  </p>
                  {crossLinkedPairs.map(pair =>
                    pair.wholesalerItems.map(wItem => (
                      <div
                        key={wItem.id}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 mb-1"
                      >
                        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-sm text-gray-500 flex-1">{wItem.name}</span>
                        <span className="text-sm font-medium text-gray-400">¥{wItem.amount.toLocaleString()}</span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* 弊社品目に紐づいていない卸品目 */}
              {unmatchedPairs.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-medium text-red-600 mb-2 flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    弊社品目に紐づいていない卸品目
                  </p>
                  {unmatchedPairs.map(pair =>
                    pair.wholesalerItems.map(wItem => (
                      <div
                        key={wItem.id}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg bg-red-50 mb-1"
                      >
                        <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        <span className="text-sm text-red-700 flex-1">{wItem.name}</span>
                        <span className="text-sm font-medium text-red-700">¥{wItem.amount.toLocaleString()}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <p className="text-xs text-gray-500">保存した紐づけは翌月以降も自動適用されます</p>
          <div className="flex items-center gap-3">
            {saveMessage && (
              <span className={`text-sm ${saveMessage.includes('失敗') ? 'text-red-600' : 'text-green-600'}`}>
                {saveMessage}
              </span>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
            >
              閉じる
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  保存中...
                </>
              ) : '紐づけを保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InsuranceRentalClientDetailModal;
