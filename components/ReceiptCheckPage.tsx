import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Client, ReceiptCheckItem } from '../types';
import {
  getReceiptCheck,
  saveReceiptCheck,
  generateReceiptCheckFromClients,
  refreshItemsFromClients,
  filterOutJihiOnly,
  filterOutNonWelfareUsers,
  markCancelledBeforeCandidates,
  exportReceiptCheckCSV
} from '../src/services/receiptCheckService';
import { AsOfBasis } from '../src/utils/attributeHistory';

interface ReceiptCheckPageProps {
  clients: Client[];
  baseClients: Client[];
  userEmail: string;
  onUpdateClient: (updatedClient: Client) => void;
}

const OFFICE_OPTIONS = ['全事業所', '鹿児島（ACG）', '福岡（Lichi）'] as const;

type SortKey = keyof ReceiptCheckItem;
type SortDir = 'asc' | 'desc';

const ReceiptCheckPage: React.FC<ReceiptCheckPageProps> = ({ clients, baseClients, userEmail, onUpdateClient }) => {
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
  const [searchQuery, setSearchQuery] = useState('');
  // 変更履歴の「その月の状態」基準日（月初/月末）。localStorageに保持
  const [asOfBasis, setAsOfBasis] = useState<AsOfBasis>(() => {
    try { return (localStorage.getItem('receiptCheckAsOfBasis') as AsOfBasis) === 'start' ? 'start' : 'end'; } catch { return 'end'; }
  });
  const changeAsOfBasis = (b: AsOfBasis) => {
    setAsOfBasis(b);
    try { localStorage.setItem('receiptCheckAsOfBasis', b); } catch { /* noop */ }
  };

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Firestoreからロード（保存キーは常に「全事業所」、事業所選択は表示フィルタのみ）
  // ページ開封時に isWelfareEquipmentUser ベースで自動マージ
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const docData = await getReceiptCheck(billingMonth, '全事業所');
      const rawItems = docData?.items || [];

      // 最新の isWelfareEquipmentUser 利用者リストを生成
      // baseClients を渡すことで insuranceRentalOverride=true でも正しく判定
      const generated = generateReceiptCheckFromClients(clients, billingMonth, '全事業所', baseClients, asOfBasis);

      if (rawItems.length === 0) {
        // Firestoreにデータなし → 生成リストをそのまま表示（保存はしない）
        setItems(generated);
        return;
      }

      // 既存データを動的フィールド（事業所・拠点・生保・入退院日等）で最新化
      const refreshed = refreshItemsFromClients(rawItems, clients, billingMonth, asOfBasis);

      const monthStart = `${billingMonth}-01`;
      const clientMap = new Map(clients.map(c => [c.aozoraId, c]));

      // receiptCheckTarget=true は強制追加（フィルタをバイパス）
      // receiptCheckTarget=false は強制除外（他フィルタより優先）
      // receiptCheckTarget=undefined は自動判定フィルタを適用
      const forceItems = refreshed.filter(item => clientMap.get(item.aozoraId)?.receiptCheckTarget === true);
      const autoItems  = refreshed.filter(item => {
        const t = clientMap.get(item.aozoraId)?.receiptCheckTarget;
        return t !== true && t !== false;
      });

      // 自動判定アイテムにのみフィルタ適用
      const afterJihi    = filterOutJihiOnly(autoItems, clients, billingMonth, baseClients);
      const afterWelfare = filterOutNonWelfareUsers(afterJihi, clients);
      // 解約日による除外は削除せず autoExcludeCandidate フラグを立てるのみ（サイレント削除防止）
      const flaggedAuto  = markCancelledBeforeCandidates(afterWelfare, monthStart);

      // 強制追加 + 自動判定結果を合算（receiptCheckTarget=false は含まれない）
      const validItems = [...forceItems, ...flaggedAuto];

      // 既存リストにない新規利用者のみ追加（既存データは削除しない）
      const existingIds = new Set(validItems.map(i => i.aozoraId));
      const newItems = generated.filter(g => !existingIds.has(g.aozoraId));

      const merged = [...validItems, ...newItems].sort((a, b) => {
        const kanaA = a.nameKana || a.clientName;
        const kanaB = b.nameKana || b.clientName;
        return kanaA.localeCompare(kanaB, 'ja');
      });

      setItems(merged);

      // 新規追加・除外があれば自動保存
      if (clients.length > 0 && (newItems.length > 0 || validItems.length !== refreshed.length)) {
        await saveReceiptCheck(billingMonth, '全事業所', merged, userEmail);
      }
    } catch (error) {
      console.error('レセプトチェックの読み込みに失敗:', error);
    } finally {
      setLoading(false);
    }
  }, [billingMonth, clients, baseClients, userEmail, asOfBasis]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ソート済み＆フィルタ済みアイテム（表示用）+ 元インデックスのマッピング
  const sortedItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const indexed = items
      .map((item, idx) => ({ item, origIdx: idx }))
      .filter(({ item }) => {
        // 事業所フィルタ（「全事業所」の場合は全件表示）
        if (office !== '全事業所' && item.office !== office) return false;
        // 検索フィルタ
        if (!q) return true;
        return (
          item.clientName.toLowerCase().includes(q) ||
          (item.careOffice || '').toLowerCase().includes(q)
        );
      });
    if (!sortKey) {
      // デフォルトはあかさたな順（nameKana → clientName フォールバック）
      return [...indexed].sort((a, b) => {
        const kanaA = a.item.nameKana || a.item.clientName;
        const kanaB = b.item.nameKana || b.item.clientName;
        return kanaA.localeCompare(kanaB, 'ja');
      });
    }

    return [...indexed].sort((a, b) => {
      // 利用者名ソートはカナ読みで行う
      if (sortKey === 'clientName') {
        const kanaA = a.item.nameKana || a.item.clientName;
        const kanaB = b.item.nameKana || b.item.clientName;
        const cmp = kanaA.localeCompare(kanaB, 'ja');
        return sortDir === 'asc' ? cmp : -cmp;
      }

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
  }, [items, sortKey, sortDir, searchQuery, office]);

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

  // デバウンス自動保存（保存キーは常に「全事業所」）
  const scheduleSave = useCallback((updatedItems: ReceiptCheckItem[]) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await saveReceiptCheck(billingMonth, '全事業所', updatedItems, userEmail);
      } catch (error) {
        console.error('レセプトチェックの保存に失敗:', error);
      } finally {
        setSaving(false);
      }
    }, 500);
  }, [billingMonth, userEmail]);

  // チェックボックスのトグル（元配列のインデックスで操作）
  const toggleCheckbox = (origIdx: number, field: keyof ReceiptCheckItem) => {
    setItems(prev => {
      const updated = [...prev];
      updated[origIdx] = { ...updated[origIdx], [field]: !updated[origIdx][field as keyof ReceiptCheckItem] };
      scheduleSave(updated);
      return updated;
    });
  };

  // テキスト・数値フィールドの更新
  const updateField = useCallback(<K extends keyof ReceiptCheckItem>(
    origIdx: number,
    field: K,
    value: ReceiptCheckItem[K]
  ) => {
    setItems(prev => {
      const updated = [...prev];
      updated[origIdx] = { ...updated[origIdx], [field]: value };
      scheduleSave(updated);
      return updated;
    });
  }, [scheduleSave]);

  // 自動除外候補（解約日により対象外候補）の確認操作
  // 「対象に残す」= receiptCheckTarget: true（強制追加、以後この警告は出ない）
  // 「除外する」  = receiptCheckTarget: false（強制除外、一覧から外れる）
  // 基本情報タブと同じ receiptCheckTarget フラグを更新するだけなので、
  // 次回の loadData() で自動的に反映される（この画面側の items は直接操作しない）
  const resolveExcludeCandidate = (aozoraId: string, keep: boolean) => {
    const client = clients.find(c => c.aozoraId === aozoraId);
    if (!client) return;
    onUpdateClient({ ...client, receiptCheckTarget: keep });
  };

  // 利用者データから取込
  const handleImportFromClients = async () => {
    setImportingFromClients(true);
    try {
      // 常に全事業所で生成（事業所選択は表示フィルタのみ）
      const generated = generateReceiptCheckFromClients(clients, billingMonth, '全事業所', baseClients, asOfBasis);

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
              // 手動編集された単位数を保持（再取込で上書きしない）
              units: existing.units,
              // チェック状態を保持
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
        await saveReceiptCheck(billingMonth, '全事業所', merged, userEmail);
      } else {
        setItems(generated);
        await saveReceiptCheck(billingMonth, '全事業所', generated, userEmail);
      }
    } catch (error) {
      console.error('利用者データ取込に失敗:', error);
      alert('利用者データの取込に失敗しました。');
    } finally {
      setImportingFromClients(false);
    }
  };

  // 月度更新：当月（billingMonth）内に解約日がある利用者を一覧から除外
  const [updatingMonth, setUpdatingMonth] = useState(false);
  const handleMonthlyUpdate = async () => {
    // 解約日のうち当月内のものが1件でもある利用者のみ除外対象
    const isTargetMonth = (cancellationDate: string) => {
      const dates = cancellationDate.split(',').map(d => d.trim()).filter(Boolean);
      return dates.some(d => d.startsWith(billingMonth));
    };

    const toRemove = items.filter(item => item.cancellationDate && isTargetMonth(item.cancellationDate));
    if (toRemove.length === 0) {
      alert(`${billingMonth} 内に解約日が入力されている利用者はいません。`);
      return;
    }
    const confirmed = window.confirm(
      `${billingMonth} の月度更新を実行しますか？\n\n以下の${toRemove.length}名を一覧から除外します：\n${toRemove.map(i => i.clientName).join('、')}`
    );
    if (!confirmed) return;
    setUpdatingMonth(true);
    try {
      const updated = items.filter(item => !(item.cancellationDate && isTargetMonth(item.cancellationDate)));
      setItems(updated);
      await saveReceiptCheck(billingMonth, '全事業所', updated, userEmail);

      // 翌月の単位数に引き継ぐ
      const [year, mon] = billingMonth.split('-').map(Number);
      const nextMonth = mon === 12
        ? `${year + 1}-01`
        : `${year}-${String(mon + 1).padStart(2, '0')}`;
      const unitsMap = new Map(updated.map(i => [i.aozoraId, i.units]));

      const nextDoc = await getReceiptCheck(nextMonth, '全事業所');
      if (nextDoc && nextDoc.items.length > 0) {
        // 翌月データが既にある → 単位数を上書き・解約日ロックを解除
        const nextUpdated = nextDoc.items.map(item => ({
          ...item,
          ...(unitsMap.has(item.aozoraId) ? { units: unitsMap.get(item.aozoraId)! } : {}),
          cancellationDateLocked: false,
        }));
        await saveReceiptCheck(nextMonth, '全事業所', nextUpdated, userEmail);
      } else {
        // 翌月データなし → 当月の残存リストをそのまま初期値として保存
        const nextItems = updated.map(item => ({
          ...item,
          // 日付・チェック状態はリセット
          firstUseDate: item.firstUseDate,
          hospitalizationDate: '',
          dischargeDate: '',
          cancellationDate: '',
          cancellationDateLocked: false,
          provisionTicketReceived: false,
          unitsDifference: false,
          changedFromLastMonth: false,
          kaipokePlanCreated: false,
          welfareCareTicket: false,
          reflectedFromManagement: false,
          performanceReport: false,
          delayed: false,
        }));
        await saveReceiptCheck(nextMonth, '全事業所', nextItems, userEmail);
      }
    } catch (error) {
      console.error('月度更新に失敗:', error);
      alert('月度更新に失敗しました。');
    } finally {
      setUpdatingMonth(false);
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

  const dateFields: { key: keyof ReceiptCheckItem; label: string; editable?: boolean }[] = [
    { key: 'firstUseDate', label: '利用初回日', editable: true },
    { key: 'hospitalizationDate', label: '入院日' },
    { key: 'dischargeDate', label: '退院日' },
    { key: 'cancellationDate', label: '解約日', editable: true },
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
            {/* 履歴の「その月の状態」基準日 月初/月末 切替 */}
            <div className="flex items-center gap-1" title="変更履歴から「その月の状態」を求める基準日。月途中の変更の扱いが変わります。">
              <span className="text-xs text-gray-500">基準日</span>
              <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-sm">
                <button
                  type="button"
                  onClick={() => changeAsOfBasis('start')}
                  className={`px-3 py-2 ${asOfBasis === 'start' ? 'bg-rose-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  月初
                </button>
                <button
                  type="button"
                  onClick={() => changeAsOfBasis('end')}
                  className={`px-3 py-2 border-l border-gray-300 ${asOfBasis === 'end' ? 'bg-rose-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  月末
                </button>
              </div>
            </div>
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
            onClick={handleMonthlyUpdate}
            disabled={updatingMonth || items.length === 0}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            {updatingMonth ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
            )}
            月度更新
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

          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="利用者名・介護事業所で検索"
                className="pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-rose-500 focus:border-transparent w-52"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            <span className="text-sm text-gray-500 whitespace-nowrap">
              {searchQuery ? `${sortedItems.length} / ${items.length}件` : `${items.length}件`}
            </span>
          </div>
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
                  className={`${item.autoExcludeCandidate ? 'bg-red-50' : displayIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-rose-50 transition-colors`}
                >
                  <td className="sticky left-0 z-10 px-3 py-2 border-b border-r border-gray-200 text-gray-500 text-xs bg-inherit">{displayIdx + 1}</td>
                  <td className="sticky left-[40px] z-10 px-3 py-2 border-b border-r border-gray-200 font-mono text-xs text-gray-600 bg-inherit whitespace-nowrap">{item.aozoraId}</td>
                  <td className={`sticky left-[130px] z-10 px-3 py-2 border-b border-r border-gray-200 font-medium text-gray-800 bg-inherit whitespace-nowrap ${item.autoExcludeCandidate ? 'ring-1 ring-inset ring-red-300' : ''}`}>
                    <div>{item.clientName}</div>
                    {item.autoExcludeCandidate && (
                      <div className="mt-1 flex flex-col items-start gap-1">
                        <span className="inline-block px-1.5 py-0.5 text-[10px] font-bold text-red-700 bg-red-100 border border-red-300 rounded whitespace-nowrap">
                          解約日により対象外候補（要確認）
                        </span>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => resolveExcludeCandidate(item.aozoraId, true)}
                            title="在宅等で福祉用具の利用を継続中の場合はこちら（以後この警告は出ません）"
                            className="px-1.5 py-0.5 text-[10px] font-medium text-white bg-teal-600 hover:bg-teal-700 rounded whitespace-nowrap"
                          >
                            対象に残す
                          </button>
                          <button
                            type="button"
                            onClick={() => resolveExcludeCandidate(item.aozoraId, false)}
                            title="実際に利用終了していることを確認できた場合はこちら（一覧から除外）"
                            className="px-1.5 py-0.5 text-[10px] font-medium text-white bg-gray-500 hover:bg-gray-600 rounded whitespace-nowrap"
                          >
                            除外する
                          </button>
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 border-b border-gray-200 text-center text-xs text-gray-600 whitespace-nowrap">{item.office}</td>
                  <td className="px-1 py-1 border-b border-gray-200 text-center">
                    <input
                      type="number"
                      min="0"
                      value={item.units === 0 ? '' : item.units}
                      onChange={e => updateField(origIdx, 'units', parseInt(e.target.value, 10) || 0)}
                      onBlur={e => {
                        if (e.target.value === '') updateField(origIdx, 'units', 0);
                      }}
                      className="w-16 text-center text-sm font-medium border border-gray-300 rounded px-1 py-0.5 focus:ring-1 focus:ring-rose-500 focus:border-rose-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      placeholder="0"
                    />
                  </td>
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
                    <td key={f.key} className={`px-1 py-1 border-b border-gray-200 text-center text-xs whitespace-nowrap ${
                      f.key === 'cancellationDate' && item.cancellationDate ? 'bg-red-100 text-red-700 font-medium' :
                      f.key === 'hospitalizationDate' && item.hospitalizationDate ? 'bg-amber-100 text-amber-700 font-medium' :
                      f.key === 'dischargeDate' && item.dischargeDate ? 'bg-blue-100 text-blue-700 font-medium' :
                      'text-gray-600'
                    }`}>
                      {f.key === 'cancellationDate' ? (
                        <div className="flex items-center gap-0.5 justify-center">
                          <input
                            type="text"
                            value={item.cancellationDate || ''}
                            onChange={e => updateField(origIdx, 'cancellationDate', e.target.value)}
                            placeholder="YYYY-MM-DD"
                            className={`w-28 text-center text-xs border rounded px-1 py-0.5 focus:ring-1 focus:outline-none ${item.cancellationDateLocked ? 'border-amber-400 bg-amber-50 focus:ring-amber-400 focus:border-amber-400' : item.cancellationDate ? 'border-red-300 bg-red-50 text-red-700 focus:ring-red-400 focus:border-red-400' : 'border-gray-300 focus:ring-rose-500 focus:border-rose-500'}`}
                          />
                          <button
                            onClick={() => updateField(origIdx, 'cancellationDateLocked', !item.cancellationDateLocked)}
                            title={item.cancellationDateLocked ? '自動更新をロック中（クリックで解除）' : 'クリックで解約日を手動ロック（自動更新を停止）'}
                            className={`flex-shrink-0 w-5 h-5 rounded text-xs flex items-center justify-center transition-colors ${item.cancellationDateLocked ? 'text-amber-600 hover:text-amber-700' : 'text-gray-300 hover:text-gray-500'}`}
                          >
                            {item.cancellationDateLocked ? (
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                                <path fillRule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clipRule="evenodd" />
                              </svg>
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                                <path d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5a3 3 0 0 1 5.496-1.658.75.75 0 1 0 1.311-.73A4.5 4.5 0 0 0 10 1Z" />
                              </svg>
                            )}
                          </button>
                        </div>
                      ) : f.editable ? (
                        <input
                          type="text"
                          value={(item[f.key] as string) || ''}
                          onChange={e => updateField(origIdx, f.key, e.target.value as ReceiptCheckItem[typeof f.key])}
                          placeholder="YYYY-MM-DD"
                          className="w-28 text-center text-xs border border-gray-300 rounded px-1 py-0.5 focus:ring-1 focus:ring-rose-500 focus:border-rose-500 focus:outline-none"
                        />
                      ) : (
                        (item[f.key] as string) || ''
                      )}
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
