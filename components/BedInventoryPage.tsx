import React, { useState, useEffect, useMemo } from 'react';
import {
  BedInventoryItem,
  BedSet,
  BedItemType,
  BedLifecycleStatus,
  BedRentalHistory,
  DisinfectionRecord,
  OfficeLocation,
  Client,
} from '../types';
import {
  getAllBedItems,
  saveBedItem,
  deleteBedItem,
  getAllBedSets,
  saveBedSet,
  deleteBedSet,
  rentOutBed,
  returnBed,
  startDisinfection,
  completeDisinfection,
  getNextCode,
  getDepreciationInfo,
  DepreciationInfo,
} from '../src/services/bedInventoryService';

// ===== Props =====
interface BedInventoryPageProps {
  clients: Client[];
  userEmail: string;
}

type TabType = 'inventory' | 'sets' | 'depreciation';

// ===== Main Component =====
const BedInventoryPage: React.FC<BedInventoryPageProps> = ({ clients, userEmail }) => {
  const [activeTab, setActiveTab] = useState<TabType>('inventory');
  const [items, setItems] = useState<BedInventoryItem[]>([]);
  const [sets, setSets] = useState<BedSet[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [officeFilter, setOfficeFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRentModal, setShowRentModal] = useState<BedInventoryItem | null>(null);
  const [showReturnModal, setShowReturnModal] = useState<BedInventoryItem | null>(null);
  const [showDisinfectStartModal, setShowDisinfectStartModal] = useState<BedInventoryItem | null>(null);
  const [showDisinfectCompleteModal, setShowDisinfectCompleteModal] = useState<BedInventoryItem | null>(null);
  const [showSetModal, setShowSetModal] = useState(false);
  const [editingItem, setEditingItem] = useState<BedInventoryItem | null>(null);
  const [editingSet, setEditingSet] = useState<BedSet | null>(null);

  // Load data
  const loadData = async () => {
    setLoading(true);
    try {
      const [itemsData, setsData] = await Promise.all([getAllBedItems(), getAllBedSets()]);
      setItems(itemsData);
      setSets(setsData);
    } catch (err) {
      console.error('Failed to load bed inventory:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // Filtered items
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (officeFilter !== 'all' && item.office !== officeFilter) return false;
      if (typeFilter !== 'all' && item.itemType !== typeFilter) return false;
      if (statusFilter !== 'all' && item.lifecycleStatus !== statusFilter) return false;
      return true;
    });
  }, [items, officeFilter, typeFilter, statusFilter]);

  // ===== CSV Export Helpers =====
  const downloadCSV = (filename: string, headers: string[], rows: string[][]) => {
    const bom = '\uFEFF';
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportInventoryCSV = () => {
    const headers = ['管理コード', '種別', '商品名', 'メーカー', 'ステータス', '貸出先', '事業所', '購入日', '購入金額', 'セット名'];
    const rows = filteredItems.map(item => [
      item.code, item.itemType, item.name, item.manufacturer || '', item.lifecycleStatus,
      item.currentClientName || '', item.office, item.purchaseDate || '', String(item.purchasePrice ?? ''),
      item.setName || '',
    ]);
    downloadCSV('ベッド在庫一覧.csv', headers, rows);
  };

  const exportDepreciationCSV = () => {
    const headers = ['管理コード', '商品名', '購入日', '購入金額', '償却月数', '経過月数', '月額償却', '累計償却', '残存簿価', '貸出月数'];
    const rows: string[][] = [];
    filteredItems.forEach(item => {
      const dep = getDepreciationInfo(item);
      if (dep) {
        rows.push([
          item.code, item.name, dep.purchaseDate, String(dep.purchasePrice), String(dep.depreciationMonths),
          String(dep.elapsedMonths), String(dep.monthlyDepreciation), String(dep.accumulatedDepreciation),
          String(dep.bookValue), String(dep.rentalMonths),
        ]);
      }
    });
    downloadCSV('償却一覧.csv', headers, rows);
  };

  const exportDisinfectionCSV = () => {
    const headers = ['管理コード', '商品名', '消毒業者', '費用', '開始日', '終了日', '期間（日）'];
    const rows: string[][] = [];
    filteredItems.forEach(item => {
      for (const rec of item.disinfectionHistory || []) {
        const days = rec.endDate && rec.startDate
          ? Math.round((new Date(rec.endDate).getTime() - new Date(rec.startDate).getTime()) / (1000 * 60 * 60 * 24))
          : '';
        rows.push([item.code, item.name, rec.vendor, String(rec.cost), rec.startDate, rec.endDate, String(days)]);
      }
    });
    downloadCSV('消毒履歴.csv', headers, rows);
  };

  // ===== Render =====
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-teal-600 mb-3"></div>
          <p className="text-gray-500">読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 h-full overflow-hidden flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-teal-600">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
            </svg>
            ベッド管理
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Filters */}
            <select value={officeFilter} onChange={e => setOfficeFilter(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="all">全事業所</option>
              <option value="鹿児島（ACG）">鹿児島</option>
              <option value="福岡（Lichi）">福岡</option>
            </select>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="all">全種別</option>
              <option value="ベッド">ベッド</option>
              <option value="サイドレール">サイドレール</option>
              <option value="マットレス">マットレス</option>
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="all">全ステータス</option>
              <option value="在庫">在庫</option>
              <option value="貸出中">貸出中</option>
              <option value="消毒中">消毒中</option>
            </select>
            <button onClick={() => { setEditingItem(null); setShowAddModal(true); }}
              className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-1.5 rounded text-sm font-medium transition-colors">
              新規登録
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          {([
            { key: 'inventory' as TabType, label: '在庫一覧', color: 'teal' },
            { key: 'sets' as TabType, label: 'セット管理', color: 'cyan' },
            { key: 'depreciation' as TabType, label: '償却・消毒履歴', color: 'amber' },
          ]).map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
                activeTab === tab.key
                  ? tab.color === 'teal' ? 'bg-teal-600 text-white' : tab.color === 'cyan' ? 'bg-cyan-600 text-white' : 'bg-amber-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'inventory' && (
          <InventoryTab
            items={filteredItems}
            sets={sets}
            onEdit={(item) => { setEditingItem(item); setShowAddModal(true); }}
            onDelete={async (id) => {
              if (!confirm('このアイテムを削除しますか？')) return;
              await deleteBedItem(id);
              await loadData();
            }}
            onRent={setShowRentModal}
            onReturn={setShowReturnModal}
            onDisinfectStart={setShowDisinfectStartModal}
            onDisinfectComplete={setShowDisinfectCompleteModal}
            onExportCSV={exportInventoryCSV}
          />
        )}
        {activeTab === 'sets' && (
          <SetsTab
            sets={sets}
            items={items}
            officeFilter={officeFilter}
            onCreateSet={() => { setEditingSet(null); setShowSetModal(true); }}
            onEditSet={(set) => { setEditingSet(set); setShowSetModal(true); }}
            onDeleteSet={async (id) => {
              if (!confirm('このセットを削除しますか？')) return;
              // Remove setId/setName from items in this set
              const setDoc = sets.find(s => s.id === id);
              if (setDoc) {
                for (const itemId of setDoc.itemIds) {
                  const item = items.find(i => i.id === itemId);
                  if (item) {
                    await saveBedItem({ ...item, setId: undefined, setName: undefined } as BedInventoryItem, userEmail);
                  }
                }
              }
              await deleteBedSet(id);
              await loadData();
            }}
          />
        )}
        {activeTab === 'depreciation' && (
          <DepreciationTab
            items={filteredItems}
            onExportDepreciationCSV={exportDepreciationCSV}
            onExportDisinfectionCSV={exportDisinfectionCSV}
          />
        )}
      </div>

      {/* Modals */}
      {showAddModal && (
        <AddEditModal
          existingItem={editingItem}
          allItems={items}
          clients={clients}
          userEmail={userEmail}
          onSave={async (item) => {
            await saveBedItem(item, userEmail);
            setShowAddModal(false);
            setEditingItem(null);
            await loadData();
          }}
          onClose={() => { setShowAddModal(false); setEditingItem(null); }}
        />
      )}
      {showRentModal && (
        <RentModal
          item={showRentModal}
          items={items}
          sets={sets}
          clients={clients}
          userEmail={userEmail}
          onConfirm={async (itemIds, clientAozoraId, clientName, startDate, office) => {
            for (const id of itemIds) {
              await rentOutBed(id, clientAozoraId, clientName, startDate, office, userEmail);
            }
            setShowRentModal(null);
            await loadData();
          }}
          onClose={() => setShowRentModal(null)}
        />
      )}
      {showReturnModal && (
        <ReturnModal
          item={showReturnModal}
          onConfirm={async (endDate) => {
            await returnBed(showReturnModal.id, endDate, userEmail);
            setShowReturnModal(null);
            await loadData();
          }}
          onClose={() => setShowReturnModal(null)}
        />
      )}
      {showDisinfectStartModal && (
        <DisinfectStartModal
          item={showDisinfectStartModal}
          onConfirm={async (record) => {
            await startDisinfection(showDisinfectStartModal.id, record, userEmail);
            setShowDisinfectStartModal(null);
            await loadData();
          }}
          onClose={() => setShowDisinfectStartModal(null)}
        />
      )}
      {showDisinfectCompleteModal && (
        <DisinfectCompleteModal
          item={showDisinfectCompleteModal}
          onConfirm={async (endDate) => {
            await completeDisinfection(showDisinfectCompleteModal.id, endDate, userEmail);
            setShowDisinfectCompleteModal(null);
            await loadData();
          }}
          onClose={() => setShowDisinfectCompleteModal(null)}
        />
      )}
      {showSetModal && (
        <SetModal
          existingSet={editingSet}
          items={items}
          userEmail={userEmail}
          onSave={async (set, updatedItemIds) => {
            await saveBedSet(set);
            // Update items' setId/setName
            for (const item of items) {
              if (updatedItemIds.includes(item.id)) {
                if (item.setId !== set.id) {
                  await saveBedItem({ ...item, setId: set.id, setName: set.name }, userEmail);
                }
              } else if (item.setId === set.id) {
                await saveBedItem({ ...item, setId: undefined, setName: undefined } as BedInventoryItem, userEmail);
              }
            }
            setShowSetModal(false);
            setEditingSet(null);
            await loadData();
          }}
          onClose={() => { setShowSetModal(false); setEditingSet(null); }}
        />
      )}
    </div>
  );
};

