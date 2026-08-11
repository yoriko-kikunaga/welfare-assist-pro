import React, { useState, useMemo } from 'react';
import {
  Client,
  WholesaleCompany,
  WHOLESALE_COMPANY_NAMES,
  InvoiceItem,
  InsuranceRentalClientReconciliation,
  ReconciliationDocument,
} from '../types';
import InsuranceRentalClientDetailModal from './InsuranceRentalClientDetailModal';
import { loadItemMappings, buildItemPairs, SALES_COLLECTION, INSURANCE_RENTAL_COLLECTION, SELF_PAY_RENTAL_COLLECTION } from '../src/services/insuranceRentalMatchService';

function csvCell(v: string | number): string {
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

interface Props {
  clients: Client[];
  invoiceItemsByCompany: Map<WholesaleCompany, InvoiceItem[]>;
  billingMonth: string;
  reconciliationDoc: ReconciliationDocument | null;
  userEmail: string;
  onConfirmCompany: (company: WholesaleCompany) => Promise<void>;
  onUnconfirmCompany: (company: WholesaleCompany) => Promise<void>;
}

/**
 * 指定月度に納品された販売品目を返す
 */
function getSalesEquipmentsForMonth(client: Client, month: string) {
  const monthStart = `${month}-01`;
  const [year, mo] = month.split('-').map(Number);
  const lastDay = new Date(year, mo, 0).getDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;
  return (client.selectedEquipment || []).filter(eq => {
    if (eq.status !== '販売') return false;
    const deliveryDate = eq.deliveryDate;
    if (!deliveryDate) return false;
    return deliveryDate >= monthStart && deliveryDate <= monthEnd;
  });
}

/**
 * 販売が有効な利用者のあおぞらIDセットを返す（当月納品分＋対象月度タグ付き品目の紐づけ先）
 */
function getSalesClientIds(
  clients: Client[],
  billingMonth: string,
  invoiceItemsByCompany: Map<WholesaleCompany, InvoiceItem[]>
): Set<string> {
  const ids = new Set<string>();
  for (const client of clients) {
    if (getSalesEquipmentsForMonth(client, billingMonth).length > 0) ids.add(client.aozoraId);
  }
  // 対象月度タグ付きで紐づけ済みの品目がある利用者は、当月納品がなくても対象に含める（月をまたぐ遅れ請求の紐づけ用）
  invoiceItemsByCompany.forEach(items => {
    items.forEach(item => {
      if (item.matchedAozoraId && item.targetMonth) ids.add(item.matchedAozoraId);
    });
  });
  return ids;
}

/**
 * 会社・利用者ごとの販売突合データを構築
 */
function buildSalesReconciliations(
  clients: Client[],
  invoiceItemsByCompany: Map<WholesaleCompany, InvoiceItem[]>,
  salesClientIds: Set<string>,
  billingMonth: string
): Map<WholesaleCompany, InsuranceRentalClientReconciliation[]> {
  const clientMap = new Map(clients.map(c => [c.aozoraId, c]));
  const result = new Map<WholesaleCompany, InsuranceRentalClientReconciliation[]>();

  invoiceItemsByCompany.forEach((items, company) => {
    // 販売利用者に紐づいた品目のみ対象
    const relevantItems = items.filter(
      item => item.matchedAozoraId && salesClientIds.has(item.matchedAozoraId)
    );
    if (relevantItems.length === 0) return;

    // 利用者ごとにグルーピング
    const byClient = new Map<string, InvoiceItem[]>();
    for (const item of relevantItems) {
      const id = item.matchedAozoraId!;
      if (!byClient.has(id)) byClient.set(id, []);
      byClient.get(id)!.push(item);
    }

    const reconciliations: InsuranceRentalClientReconciliation[] = [];
    byClient.forEach((clientItems, aozoraId) => {
      const client = clientMap.get(aozoraId);
      if (!client) return;

      // 当月納品分＋対象月度タグで指定された月の納品分を合算（重複はeq.idで排除）
      const relevantMonths = new Set([billingMonth, ...clientItems.map(i => i.targetMonth).filter((m): m is string => !!m)]);
      const salesEquipmentsById = new Map<string, ReturnType<typeof getSalesEquipmentsForMonth>[number]>();
      relevantMonths.forEach(m => {
        getSalesEquipmentsForMonth(client, m).forEach(eq => salesEquipmentsById.set(eq.id, eq));
      });
      const salesEquipments = Array.from(salesEquipmentsById.values());

      const ourAmount = salesEquipments.reduce((sum, eq) => {
        return sum + (eq.unitPrice || 0) * (eq.quantity || 1);
      }, 0);

      const wholesalerAmount = clientItems.reduce((s, w) => s + w.amount, 0);

      const ourItems = salesEquipments.map(eq => ({
        id: eq.id,
        name: eq.name || eq.selfPayProductName || '',
        salesAmount: (eq.unitPrice || 0) * (eq.quantity || 1) || undefined,
        isCompanyOwned: eq.propertyAttribute === '自社物件',
      })).filter(item => item.name !== '');

      reconciliations.push({
        aozoraId,
        clientName: client.name,
        wholesaleCompany: company,
        ourAmount,
        wholesalerAmount,
        ourItems,
        wholesalerItems: clientItems,
        difference: ourAmount - wholesalerAmount,
      });
    });

    // 差額あり（不一致）を先頭に
    reconciliations.sort((a, b) => {
      const aHasDiff = a.difference !== 0 ? 0 : 1;
      const bHasDiff = b.difference !== 0 ? 0 : 1;
      return aHasDiff - bHasDiff || a.clientName.localeCompare(b.clientName, 'ja');
    });

    result.set(company, reconciliations);
  });

  return result;
}

const SalesClientReconciliationSection: React.FC<Props> = ({
  clients,
  invoiceItemsByCompany,
  billingMonth,
  reconciliationDoc,
  userEmail,
  onConfirmCompany,
  onUnconfirmCompany,
}) => {
  const [expandedCompanies, setExpandedCompanies] = useState<Set<WholesaleCompany>>(new Set());
  const [detailTarget, setDetailTarget] = useState<InsuranceRentalClientReconciliation | null>(null);
  const [confirmingCompany, setConfirmingCompany] = useState<WholesaleCompany | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [savedMatchedIds, setSavedMatchedIds] = useState<Map<WholesaleCompany, Set<string>>>(new Map());
  const [adjustedWholesalerAmounts, setAdjustedWholesalerAmounts] = useState<Map<WholesaleCompany, Map<string, number>>>(new Map());

  const salesClientIds = useMemo(
    () => getSalesClientIds(clients, billingMonth, invoiceItemsByCompany),
    [clients, billingMonth, invoiceItemsByCompany]
  );

  const reconciliationsByCompany = useMemo(
    () => buildSalesReconciliations(clients, invoiceItemsByCompany, salesClientIds, billingMonth),
    [clients, invoiceItemsByCompany, salesClientIds, billingMonth]
  );

  if (reconciliationsByCompany.size === 0) return null;

  const toggleCompany = (company: WholesaleCompany) => {
    setExpandedCompanies(prev => {
      const next = new Set(prev);
      if (next.has(company)) {
        next.delete(company);
      } else {
        next.add(company);
        if (!savedMatchedIds.has(company)) {
          const reconciliations = reconciliationsByCompany.get(company) || [];
          Promise.all(
            reconciliations.map(async r => {
              const [currentMappings, ...otherMappingsArr] = await Promise.all([
                loadItemMappings(company, r.aozoraId, SALES_COLLECTION),
                loadItemMappings(company, r.aozoraId, INSURANCE_RENTAL_COLLECTION),
                loadItemMappings(company, r.aozoraId, SELF_PAY_RENTAL_COLLECTION),
              ]);
              const crossLinkedNames = new Set<string>();
              for (const mappings of otherMappingsArr) {
                for (const m of mappings) {
                  for (const name of m.wholesalerItemNames) crossLinkedNames.add(name);
                }
              }
              const adjustedAmount = r.wholesalerItems
                .filter(w => !crossLinkedNames.has(w.itemName))
                .reduce((s, w) => s + w.amount, 0);
              return { aozoraId: r.aozoraId, hasMappings: currentMappings.length > 0, adjustedAmount };
            })
          ).then(results => {
            const savedIds = new Set(results.filter(r => r.hasMappings).map(r => r.aozoraId));
            setSavedMatchedIds(prev => new Map(prev).set(company, savedIds));
            const amountMap = new Map(results.map(r => [r.aozoraId, r.adjustedAmount]));
            setAdjustedWholesalerAmounts(prev => new Map(prev).set(company, amountMap));
          });
        }
      }
      return next;
    });
  };

  const handleSaved = (company: WholesaleCompany, aozoraId: string) => {
    setSavedMatchedIds(prev => {
      const next = new Map(prev);
      const ids = new Set(next.get(company) || []);
      ids.add(aozoraId);
      next.set(company, ids);
      return next;
    });
  };

  const handleConfirm = async (company: WholesaleCompany) => {
    setConfirmingCompany(company);
    try {
      await onConfirmCompany(company);
    } finally {
      setConfirmingCompany(null);
    }
  };

  const handleUnconfirm = async (company: WholesaleCompany) => {
    setConfirmingCompany(company);
    try {
      await onUnconfirmCompany(company);
    } finally {
      setConfirmingCompany(null);
    }
  };

  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      const rows: string[] = ['\uFEFF種別,あおぞらID,利用者名,施設名,居室,在宅,弊社品目,卸品目,請求金額,卸金額,卸会社'];

      // Pass 1: 全会社・全利用者のペアを収集
      type Entry = { company: WholesaleCompany; r: InsuranceRentalClientReconciliation; pairs: ReturnType<typeof buildItemPairs>; billingAmount: number | '' };
      const entries: Entry[] = [];
      for (const [company, reconciliations] of reconciliationsByCompany) {
        for (const r of reconciliations) {
          const savedMappings = await loadItemMappings(company, r.aozoraId, SALES_COLLECTION);
          const pairs = buildItemPairs(r.ourItems, r.wholesalerItems, savedMappings);
          entries.push({ company, r, pairs, billingAmount: r.ourAmount > 0 ? r.ourAmount : '' });
        }
      }

      // Pass 2: 他社で紐づけ済みの弊社品目IDを収集
      const matchedOurItemIds = new Map<string, Set<string>>();
      for (const { r, pairs } of entries) {
        for (const pair of pairs) {
          if (pair.ourItem && pair.wholesalerItems.length > 0) {
            if (!matchedOurItemIds.has(r.aozoraId)) matchedOurItemIds.set(r.aozoraId, new Set());
            matchedOurItemIds.get(r.aozoraId)!.add(pair.ourItem.id);
          }
        }
      }

      // Pass 3の前に介護保険レンタル・自費レンタルの利用者IDを計算
      const [year, month] = billingMonth.split('-').map(Number);
      const lastDay = new Date(year, month, 0).getDate();
      const monthStart = `${billingMonth}-01`;
      const monthEnd = `${billingMonth}-${String(lastDay).padStart(2, '0')}`;
      const insuranceRentalIds = new Set<string>();
      const selfPayIds = new Set<string>();
      for (const client of clients) {
        for (const eq of client.selectedEquipment || []) {
          if (eq.status === '介護保険レンタル') {
            if ((!eq.startDate || eq.startDate <= monthEnd) && (!eq.endDate || eq.endDate >= monthStart)) {
              insuranceRentalIds.add(client.aozoraId);
            }
          }
          if (eq.status === '自費レンタル' && !eq.deletedAt) {
            if ((!eq.startDate || eq.startDate <= monthEnd) && (!eq.endDate || eq.endDate >= monthStart)) {
              selfPayIds.add(client.aozoraId);
            }
          }
        }
      }

      // Pass 3: CSV行を生成（弊社品目は1回のみ・請求金額は利用者ごとに1回のみ出力）
      const clientMap = new Map(clients.map(c => [c.aozoraId, c]));
      const outputOurItemIds = new Map<string, Set<string>>();
      const billedClients = new Set<string>();
      for (const { company, r, pairs, billingAmount } of entries) {
        const cl = clientMap.get(r.aozoraId);
        const fac = csvCell(cl?.facilityName || '');
        const room = csvCell(cl?.roomNumber || '');
        const loc = csvCell(cl?.location || '');
        const matchedIds = matchedOurItemIds.get(r.aozoraId) ?? new Set<string>();
        if (!outputOurItemIds.has(r.aozoraId)) outputOurItemIds.set(r.aozoraId, new Set());
        const outputIds = outputOurItemIds.get(r.aozoraId)!;
        for (const pair of pairs) {
          if (pair.ourItem && pair.wholesalerItems.length > 0) {
            // 紐づけ済み：全項目あり（請求金額は初回行のみ）
            for (const wItem of pair.wholesalerItems) {
              const billing = billedClients.has(r.aozoraId) ? '' : billingAmount;
              rows.push([csvCell('販売'), csvCell(r.aozoraId), csvCell(r.clientName), fac, room, loc, csvCell(pair.ourItem.name), csvCell(wItem.name), billing, wItem.amount, csvCell(WHOLESALE_COMPANY_NAMES[company])].join(','));
              billedClients.add(r.aozoraId);
            }
            outputIds.add(pair.ourItem.id);
          } else if (pair.ourItem) {
            // 他社で紐づけ済み、または既に出力済みならスキップ
            if (matchedIds.has(pair.ourItem.id) || outputIds.has(pair.ourItem.id)) continue;
            const billing = billedClients.has(r.aozoraId) ? '' : billingAmount;
            rows.push([csvCell('販売'), csvCell(r.aozoraId), csvCell(r.clientName), fac, room, loc, csvCell(pair.ourItem.name), '（未紐づけ）', billing, '', ''].join(','));
            billedClients.add(r.aozoraId);
            outputIds.add(pair.ourItem.id);
          }
          // 卸品目のみ未紐づけは「卸品目 未紐づけ一覧」セクションに出力するためここでは省略
        }
      }

      const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `販売_利用者別突合_${billingMonth}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        {/* セクションヘッダー */}
        <div className="px-6 py-4 bg-purple-50 border-b border-purple-200 flex items-center gap-3">
          <svg className="w-5 h-5 text-purple-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
          </svg>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-purple-900">販売 利用者別突合</h2>
            <p className="text-xs text-purple-600 mt-0.5">
              当月納品の販売品目と卸請求を利用者単位で照合します
            </p>
          </div>
          <button
            onClick={handleExportCSV}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-700 border border-purple-300 rounded-lg hover:bg-purple-100 transition-colors disabled:opacity-50"
          >
            {isExporting ? (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            )}
            {isExporting ? '出力中...' : 'CSV出力'}
          </button>
        </div>

        {/* 会社ごとのブロック */}
        <div className="divide-y divide-gray-200">
          {Array.from(reconciliationsByCompany.entries()).map(([company, reconciliations]) => {
            const isExpanded = expandedCompanies.has(company);
            const confirmStatus = reconciliationDoc?.salesConfirmation?.[company];
            const isConfirmed = confirmStatus?.status === 'confirmed';
            const isConfirming = confirmingCompany === company;
            const getAdjustedWA = (r: InsuranceRentalClientReconciliation) =>
              adjustedWholesalerAmounts.get(company)?.get(r.aozoraId) ?? r.wholesalerAmount;
            const mismatchCount = reconciliations.filter(r => (r.ourAmount - getAdjustedWA(r)) !== 0).length;
            const totalOur = reconciliations.reduce((s, r) => s + r.ourAmount, 0);
            const totalWholesaler = reconciliations.reduce((s, r) => s + getAdjustedWA(r), 0);

            return (
              <div key={company}>
                {/* 会社ヘッダー行 */}
                <div
                  className={`flex items-center gap-3 px-6 py-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                    isConfirmed ? 'bg-green-50' : ''
                  }`}
                  onClick={() => toggleCompany(company)}
                >
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-800 text-sm">{WHOLESALE_COMPANY_NAMES[company]}</span>
                      {isConfirmed && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-medium">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          確定済
                        </span>
                      )}
                      {mismatchCount > 0 && !isConfirmed && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">
                          差額あり {mismatchCount}件
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {reconciliations.length}名 ／ 弊社計：¥{totalOur.toLocaleString()} ／ 卸計：¥{totalWholesaler.toLocaleString()}
                    </div>
                  </div>

                  <div onClick={e => e.stopPropagation()}>
                    {isConfirmed ? (
                      <button
                        onClick={() => handleUnconfirm(company)}
                        disabled={isConfirming}
                        className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        確定解除
                      </button>
                    ) : (
                      <button
                        onClick={() => handleConfirm(company)}
                        disabled={isConfirming}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {isConfirming ? '処理中...' : '確定する'}
                      </button>
                    )}
                  </div>
                </div>

                {/* 利用者一覧（展開時） */}
                {isExpanded && (
                  <div className="bg-gray-50 border-t border-gray-200">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">利用者</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">弊社（販売）</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">卸請求（仕入）</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">差額</th>
                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">詳細</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {reconciliations.map(r => {
                          const effectiveWA = getAdjustedWA(r);
                          const effectiveDiff = r.ourAmount - effectiveWA;
                          const hasDiff = effectiveDiff !== 0;
                          const isSaved = savedMatchedIds.get(company)?.has(r.aozoraId) ?? false;
                          return (
                            <tr key={r.aozoraId} className={`hover:bg-white transition-colors ${isSaved ? 'bg-green-50' : hasDiff ? 'bg-red-50' : 'bg-white'}`}>
                              <td className="px-6 py-3 text-sm text-gray-900">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span>{r.clientName}</span>
                                  {isSaved && (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-medium">
                                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                      </svg>
                                      紐づけ済
                                    </span>
                                  )}
                                  {r.ourItems.some(i => i.isCompanyOwned) && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full font-medium">
                                      自社ベッド含む
                                    </span>
                                  )}
                                  {r.wholesalerItems.some(w => w.targetMonth && w.targetMonth !== billingMonth) && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full font-medium">
                                      他月分あり
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-400">{r.aozoraId}</div>
                              </td>
                              <td className="px-4 py-3 text-sm text-right font-medium text-blue-700">
                                {r.ourAmount > 0 ? `¥${r.ourAmount.toLocaleString()}` : (
                                  <span className="text-gray-400 text-xs">未設定</span>
                                )}
                                <div className="text-xs font-normal text-gray-400">{r.ourItems.length}品目</div>
                              </td>
                              <td className="px-4 py-3 text-sm text-right font-medium text-orange-700">
                                ¥{effectiveWA.toLocaleString()}
                                <div className="text-xs font-normal text-gray-400">{r.wholesalerItems.length}品目</div>
                              </td>
                              <td className="px-4 py-3 text-sm text-right font-semibold">
                                {r.ourAmount === 0 ? (
                                  <span className="text-gray-400">—</span>
                                ) : (
                                  <span className={hasDiff ? 'text-red-600' : 'text-green-600'}>
                                    {effectiveDiff >= 0 ? '+' : ''}{effectiveDiff.toLocaleString()}円
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <button
                                  onClick={() => setDetailTarget(r)}
                                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                                    isSaved
                                      ? 'text-green-700 border border-green-200 hover:bg-green-50'
                                      : 'text-blue-600 border border-blue-200 hover:bg-blue-50'
                                  }`}
                                >
                                  {isSaved ? '確認・編集' : '詳細'}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 品目詳細モーダル */}
      {detailTarget && (
        <InsuranceRentalClientDetailModal
          reconciliation={detailTarget}
          collectionName={SALES_COLLECTION}
          onClose={() => setDetailTarget(null)}
          onSaved={() => handleSaved(detailTarget.wholesaleCompany, detailTarget.aozoraId)}
          otherCollectionNames={[INSURANCE_RENTAL_COLLECTION, SELF_PAY_RENTAL_COLLECTION]}
          ourAmountLabel="販売合計"
        />
      )}
    </>
  );
};

export default SalesClientReconciliationSection;
