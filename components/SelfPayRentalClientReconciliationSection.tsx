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
import { loadItemMappings, buildItemPairs, SELF_PAY_RENTAL_COLLECTION } from '../src/services/insuranceRentalMatchService';

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
 * 自費レンタルが有効な利用者のあおぞらIDセットを返す（当月アクティブ分）
 */
function getSelfPayRentalClientIds(clients: Client[], billingMonth: string): Set<string> {
  const [year, month] = billingMonth.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const monthStart = `${billingMonth}-01`;
  const monthEnd = `${billingMonth}-${String(lastDay).padStart(2, '0')}`;

  const ids = new Set<string>();
  for (const client of clients) {
    const hasActive = (client.selectedEquipment || []).some(eq => {
      if (eq.status !== '自費レンタル') return false;
      if (eq.startDate && eq.startDate > monthEnd) return false;
      if (eq.endDate && eq.endDate < monthStart) return false;
      return true;
    });
    if (hasActive) ids.add(client.aozoraId);
  }
  return ids;
}

/**
 * 会社・利用者ごとの自費レンタル突合データを構築
 */
function buildSelfPayRentalReconciliations(
  clients: Client[],
  invoiceItemsByCompany: Map<WholesaleCompany, InvoiceItem[]>,
  selfPayRentalClientIds: Set<string>,
  billingMonth: string
): Map<WholesaleCompany, InsuranceRentalClientReconciliation[]> {
  const [year, month] = billingMonth.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const monthStart = `${billingMonth}-01`;
  const monthEnd = `${billingMonth}-${String(lastDay).padStart(2, '0')}`;

  const clientMap = new Map(clients.map(c => [c.aozoraId, c]));
  const result = new Map<WholesaleCompany, InsuranceRentalClientReconciliation[]>();

  invoiceItemsByCompany.forEach((items, company) => {
    const relevantItems = items.filter(
      item => item.matchedAozoraId && selfPayRentalClientIds.has(item.matchedAozoraId)
    );
    if (relevantItems.length === 0) return;

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

      // 当月アクティブな自費レンタル品目
      const activeEquipments = (client.selectedEquipment || []).filter(eq => {
        if (eq.status !== '自費レンタル') return false;
        if (eq.startDate && eq.startDate > monthEnd) return false;
        if (eq.endDate && eq.endDate < monthStart) return false;
        return true;
      });

      const ourAmount = activeEquipments.reduce((sum, eq) => {
        return sum + (eq.unitPrice || 0) * (eq.quantity || 1);
      }, 0);

      const wholesalerAmount = clientItems.reduce((s, w) => s + w.amount, 0);

      const ourItems = activeEquipments.map(eq => ({
        id: eq.id,
        name: eq.selfPayProductName || eq.name || '',
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

    reconciliations.sort((a, b) => {
      const aHasDiff = a.difference !== 0 ? 0 : 1;
      const bHasDiff = b.difference !== 0 ? 0 : 1;
      return aHasDiff - bHasDiff || a.clientName.localeCompare(b.clientName, 'ja');
    });

    result.set(company, reconciliations);
  });

  return result;
}

const SelfPayRentalClientReconciliationSection: React.FC<Props> = ({
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

  const selfPayRentalClientIds = useMemo(
    () => getSelfPayRentalClientIds(clients, billingMonth),
    [clients, billingMonth]
  );

  const reconciliationsByCompany = useMemo(
    () => buildSelfPayRentalReconciliations(clients, invoiceItemsByCompany, selfPayRentalClientIds, billingMonth),
    [clients, invoiceItemsByCompany, selfPayRentalClientIds, billingMonth]
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
              const mappings = await loadItemMappings(company, r.aozoraId, SELF_PAY_RENTAL_COLLECTION);
              return { aozoraId: r.aozoraId, hasMappings: mappings.length > 0 };
            })
          ).then(results => {
            const savedIds = new Set(results.filter(r => r.hasMappings).map(r => r.aozoraId));
            setSavedMatchedIds(prev => new Map(prev).set(company, savedIds));
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
      const rows: string[] = ['\uFEFF種別,卸会社,利用者名,あおぞらID,弊社品目,卸品目,卸金額'];
      for (const [company, reconciliations] of reconciliationsByCompany) {
        for (const r of reconciliations) {
          const savedMappings = await loadItemMappings(company, r.aozoraId, SELF_PAY_RENTAL_COLLECTION);
          const pairs = buildItemPairs(r.ourItems, r.wholesalerItems, savedMappings);
          for (const pair of pairs) {
            if (pair.ourItem && pair.wholesalerItems.length > 0) {
              for (const wItem of pair.wholesalerItems) {
                rows.push([csvCell('自費レンタル'), csvCell(WHOLESALE_COMPANY_NAMES[company]), csvCell(r.clientName), csvCell(r.aozoraId), csvCell(pair.ourItem.name), csvCell(wItem.name), wItem.amount].join(','));
              }
            } else if (pair.ourItem) {
              rows.push([csvCell('自費レンタル'), csvCell(WHOLESALE_COMPANY_NAMES[company]), csvCell(r.clientName), csvCell(r.aozoraId), csvCell(pair.ourItem.name), '（未紐づけ）', ''].join(','));
            } else {
              for (const wItem of pair.wholesalerItems) {
                rows.push([csvCell('自費レンタル'), csvCell(WHOLESALE_COMPANY_NAMES[company]), csvCell(r.clientName), csvCell(r.aozoraId), '（未紐づけ）', csvCell(wItem.name), wItem.amount].join(','));
              }
            }
          }
        }
      }
      const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `自費レンタル_利用者別突合_${billingMonth}.csv`;
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
        <div className="px-6 py-4 bg-teal-50 border-b border-teal-200 flex items-center gap-3">
          <svg className="w-5 h-5 text-teal-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-teal-900">自費レンタル 利用者別突合</h2>
            <p className="text-xs text-teal-600 mt-0.5">
              当月アクティブな自費レンタル品目と卸請求を利用者単位で照合します
            </p>
          </div>
          <button
            onClick={handleExportCSV}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-700 border border-teal-300 rounded-lg hover:bg-teal-100 transition-colors disabled:opacity-50"
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
            const confirmStatus = reconciliationDoc?.selfPayRentalConfirmation?.[company];
            const isConfirmed = confirmStatus?.status === 'confirmed';
            const isConfirming = confirmingCompany === company;
            const mismatchCount = reconciliations.filter(r => r.difference !== 0).length;
            const totalOur = reconciliations.reduce((s, r) => s + r.ourAmount, 0);
            const totalWholesaler = reconciliations.reduce((s, r) => s + r.wholesalerAmount, 0);

            return (
              <div key={company}>
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
                        className="px-3 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {isConfirming ? '処理中...' : '確定する'}
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="bg-gray-50 border-t border-gray-200">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase">利用者</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">弊社（自費レンタル）</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">卸請求（仕入）</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">差額</th>
                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">詳細</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {reconciliations.map(r => {
                          const hasDiff = r.difference !== 0;
                          const isSaved = savedMatchedIds.get(company)?.has(r.aozoraId) ?? false;
                          return (
                            <tr key={r.aozoraId} className={`hover:bg-white transition-colors ${isSaved ? 'bg-green-50' : hasDiff ? 'bg-red-50' : 'bg-white'}`}>
                              <td className="px-6 py-3 text-sm text-gray-900">
                                <div className="flex items-center gap-2">
                                  <span>{r.clientName}</span>
                                  {isSaved && (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-medium">
                                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                      </svg>
                                      紐づけ済
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
                                ¥{r.wholesalerAmount.toLocaleString()}
                                <div className="text-xs font-normal text-gray-400">{r.wholesalerItems.length}品目</div>
                              </td>
                              <td className="px-4 py-3 text-sm text-right font-semibold">
                                {r.ourAmount === 0 ? (
                                  <span className="text-gray-400">—</span>
                                ) : (
                                  <span className={hasDiff ? 'text-red-600' : 'text-green-600'}>
                                    {r.difference >= 0 ? '+' : ''}{r.difference.toLocaleString()}円
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

      {detailTarget && (
        <InsuranceRentalClientDetailModal
          reconciliation={detailTarget}
          collectionName={SELF_PAY_RENTAL_COLLECTION}
          onClose={() => setDetailTarget(null)}
          onSaved={() => handleSaved(detailTarget.wholesaleCompany, detailTarget.aozoraId)}
        />
      )}
    </>
  );
};

export default SelfPayRentalClientReconciliationSection;