// ===== Status Badge =====
const StatusBadge: React.FC<{ item: BedInventoryItem }> = ({ item }) => {
  if (item.lifecycleStatus === '在庫') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">在庫</span>;
  }
  if (item.lifecycleStatus === '貸出中') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
        貸出中: {item.currentClientName}
      </span>
    );
  }
  if (item.lifecycleStatus === '消毒中') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
        消毒中: {item.currentDisinfection?.vendor}
      </span>
    );
  }
  return null;
};

// ===== Tab 1: Inventory =====
interface InventoryTabProps {
  items: BedInventoryItem[];
  sets: BedSet[];
  onEdit: (item: BedInventoryItem) => void;
  onDelete: (id: string) => void;
  onRent: (item: BedInventoryItem) => void;
  onReturn: (item: BedInventoryItem) => void;
  onDisinfectStart: (item: BedInventoryItem) => void;
  onDisinfectComplete: (item: BedInventoryItem) => void;
  onExportCSV: () => void;
}

const InventoryTab: React.FC<InventoryTabProps> = ({ items, sets, onEdit, onDelete, onRent, onReturn, onDisinfectStart, onDisinfectComplete, onExportCSV }) => {
  // Summary counts
  const stockCount = items.filter(i => i.lifecycleStatus === '在庫').length;
  const rentedCount = items.filter(i => i.lifecycleStatus === '貸出中').length;
  const disinfectCount = items.filter(i => i.lifecycleStatus === '消毒中').length;

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-lg p-3 border border-gray-200 text-center">
          <div className="text-2xl font-bold text-gray-800">{items.length}</div>
          <div className="text-xs text-gray-500">合計</div>
        </div>
        <div className="bg-green-50 rounded-lg p-3 border border-green-200 text-center">
          <div className="text-2xl font-bold text-green-700">{stockCount}</div>
          <div className="text-xs text-green-600">在庫</div>
        </div>
        <div className="bg-blue-50 rounded-lg p-3 border border-blue-200 text-center">
          <div className="text-2xl font-bold text-blue-700">{rentedCount}</div>
          <div className="text-xs text-blue-600">貸出中</div>
        </div>
        <div className="bg-yellow-50 rounded-lg p-3 border border-yellow-200 text-center">
          <div className="text-2xl font-bold text-yellow-700">{disinfectCount}</div>
          <div className="text-xs text-yellow-600">消毒中</div>
        </div>
      </div>

      {/* CSV export */}
      <div className="flex justify-end mb-2">
        <button onClick={onExportCSV} className="text-sm text-teal-600 hover:text-teal-800 font-medium flex items-center gap-1">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          CSV出力
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-600">管理コード</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">種別</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">商品名</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">ステータス</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">事業所</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">セット</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">購入日</th>
              <th className="px-3 py-2 text-center font-medium text-gray-600">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">アイテムがありません</td></tr>
            ) : items.map(item => (
              <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs font-medium text-teal-700">{item.code}</td>
                <td className="px-3 py-2">{item.itemType}</td>
                <td className="px-3 py-2">{item.name}</td>
                <td className="px-3 py-2"><StatusBadge item={item} /></td>
                <td className="px-3 py-2 text-xs">{item.office === '鹿児島（ACG）' ? '鹿児島' : '福岡'}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{item.setName || '-'}</td>
                <td className="px-3 py-2 text-xs">{item.purchaseDate || '-'}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-center gap-1 flex-wrap">
                    {item.lifecycleStatus === '在庫' && (
                      <button onClick={() => onRent(item)} className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">貸出</button>
                    )}
                    {item.lifecycleStatus === '貸出中' && (
                      <button onClick={() => onReturn(item)} className="px-2 py-1 text-xs bg-orange-600 text-white rounded hover:bg-orange-700">返却</button>
                    )}
                    {item.lifecycleStatus === '在庫' && (
                      <button onClick={() => onDisinfectStart(item)} className="px-2 py-1 text-xs bg-yellow-600 text-white rounded hover:bg-yellow-700">消毒</button>
                    )}
                    {item.lifecycleStatus === '消毒中' && (
                      <button onClick={() => onDisinfectComplete(item)} className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700">完了</button>
                    )}
                    <button onClick={() => onEdit(item)} className="px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300">編集</button>
                    <button onClick={() => onDelete(item.id)} className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">削除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ===== Tab 2: Sets =====
interface SetsTabProps {
  sets: BedSet[];
  items: BedInventoryItem[];
  officeFilter: string;
  onCreateSet: () => void;
  onEditSet: (set: BedSet) => void;
  onDeleteSet: (id: string) => void;
}

const SetsTab: React.FC<SetsTabProps> = ({ sets, items, officeFilter, onCreateSet, onEditSet, onDeleteSet }) => {
  const filteredSets = officeFilter === 'all' ? sets : sets.filter(s => s.office === officeFilter);

  const getSetStatus = (set: BedSet): string => {
    const setItems = items.filter(i => set.itemIds.includes(i.id));
    if (setItems.length === 0) return '空';
    const statuses = new Set(setItems.map(i => i.lifecycleStatus));
    if (statuses.size === 1) return setItems[0].lifecycleStatus;
    return '混在';
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-500">{filteredSets.length} セット</p>
        <button onClick={onCreateSet}
          className="bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-1.5 rounded text-sm font-medium transition-colors">
          セット作成
        </button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-600">セット名</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">含まれるアイテム</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">事業所</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">ステータス</th>
              <th className="px-3 py-2 text-center font-medium text-gray-600">操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredSets.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">セットがありません</td></tr>
            ) : filteredSets.map(set => {
              const setItems = items.filter(i => set.itemIds.includes(i.id));
              const status = getSetStatus(set);
              return (
                <tr key={set.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium">{set.name}</td>
                  <td className="px-3 py-2 text-xs">
                    {setItems.map(i => (
                      <span key={i.id} className="inline-block bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded mr-1 mb-1">
                        {i.code} ({i.itemType})
                      </span>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-xs">{set.office === '鹿児島（ACG）' ? '鹿児島' : '福岡'}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      status === '在庫' ? 'bg-green-100 text-green-800' :
                      status === '貸出中' ? 'bg-blue-100 text-blue-800' :
                      status === '消毒中' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-600'
                    }`}>{status}</span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => onEditSet(set)} className="px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300 mr-1">編集</button>
                    <button onClick={() => onDeleteSet(set.id)} className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">削除</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ===== Tab 3: Depreciation & Disinfection =====
interface DepreciationTabProps {
  items: BedInventoryItem[];
  onExportDepreciationCSV: () => void;
  onExportDisinfectionCSV: () => void;
}

const DepreciationTab: React.FC<DepreciationTabProps> = ({ items, onExportDepreciationCSV, onExportDisinfectionCSV }) => {
  const depreciationData: { item: BedInventoryItem; dep: DepreciationInfo }[] = [];
  items.forEach(item => {
    const dep = getDepreciationInfo(item);
    if (dep) depreciationData.push({ item, dep });
  });

  // Disinfection history flat list
  const disinfectionData: { item: BedInventoryItem; record: DisinfectionRecord }[] = [];
  items.forEach(item => {
    for (const rec of item.disinfectionHistory || []) {
      disinfectionData.push({ item, record: rec });
    }
  });
  disinfectionData.sort((a, b) => (b.record.startDate || '').localeCompare(a.record.startDate || ''));

  return (
    <div className="space-y-6">
      {/* Depreciation Section */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-base font-bold text-gray-700">償却状況</h3>
          <button onClick={onExportDepreciationCSV} className="text-sm text-amber-600 hover:text-amber-800 font-medium flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            CSV出力
          </button>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600">管理コード</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">商品名</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">購入日</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">購入金額</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">償却月数</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">経過</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">月額</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">累計償却</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">残存簿価</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">貸出月数</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">進捗</th>
              </tr>
            </thead>
            <tbody>
              {depreciationData.length === 0 ? (
                <tr><td colSpan={11} className="px-3 py-8 text-center text-gray-400">償却データがありません（購入日・購入金額を登録してください）</td></tr>
              ) : depreciationData.map(({ item, dep }) => (
                <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono text-xs font-medium text-teal-700">{item.code}</td>
                  <td className="px-3 py-2">{item.name}</td>
                  <td className="px-3 py-2 text-xs">{dep.purchaseDate}</td>
                  <td className="px-3 py-2 text-right">{dep.purchasePrice.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{dep.depreciationMonths}</td>
                  <td className="px-3 py-2 text-right">{dep.elapsedMonths}</td>
                  <td className="px-3 py-2 text-right">{dep.monthlyDepreciation.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{dep.accumulatedDepreciation.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-medium">{dep.bookValue.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{dep.rentalMonths}</td>
                  <td className="px-3 py-2 w-32">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-2">
                        <div className={`h-2 rounded-full ${dep.progressRate >= 1 ? 'bg-red-500' : dep.progressRate >= 0.75 ? 'bg-amber-500' : 'bg-teal-500'}`}
                          style={{ width: `${Math.round(dep.progressRate * 100)}%` }}></div>
                      </div>
                      <span className="text-xs text-gray-500">{Math.round(dep.progressRate * 100)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Disinfection History Section */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-base font-bold text-gray-700">消毒履歴</h3>
          <button onClick={onExportDisinfectionCSV} className="text-sm text-amber-600 hover:text-amber-800 font-medium flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            CSV出力
          </button>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600">管理コード</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">商品名</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">消毒業者</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">費用</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">開始日</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">終了日</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">期間（日）</th>
              </tr>
            </thead>
            <tbody>
              {disinfectionData.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">消毒履歴がありません</td></tr>
              ) : disinfectionData.map(({ item, record }, idx) => {
                const days = record.endDate && record.startDate
                  ? Math.round((new Date(record.endDate).getTime() - new Date(record.startDate).getTime()) / (1000 * 60 * 60 * 24))
                  : '-';
                return (
                  <tr key={`${item.id}-${idx}`} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs font-medium text-teal-700">{item.code}</td>
                    <td className="px-3 py-2">{item.name}</td>
                    <td className="px-3 py-2">{record.vendor}</td>
                    <td className="px-3 py-2 text-right">{record.cost.toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs">{record.startDate}</td>
                    <td className="px-3 py-2 text-xs">{record.endDate}</td>
                    <td className="px-3 py-2 text-right">{days}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ===== Modal Backdrop =====
const ModalBackdrop: React.FC<{ children: React.ReactNode; onClose: () => void }> = ({ children, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={onClose}>
    <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
      {children}
    </div>
  </div>
);

// ===== Rental history row (for AddEditModal) =====
interface RentalHistoryRow {
  id: string;
  clientAozoraId: string;
  clientName: string;
  startDate: string;
  endDate: string;
  office: OfficeLocation;
  // UI state
  searchQuery: string;
  showDropdown: boolean;
}

function emptyRentalRow(): RentalHistoryRow {
  return {
    id: `rent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    clientAozoraId: '',
    clientName: '',
    startDate: '',
    endDate: '',
    office: '鹿児島（ACG）',
    searchQuery: '',
    showDropdown: false,
  };
}

// ===== Add/Edit Modal =====
interface AddEditModalProps {
  existingItem: BedInventoryItem | null;
  allItems: BedInventoryItem[];
  clients: Client[];
  userEmail: string;
  onSave: (item: BedInventoryItem) => void;
  onClose: () => void;
}

const AddEditModal: React.FC<AddEditModalProps> = ({ existingItem, allItems, clients, userEmail, onSave, onClose }) => {
  const isEdit = !!existingItem;
  const [itemType, setItemType] = useState<BedItemType>(existingItem?.itemType || 'ベッド');
  const [code, setCode] = useState(existingItem?.code || '');
  const [name, setName] = useState(existingItem?.name || '');
  const [manufacturer, setManufacturer] = useState(existingItem?.manufacturer || '');
  const [office, setOffice] = useState<OfficeLocation>(existingItem?.office || '鹿児島（ACG）');
  const [purchaseDate, setPurchaseDate] = useState(existingItem?.purchaseDate || '');
  const [purchasePrice, setPurchasePrice] = useState(existingItem?.purchasePrice?.toString() || '');
  const [depreciationMonths, setDepreciationMonths] = useState(existingItem?.depreciationMonths?.toString() || '12');
  const [note, setNote] = useState(existingItem?.note || '');

  // Rental history rows
  const [rentalRows, setRentalRows] = useState<RentalHistoryRow[]>(() => {
    const existing = existingItem?.rentalHistory || [];
    if (existing.length === 0) return [];
    return existing.map(r => ({
      id: r.id,
      clientAozoraId: r.clientAozoraId,
      clientName: r.clientName,
      startDate: r.startDate,
      endDate: r.endDate || '',
      office: r.office,
      searchQuery: r.clientName,
      showDropdown: false,
    }));
  });

  // Auto-generate code for new items
  useEffect(() => {
    if (!isEdit) {
      setCode(getNextCode(allItems, itemType));
    }
  }, [itemType, isEdit, allItems]);

  const addRentalRow = () => {
    setRentalRows(prev => [...prev, emptyRentalRow()]);
  };

  const removeRentalRow = (idx: number) => {
    setRentalRows(prev => prev.filter((_, i) => i !== idx));
  };

  const updateRentalRow = (idx: number, updates: Partial<RentalHistoryRow>) => {
    setRentalRows(prev => prev.map((r, i) => i === idx ? { ...r, ...updates } : r));
  };

  const handleSubmit = () => {
    if (!code.trim() || !name.trim()) {
      alert('管理コードと商品名は必須です');
      return;
    }

    // Build rental history from rows
    const rentalHistory: BedRentalHistory[] = rentalRows
      .filter(r => r.clientAozoraId && r.startDate) // skip incomplete rows
      .map(r => ({
        id: r.id,
        clientAozoraId: r.clientAozoraId,
        clientName: r.clientName,
        startDate: r.startDate,
        endDate: r.endDate || undefined,
        office: r.office,
      }));

    // Determine lifecycle status from rental history
    const hasOpenRental = rentalHistory.some(r => !r.endDate);
    const latestOpenRental = hasOpenRental
      ? rentalHistory.filter(r => !r.endDate).slice(-1)[0]
      : null;

    // If editing, preserve disinfection status; otherwise derive from rentals
    let lifecycleStatus = existingItem?.lifecycleStatus || '在庫';
    let currentClientAozoraId = existingItem?.currentClientAozoraId;
    let currentClientName = existingItem?.currentClientName;

    if (existingItem?.lifecycleStatus !== '消毒中') {
      if (latestOpenRental) {
        lifecycleStatus = '貸出中';
        currentClientAozoraId = latestOpenRental.clientAozoraId;
        currentClientName = latestOpenRental.clientName;
      } else {
        lifecycleStatus = '在庫';
        currentClientAozoraId = undefined;
        currentClientName = undefined;
      }
    }

    const item: BedInventoryItem = {
      id: existingItem?.id || code.trim(),
      code: code.trim(),
      name: name.trim(),
      itemType,
      manufacturer: manufacturer.trim() || undefined,
      office,
      lifecycleStatus,
      currentClientAozoraId,
      currentClientName,
      setId: existingItem?.setId,
      setName: existingItem?.setName,
      purchaseDate: purchaseDate || undefined,
      purchasePrice: purchasePrice ? Number(purchasePrice) : undefined,
      depreciationMonths: Number(depreciationMonths) || 12,
      disinfectionHistory: existingItem?.disinfectionHistory || [],
      currentDisinfection: existingItem?.currentDisinfection,
      rentalHistory,
      note: note.trim() || undefined,
      createdAt: existingItem?.createdAt || new Date(),
      updatedAt: new Date(),
      updatedBy: userEmail,
    };
    onSave(item);
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-4">{isEdit ? 'アイテム編集' : '新規登録'}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">種別</label>
            <select value={itemType} onChange={e => setItemType(e.target.value as BedItemType)} disabled={isEdit}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm disabled:bg-gray-100">
              <option value="ベッド">ベッド</option>
              <option value="サイドレール">サイドレール</option>
              <option value="マットレス">マットレス</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">管理コード</label>
            <input type="text" value={code} onChange={e => setCode(e.target.value)} disabled={isEdit}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm disabled:bg-gray-100" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">商品名 *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">メーカー</label>
            <input type="text" value={manufacturer} onChange={e => setManufacturer(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">事業所</label>
            <select value={office} onChange={e => setOffice(e.target.value as OfficeLocation)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
              <option value="鹿児島（ACG）">鹿児島（ACG）</option>
              <option value="福岡（Lichi）">福岡（Lichi）</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">購入日</label>
              <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">購入金額</label>
              <input type="number" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} placeholder="0"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">償却月数</label>
            <input type="number" value={depreciationMonths} onChange={e => setDepreciationMonths(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </div>

          {/* 貸与履歴セクション */}
          <div className="border-t border-gray-200 pt-3 mt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-bold text-gray-700">貸与履歴</label>
              <button type="button" onClick={addRentalRow}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 font-medium">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                追加
              </button>
            </div>
            {rentalRows.length === 0 && (
              <p className="text-xs text-gray-400 mb-1">貸与履歴がありません。「追加」で登録できます。</p>
            )}
            <div className="space-y-3">
              {rentalRows.map((row, idx) => (
                <RentalHistoryRowEditor
                  key={row.id}
                  row={row}
                  index={idx}
                  clients={clients}
                  onUpdate={(updates) => updateRentalRow(idx, updates)}
                  onRemove={() => removeRentalRow(idx)}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">備考</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300">キャンセル</button>
          <button onClick={handleSubmit} className="px-4 py-2 text-sm bg-teal-600 text-white rounded hover:bg-teal-700 font-medium">
            {isEdit ? '更新' : '登録'}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
};

// ===== Rental History Row Editor =====
interface RentalHistoryRowEditorProps {
  row: RentalHistoryRow;
  index: number;
  clients: Client[];
  onUpdate: (updates: Partial<RentalHistoryRow>) => void;
  onRemove: () => void;
}

const RentalHistoryRowEditor: React.FC<RentalHistoryRowEditorProps> = ({ row, index, clients, onUpdate, onRemove }) => {
  const filteredClients = row.searchQuery.trim() && !row.clientAozoraId
    ? clients.filter(c => {
        const q = row.searchQuery.toLowerCase();
        return c.name.toLowerCase().includes(q) || c.nameKana.toLowerCase().includes(q) || c.aozoraId.includes(q);
      }).slice(0, 10)
    : [];

  return (
    <div className="bg-gray-50 border border-gray-200 rounded p-3 relative">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-500">#{index + 1}</span>
        <button type="button" onClick={onRemove} className="text-red-400 hover:text-red-600" title="削除">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 貸与先 */}
      <div className="mb-2">
        <label className="block text-xs text-gray-600 mb-0.5">貸与先</label>
        {row.clientAozoraId ? (
          <div className="flex items-center gap-2 bg-blue-50 px-2 py-1.5 rounded text-sm">
            <span className="font-medium">{row.clientName}</span>
            <span className="text-gray-500 text-xs">{row.clientAozoraId}</span>
            <button type="button" onClick={() => onUpdate({ clientAozoraId: '', clientName: '', searchQuery: '' })}
              className="ml-auto text-red-500 text-xs hover:text-red-700">解除</button>
          </div>
        ) : (
          <div className="relative">
            <input type="text" value={row.searchQuery} placeholder="氏名・カナ・IDで検索"
              onChange={e => onUpdate({ searchQuery: e.target.value, showDropdown: true })}
              onFocus={() => onUpdate({ showDropdown: true })}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
            {row.showDropdown && filteredClients.length > 0 && (
              <div className="absolute z-10 w-full bg-white border border-gray-200 rounded mt-0.5 max-h-32 overflow-y-auto shadow-lg">
                {filteredClients.map(c => (
                  <button key={c.id} type="button"
                    onClick={() => onUpdate({ clientAozoraId: c.aozoraId, clientName: c.name, searchQuery: c.name, showDropdown: false })}
                    className="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-gray-500 ml-1 text-xs">{c.aozoraId}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 日付・事業所 */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-xs text-gray-600 mb-0.5">開始日</label>
          <input type="date" value={row.startDate} onChange={e => onUpdate({ startDate: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs" />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-0.5">終了日</label>
          <input type="date" value={row.endDate} onChange={e => onUpdate({ endDate: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs" />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-0.5">事業所</label>
          <select value={row.office} onChange={e => onUpdate({ office: e.target.value as OfficeLocation })}
            className="w-full border border-gray-300 rounded px-1 py-1.5 text-xs">
            <option value="鹿児島（ACG）">鹿児島</option>
            <option value="福岡（Lichi）">福岡</option>
          </select>
        </div>
      </div>
    </div>
  );
};

// ===== Rent Modal =====
interface RentModalProps {
  item: BedInventoryItem;
  items: BedInventoryItem[];
  sets: BedSet[];
  clients: Client[];
  userEmail: string;
  onConfirm: (itemIds: string[], clientAozoraId: string, clientName: string, startDate: string, office: OfficeLocation) => void;
  onClose: () => void;
}

const RentModal: React.FC<RentModalProps> = ({ item, items, sets, clients, userEmail, onConfirm, onClose }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [rentAsSet, setRentAsSet] = useState(false);

  const belongsToSet = item.setId ? sets.find(s => s.id === item.setId) : null;
  const setItems = belongsToSet ? items.filter(i => belongsToSet.itemIds.includes(i.id) && i.lifecycleStatus === '在庫') : [];

  const filteredClients = searchQuery.trim()
    ? clients.filter(c => {
        const q = searchQuery.toLowerCase();
        return c.name.toLowerCase().includes(q) || c.nameKana.toLowerCase().includes(q) || c.aozoraId.includes(q);
      }).slice(0, 20)
    : [];

  const handleSubmit = () => {
    if (!selectedClient) { alert('利用者を選択してください'); return; }
    if (!startDate) { alert('貸出開始日を入力してください'); return; }
    const itemIds = rentAsSet && belongsToSet ? setItems.map(i => i.id) : [item.id];
    onConfirm(itemIds, selectedClient.aozoraId, selectedClient.name, startDate, item.office);
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-4">貸出 - {item.code} {item.name}</h2>
        <div className="space-y-3">
          {belongsToSet && setItems.length > 1 && (
            <div className="bg-blue-50 border border-blue-200 rounded p-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={rentAsSet} onChange={e => setRentAsSet(e.target.checked)} className="rounded" />
                <span>セット一括貸出（{belongsToSet.name}: {setItems.map(i => i.code).join(', ')}）</span>
              </label>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">利用者検索</label>
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="氏名・カナ・IDで検索" className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            {filteredClients.length > 0 && !selectedClient && (
              <div className="border border-gray-200 rounded mt-1 max-h-40 overflow-y-auto">
                {filteredClients.map(c => (
                  <button key={c.id} onClick={() => { setSelectedClient(c); setSearchQuery(c.name); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-gray-500 ml-2 text-xs">{c.aozoraId}</span>
                    {c.facilityName && <span className="text-gray-400 ml-2 text-xs">{c.facilityName}</span>}
                  </button>
                ))}
              </div>
            )}
            {selectedClient && (
              <div className="mt-1 flex items-center gap-2 bg-blue-50 px-3 py-2 rounded text-sm">
                <span className="font-medium">{selectedClient.name}</span>
                <span className="text-gray-500 text-xs">{selectedClient.aozoraId}</span>
                <button onClick={() => { setSelectedClient(null); setSearchQuery(''); }} className="ml-auto text-red-500 text-xs hover:text-red-700">解除</button>
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">貸出開始日</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300">キャンセル</button>
          <button onClick={handleSubmit} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium">貸出実行</button>
        </div>
      </div>
    </ModalBackdrop>
  );
};

// ===== Return Modal =====
const ReturnModal: React.FC<{ item: BedInventoryItem; onConfirm: (endDate: string) => void; onClose: () => void }> = ({ item, onConfirm, onClose }) => {
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-4">返却 - {item.code} {item.name}</h2>
        <p className="text-sm text-gray-600 mb-3">貸出先: {item.currentClientName}</p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">返却日</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300">キャンセル</button>
          <button onClick={() => onConfirm(endDate)} className="px-4 py-2 text-sm bg-orange-600 text-white rounded hover:bg-orange-700 font-medium">返却実行</button>
        </div>
      </div>
    </ModalBackdrop>
  );
};

// ===== Disinfect Start Modal =====
const DisinfectStartModal: React.FC<{ item: BedInventoryItem; onConfirm: (record: DisinfectionRecord) => void; onClose: () => void }> = ({ item, onConfirm, onClose }) => {
  const [vendor, setVendor] = useState('');
  const [cost, setCost] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');

  const handleSubmit = () => {
    if (!vendor.trim()) { alert('消毒業者名を入力してください'); return; }
    onConfirm({
      id: `dis-${Date.now()}`,
      vendor: vendor.trim(),
      cost: Number(cost) || 0,
      startDate,
      endDate: endDate || startDate,
      note: note.trim() || undefined,
    });
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-4">消毒開始 - {item.code} {item.name}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">消毒業者名 *</label>
            <input type="text" value={vendor} onChange={e => setVendor(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">費用</label>
            <input type="number" value={cost} onChange={e => setCost(e.target.value)} placeholder="0"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">開始日</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">予定終了日</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">備考</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300">キャンセル</button>
          <button onClick={handleSubmit} className="px-4 py-2 text-sm bg-yellow-600 text-white rounded hover:bg-yellow-700 font-medium">消毒開始</button>
        </div>
      </div>
    </ModalBackdrop>
  );
};

// ===== Disinfect Complete Modal =====
const DisinfectCompleteModal: React.FC<{ item: BedInventoryItem; onConfirm: (endDate: string) => void; onClose: () => void }> = ({ item, onConfirm, onClose }) => {
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-4">消毒完了 - {item.code} {item.name}</h2>
        <p className="text-sm text-gray-600 mb-3">業者: {item.currentDisinfection?.vendor}</p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">完了日</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300">キャンセル</button>
          <button onClick={() => onConfirm(endDate)} className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 font-medium">完了</button>
        </div>
      </div>
    </ModalBackdrop>
  );
};

// ===== Set Modal =====
interface SetModalProps {
  existingSet: BedSet | null;
  items: BedInventoryItem[];
  userEmail: string;
  onSave: (set: BedSet, selectedItemIds: string[]) => void;
  onClose: () => void;
}

const SetModal: React.FC<SetModalProps> = ({ existingSet, items, userEmail, onSave, onClose }) => {
  const isEdit = !!existingSet;
  const [name, setName] = useState(existingSet?.name || '');
  const [office, setOffice] = useState<OfficeLocation>(existingSet?.office || '鹿児島（ACG）');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(existingSet?.itemIds || []));

  // Items available for selection: either already in this set, or not in any set and matching office
  const availableItems = items.filter(i =>
    i.office === office && (!i.setId || i.setId === existingSet?.id)
  );

  const toggleItem = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const handleSubmit = () => {
    if (!name.trim()) { alert('セット名を入力してください'); return; }
    if (selectedIds.size === 0) { alert('アイテムを選択してください'); return; }
    const set: BedSet = {
      id: existingSet?.id || `SET-${Date.now()}`,
      name: name.trim(),
      itemIds: Array.from(selectedIds),
      office,
      createdAt: existingSet?.createdAt || new Date(),
      updatedAt: new Date(),
    };
    onSave(set, Array.from(selectedIds));
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-4">{isEdit ? 'セット編集' : 'セット作成'}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">セット名 *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">事業所</label>
            <select value={office} onChange={e => { setOffice(e.target.value as OfficeLocation); setSelectedIds(new Set()); }}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm" disabled={isEdit}>
              <option value="鹿児島（ACG）">鹿児島（ACG）</option>
              <option value="福岡（Lichi）">福岡（Lichi）</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">アイテム選択</label>
            <div className="border border-gray-200 rounded max-h-48 overflow-y-auto">
              {availableItems.length === 0 ? (
                <p className="p-3 text-sm text-gray-400">選択可能なアイテムがありません</p>
              ) : availableItems.map(item => (
                <label key={item.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-0 cursor-pointer">
                  <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleItem(item.id)} className="rounded" />
                  <span className="font-mono text-xs text-teal-700">{item.code}</span>
                  <span className="text-sm">{item.itemType} - {item.name}</span>
                  <StatusBadge item={item} />
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300">キャンセル</button>
          <button onClick={handleSubmit} className="px-4 py-2 text-sm bg-cyan-600 text-white rounded hover:bg-cyan-700 font-medium">
            {isEdit ? '更新' : '作成'}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
};

export default BedInventoryPage;
