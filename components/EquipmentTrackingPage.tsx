import React, { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  EquipmentItem,
  EquipmentItemStatus,
  EquipmentItemType,
  EquipmentLog,
  EquipmentSet,
  CleaningRecord,
  UsageType,
  MigrationOptions,
  OfficeLocation,
  Client,
  BedInventoryItem,
} from '../types';
import {
  getAllEquipmentItems,
  saveEquipmentItem,
  deleteEquipmentItem,
  getAllEquipmentSets,
  saveEquipmentSet,
  deleteEquipmentSet,
  getEquipmentLogs,
  changeEquipmentStatus,
  startCleaning,
  completeCleaning,
  getAllowedNextStatuses,
  getNextEquipmentCode,
  getDepreciationInfo,
  getRentalDepreciationInfo,
  exportEquipmentToCSV,
  exportDepreciationToCSV,
  exportCleaningHistoryToCSV,
  migrateBedInventoryToEquipments,
  getAllBedItems,
} from '../src/services/equipmentTrackingService';
import { getFunctions, httpsCallable } from 'firebase/functions';

const QRScannerModal = lazy(() => import('./QRScannerModal'));

// ===== Types =====
interface EquipmentTrackingPageProps {
  clients: Client[];
  userEmail: string;
}

type TabType = 'inventory' | 'sets' | 'depreciation' | 'logs';

const ITEM_TYPES: EquipmentItemType[] = ['ベッド', 'サイドレール', 'マットレス'];
const USAGE_TYPES: UsageType[] = ['介護保険', '自費', '販売', '施設物品', '使用不可'];
const ALL_STATUSES: EquipmentItemStatus[] = [
  '倉庫保管', '事務所保管', 'クリーニング前', 'クリーニング中',
  '介護保険貸与にて使用', '自費にて使用', '施設物品', '販売済み', '破棄済み',
];
const OFFICES: OfficeLocation[] = ['鹿児島（ACG）', '福岡（Lichi）'];

// ===== Color helpers =====
function statusColor(s: EquipmentItemStatus): string {
  switch (s) {
    case '倉庫保管': return 'bg-gray-100 text-gray-700';
    case '事務所保管': return 'bg-blue-100 text-blue-700';
    case 'クリーニング前': return 'bg-yellow-100 text-yellow-700';
    case 'クリーニング中': return 'bg-orange-100 text-orange-700';
    case '介護保険貸与にて使用': return 'bg-green-100 text-green-700';
    case '自費にて使用': return 'bg-emerald-100 text-emerald-700';
    case '施設物品': return 'bg-purple-100 text-purple-700';
    case '販売済み': return 'bg-indigo-100 text-indigo-700';
    case '破棄済み': return 'bg-red-100 text-red-700';
    default: return 'bg-gray-100 text-gray-600';
  }
}

function usageTypeColor(u: UsageType): string {
  switch (u) {
    case '介護保険': return 'bg-teal-100 text-teal-700';
    case '自費': return 'bg-cyan-100 text-cyan-700';
    case '販売': return 'bg-violet-100 text-violet-700';
    case '施設物品': return 'bg-amber-100 text-amber-700';
    case '使用不可': return 'bg-red-100 text-red-700';
    default: return 'bg-gray-100 text-gray-600';
  }
}

