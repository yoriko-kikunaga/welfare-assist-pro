import React, { useState, useCallback } from 'react';
import {
  Client,
  WholesaleCompany,
  WHOLESALE_COMPANY_NAMES,
  InvoiceItem,
} from '../types';
import {
  loadItemMappings,
  buildItemPairs,
  INSURANCE_RENTAL_COLLECTION,
  SALES_COLLECTION,
  SELF_PAY_RENTAL_COLLECTION,
} from '../src/services/insuranceRentalMatchService';

function csvCell(v: string | number): string {
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"` : s;
}

type SectionType = '介護保険レンタル' | '販売' | '自費レンタル';

interface UnmatchedRow {
  section: SectionType;
  aozoraId: string;
  clientName: string;
  facilityName: string;
  roomNumber: string;
  ourItemNames: string[];
  wholesalerItemName: string;
  wholesalerAmount: number;
  company: WholesaleCompany;
}

interface Props {
  clients: Client[];
  invoiceItemsByCompany: Map<WholesaleCompany, InvoiceItem[]>;
  billingMonth: string;
}

const SECTION_BADGE: Record<SectionType, string> = {
  '介護保険レンタル': 'bg-blue-100 text-blue-700',
  '販売': 'bg-purple-100 text-purple-700',
  '自費レンタル': 'bg-teal-100 text-teal-700',
};

