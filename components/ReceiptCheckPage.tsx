import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Client, ReceiptCheckItem } from '../types';
import {
  getReceiptCheck,
  saveReceiptCheck,
  generateReceiptCheckFromClients,
  exportReceiptCheckCSV
} from '../src/services/receiptCheckService';

interface ReceiptCheckPageProps {
  clients: Client[];
  userEmail: string;
}

const OFFICE_OPTIONS = ['全事業所', '鹿児島（ACG）', '福岡（Lichi）'] as const;

type SortKey = keyof ReceiptCheckItem;
type SortDir = 'asc' | 'desc';

const ReceiptCheckPage: React.FC<ReceiptCheckPageProps> = ({ clients, userEmail }) => {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [billingMonth, setBillingMonth] = useState(defaultMonth);
  const [office, setOffice] = useState<string>('全事業所');
  const [items, setItems] = useState<ReceiptCheckItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importingFromClients, setImportingFromClients] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Firestoreからロード
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const doc = await getReceiptCheck(billingMonth, office);
      setItems(doc?.items || []);
    } catch (error) {
      console.error('レセプトチェックの読み込みに失敗:', error);
    } finally {
      setLoading(false);
    }
  }, [billingMonth, office]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ソート済みアイテム（表示用）+ 元インデックスのマッピング
  const sortedItems = useMemo(() => {
    const indexed = items.map((item, idx) => ({ item, origIdx: idx }));
    if (!sortKey) return indexed;

    return [...indexed].sort((a, b) => {
      const valA = a.item[sortKey];
      const valB = b.item[sortKey];

      // boolean: true > false
      if (typeof valA === 'boolean' && typeof valB === 'boolean') {
        if (valA === valB) return 0;
        const result = valA ? -1 : 1;
        return sortDir === 'asc' ? result : -result;
      }

      // number
      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortDir === 'asc' ? valA - valB : valB - valA;
      }

      // string（空文字は末尾に）
      const strA = String(valA || '');
      const strB = String(valB || '');
      if (!strA && strB) return 1;
      if (strA && !strB) return -1;
      const cmp = strA.localeCompare(strB, 'ja');
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [items, sortKey, sortDir]);

  // ヘッダークリックでソート切替
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      if (sortDir === 'asc') {
        setSortDir('desc');
      } else {
        // 3回目クリックでソート解除
        setSortKey(null);
        setSortDir('asc');
      }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  // ソートインジケーター
  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return <span className="text-gray-300 ml-0.5">⇅</span>;
    return <span className="text-rose-600 ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  // デバウンス自動保存
  const scheduleSave = useCallback((updatedItems: ReceiptCheckItem[]) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await saveReceiptCheck(billingMonth, office, updatedItems, userEmail);
      } catch (error) {
        console.error('レセプトチェックの保存に失敗:', error);
      } finally {
        setSaving(false);
      }
    }, 500);
  }, [billingMonth, office, userEmail]);

  // チェックボックスのトグル（元配列のインデックスで操作）
  const toggleCheckbox = (origIdx: number, field: keyof ReceiptCheckItem) => {
    setItems(prev => {
      const updated = [...prev];
      updated[origIdx] = { ...updated[origIdx], [field]: !updated[origIdx][field as keyof ReceiptCheckItem] };
      scheduleSave(updated);
      return updated;
    });
  };

  // 利用者データから取込
  const handleImportFromClients = async () => {
    setImportingFromClients(true);
    try {
      const generated = generateReceiptCheckFromClients(clients, billingMonth, office);

      if (generated.length === 0) {
        alert('該当する介護保険レンタル利用者がいません。\nカイポケCSVインポートが完了しているか確認してください。');
        return;
      }

      // 既存データがある場合、チェック状態をマージ
      if (items.length > 0) {
        const existingMap = new Map(items.map(i => [i.aozoraId, i]));
        const merged = generated.map(gen => {
          const existing = existingMap.get(gen.aozoraId);
          if (existing) {
            return {
              ...gen,
              provisionTicketReceived: existing.provisionTicketReceived,
              unitsDifference: existing.unitsDifference,
              changedFromLastMonth: existing.changedFromLastMonth,
              kaipokePlanCreated: existing.kaipokePlanCreated,
              welfareCareTicket: existing.welfareCareTicket,
              reflectedFromManagement: existing.reflectedFromManagement,
              performanceReport: existing.performanceReport,
              delayed: existing.delayed,
            };
          }
          return gen;
        });
        setItems(merged);
        await saveReceiptCheck(billingMonth, office, merged, userEmail);
      } else {
        setItems(generated);
        await saveReceiptCheck(billingMonth, office, generated, userEmail);
      }
    } catch (error) {
      console.error('利用者データ取込に失敗:', error);
      alert('利用者データの取込に失敗しました。');
    } finally {
      setImportingFromClients(false);
    }
  };

  const checkboxFieldsBefore: { key: keyof ReceiptCheckItem; label: string }[] = [
    { key: 'provisionTicketReceived', label: '提供票受領' },
    { key: 'unitsDifference', label: '単位数差異' },
    { key: 'changedFromLastMonth', label: '先月変更' },
    { key: 'kaipokePlanCreated', label: 'カイポケ計画書' },
  ];

  const checkboxFieldsAfter: { key: keyof ReceiptCheckItem; label: string }[] = [
    { key: 'reflectedFromManagement', label: '管理表反映' },
    { key: 'performanceReport', label: '実績報告書' },
    { key: 'delayed', label: '月遅れ' },
  ];

  const dateFields: { key: keyof ReceiptCheckItem; label: string }[] = [
    { key: 'firstUseDate', label: '利用初回日' },
    { key: 'hospitalizationDate', label: '入院日' },
    { key: 'dischargeDate', label: '退院日' },
    { key: 'cancellationDate', label: '解約日' },
  ];

  const thClass = "px-3 py-2 text-center font-medium text-gray-600 border-b border-gray-200 whitespace-nowrap cursor-pointer hover:bg-gray-200 select-none transition-colors";
  const thClassLeft = "px-3 py-2 text-left font-medium text-gray-600 border-b border-gray-200 whitespace-nowrap cursor-pointer hover:bg-gray-200 select-none transition-colors";

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* ヘッダー */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-rose-600">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
            </svg>
            レセプトチェック
          </h1>

          <div className="flex items-center gap-3">
            <input
              type="month"
              value={billingMonth}
              onChange={e => setBillingMonth(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-rose-500 focus:border-transparent"
            />
            <select
              value={office}
              onChange={e => setOffice(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-rose-500 focus:border-transparent"
            >
              {OFFICE_OPTIONS.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            {saving && (
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                保存中...
              </span>
            )}
          </div>
        </div>

        {/* アクションバー */}
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={handleImportFromClients}
            disabled={importingFromClients}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-400 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            {importingFromClients ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
              </svg>
            )}
            利用者データから取込
          </button>

          <button
            onClick={() => items.length > 0 && exportReceiptCheckCSV(items)}
            disabled={items.length === 0}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            CSVエクスポート
          </button>

          <span className="text-sm text-gray-500 ml-auto">
            {items.length}件
          </span>
        </div>
      </div>

      {/* テーブル */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-rose-600 mb-2" />
              <p className="text-gray-500 text-sm">読み込み中...</p>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center text-gray-400">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor" className="w-16 h-16 mx-auto mb-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
              </svg>
              <p className="text-lg font-medium mb-1">データがありません</p>
              <p className="text-sm">「利用者データから取込」ボタンで介護保険レンタル利用者を自動取込できます</p>
            </div>
          </div>
        ) : (
          <table className="min-w-full text-sm border-collapse">
            <thead className="bg-gray-100 sticky top-0 z-10">
              <tr>
                <th className="sticky left-0 z-20 bg-gray-100 px-3 py-2 text-left font-medium text-gray-600 border-b border-r border-gray-200 whitespace-nowrap">No.</th>
                <th onClick={() => handleSort('aozoraId')} className="sticky left-[40px] z-20 bg-gray-100 px-3 py-2 text-left font-medium text-gray-600 border-b border-r border-gray-200 whitespace-nowrap cursor-pointer hover:bg-gray-200 select-none transition-colors">
                  あおぞらID{sortIndicator('aozoraId')}
                </th>
                <th onClick={() => handleSort('clientName')} className="sticky left-[130px] z-20 bg-gray-100 px-3 py-2 text-left font-medium text-gray-600 border-b border-r border-gray-200 whitespace-nowrap min-w-[100px] cursor-pointer hover:bg-gray-200 select-none transition-colors">
                  利用者名{sortIndicator('clientName')}
                </th>
                <th onClick={() => handleSort('office')} className={thClass}>事業所{sortIndicator('office')}</th>
                <th onClick={() => handleSort('units')} className={thClass}>単位数{sortIndicator('units')}</th>
                {checkboxFieldsBefore.map(f => (
                  <th key={f.key} onClick={() => handleSort(f.key)} className="px-2 py-2 text-center font-medium text-gray-600 border-b border-gray-200 whitespace-nowrap cursor-pointer hover:bg-gray-200 select-none transition-colors">
                    <span className="text-xs">{f.label}{sortIndicator(f.key)}</span>
                  </th>
                ))}
                <th onClick={() => handleSort('welfareRecipient')} className="px-3 py-2 text-center font-medium text-gray-600 border-b border-gray-200 whitespace-nowrap bg-yellow-50 cursor-pointer hover:bg-yellow-100 select-none transition-colors">
                  <span className="text-xs">生保受給{sortIndicator('welfareRecipient')}</span>
                </th>
                <th onClick={() => handleSort('welfareCareTicket')} className="px-2 py-2 text-center font-medium text-gray-600 border-b border-gray-200 whitespace-nowrap bg-yellow-50 cursor-pointer hover:bg-yellow-100 select-none transition-colors">
                  <span className="text-xs">生保介護券{sortIndicator('welfareCareTicket')}</span>
                </th>
                {checkboxFieldsAfter.map(f => (
                  <th key={f.key} onClick={() => handleSort(f.key)} className="px-2 py-2 text-center font-medium text-gray-600 border-b border-gray-200 whitespace-nowrap cursor-pointer hover:bg-gray-200 select-none transition-colors">
                    <span className="text-xs">{f.label}{sortIndicator(f.key)}</span>
                  </th>
                ))}
                {dateFields.map(f => (
                  <th key={f.key} onClick={() => handleSort(f.key)} className={thClass}>
                    <span className="text-xs">{f.label}{sortIndicator(f.key)}</span>
                  </th>
                ))}
                <th onClick={() => handleSort('location')} className={thClassLeft}>拠点{sortIndicator('location')}</th>
                <th onClick={() => handleSort('careOffice')} className={thClassLeft}>介護事業所{sortIndicator('careOffice')}</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map(({ item, origIdx }, displayIdx) => (
                <tr
                  key={item.aozoraId}
                  className={`${displayIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-rose-50 transition-colors`}
                >
                  <td className="sticky left-0 z-10 px-3 py-2 border-b border-r border-gray-200 text-gray-500 text-xs bg-inherit">{displayIdx + 1}</td>
                  <td className="sticky left-[40px] z-10 px-3 py-2 border-b border-r border-gray-200 font-mono text-xs text-gray-600 bg-inherit whitespace-nowrap">{item.aozoraId}</td>
                  <td className="sticky left-[130px] z-10 px-3 py-2 border-b border-r border-gray-200 font-medium text-gray-800 bg-inherit whitespace-nowrap">{item.clientName}</td>
                  <td className="px-3 py-2 border-b border-gray-200 text-center text-xs text-gray-600 whitespace-nowrap">{item.office}</td>
                  <td className="px-3 py-2 border-b border-gray-200 text-center font-medium">{item.units || ''}</td>
                  {checkboxFieldsBefore.map(f => (
                    <td key={f.key} className="px-2 py-2 border-b border-gray-200 text-center">
                      <input
                        type="checkbox"
                        checked={!!item[f.key]}
                        onChange={() => toggleCheckbox(origIdx, f.key)}
                        className="w-4 h-4 text-rose-600 rounded cursor-pointer focus:ring-rose-500"
                      />
                    </td>
                  ))}
                  <td className={`px-3 py-2 border-b border-gray-200 text-center ${item.welfareRecipient ? 'bg-yellow-100 font-bold text-yellow-800' : ''}`}>
                    {item.welfareRecipient ? '○' : ''}
                  </td>
                  <td className={`px-2 py-2 border-b border-gray-200 text-center ${item.welfareRecipient ? 'bg-yellow-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={!!item.welfareCareTicket}
                      onChange={() => toggleCheckbox(origIdx, 'welfareCareTicket')}
                      className="w-4 h-4 text-rose-600 rounded cursor-pointer focus:ring-rose-500"
                    />
                  </td>
                  {checkboxFieldsAfter.map(f => (
                    <td key={f.key} className="px-2 py-2 border-b border-gray-200 text-center">
                      <input
                        type="checkbox"
                        checked={!!item[f.key]}
                        onChange={() => toggleCheckbox(origIdx, f.key)}
                        className="w-4 h-4 text-rose-600 rounded cursor-pointer focus:ring-rose-500"
                      />
                    </td>
                  ))}
                  {dateFields.map(f => (
                    <td key={f.key} className="px-3 py-2 border-b border-gray-200 text-center text-xs text-gray-600 whitespace-nowrap">
                      {(item[f.key] as string) || ''}
                    </td>
                  ))}
                  <td className="px-3 py-2 border-b border-gray-200 text-xs text-gray-600 whitespace-nowrap">{item.location}</td>
                  <td className="px-3 py-2 border-b border-gray-200 text-xs text-gray-600 whitespace-nowrap max-w-[200px] truncate" title={item.careOffice}>{item.careOffice}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default ReceiptCheckPage;
