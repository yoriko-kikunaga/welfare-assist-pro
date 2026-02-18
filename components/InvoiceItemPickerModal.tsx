/**
 * InvoiceItemPickerModal - 仕入データ選択モーダル（売上のみタブ用）
 *
 * 売上のみタブで「この売上に対応する仕入データを選ぶ」ためのモーダル。
 * 現在の「仕入のみ」アイテムを一覧表示し、テキスト検索でフィルタ可能。
 */

import React, { useState, useMemo } from 'react';
import { ReconciliationResultV2, WHOLESALE_COMPANY_NAMES, InvoiceItem } from '../types';

interface InvoiceItemPickerModalProps {
  title: string;
  subtitle?: string;  // 売上側の利用者名・商品名・金額
  invoiceOnlyResults: ReconciliationResultV2[];  // 仕入のみのresults
  onSelect: (invoiceItem: InvoiceItem) => void;
  onClose: () => void;
}

export default function InvoiceItemPickerModal({
  title,
  subtitle,
  invoiceOnlyResults,
  onSelect,
  onClose,
}: InvoiceItemPickerModalProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // 検索結果をフィルタ
  const filteredResults = useMemo(() => {
    if (!searchQuery.trim()) return invoiceOnlyResults;

    const query = searchQuery.toLowerCase();
    return invoiceOnlyResults.filter(r => {
      const item = r.invoiceItem;
      if (!item) return false;
      return (
        item.customerName?.toLowerCase().includes(query) ||
        item.itemName?.toLowerCase().includes(query) ||
        WHOLESALE_COMPANY_NAMES[item.wholesaleCompany]?.toLowerCase().includes(query)
      );
    });
  }, [searchQuery, invoiceOnlyResults]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        {/* ヘッダー */}
        <div className="px-6 py-4 border-b bg-purple-50">
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
          <p className="text-xs text-purple-600 mt-1">
            仕入のみ: {invoiceOnlyResults.length}件から選択
          </p>
        </div>

        {/* 検索フィールド */}
        <div className="px-6 py-3 border-b">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="利用者名・商品名・卸会社で検索..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
            autoFocus
          />
        </div>

        {/* 仕入アイテム一覧 */}
        <div className="flex-1 overflow-y-auto">
          {filteredResults.length > 0 ? (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">利用者</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">商品名</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">金額</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">卸会社</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500">選択</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredResults.map((result) => {
                  const item = result.invoiceItem;
                  if (!item) return null;
                  return (
                    <tr key={result.id} className="hover:bg-purple-50 cursor-pointer" onClick={() => onSelect(item)}>
                      <td className="px-4 py-3 text-sm text-gray-900">{item.customerName}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{item.itemName}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right">
                        ¥{item.amount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {WHOLESALE_COMPANY_NAMES[item.wholesaleCompany]}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); onSelect(item); }}
                          className="px-2 py-1 text-xs text-purple-700 bg-purple-100 rounded hover:bg-purple-200 transition-colors"
                        >
                          選択
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="text-center py-8 text-sm text-gray-500">
              {searchQuery ? '該当する仕入データが見つかりません' : '仕入のみのデータがありません'}
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