const UnmatchedWholesalerItemsSection: React.FC<Props> = ({
  clients,
  invoiceItemsByCompany,
  billingMonth,
}) => {
  const [rows, setRows] = useState<UnmatchedRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [year, month] = billingMonth.split('-').map(Number);
      const lastDay = new Date(year, month, 0).getDate();
      const mStart = `${billingMonth}-01`;
      const mEnd = `${billingMonth}-${String(lastDay).padStart(2, '0')}`;
      const clientMap = new Map(clients.map(c => [c.aozoraId, c]));

      // 各セクションのアクティブ利用者IDセットを計算
      const insuranceIds = new Set<string>();
      const salesIds = new Set<string>();
      const selfPayIds = new Set<string>();
      for (const client of clients) {
        for (const eq of client.selectedEquipment || []) {
          if (eq.status === '介護保険レンタル') {
            if ((!eq.startDate || eq.startDate <= mEnd) && (!eq.endDate || eq.endDate >= mStart))
              insuranceIds.add(client.aozoraId);
          }
          if (eq.status === '販売' && eq.deliveryDate && eq.deliveryDate >= mStart && eq.deliveryDate <= mEnd)
            salesIds.add(client.aozoraId);
          if (eq.status === '自費レンタル') {
            if ((!eq.startDate || eq.startDate <= mEnd) && (!eq.endDate || eq.endDate >= mStart))
              selfPayIds.add(client.aozoraId);
          }
        }
      }

      const seenKeys = new Set<string>();
      const result: UnmatchedRow[] = [];

      // 各セクションを処理して卸品目のみ未紐づけを収集
      const processSection = async (
        section: SectionType,
        sectionIds: Set<string>,
        collection: string,
        getOurItems: (client: Client) => { id: string; name: string }[]
      ) => {
        for (const [company, allItems] of invoiceItemsByCompany) {
          const byClient = new Map<string, InvoiceItem[]>();
          for (const item of allItems) {
            if (!item.matchedAozoraId || !sectionIds.has(item.matchedAozoraId)) continue;
            if (!byClient.has(item.matchedAozoraId)) byClient.set(item.matchedAozoraId, []);
            byClient.get(item.matchedAozoraId)!.push(item);
          }
          for (const [aozoraId, clientItems] of byClient) {
            const client = clientMap.get(aozoraId);
            if (!client) continue;
            const ourItems = getOurItems(client);
            const savedMappings = await loadItemMappings(company, aozoraId, collection);
            const pairs = buildItemPairs(ourItems, clientItems, savedMappings);
            // 弊社品目のうち卸品目が未紐づけのもの（既紐づけ品目は除外）
            const ourItemNames = pairs
              .filter(p => p.ourItem !== null && p.wholesalerItems.length === 0)
              .map(p => p.ourItem!.name)
              .filter(n => n !== '');
            for (const pair of pairs) {
              if (pair.ourItem) continue; // 弊社品目がある場合はスキップ
              for (const wItem of pair.wholesalerItems) {
                const key = `${aozoraId}_${company}_${wItem.name}`;
                if (seenKeys.has(key)) continue; // 他セクションで既出はスキップ
                seenKeys.add(key);
                result.push({
                  section,
                  aozoraId,
                  clientName: client.name,
                  facilityName: client.facilityName || '',
                  roomNumber: client.roomNumber || '',
                  ourItemNames,
                  wholesalerItemName: wItem.name,
                  wholesalerAmount: wItem.amount,
                  company,
                });
              }
            }
          }
        }
      };

      await processSection(
        '介護保険レンタル',
        insuranceIds,
        INSURANCE_RENTAL_COLLECTION,
        (c) =>
          (c.selectedEquipment || [])
            .filter(eq => eq.status === '介護保険レンタル')
            .map(eq => ({ id: eq.id, name: eq.name || eq.selfPayProductName || '' }))
            .filter(i => i.name !== '')
      );

      await processSection(
        '販売',
        salesIds,
        SALES_COLLECTION,
        (c) =>
          (c.selectedEquipment || [])
            .filter(eq => eq.status === '販売' && eq.deliveryDate && eq.deliveryDate >= mStart && eq.deliveryDate <= mEnd)
            .map(eq => ({ id: eq.id, name: eq.name || eq.selfPayProductName || '' }))
            .filter(i => i.name !== '')
      );

      await processSection(
        '自費レンタル',
        selfPayIds,
        SELF_PAY_RENTAL_COLLECTION,
        (c) =>
          (c.selectedEquipment || [])
            .filter(eq =>
              eq.status === '自費レンタル' &&
              (!eq.startDate || eq.startDate <= mEnd) &&
              (!eq.endDate || eq.endDate >= mStart)
            )
            .map(eq => ({ id: eq.id, name: eq.selfPayProductName || eq.name || '' }))
            .filter(i => i.name !== '')
      );

      const sectionOrder: Record<SectionType, number> = {
        '介護保険レンタル': 0,
        '販売': 1,
        '自費レンタル': 2,
      };
      result.sort((a, b) => {
        const so = sectionOrder[a.section] - sectionOrder[b.section];
        return so !== 0 ? so : a.clientName.localeCompare(b.clientName, 'ja');
      });

      setRows(result);
      setLoaded(true);
    } finally {
      setIsLoading(false);
    }
  }, [clients, invoiceItemsByCompany, billingMonth]);

  const handleExportCSV = () => {
    setIsExporting(true);
    try {
      const lines = ['\uFEFF種別,あおぞらID,利用者名,施設名,居室,弊社品目,卸品目,卸金額,卸会社'];
      for (const row of rows) {
        lines.push(
          [
            csvCell(row.section),
            csvCell(row.aozoraId),
            csvCell(row.clientName),
            csvCell(row.facilityName),
            csvCell(row.roomNumber),
            csvCell(row.ourItemNames.join(' / ')),
            csvCell(row.wholesalerItemName),
            row.wholesalerAmount,
            csvCell(WHOLESALE_COMPANY_NAMES[row.company]),
          ].join(',')
        );
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `卸品目未紐づけ一覧_${billingMonth}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-orange-200 overflow-hidden">
      {/* ヘッダー */}
      <div className="px-6 py-4 bg-orange-50 border-b border-orange-200 flex items-center gap-3">
        <svg className="w-5 h-5 text-orange-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-orange-900">卸品目 未紐づけ一覧</h2>
          <p className="text-xs text-orange-600 mt-0.5">
            介護保険レンタル・販売・自費レンタルで弊社品目に紐づかない卸請求品目の一覧
          </p>
        </div>
        <div className="flex gap-2">
          {loaded && rows.length > 0 && (
            <button
              onClick={handleExportCSV}
              disabled={isExporting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-orange-700 border border-orange-300 rounded-lg hover:bg-orange-100 transition-colors disabled:opacity-50"
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
          )}
          <button
            onClick={load}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors disabled:opacity-50"
          >
            {isLoading ? (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {isLoading ? '読み込み中...' : loaded ? '再読み込み' : '読み込む'}
          </button>
        </div>
      </div>

      {/* 未読み込み状態 */}
      {!loaded && !isLoading && (
        <div className="px-6 py-8 text-center text-sm text-gray-400">
          「読み込む」ボタンを押すと未紐づけ品目を表示します
        </div>
      )}

      {/* 読み込み中 */}
      {isLoading && (
        <div className="px-6 py-8 text-center text-sm text-gray-400">
          Firestoreから紐づけ情報を取得中...
        </div>
      )}

      {/* 0件 */}
      {loaded && !isLoading && rows.length === 0 && (
        <div className="px-6 py-8 text-center">
          <svg className="w-8 h-8 text-green-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-sm text-green-600 font-medium">未紐づけ品目はありません</p>
        </div>
      )}

      {/* テーブル */}
      {loaded && !isLoading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">種別</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">あおぞらID</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">利用者名</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">施設名</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">居室</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">弊社品目</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">卸品目</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">卸金額</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">卸会社</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row, i) => (
                <tr key={i} className="hover:bg-orange-50 transition-colors">
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${SECTION_BADGE[row.section]}`}>
                      {row.section}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">{row.aozoraId}</td>
                  <td className="px-4 py-2.5 text-gray-900 font-medium">{row.clientName}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{row.facilityName || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{row.roomNumber || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-600 text-xs">
                    {row.ourItemNames.length > 0
                      ? row.ourItemNames.map((name, idx) => (
                          <div key={idx}>{name}</div>
                        ))
                      : <span className="text-gray-300">—</span>
                    }
                  </td>
                  <td className="px-4 py-2.5 text-gray-700">{row.wholesalerItemName}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">¥{row.wholesalerAmount.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{WHOLESALE_COMPANY_NAMES[row.company]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400 text-right">
            {rows.length}件
          </div>
        </div>
      )}
    </div>
  );
};

export default UnmatchedWholesalerItemsSection;