// ===== Main Component =====
const EquipmentTrackingPage: React.FC<EquipmentTrackingPageProps> = ({ clients, userEmail }) => {
  const [activeTab, setActiveTab] = useState<TabType>('inventory');
  const [items, setItems] = useState<EquipmentItem[]>([]);
  const [sets, setSets] = useState<EquipmentSet[]>([]);
  const [logs, setLogs] = useState<EquipmentLog[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [officeFilter, setOfficeFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [usageFilter, setUsageFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState<EquipmentItem | null>(null);
  const [showStatusModal, setShowStatusModal] = useState<EquipmentItem | null>(null);
  const [showCleaningStartModal, setShowCleaningStartModal] = useState<EquipmentItem | null>(null);
  const [showCleaningCompleteModal, setShowCleaningCompleteModal] = useState<EquipmentItem | null>(null);
  const [showQRModal, setShowQRModal] = useState<EquipmentItem | null>(null);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showSetModal, setShowSetModal] = useState(false);
  const [editingSet, setEditingSet] = useState<EquipmentSet | null>(null);
  const [showMigrationModal, setShowMigrationModal] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [itemsData, setsData] = await Promise.all([
        getAllEquipmentItems(),
        getAllEquipmentSets(),
      ]);
      setItems(itemsData);
      setSets(setsData);
    } catch (err) {
      console.error('Failed to load equipment data:', err);
      alert('データの読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const logsData = await getEquipmentLogs();
      setLogs(logsData);
    } catch (err) {
      console.error('Failed to load equipment logs:', err);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (activeTab === 'logs') loadLogs();
  }, [activeTab, loadLogs]);

  // Filtered items
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (officeFilter !== 'all' && item.office !== officeFilter) return false;
      if (typeFilter !== 'all' && item.itemType !== typeFilter) return false;
      if (usageFilter !== 'all' && item.usageType !== usageFilter) return false;
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      return true;
    });
  }, [items, officeFilter, typeFilter, usageFilter, statusFilter]);

  const handleQRScan = useCallback((decoded: string) => {
    setShowQRScanner(false);
    const found = items.find(i => i.id === decoded);
    if (found) {
      setShowQRModal(found);
    } else {
      alert(`ID: ${decoded}\n\n該当機材が見つかりません。`);
    }
  }, [items]);

  const handleDelete = async (item: EquipmentItem) => {
    if (!confirm(`「${item.code} ${item.name}」を削除しますか？`)) return;
    try {
      await deleteEquipmentItem(item.id);
      await loadData();
    } catch (err) {
      alert(`削除に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const downloadCSV = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mb-3" />
          <p className="text-gray-500">読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-6 py-3 md:py-4">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg md:text-xl font-bold text-gray-800 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-indigo-600">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 3.75 9.375v-4.5ZM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 0 1-1.125-1.125v-4.5ZM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 13.5 9.375v-4.5Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75ZM6.75 16.5h.75v.75h-.75v-.75ZM16.5 6.75h.75v.75h-.75v-.75Z" />
            </svg>
            ベッド管理
          </h1>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => setShowQRScanner(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 3.75 9.375v-4.5ZM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 0 1-1.125-1.125v-4.5ZM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 13.5 9.375v-4.5Z" />
              </svg>
              <span className="hidden sm:inline">QRスキャン</span>
            </button>
            <button
              onClick={() => { setEditingItem(null); setShowAddModal(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-700 hover:bg-indigo-800 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              <span className="hidden sm:inline">新規登録</span>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <select
            value={officeFilter}
            onChange={e => setOfficeFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            <option value="all">全事業所</option>
            {OFFICES.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            <option value="all">全種別</option>
            {ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            value={usageFilter}
            onChange={e => setUsageFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            <option value="all">全用途</option>
            {USAGE_TYPES.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            <option value="all">全ステータス</option>
            {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="text-sm text-gray-500 self-center">{filteredItems.length}件</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-6 overflow-x-auto">
        <div className="flex gap-1 min-w-max md:min-w-0">
          {([
            { id: 'inventory', label: '在庫一覧', short: '在庫', color: 'indigo' },
            { id: 'sets', label: 'セット管理', short: 'セット', color: 'purple' },
            { id: 'depreciation', label: '償却・クリーニング', short: '償却', color: 'amber' },
            { id: 'logs', label: '監査ログ', short: 'ログ', color: 'gray' },
          ] as const).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? `border-${tab.color}-600 text-${tab.color}-700`
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.short}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto p-3 md:p-4">

        {/* Tab 1: 在庫一覧 */}
        {activeTab === 'inventory' && (
          <div>
            <div className="flex justify-end mb-3">
              <button
                onClick={() => downloadCSV(exportEquipmentToCSV(filteredItems), '個体管理一覧.csv')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm rounded-lg transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                CSV出力
              </button>
            </div>

            {/* Mobile: カードビュー */}
            <div className="md:hidden space-y-3">
              {filteredItems.length === 0 ? (
                <p className="text-center py-8 text-gray-400">データがありません</p>
              ) : filteredItems.map(item => {
                const allowed = getAllowedNextStatuses(item.status, item.usageType);
                const canRent = allowed.some(s => s === '介護保険貸与にて使用' || s === '自費にて使用');
                const canReturn = allowed.some(s => s === '倉庫保管' || s === '事務所保管') && !!item.currentClientAozoraId;
                const canClean = allowed.includes('クリーニング前');
                const isCleaningDone = item.status === 'クリーニング中';
                const canSell = allowed.includes('販売済み');
                const canDispose = allowed.includes('破棄済み');

                return (
                  <div key={item.id} className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                    {/* 1行目: コード + 商品名 + 種別 */}
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <span className="font-mono text-indigo-700 font-semibold text-sm">{item.code}</span>
                        <span className="ml-1.5 text-gray-800 text-sm font-medium">{item.name}</span>
                      </div>
                      <span className="text-xs text-gray-500 ml-2 flex-shrink-0">{item.itemType}</span>
                    </div>
                    {/* 2行目: バッジ群 */}
                    <div className="flex flex-wrap gap-1 mb-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${usageTypeColor(item.usageType)}`}>
                        {item.usageType}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(item.status)}`}>
                        {item.status}
                      </span>
                    </div>
                    {/* 3行目: 利用者名（貸出中のみ） */}
                    {item.currentClientName && (
                      <p className="text-xs text-gray-600 mb-2">利用者: {item.currentClientName}</p>
                    )}
                    {/* 4行目: アクションボタン */}
                    <div className="flex gap-1 flex-wrap pt-2 border-t border-gray-100">
                      {canRent && (
                        <button onClick={() => setShowStatusModal(item)} className="px-2 py-0.5 bg-green-100 hover:bg-green-200 text-green-700 text-xs rounded">貸出</button>
                      )}
                      {canReturn && (
                        <button onClick={() => setShowStatusModal(item)} className="px-2 py-0.5 bg-blue-100 hover:bg-blue-200 text-blue-700 text-xs rounded">返却</button>
                      )}
                      {canClean && (
                        <button onClick={() => setShowCleaningStartModal(item)} className="px-2 py-0.5 bg-orange-100 hover:bg-orange-200 text-orange-700 text-xs rounded">クリーニング前</button>
                      )}
                      {isCleaningDone && (
                        <button onClick={() => setShowCleaningCompleteModal(item)} className="px-2 py-0.5 bg-green-100 hover:bg-green-200 text-green-700 text-xs rounded">クリーニング完了</button>
                      )}
                      {canSell && (
                        <button onClick={() => setShowStatusModal(item)} className="px-2 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs rounded">販売済み</button>
                      )}
                      {canDispose && (
                        <button onClick={() => setShowStatusModal(item)} className="px-2 py-0.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs rounded">破棄</button>
                      )}
                      <button onClick={() => setShowQRModal(item)} className="px-2 py-0.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 text-xs rounded">QR</button>
                      <button onClick={() => { setEditingItem(item); setShowAddModal(true); }} className="px-2 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs rounded">編集</button>
                      <button onClick={() => handleDelete(item)} className="px-2 py-0.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs rounded">削除</button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop: テーブルビュー */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm bg-white rounded-lg shadow-sm border border-gray-200">
                <thead>
                  <tr className="bg-indigo-50 text-indigo-800">
                    <th className="px-3 py-2 text-left font-semibold">管理コード</th>
                    <th className="px-3 py-2 text-left font-semibold">商品名</th>
                    <th className="px-3 py-2 text-left font-semibold">種別</th>
                    <th className="px-3 py-2 text-left font-semibold">事業所</th>
                    <th className="px-3 py-2 text-left font-semibold">用途区分</th>
                    <th className="px-3 py-2 text-left font-semibold">ステータス</th>
                    <th className="px-3 py-2 text-left font-semibold">利用者名</th>
                    <th className="px-3 py-2 text-left font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-gray-400">
                        データがありません
                      </td>
                    </tr>
                  ) : filteredItems.map(item => {
                    const allowed = getAllowedNextStatuses(item.status, item.usageType);
                    const canRent = allowed.some(s => s === '介護保険貸与にて使用' || s === '自費にて使用');
                    const canReturn = allowed.some(s => s === '倉庫保管' || s === '事務所保管') && !!item.currentClientAozoraId;
                    const canClean = allowed.includes('クリーニング前');
                    const isCleaningDone = item.status === 'クリーニング中';
                    const canSell = allowed.includes('販売済み');
                    const canDispose = allowed.includes('破棄済み');

                    return (
                      <tr key={item.id} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono text-indigo-700 font-semibold">{item.code}</td>
                        <td className="px-3 py-2">{item.name}</td>
                        <td className="px-3 py-2">{item.itemType}</td>
                        <td className="px-3 py-2 text-xs">{item.office}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${usageTypeColor(item.usageType)}`}>
                            {item.usageType}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(item.status)}`}>
                            {item.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600">{item.currentClientName || '—'}</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1 flex-wrap">
                            {canRent && (
                              <button onClick={() => setShowStatusModal(item)} className="px-2 py-0.5 bg-green-100 hover:bg-green-200 text-green-700 text-xs rounded">貸出</button>
                            )}
                            {canReturn && (
                              <button onClick={() => setShowStatusModal(item)} className="px-2 py-0.5 bg-blue-100 hover:bg-blue-200 text-blue-700 text-xs rounded">返却</button>
                            )}
                            {canClean && (
                              <button onClick={() => setShowCleaningStartModal(item)} className="px-2 py-0.5 bg-orange-100 hover:bg-orange-200 text-orange-700 text-xs rounded">クリーニング前</button>
                            )}
                            {isCleaningDone && (
                              <button onClick={() => setShowCleaningCompleteModal(item)} className="px-2 py-0.5 bg-green-100 hover:bg-green-200 text-green-700 text-xs rounded">クリーニング完了</button>
                            )}
                            {canSell && (
                              <button onClick={() => setShowStatusModal(item)} className="px-2 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs rounded">販売済み</button>
                            )}
                            {canDispose && (
                              <button onClick={() => setShowStatusModal(item)} className="px-2 py-0.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs rounded">破棄</button>
                            )}
                            <button onClick={() => setShowQRModal(item)} className="px-2 py-0.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 text-xs rounded">QR</button>
                            <button onClick={() => { setEditingItem(item); setShowAddModal(true); }} className="px-2 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs rounded">編集</button>
                            <button onClick={() => handleDelete(item)} className="px-2 py-0.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs rounded">削除</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Migration button */}
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setShowMigrationModal(true)}
                className="text-xs text-gray-400 hover:text-gray-600 underline"
              >
                旧ベッド管理からデータを移行
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: セット管理 */}
        {activeTab === 'sets' && (
          <SetsTab
            sets={sets}
            items={items}
            onAddSet={() => { setEditingSet(null); setShowSetModal(true); }}
            onEditSet={s => { setEditingSet(s); setShowSetModal(true); }}
            onDeleteSet={async s => {
              if (!confirm(`「${s.name}」を削除しますか？`)) return;
              await deleteEquipmentSet(s.id);
              await loadData();
            }}
          />
        )}

        {/* Tab 3: 償却・クリーニング */}
        {activeTab === 'depreciation' && (
          <DepreciationTab
            items={filteredItems}
            onExportDep={() => downloadCSV(exportDepreciationToCSV(filteredItems), '償却一覧.csv')}
            onExportCleaning={() => downloadCSV(exportCleaningHistoryToCSV(filteredItems), 'クリーニング履歴.csv')}
          />
        )}

        {/* Tab 4: 監査ログ */}
        {activeTab === 'logs' && (
          <LogsTab logs={logs} />
        )}
      </div>

      {/* ===== Modals ===== */}

      {showQRScanner && (
        <Suspense fallback={<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"><p className="text-white">読み込み中...</p></div>}>
          <QRScannerModal onScan={handleQRScan} onClose={() => setShowQRScanner(false)} />
        </Suspense>
      )}

      {showAddModal && (
        <AddEditModal
          item={editingItem}
          items={items}
          userEmail={userEmail}
          onClose={() => { setShowAddModal(false); setEditingItem(null); }}
          onSaved={loadData}
        />
      )}

      {showStatusModal && (
        <StatusChangeModal
          item={showStatusModal}
          clients={clients}
          userEmail={userEmail}
          onClose={() => setShowStatusModal(null)}
          onSaved={loadData}
        />
      )}

      {showCleaningStartModal && (
        <CleaningStartModal
          item={showCleaningStartModal}
          userEmail={userEmail}
          onClose={() => setShowCleaningStartModal(null)}
          onSaved={loadData}
        />
      )}

      {showCleaningCompleteModal && (
        <CleaningCompleteModal
          item={showCleaningCompleteModal}
          userEmail={userEmail}
          onClose={() => setShowCleaningCompleteModal(null)}
          onSaved={loadData}
        />
      )}

      {showQRModal && (
        <QRDisplayModal
          item={showQRModal}
          userEmail={userEmail}
          onClose={() => setShowQRModal(null)}
          onQRSaved={loadData}
        />
      )}

      {showSetModal && (
        <SetModal
          set={editingSet}
          items={items}
          onClose={() => { setShowSetModal(false); setEditingSet(null); }}
          onSaved={loadData}
        />
      )}

      {showMigrationModal && (
        <MigrationModal
          userEmail={userEmail}
          onClose={() => setShowMigrationModal(false)}
          onMigrated={loadData}
        />
      )}
    </div>
  );
};

// ===== Sub-tabs =====

interface SetsTabProps {
  sets: EquipmentSet[];
  items: EquipmentItem[];
  onAddSet: () => void;
  onEditSet: (s: EquipmentSet) => void;
  onDeleteSet: (s: EquipmentSet) => void;
}

const SetsTab: React.FC<SetsTabProps> = ({ sets, items, onAddSet, onEditSet, onDeleteSet }) => (
  <div>
    <div className="flex justify-between items-center mb-3">
      <h3 className="font-semibold text-gray-700">セット一覧（{sets.length}件）</h3>
      <button onClick={onAddSet} className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-lg">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        セット追加
      </button>
    </div>
    {sets.length === 0 ? (
      <p className="text-center text-gray-400 py-8">セットがありません</p>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sets.map(set => {
          const setItems = items.filter(i => set.itemIds.includes(i.id));
          return (
            <div key={set.id} className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <h4 className="font-semibold text-gray-800">{set.name}</h4>
                <div className="flex gap-1">
                  <button onClick={() => onEditSet(set)} className="text-gray-400 hover:text-indigo-600">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
                    </svg>
                  </button>
                  <button onClick={() => onDeleteSet(set)} className="text-gray-400 hover:text-red-600">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-500 mb-2">{set.office}</p>
              <div className="space-y-1">
                {setItems.map(i => (
                  <div key={i.id} className="flex items-center justify-between text-xs">
                    <span className="text-gray-700">{i.code} {i.name}</span>
                    <span className={`px-1.5 py-0.5 rounded-full ${statusColor(i.status)}`}>{i.status}</span>
                  </div>
                ))}
                {set.itemIds.length === 0 && <p className="text-xs text-gray-400">アイテムなし</p>}
              </div>
            </div>
          );
        })}
      </div>
    )}
  </div>
);

interface DepreciationTabProps {
  items: EquipmentItem[];
  onExportDep: () => void;
  onExportCleaning: () => void;
}

const DepreciationTab: React.FC<DepreciationTabProps> = ({ items, onExportDep, onExportCleaning }) => {
  const itemsWithDep = items.filter(i => i.purchaseDate && i.purchasePrice);
  const items12m = items.filter(i => (i.depreciationMonths || 12) === 12);

  return (
    <div className="space-y-6">

      {/* 12ヶ月償却 レンタル先一覧 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="font-semibold text-gray-700">12ヶ月償却 レンタル先一覧</h3>
          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{items12m.length}件</span>
        </div>
        {items12m.length === 0 ? (
          <p className="text-center text-gray-400 py-6">12ヶ月償却の機材がありません</p>
        ) : (
          <div className="space-y-3">
            {items12m.map(item => {
              const info = getRentalDepreciationInfo(item);
              const progressPct = Math.min(100, Math.round((info.totalRentalMonths / info.depreciationMonths) * 100));
              return (
                <div key={item.id} className="bg-white rounded-lg border border-amber-200 shadow-sm overflow-hidden">
                  {/* アイテムヘッダー */}
                  <div className="bg-amber-50 px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="font-mono font-semibold text-indigo-700 text-sm">{item.code}</span>
                    <span className="font-medium text-gray-800 text-sm">{item.name}</span>
                    <span className="text-xs text-gray-500">{item.office}</span>
                    <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      {item.purchasePrice && (
                        <span className="text-gray-600 text-xs">購入 ¥{item.purchasePrice.toLocaleString()}</span>
                      )}
                      {info.monthlyDepreciation !== null && (
                        <span className="text-gray-600 text-xs">月額 ¥{info.monthlyDepreciation.toLocaleString()}</span>
                      )}
                      <span className="text-amber-700 font-medium text-xs">
                        累計 {info.totalRentalMonths}ヶ月 / {info.depreciationMonths}ヶ月
                      </span>
                      <span className={`font-semibold text-xs ${info.remainingMonths === 0 ? 'text-red-600' : 'text-green-700'}`}>
                        残 {info.remainingMonths}ヶ月
                      </span>
                      {info.bookValue !== null && (
                        <span className="text-gray-700 font-medium text-xs">
                          簿価 ¥{info.bookValue.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* 進捗バー */}
                  <div className="h-1.5 bg-gray-100">
                    <div
                      className={`h-1.5 transition-all ${progressPct >= 100 ? 'bg-red-400' : 'bg-amber-400'}`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  {/* レンタル先テーブル */}
                  {info.rentalRecords.length === 0 ? (
                    <p className="text-xs text-gray-400 px-4 py-3">レンタル実績なし</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-500 border-b border-gray-100">
                          <th className="px-4 py-1.5 text-left font-medium">利用者名</th>
                          <th className="px-4 py-1.5 text-left font-medium">開始日</th>
                          <th className="px-4 py-1.5 text-left font-medium">終了日</th>
                          <th className="px-4 py-1.5 text-right font-medium">月数</th>
                          <th className="px-4 py-1.5 text-left font-medium">状態</th>
                        </tr>
                      </thead>
                      <tbody>
                        {info.rentalRecords.map((r, idx) => (
                          <tr key={idx} className={`border-t border-gray-50 ${r.isCurrent ? 'bg-green-50' : ''}`}>
                            <td className="px-4 py-1.5 text-gray-800">
                              {r.clientName || '—'}
                              {r.clientAozoraId && (
                                <span className="ml-1 text-gray-400">({r.clientAozoraId})</span>
                              )}
                            </td>
                            <td className="px-4 py-1.5 text-gray-600">{r.startDate}</td>
                            <td className="px-4 py-1.5 text-gray-600">{r.endDate || '—'}</td>
                            <td className="px-4 py-1.5 text-right font-medium text-amber-700">{r.rentalMonths}ヶ月</td>
                            <td className="px-4 py-1.5">
                              {r.isCurrent ? (
                                <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full">貸出中</span>
                              ) : (
                                <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full">返却済</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Depreciation Section */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold text-gray-700">償却一覧</h3>
          <button onClick={onExportDep} className="flex items-center gap-1 px-3 py-1 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm rounded">
            CSV出力
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm bg-white rounded-lg border border-gray-200">
            <thead>
              <tr className="bg-amber-50 text-amber-800">
                <th className="px-3 py-2 text-left">管理コード</th>
                <th className="px-3 py-2 text-left">商品名</th>
                <th className="px-3 py-2 text-left">購入日</th>
                <th className="px-3 py-2 text-right">購入金額</th>
                <th className="px-3 py-2 text-right">月額償却</th>
                <th className="px-3 py-2 text-right">残存簿価</th>
                <th className="px-3 py-2 text-left">進捗</th>
              </tr>
            </thead>
            <tbody>
              {itemsWithDep.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-6 text-gray-400">データなし</td></tr>
              ) : itemsWithDep.map(item => {
                const dep = getDepreciationInfo(item);
                if (!dep) return null;
                return (
                  <tr key={item.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-indigo-700">{item.code}</td>
                    <td className="px-3 py-2">{item.name}</td>
                    <td className="px-3 py-2">{dep.purchaseDate}</td>
                    <td className="px-3 py-2 text-right">¥{dep.purchasePrice.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">¥{dep.monthlyDepreciation.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">¥{dep.bookValue.toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                          <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: `${Math.round(dep.progressRate * 100)}%` }} />
                        </div>
                        <span className="text-xs text-gray-500">{Math.round(dep.progressRate * 100)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cleaning History Section */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold text-gray-700">クリーニング履歴</h3>
          <button onClick={onExportCleaning} className="flex items-center gap-1 px-3 py-1 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm rounded">
            CSV出力
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm bg-white rounded-lg border border-gray-200">
            <thead>
              <tr className="bg-amber-50 text-amber-800">
                <th className="px-3 py-2 text-left">管理コード</th>
                <th className="px-3 py-2 text-left">商品名</th>
                <th className="px-3 py-2 text-left">業者名</th>
                <th className="px-3 py-2 text-right">費用</th>
                <th className="px-3 py-2 text-left">開始日</th>
                <th className="px-3 py-2 text-left">終了日</th>
                <th className="px-3 py-2 text-left">備考</th>
              </tr>
            </thead>
            <tbody>
              {items.every(i => (i.cleaningHistory || []).length === 0 && !i.currentCleaning) ? (
                <tr><td colSpan={7} className="text-center py-6 text-gray-400">履歴なし</td></tr>
              ) : items.flatMap(item => [
                ...(item.cleaningHistory || []).map(c => ({ item, c, current: false })),
                ...(item.currentCleaning ? [{ item, c: item.currentCleaning, current: true }] : []),
              ]).map(({ item, c, current }) => (
                <tr key={`${item.id}-${c.id}`} className={`border-t border-gray-100 hover:bg-gray-50 ${current ? 'bg-orange-50' : ''}`}>
                  <td className="px-3 py-2 font-mono text-indigo-700">{item.code}</td>
                  <td className="px-3 py-2">{item.name}</td>
                  <td className="px-3 py-2">{c.vendor}</td>
                  <td className="px-3 py-2 text-right">¥{c.cost.toLocaleString()}</td>
                  <td className="px-3 py-2">{c.startDate}</td>
                  <td className="px-3 py-2">{current ? <span className="text-orange-600 font-medium">進行中</span> : c.endDate}</td>
                  <td className="px-3 py-2 text-gray-500">{c.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

interface LogsTabProps { logs: EquipmentLog[]; }
const LogsTab: React.FC<LogsTabProps> = ({ logs }) => (
  <div>
    <h3 className="font-semibold text-gray-700 mb-3">監査ログ（直近100件）</h3>
    <div className="overflow-x-auto">
      <table className="w-full text-sm bg-white rounded-lg border border-gray-200">
        <thead>
          <tr className="bg-gray-50 text-gray-700">
            <th className="px-3 py-2 text-left">日時</th>
            <th className="px-3 py-2 text-left">管理コード</th>
            <th className="px-3 py-2 text-left">アクション</th>
            <th className="px-3 py-2 text-left">変更前</th>
            <th className="px-3 py-2 text-left">変更後</th>
            <th className="px-3 py-2 text-left">担当者</th>
            <th className="px-3 py-2 text-left">備考</th>
          </tr>
        </thead>
        <tbody>
          {logs.length === 0 ? (
            <tr><td colSpan={7} className="text-center py-6 text-gray-400">ログなし</td></tr>
          ) : logs.map(log => (
            <tr key={log.id} className="border-t border-gray-100 hover:bg-gray-50">
              <td className="px-3 py-2 text-xs text-gray-500">{log.performedAt.toLocaleString('ja-JP')}</td>
              <td className="px-3 py-2 font-mono text-indigo-700">{log.equipmentCode}</td>
              <td className="px-3 py-2">{log.action}</td>
              <td className="px-3 py-2 text-xs">{log.fromStatus ?? '—'}</td>
              <td className="px-3 py-2 text-xs">{log.toStatus ?? '—'}</td>
              <td className="px-3 py-2 text-xs">{log.performedBy}</td>
              <td className="px-3 py-2 text-xs text-gray-500">{log.note || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

// ===== Modal: AddEdit =====
interface AddEditModalProps {
  item: EquipmentItem | null;
  items: EquipmentItem[];
  userEmail: string;
  onClose: () => void;
  onSaved: () => void;
}

const AddEditModal: React.FC<AddEditModalProps> = ({ item, items, userEmail, onClose, onSaved }) => {
  const isNew = !item;
  const [itemType, setItemType] = useState<EquipmentItemType>(item?.itemType || 'ベッド');
  const [name, setName] = useState(item?.name || '');
  const [manufacturer, setManufacturer] = useState(item?.manufacturer || '');
  const [office, setOffice] = useState<OfficeLocation>(item?.office || '鹿児島（ACG）');
  const [usageType, setUsageType] = useState<UsageType>(item?.usageType || '介護保険');
  const [initialStatus, setInitialStatus] = useState<EquipmentItemStatus>(item?.status || '倉庫保管');
  const [purchaseDate, setPurchaseDate] = useState(item?.purchaseDate || '');
  const [purchasePrice, setPurchasePrice] = useState(item?.purchasePrice?.toString() || '');
  const [depMonths, setDepMonths] = useState(item?.depreciationMonths?.toString() || '12');
  const [note, setNote] = useState(item?.note || '');
  const [saving, setSaving] = useState(false);

  const autoCode = isNew ? getNextEquipmentCode(items, itemType) : item.code;

  const handleSave = async () => {
    if (!name.trim()) { alert('商品名を入力してください'); return; }
    setSaving(true);
    try {
      const now = new Date();
      const newItem: EquipmentItem = item ? {
        ...item,
        name: name.trim(),
        itemType,
        manufacturer: manufacturer.trim() || undefined,
        office,
        usageType,
        status: item.status,
        purchaseDate: purchaseDate || undefined,
        purchasePrice: purchasePrice ? parseInt(purchasePrice) : undefined,
        depreciationMonths: parseInt(depMonths) || 12,
        note: note.trim() || undefined,
      } : {
        id: crypto.randomUUID(),
        code: autoCode,
        name: name.trim(),
        itemType,
        manufacturer: manufacturer.trim() || undefined,
        office,
        usageType,
        status: initialStatus,
        purchaseDate: purchaseDate || undefined,
        purchasePrice: purchasePrice ? parseInt(purchasePrice) : undefined,
        depreciationMonths: parseInt(depMonths) || 12,
        cleaningHistory: [],
        usageHistory: [],
        note: note.trim() || undefined,
        createdAt: now,
        updatedAt: now,
        updatedBy: userEmail,
      };
      await saveEquipmentItem(newItem, userEmail, isNew);
      onSaved();
      onClose();
    } catch (err) {
      alert(`保存に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white">
          <h2 className="text-lg font-bold text-gray-800">{isNew ? '機材を新規登録' : '機材を編集'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg></button>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">種別</label>
              <select value={itemType} onChange={e => setItemType(e.target.value as EquipmentItemType)} disabled={!isNew} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                {ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">管理コード</label>
              <input value={autoCode} disabled className="w-full border border-gray-200 bg-gray-50 rounded px-2 py-1.5 text-sm font-mono text-indigo-700" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">商品名 *</label>
            <input value={name} onChange={e => setName(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" placeholder="例: 高さ調節ベッド" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">メーカー</label>
            <input value={manufacturer} onChange={e => setManufacturer(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">事業所</label>
              <select value={office} onChange={e => setOffice(e.target.value as OfficeLocation)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                {OFFICES.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">用途区分</label>
              <select value={usageType} onChange={e => setUsageType(e.target.value as UsageType)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                {USAGE_TYPES.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          {isNew && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">初期ステータス</label>
              <select value={initialStatus} onChange={e => setInitialStatus(e.target.value as EquipmentItemStatus)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                <option value="倉庫保管">倉庫保管</option>
                <option value="事務所保管">事務所保管</option>
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">購入日</label>
              <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">購入金額（円）</label>
              <input type="number" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" placeholder="0" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">償却月数</label>
            <input type="number" value={depMonths} onChange={e => setDepMonths(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" min="1" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">備考</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">キャンセル</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ===== Modal: StatusChange =====
interface StatusChangeModalProps {
  item: EquipmentItem;
  clients: Client[];
  userEmail: string;
  onClose: () => void;
  onSaved: () => void;
}

const StatusChangeModal: React.FC<StatusChangeModalProps> = ({ item, clients, userEmail, onClose, onSaved }) => {
  const [toStatus, setToStatus] = useState<EquipmentItemStatus | ''>('');
  const [usageType, setUsageType] = useState<UsageType>(item.usageType);
  const [clientSearch, setClientSearch] = useState(item.currentClientName || '');
  const [selectedClient, setSelectedClient] = useState<Client | null>(
    clients.find(c => c.aozoraId === item.currentClientAozoraId) || null
  );
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const allowed = getAllowedNextStatuses(item.status, usageType);

  const needsClient = toStatus === '介護保険貸与にて使用' || toStatus === '自費にて使用';

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return [];
    return clients.filter(c =>
      c.name.includes(clientSearch) || c.nameKana.includes(clientSearch) || c.aozoraId.includes(clientSearch)
    ).slice(0, 10);
  }, [clients, clientSearch]);

  const handleSave = async () => {
    if (!toStatus) { alert('遷移先ステータスを選択してください'); return; }
    if (needsClient && !selectedClient) { alert('利用者を選択してください'); return; }
    setSaving(true);
    try {
      await changeEquipmentStatus({
        itemId: item.id,
        toStatus,
        usageType,
        clientAozoraId: needsClient ? selectedClient?.aozoraId : undefined,
        clientName: needsClient ? selectedClient?.name : undefined,
        startDate,
        note: note.trim() || undefined,
        userEmail,
      });
      onSaved();
      onClose();
    } catch (err) {
      alert(`ステータス変更に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold text-gray-800">ステータス変更</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="bg-gray-50 rounded p-2 text-sm">
            <span className="font-mono text-indigo-700 font-semibold">{item.code}</span> {item.name}
            <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${statusColor(item.status)}`}>{item.status}</span>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">用途区分</label>
            <select value={usageType} onChange={e => setUsageType(e.target.value as UsageType)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              {USAGE_TYPES.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">次のステータス *</label>
            <select value={toStatus} onChange={e => setToStatus(e.target.value as EquipmentItemStatus)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">選択してください</option>
              {allowed.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {allowed.length === 0 && <p className="text-xs text-red-500 mt-1">この用途区分では遷移可能なステータスがありません</p>}
          </div>
          {needsClient && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">利用者 *</label>
              <input
                value={clientSearch}
                onChange={e => { setClientSearch(e.target.value); setSelectedClient(null); }}
                placeholder="氏名・カナ・IDで検索"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
              {filteredClients.length > 0 && !selectedClient && (
                <ul className="border border-gray-200 rounded mt-1 max-h-36 overflow-y-auto">
                  {filteredClients.map(c => (
                    <li key={c.id}>
                      <button
                        onClick={() => { setSelectedClient(c); setClientSearch(c.name); }}
                        className="w-full text-left px-2 py-1.5 text-sm hover:bg-indigo-50"
                      >
                        {c.name} <span className="text-xs text-gray-400">({c.aozoraId})</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {selectedClient && (
                <p className="text-xs text-green-600 mt-1">✓ {selectedClient.name} ({selectedClient.aozoraId})</p>
              )}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">日付</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">備考</label>
            <input value={note} onChange={e => setNote(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">キャンセル</button>
          <button onClick={handleSave} disabled={saving || !toStatus} className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50">
            {saving ? '処理中...' : '変更する'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ===== Modal: CleaningStart =====
interface CleaningStartModalProps {
  item: EquipmentItem;
  userEmail: string;
  onClose: () => void;
  onSaved: () => void;
}

const CleaningStartModal: React.FC<CleaningStartModalProps> = ({ item, userEmail, onClose, onSaved }) => {
  const [vendor, setVendor] = useState('');
  const [cost, setCost] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!vendor.trim()) { alert('業者名を入力してください'); return; }
    setSaving(true);
    try {
      const record: CleaningRecord = {
        id: `clean-${Date.now()}`,
        vendor: vendor.trim(),
        cost: parseInt(cost) || 0,
        startDate,
        endDate: endDate || '',
        note: note.trim() || undefined,
      };
      await startCleaning(item.id, record, userEmail);
      onSaved();
      onClose();
    } catch (err) {
      alert(`開始に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold text-gray-800">クリーニング前へ</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="bg-gray-50 rounded p-2 text-sm font-mono text-indigo-700">{item.code} {item.name}</div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">業者名 *</label>
            <input value={vendor} onChange={e => setVendor(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" placeholder="クリーニング業者名" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">費用（円）</label>
            <input type="number" value={cost} onChange={e => setCost(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" placeholder="0" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">開始日</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">予定終了日</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">備考</label>
            <input value={note} onChange={e => setNote(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">キャンセル</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-lg disabled:opacity-50">
            {saving ? '処理中...' : 'クリーニング前へ'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ===== Modal: CleaningComplete =====
interface CleaningCompleteModalProps {
  item: EquipmentItem;
  userEmail: string;
  onClose: () => void;
  onSaved: () => void;
}

const CleaningCompleteModal: React.FC<CleaningCompleteModalProps> = ({ item, userEmail, onClose, onSaved }) => {
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [targetStatus, setTargetStatus] = useState<EquipmentItemStatus>('倉庫保管');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await completeCleaning(item.id, endDate, targetStatus, userEmail);
      onSaved();
      onClose();
    } catch (err) {
      alert(`完了に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold text-gray-800">クリーニング完了</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="bg-gray-50 rounded p-2 text-sm font-mono text-indigo-700">{item.code} {item.name}</div>
          {item.currentCleaning && (
            <div className="text-sm text-gray-600 bg-orange-50 rounded p-2">
              <p>業者: {item.currentCleaning.vendor}</p>
              <p>費用: ¥{item.currentCleaning.cost.toLocaleString()}</p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">完了日</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">返却先ステータス</label>
            <select value={targetStatus} onChange={e => setTargetStatus(e.target.value as EquipmentItemStatus)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="倉庫保管">倉庫保管</option>
              <option value="事務所保管">事務所保管</option>
              <option value="破棄済み">破棄済み</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">キャンセル</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50">
            {saving ? '処理中...' : '完了にする'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ===== Modal: QRDisplay =====
interface QRDisplayModalProps {
  item: EquipmentItem;
  userEmail: string;
  onClose: () => void;
  onQRSaved: () => void;
}

const QRDisplayModal: React.FC<QRDisplayModalProps> = ({ item, onClose, onQRSaved }) => {
  const [saving, setSaving] = useState(false);
  const [savedUrl, setSavedUrl] = useState(item.qrCodeUrl || '');

  const handleSaveToStorage = async () => {
    setSaving(true);
    try {
      const functions = getFunctions(undefined, 'asia-northeast1');
      const generateQR = httpsCallable(functions, 'generateEquipmentQR');
      const result = await generateQR({ equipmentId: item.id, equipmentCode: item.code });
      const data = result.data as { success: boolean; qrCodeUrl: string };
      if (data.success) {
        setSavedUrl(data.qrCodeUrl);
        // Save URL back to item
        await saveEquipmentItem({ ...item, qrCodeUrl: data.qrCodeUrl }, '');
        onQRSaved();
        alert('QR画像をStorageに保存しました');
      }
    } catch (err) {
      alert(`QR保存に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`
      <html><head><title>${item.code} QR</title></head><body style="text-align:center;padding:20px">
      <h2>${item.code}</h2><p>${item.name}</p>
      ${savedUrl ? `<img src="${savedUrl}" width="200" />` : '<p>QRはこちらで表示されます</p>'}
      </body></html>
    `);
    win.document.close();
    win.print();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold text-gray-800">QRコード</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg></button>
        </div>
        <div className="p-6 flex flex-col items-center gap-4">
          <p className="font-mono text-indigo-700 font-bold text-lg">{item.code}</p>
          <p className="text-sm text-gray-600">{item.name}</p>
          <div className="p-3 bg-white border-2 border-gray-200 rounded-lg">
            <QRCodeSVG value={item.id} size={180} />
          </div>
          <p className="text-xs text-gray-400 break-all text-center">{item.id}</p>
          <div className="flex gap-2 w-full">
            <button onClick={handleSaveToStorage} disabled={saving} className="flex-1 px-3 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50">
              {saving ? '保存中...' : 'Storageに保存'}
            </button>
            <button onClick={handlePrint} className="flex-1 px-3 py-2 text-sm border border-gray-300 hover:bg-gray-50 rounded-lg">
              印刷
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ===== Modal: Set =====
interface SetModalProps {
  set: EquipmentSet | null;
  items: EquipmentItem[];
  onClose: () => void;
  onSaved: () => void;
}

const SetModal: React.FC<SetModalProps> = ({ set, items, onClose, onSaved }) => {
  const [name, setName] = useState(set?.name || '');
  const [office, setOffice] = useState<OfficeLocation>(set?.office || '鹿児島（ACG）');
  const [selectedIds, setSelectedIds] = useState<string[]>(set?.itemIds || []);
  const [saving, setSaving] = useState(false);

  const toggleItem = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleSave = async () => {
    if (!name.trim()) { alert('セット名を入力してください'); return; }
    setSaving(true);
    try {
      const now = new Date();
      const newSet: EquipmentSet = set ? {
        ...set, name: name.trim(), office, itemIds: selectedIds, updatedAt: now,
      } : {
        id: crypto.randomUUID(), name: name.trim(), office, itemIds: selectedIds, createdAt: now, updatedAt: now,
      };
      await saveEquipmentSet(newSet);
      onSaved();
      onClose();
    } catch (err) {
      alert(`保存に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white">
          <h2 className="text-lg font-bold text-gray-800">{set ? 'セット編集' : 'セット追加'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">セット名 *</label>
            <input value={name} onChange={e => setName(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" placeholder="例: セットA-001" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">事業所</label>
            <select value={office} onChange={e => setOffice(e.target.value as OfficeLocation)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              {OFFICES.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">機材を選択</label>
            <div className="border border-gray-200 rounded max-h-48 overflow-y-auto">
              {items.map(item => (
                <label key={item.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-0">
                  <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleItem(item.id)} className="rounded" />
                  <span className="font-mono text-xs text-indigo-700">{item.code}</span>
                  <span className="text-sm">{item.name}</span>
                  <span className={`ml-auto px-1.5 py-0.5 rounded-full text-xs ${statusColor(item.status)}`}>{item.status}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">キャンセル</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ===== Modal: Migration =====
interface MigrationModalProps {
  userEmail: string;
  onClose: () => void;
  onMigrated: () => void;
}

const MigrationModal: React.FC<MigrationModalProps> = ({ userEmail, onClose, onMigrated }) => {
  const [defaultUsageType, setDefaultUsageType] = useState<UsageType>('介護保険');
  const [stockStatus, setStockStatus] = useState<EquipmentItemStatus>('倉庫保管');
  const [rentedStatus, setRentedStatus] = useState<EquipmentItemStatus>('介護保険貸与にて使用');
  const [cleaningStatus, setCleaningStatus] = useState<EquipmentItemStatus>('クリーニング中');
  const [migrating, setMigrating] = useState(false);
  const [result, setResult] = useState<{ migrated: number; failed: string[] } | null>(null);

  const handleMigrate = async () => {
    if (!confirm('旧ベッド管理のデータを個体管理へ移行します。旧データは削除されません。続行しますか？')) return;
    setMigrating(true);
    try {
      const oldItems: BedInventoryItem[] = await getAllBedItems();
      if (oldItems.length === 0) {
        alert('移行対象データがありません');
        setMigrating(false);
        return;
      }
      const options: MigrationOptions = {
        defaultUsageType,
        statusMapping: {
          '在庫': stockStatus,
          '貸出中': rentedStatus,
          '消毒中': cleaningStatus,
        },
      };
      const res = await migrateBedInventoryToEquipments(oldItems, options, userEmail);
      setResult(res);
      onMigrated();
    } catch (err) {
      alert(`移行に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold text-gray-800">旧ベッド管理からデータ移行</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg></button>
        </div>
        <div className="p-4 space-y-3">
          {result ? (
            <div className="bg-green-50 border border-green-200 rounded p-3">
              <p className="font-semibold text-green-700">移行完了</p>
              <p className="text-sm text-green-600">移行成功: {result.migrated}件</p>
              {result.failed.length > 0 && (
                <p className="text-sm text-red-600">失敗: {result.failed.join(', ')}</p>
              )}
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-600">旧 bedInventory コレクションのデータを新しい equipments コレクションへ移行します。</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">デフォルト用途区分</label>
                <select value={defaultUsageType} onChange={e => setDefaultUsageType(e.target.value as UsageType)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                  {USAGE_TYPES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">「在庫」→</label>
                <select value={stockStatus} onChange={e => setStockStatus(e.target.value as EquipmentItemStatus)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                  {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">「貸出中」→</label>
                <select value={rentedStatus} onChange={e => setRentedStatus(e.target.value as EquipmentItemStatus)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                  {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">「消毒中」→</label>
                <select value={cleaningStatus} onChange={e => setCleaningStatus(e.target.value as EquipmentItemStatus)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                  {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
            {result ? '閉じる' : 'キャンセル'}
          </button>
          {!result && (
            <button onClick={handleMigrate} disabled={migrating} className="px-4 py-2 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded-lg disabled:opacity-50">
              {migrating ? '移行中...' : '移行開始'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default EquipmentTrackingPage;
