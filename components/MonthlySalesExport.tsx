import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Client, Equipment, OfficeLocation, SalesType, ReconciliationDocument } from '../types';
import { getReconciliation, confirmSales, unconfirmSales } from '../src/services/firestoreService';

interface MonthlySalesExportProps {
  clients: Client[];
  userEmail: string;
}

type TabType = 'insuranceRental' | 'selfPayRental' | 'sales';
type OfficeFilter = 'all' | OfficeLocation;

const OFFICE_OPTIONS: { value: OfficeFilter; label: string }[] = [
  { value: 'all', label: '全事業所' },
  { value: '鹿児島（ACG）', label: '鹿児島（ACG）' },
  { value: '福岡（Lichi）', label: '福岡（Lichi）' },
];

const SALES_TYPES: SalesType[] = ['介護保険レンタル', '自費レンタル', '販売'];

// Map OfficeFilter to the format used by reconciliation functions
const mapOfficeFilter = (office: OfficeFilter): '全事業所' | OfficeLocation => {
  return office === 'all' ? '全事業所' : office;
};

const MonthlySalesExport: React.FC<MonthlySalesExportProps> = ({ clients, userEmail }) => {
  const [activeTab, setActiveTab] = useState<TabType>('insuranceRental');
  const [selectedOffice, setSelectedOffice] = useState<OfficeFilter>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // Firestore reconciliation state
  const [reconciliationDoc, setReconciliationDoc] = useState<ReconciliationDocument | null>(null);
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // 月の開始日と終了日を計算（ローカル日付文字列を直接生成）
  const { monthStart, monthEnd } = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number);
    // 月末日を計算（翌月の0日 = 当月の末日）
    const lastDay = new Date(year, month, 0).getDate();
    return {
      monthStart: `${year}-${String(month).padStart(2, '0')}-01`,
      monthEnd: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    };
  }, [selectedMonth]);

  // Load reconciliation document from Firestore
  const loadReconciliationDoc = useCallback(async () => {
    try {
      const doc = await getReconciliation(selectedMonth, mapOfficeFilter(selectedOffice));
      setReconciliationDoc(doc);
    } catch (error) {
      console.error('Error loading reconciliation doc:', error);
    }
  }, [selectedMonth, selectedOffice]);

  useEffect(() => {
    loadReconciliationDoc();
  }, [loadReconciliationDoc]);

  // Count confirmed sales
  const confirmedSalesCount = useMemo(() => {
    if (!reconciliationDoc) return 0;
    return SALES_TYPES.filter(type =>
      reconciliationDoc.salesConfirmation?.[type]?.status === 'confirmed'
    ).length;
  }, [reconciliationDoc]);

  // Handle sales confirmation
  const handleConfirmSales = async (salesType: SalesType) => {
    setIsConfirming(true);
    setConfirmError(null);
    try {
      const summary = salesSummary[salesType];
      await confirmSales(selectedMonth, mapOfficeFilter(selectedOffice), salesType, summary.count, summary.amount, userEmail);
      await loadReconciliationDoc();
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : '確定処理でエラーが発生しました');
    } finally {
      setIsConfirming(false);
    }
  };

  // Handle sales unconfirmation
  const handleUnconfirmSales = async (salesType: SalesType) => {
    if (reconciliationDoc?.monthlyStatus === 'confirmed') {
      setConfirmError('月次確定済みのため解除できません。先に売上・仕入突合ページで月次確定を解除してください。');
      return;
    }

    setIsConfirming(true);
    setConfirmError(null);
    try {
      await unconfirmSales(selectedMonth, mapOfficeFilter(selectedOffice), salesType, userEmail);
      await loadReconciliationDoc();
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : '解除処理でエラーが発生しました');
    } finally {
      setIsConfirming(false);
    }
  };

  // 介護保険レンタルデータを抽出
  const insuranceRentalData = useMemo(() => {
    const result: Array<{
      client: Client;
      equipment: Equipment[];
    }> = [];

    clients.forEach(client => {
      const insuranceEquipment = (client.selectedEquipment || []).filter(eq => {
        if (eq.status !== '介護保険レンタル') return false;

        // 事業所フィルター
        if (selectedOffice !== 'all' && eq.office !== selectedOffice) {
          return false;
        }

        // 利用開始日が月末以前であること
        const startDate = eq.startDate || '1900-01-01';
        if (startDate > monthEnd) {
          return false;
        }

        // 利用終了日が選択月の開始日より前の場合は除外
        if (eq.endDate && eq.endDate < monthStart) {
          return false;
        }

        return true;
      });

      if (insuranceEquipment.length > 0) {
        result.push({ client, equipment: insuranceEquipment });
      }
    });

    return result.sort((a, b) => a.client.aozoraId.localeCompare(b.client.aozoraId));
  }, [clients, monthStart, monthEnd, selectedOffice]);

  // 自費レンタル利用者を抽出
  const selfPayRentalData = useMemo(() => {
    const result: Array<{
      client: Client;
      equipment: Equipment[];
    }> = [];

    clients.forEach(client => {
      const selfPayEquipment = (client.selectedEquipment || []).filter(eq => {
        if (eq.status !== '自費レンタル') return false;

        // 事業所フィルター
        if (selectedOffice !== 'all' && eq.office !== selectedOffice) {
          return false;
        }

        // 利用終了日が選択月より前の場合は除外
        if (eq.endDate && eq.endDate < monthStart) {
          return false;
        }

        // 利用開始日が月末以前であること（まだ始まっていない場合は除外）
        const startDate = eq.startDate || '1900-01-01';
        if (startDate > monthEnd) {
          return false;
        }

        return true;
      });

      if (selfPayEquipment.length > 0) {
        result.push({ client, equipment: selfPayEquipment });
      }
    });

    return result.sort((a, b) => a.client.aozoraId.localeCompare(b.client.aozoraId));
  }, [clients, monthStart, monthEnd, selectedOffice]);

  // 販売データを抽出（納品日で集計）
  const salesData = useMemo(() => {
    const result: Array<{
      client: Client;
      equipment: Equipment[];
    }> = [];

    clients.forEach(client => {
      const salesEquipment = (client.selectedEquipment || []).filter(eq => {
        if (eq.status !== '販売') return false;

        // 事業所フィルター
        if (selectedOffice !== 'all' && eq.office !== selectedOffice) {
          return false;
        }

        // 納品日が選択月内かチェック
        const deliveryDate = eq.deliveryDate || '';
        if (!deliveryDate) return false;

        return deliveryDate >= monthStart && deliveryDate <= monthEnd;
      });

      if (salesEquipment.length > 0) {
        result.push({ client, equipment: salesEquipment });
      }
    });

    return result.sort((a, b) => a.client.aozoraId.localeCompare(b.client.aozoraId));
  }, [clients, monthStart, monthEnd, selectedOffice]);

  // Sales summary by type - calculated from local tab data (same calculation as tab content)
  const salesSummary = useMemo(() => {
    const summary: Record<SalesType, { count: number; amount: number }> = {
      '介護保険レンタル': { count: 0, amount: 0 },
      '自費レンタル': { count: 0, amount: 0 },
      '販売': { count: 0, amount: 0 }
    };

    // 介護保険レンタル: units * 10 (1単位 = 10円)
    insuranceRentalData.forEach(({ equipment }) => {
      equipment.forEach(eq => {
        summary['介護保険レンタル'].count++;
        const units = parseInt(eq.units || '0', 10);
        summary['介護保険レンタル'].amount += units * 10;
      });
    });

    // 自費レンタル: unitPrice * quantity (税抜金額＝月額利用料)
    selfPayRentalData.forEach(({ equipment }) => {
      equipment.forEach(eq => {
        summary['自費レンタル'].count++;
        const quantity = eq.quantity || 1;
        const unitPrice = eq.unitPrice || 0;
        summary['自費レンタル'].amount += unitPrice * quantity;
      });
    });

    // 販売: unitPrice * quantity (税抜金額)
    salesData.forEach(({ equipment }) => {
      equipment.forEach(eq => {
        summary['販売'].count++;
        const quantity = eq.quantity || 1;
        const unitPrice = eq.unitPrice || 0;
        summary['販売'].amount += unitPrice * quantity;
      });
    });

    return summary;
  }, [insuranceRentalData, selfPayRentalData, salesData]);

  // CSV出力（介護保険レンタル）
  const exportInsuranceRentalCSV = () => {
    const headers = [
      'あおぞらID',
      '氏名',
      '施設名',
      '商品名',
      '種類',
      'メーカー',
      '卸会社',
      '単位数',
      'タイスコード',
      '利用開始日',
      '利用終了日'
    ];

    const rows = insuranceRentalData.flatMap(({ client, equipment }) =>
      equipment.map(eq => [
        client.aozoraId,
        client.name,
        client.facilityName || '',
        eq.name || '',
        eq.category || '',
        eq.manufacturer || '',
        eq.wholesaler || '',
        eq.units || '',
        eq.taisCode || '',
        eq.startDate || '',
        eq.endDate || ''
      ])
    );

    const officeLabel = selectedOffice === 'all' ? '全事業所' : selectedOffice;
    downloadCSV(headers, rows, `介護保険レンタル_${selectedMonth}_${officeLabel}.csv`);
  };

  // CSV出力（自費レンタル）
  const exportSelfPayRentalCSV = () => {
    const headers = [
      'あおぞらID',
      '氏名',
      '施設名',
      '商品名',
      '単価',
      '個数',
      '金額（税抜）',
      '税区分',
      '金額（税込）',
      '利用開始日',
      '利用終了日',
      '備考'
    ];

    const rows = selfPayRentalData.flatMap(({ client, equipment }) =>
      equipment.map(eq => {
        const quantity = eq.quantity || 1;
        const unitPrice = eq.unitPrice || 0;
        const amountBeforeTax = unitPrice * quantity;
        const taxType = eq.taxType || '非課税';
        const taxRate = taxType === '10％' ? 0.1 : taxType === '軽8％' ? 0.08 : 0;
        const amountWithTax = taxType === '税込' ? amountBeforeTax : Math.floor(amountBeforeTax * (1 + taxRate));

        return [
          client.aozoraId,
          client.name,
          client.facilityName || '',
          eq.name || eq.selfPayProductName || '',
          unitPrice.toString(),
          quantity.toString(),
          amountBeforeTax.toString(),
          taxType,
          amountWithTax.toString(),
          eq.startDate || '',
          eq.endDate || '',
          eq.note || ''
        ];
      })
    );

    const officeLabel = selectedOffice === 'all' ? '全事業所' : selectedOffice;
    downloadCSV(headers, rows, `自費レンタル_${selectedMonth}_${officeLabel}.csv`);
  };

  // CSV出力（販売）
  const exportSalesCSV = () => {
    const headers = [
      'あおぞらID',
      '氏名',
      '施設名',
      '商品名',
      '単価',
      '数量',
      '税区分',
      '税込金額',
      '送料',
      '総計',
      '受注日',
      '納品日',
      '支払い方法',
      '取引方法',
      '利用者自己負担割合',
      '一部負担上限額',
      '利用者負担額',
      '申請額',
      '申請あり',
      '申請の進捗',
      '申請市町村',
      '営業担当',
      '備考'
    ];

    const rows = salesData.flatMap(({ client, equipment }) =>
      equipment.map(eq => {
        const quantity = eq.quantity || 1;
        const unitPrice = eq.unitPrice || 0;
        const taxType = eq.taxType || '非課税';
        const taxRate = taxType === '10％' ? 0.1 : taxType === '軽8％' ? 0.08 : 0;
        const amountBeforeTax = unitPrice * quantity;
        const taxIncludedAmount = taxType === '税込' ? amountBeforeTax : Math.floor(amountBeforeTax * (1 + taxRate));
        const shippingCost = eq.shippingCost || 0;
        const total = taxIncludedAmount + shippingCost;

        // 利用者負担額・申請額の自動計算
        let userBurdenAmount = eq.userBurdenAmount;
        let applicationAmount = eq.applicationAmount;
        const burdenLimitAmount = eq.burdenLimitAmount || 0;

        // 利用者自己負担割合が設定されている場合は自動計算
        if (eq.userBurdenType && !eq.userBurdenAmount) {
          switch (eq.userBurdenType) {
            case '自己負担０（日常生活給付）':
              userBurdenAmount = 0;
              applicationAmount = total;
              break;
            case '一部負担（日常生活給付）':
              userBurdenAmount = burdenLimitAmount > 0 ? Math.min(burdenLimitAmount, total) : 0;
              applicationAmount = total - userBurdenAmount;
              break;
            case '１割負担（受領委任払い）':
              userBurdenAmount = Math.ceil(total * 0.1);
              if (burdenLimitAmount > 0) userBurdenAmount = Math.min(userBurdenAmount, burdenLimitAmount);
              applicationAmount = total - userBurdenAmount;
              break;
            case '２割負担（受領委任払い）':
              userBurdenAmount = Math.ceil(total * 0.2);
              if (burdenLimitAmount > 0) userBurdenAmount = Math.min(userBurdenAmount, burdenLimitAmount);
              applicationAmount = total - userBurdenAmount;
              break;
            case '３割負担（受領委任払い）':
              userBurdenAmount = Math.ceil(total * 0.3);
              if (burdenLimitAmount > 0) userBurdenAmount = Math.min(userBurdenAmount, burdenLimitAmount);
              applicationAmount = total - userBurdenAmount;
              break;
            case '全額負担（償還払い）':
              userBurdenAmount = total;
              applicationAmount = total;
              break;
          }
        }

        return [
          client.aozoraId,
          client.name,
          client.facilityName || '',
          eq.name || '',
          unitPrice.toString(),
          quantity.toString(),
          taxType,
          taxIncludedAmount.toString(),
          shippingCost.toString(),
          total.toString(),
          eq.orderReceivedDate || '',
          eq.deliveryDate || '',
          eq.paymentMethod || '',
          eq.transactionType || '',
          eq.userBurdenType || '',
          burdenLimitAmount ? burdenLimitAmount.toString() : '',
          userBurdenAmount ? userBurdenAmount.toString() : '',
          applicationAmount ? applicationAmount.toString() : '',
          eq.applicationStatus ? '○' : '',
          eq.applicationProgress || '',
          eq.applicationMunicipality || '',
          eq.salesPerson || '',
          eq.note || ''
        ];
      })
    );

    const officeLabel = selectedOffice === 'all' ? '全事業所' : selectedOffice;
    downloadCSV(headers, rows, `販売_${selectedMonth}_${officeLabel}.csv`);
  };

  // CSVダウンロード関数
  const downloadCSV = (headers: string[], rows: string[][], filename: string) => {
    const BOM = '\uFEFF';
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 月表示用のフォーマット
  const formatMonth = (monthStr: string) => {
    const [year, month] = monthStr.split('-');
    return `${year}年${parseInt(month)}月`;
  };

  // Format currency
  const formatCurrency = (amount: number) => `¥${amount.toLocaleString()}`;

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* ヘッダー */}
      <div className="bg-white border-b border-gray-200 p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">月次売上処理</h2>

        {/* 月度選択・事業所選択 */}
        <div className="flex items-center gap-6 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm font-bold text-gray-600">月度:</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
            />
            <span className="text-lg font-bold text-primary-600">{formatMonth(selectedMonth)}</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-bold text-gray-600">事業所:</label>
            <select
              value={selectedOffice}
              onChange={(e) => setSelectedOffice(e.target.value as OfficeFilter)}
              className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none bg-white"
            >
              {OFFICE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* タブ切り替え */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('insuranceRental')}
            className={`px-6 py-3 rounded-lg font-bold transition-colors flex items-center gap-2 ${
              activeTab === 'insuranceRental'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
            </svg>
            介護保険レンタル
            <span className="bg-white bg-opacity-20 px-2 py-0.5 rounded text-sm">
              {insuranceRentalData.reduce((sum, d) => sum + d.equipment.length, 0)}件
            </span>
          </button>
          <button
            onClick={() => setActiveTab('selfPayRental')}
            className={`px-6 py-3 rounded-lg font-bold transition-colors flex items-center gap-2 ${
              activeTab === 'selfPayRental'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
            </svg>
            自費レンタル
            <span className="bg-white bg-opacity-20 px-2 py-0.5 rounded text-sm">
              {selfPayRentalData.reduce((sum, d) => sum + d.equipment.length, 0)}件
            </span>
          </button>
          <button
            onClick={() => setActiveTab('sales')}
            className={`px-6 py-3 rounded-lg font-bold transition-colors flex items-center gap-2 ${
              activeTab === 'sales'
                ? 'bg-green-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
            </svg>
            販売
            <span className="bg-white bg-opacity-20 px-2 py-0.5 rounded text-sm">
              {salesData.reduce((sum, d) => sum + d.equipment.length, 0)}件
            </span>
          </button>
        </div>
      </div>

      {/* 売上サマリー＋確定ボタン */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">売上サマリー（税抜）</h3>
        {confirmError && (
          <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-xs">
            {confirmError}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {SALES_TYPES.map((type) => {
            const summary = salesSummary[type];
            const confirmation = reconciliationDoc?.salesConfirmation?.[type];
            const isConfirmed = confirmation?.status === 'confirmed';
            const displayCount = isConfirmed ? confirmation.count : summary.count;
            const displayAmount = isConfirmed ? confirmation.amount : summary.amount;

            return (
              <div
                key={type}
                className={`rounded-lg p-4 ${
                  type === '介護保険レンタル' ? 'bg-blue-50' :
                  type === '自費レンタル' ? 'bg-purple-50' :
                  'bg-amber-50'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-sm font-medium ${
                    type === '介護保険レンタル' ? 'text-blue-800' :
                    type === '自費レンタル' ? 'text-purple-800' :
                    'text-amber-800'
                  }`}>
                    {type}
                  </span>
                  {isConfirmed && (
                    <span className="flex items-center gap-1 text-green-600 text-xs">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                      </svg>
                      確定済
                    </span>
                  )}
                </div>
                <div className={`text-lg font-bold ${
                  type === '介護保険レンタル' ? 'text-blue-700' :
                  type === '自費レンタル' ? 'text-purple-700' :
                  'text-amber-700'
                }`}>
                  {displayCount}件
                </div>
                <div className={`text-sm ${
                  type === '介護保険レンタル' ? 'text-blue-600' :
                  type === '自費レンタル' ? 'text-purple-600' :
                  'text-amber-600'
                }`}>
                  {formatCurrency(displayAmount)}
                </div>
                <div className="mt-2 flex gap-2">
                  {isConfirmed ? (
                    <button
                      onClick={() => handleUnconfirmSales(type)}
                      disabled={isConfirming || reconciliationDoc?.monthlyStatus === 'confirmed'}
                      className="w-full px-3 py-1.5 text-xs font-medium text-red-600 bg-white border border-red-200 rounded hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      解除
                    </button>
                  ) : (
                    <button
                      onClick={() => handleConfirmSales(type)}
                      disabled={isConfirming || summary.count === 0}
                      className={`w-full px-3 py-1.5 text-xs font-medium text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        type === '介護保険レンタル' ? 'bg-blue-600 hover:bg-blue-700' :
                        type === '自費レンタル' ? 'bg-purple-600 hover:bg-purple-700' :
                        'bg-amber-600 hover:bg-amber-700'
                      }`}
                    >
                      確定
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* 合計 */}
          <div className="bg-gray-100 rounded-lg p-4">
            <div className="text-sm font-medium text-gray-700 mb-2">合計</div>
            <div className="text-lg font-bold text-gray-900">
              {salesSummary['介護保険レンタル'].count + salesSummary['自費レンタル'].count + salesSummary['販売'].count}件
            </div>
            <div className="text-sm text-gray-600">
              {formatCurrency(salesSummary['介護保険レンタル'].amount + salesSummary['自費レンタル'].amount + salesSummary['販売'].amount)}
            </div>
            <div className="mt-2 text-xs text-gray-500">
              {confirmedSalesCount}/3 確定済
            </div>
          </div>
        </div>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'insuranceRental' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {/* ヘッダー */}
            <div className="bg-blue-50 border-b border-blue-100 px-6 py-4 flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold text-blue-800">介護保険レンタル利用者</h3>
                <p className="text-sm text-blue-600 mt-1">
                  {formatMonth(selectedMonth)}の利用者: {insuranceRentalData.length}名 /
                  用具: {insuranceRentalData.reduce((sum, d) => sum + d.equipment.length, 0)}件
                </p>
              </div>
              <button
                onClick={exportInsuranceRentalCSV}
                disabled={insuranceRentalData.length === 0}
                className="bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed px-4 py-2 rounded-lg shadow-md text-sm font-bold flex items-center gap-2 transition-all"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                CSVダウンロード
              </button>
            </div>

            {/* テーブル */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">あおぞらID</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">氏名</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">施設名</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">商品名</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">種類</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">メーカー</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">卸会社</th>
                    <th className="px-4 py-3 text-right text-xs font-bold text-gray-600 uppercase">単位数</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">タイスコード</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">利用開始日</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">利用終了日</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {insuranceRentalData.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-6 py-12 text-center text-gray-400">
                        {formatMonth(selectedMonth)}の介護保険レンタル利用者はいません
                      </td>
                    </tr>
                  ) : (
                    insuranceRentalData.flatMap(({ client, equipment }) =>
                      equipment.map((eq, idx) => (
                        <tr key={`${client.aozoraId}-${eq.id}`} className="hover:bg-gray-50">
                          {idx === 0 ? (
                            <>
                              <td className="px-4 py-3 text-sm font-medium text-gray-900" rowSpan={equipment.length}>
                                {client.aozoraId}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700" rowSpan={equipment.length}>
                                {client.name}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600" rowSpan={equipment.length}>
                                {client.facilityName || '-'}
                              </td>
                            </>
                          ) : null}
                          <td className="px-4 py-3 text-sm text-gray-700">
                            {eq.name || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {eq.category || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {eq.manufacturer || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {eq.wholesaler || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700 text-right">
                            {eq.units || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {eq.taisCode || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {eq.startDate || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {eq.endDate || '-'}
                          </td>
                        </tr>
                      ))
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'selfPayRental' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {/* ヘッダー */}
            <div className="bg-purple-50 border-b border-purple-100 px-6 py-4 flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold text-purple-800">自費レンタル利用者</h3>
                <p className="text-sm text-purple-600 mt-1">
                  {formatMonth(selectedMonth)}の利用者: {selfPayRentalData.length}名 /
                  用具: {selfPayRentalData.reduce((sum, d) => sum + d.equipment.length, 0)}件
                </p>
              </div>
              <button
                onClick={exportSelfPayRentalCSV}
                disabled={selfPayRentalData.length === 0}
                className="bg-purple-600 text-white hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed px-4 py-2 rounded-lg shadow-md text-sm font-bold flex items-center gap-2 transition-all"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                CSVダウンロード
              </button>
            </div>

            {/* テーブル */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">あおぞらID</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">氏名</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">施設名</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">商品名</th>
                    <th className="px-4 py-3 text-right text-xs font-bold text-gray-600 uppercase">単価</th>
                    <th className="px-4 py-3 text-right text-xs font-bold text-gray-600 uppercase">個数</th>
                    <th className="px-4 py-3 text-right text-xs font-bold text-gray-600 uppercase">金額（税抜）</th>
                    <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase">税区分</th>
                    <th className="px-4 py-3 text-right text-xs font-bold text-gray-600 uppercase">金額（税込）</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">利用開始日</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">利用終了日</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {selfPayRentalData.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-6 py-12 text-center text-gray-400">
                        {formatMonth(selectedMonth)}の自費レンタル利用者はいません
                      </td>
                    </tr>
                  ) : (
                    selfPayRentalData.flatMap(({ client, equipment }) =>
                      equipment.map((eq, idx) => {
                        const quantity = eq.quantity || 1;
                        const unitPrice = eq.unitPrice || 0;
                        const amountBeforeTax = unitPrice * quantity;
                        const taxType = eq.taxType || '非課税';
                        const taxRate = taxType === '10％' ? 0.1 : taxType === '軽8％' ? 0.08 : 0;
                        const amountWithTax = taxType === '税込' ? amountBeforeTax : Math.floor(amountBeforeTax * (1 + taxRate));

                        return (
                          <tr key={`${client.aozoraId}-${eq.id}`} className="hover:bg-gray-50">
                            {idx === 0 ? (
                              <>
                                <td className="px-4 py-3 text-sm font-medium text-gray-900" rowSpan={equipment.length}>
                                  {client.aozoraId}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-700" rowSpan={equipment.length}>
                                  {client.name}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-600" rowSpan={equipment.length}>
                                  {client.facilityName || '-'}
                                </td>
                              </>
                            ) : null}
                            <td className="px-4 py-3 text-sm text-gray-700">
                              {eq.name || eq.selfPayProductName || '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700 text-right">
                              {unitPrice ? `¥${unitPrice.toLocaleString()}` : '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700 text-right">
                              {quantity}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700 text-right">
                              {amountBeforeTax ? `¥${amountBeforeTax.toLocaleString()}` : '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600 text-center">
                              {taxType}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700 text-right font-medium">
                              {amountWithTax ? `¥${amountWithTax.toLocaleString()}` : '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">
                              {eq.startDate || '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">
                              {eq.endDate || '-'}
                            </td>
                          </tr>
                        );
                      })
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'sales' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {/* ヘッダー */}
            <div className="bg-green-50 border-b border-green-100 px-6 py-4 flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold text-green-800">販売集計</h3>
                <p className="text-sm text-green-600 mt-1">
                  {formatMonth(selectedMonth)}の納品: {salesData.length}名 /
                  商品: {salesData.reduce((sum, d) => sum + d.equipment.length, 0)}件
                </p>
              </div>
              <button
                onClick={exportSalesCSV}
                disabled={salesData.length === 0}
                className="bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed px-4 py-2 rounded-lg shadow-md text-sm font-bold flex items-center gap-2 transition-all"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                CSVダウンロード
              </button>
            </div>

            {/* テーブル */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-bold text-gray-600 uppercase whitespace-nowrap">あおぞらID</th>
                    <th className="px-3 py-3 text-left text-xs font-bold text-gray-600 uppercase whitespace-nowrap">氏名</th>
                    <th className="px-3 py-3 text-left text-xs font-bold text-gray-600 uppercase whitespace-nowrap">施設名</th>
                    <th className="px-3 py-3 text-left text-xs font-bold text-gray-600 uppercase whitespace-nowrap">商品名</th>
                    <th className="px-3 py-3 text-right text-xs font-bold text-gray-600 uppercase whitespace-nowrap">単価</th>
                    <th className="px-3 py-3 text-right text-xs font-bold text-gray-600 uppercase whitespace-nowrap">数量</th>
                    <th className="px-3 py-3 text-center text-xs font-bold text-gray-600 uppercase whitespace-nowrap">税区分</th>
                    <th className="px-3 py-3 text-right text-xs font-bold text-gray-600 uppercase whitespace-nowrap">税込金額</th>
                    <th className="px-3 py-3 text-right text-xs font-bold text-gray-600 uppercase whitespace-nowrap">送料</th>
                    <th className="px-3 py-3 text-right text-xs font-bold text-gray-600 uppercase whitespace-nowrap">総計</th>
                    <th className="px-3 py-3 text-left text-xs font-bold text-gray-600 uppercase whitespace-nowrap">受注日</th>
                    <th className="px-3 py-3 text-left text-xs font-bold text-gray-600 uppercase whitespace-nowrap">納品日</th>
                    <th className="px-3 py-3 text-left text-xs font-bold text-gray-600 uppercase whitespace-nowrap">支払い方法</th>
                    <th className="px-3 py-3 text-left text-xs font-bold text-gray-600 uppercase whitespace-nowrap">取引方法</th>
                    <th className="px-3 py-3 text-left text-xs font-bold text-gray-600 uppercase whitespace-nowrap">自己負担割合</th>
                    <th className="px-3 py-3 text-center text-xs font-bold text-gray-600 uppercase whitespace-nowrap">申請あり</th>
                    <th className="px-3 py-3 text-left text-xs font-bold text-gray-600 uppercase whitespace-nowrap">申請市町村</th>
                    <th className="px-3 py-3 text-left text-xs font-bold text-gray-600 uppercase whitespace-nowrap">営業担当</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {salesData.length === 0 ? (
                    <tr>
                      <td colSpan={18} className="px-6 py-12 text-center text-gray-400">
                        {formatMonth(selectedMonth)}の販売データはありません
                      </td>
                    </tr>
                  ) : (
                    salesData.flatMap(({ client, equipment }) =>
                      equipment.map((eq, idx) => {
                        const quantity = eq.quantity || 1;
                        const unitPrice = eq.unitPrice || 0;
                        const taxType = eq.taxType || '非課税';
                        const taxRate = taxType === '10％' ? 0.1 : taxType === '軽8％' ? 0.08 : 0;
                        const amountBeforeTax = unitPrice * quantity;
                        const taxIncludedAmount = taxType === '税込' ? amountBeforeTax : Math.floor(amountBeforeTax * (1 + taxRate));
                        const shippingCost = eq.shippingCost || 0;
                        const total = taxIncludedAmount + shippingCost;

                        return (
                          <tr key={`${client.aozoraId}-${eq.id}`} className="hover:bg-gray-50">
                            {idx === 0 ? (
                              <>
                                <td className="px-3 py-3 text-sm font-medium text-gray-900 whitespace-nowrap" rowSpan={equipment.length}>
                                  {client.aozoraId}
                                </td>
                                <td className="px-3 py-3 text-sm text-gray-700 whitespace-nowrap" rowSpan={equipment.length}>
                                  {client.name}
                                </td>
                                <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap" rowSpan={equipment.length}>
                                  {client.facilityName || '-'}
                                </td>
                              </>
                            ) : null}
                            <td className="px-3 py-3 text-sm text-gray-700">
                              {eq.name || '-'}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-700 text-right whitespace-nowrap">
                              {unitPrice ? `¥${unitPrice.toLocaleString()}` : '-'}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-700 text-right">
                              {quantity}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-600 text-center whitespace-nowrap">
                              {taxType}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-700 text-right whitespace-nowrap">
                              {taxIncludedAmount ? `¥${taxIncludedAmount.toLocaleString()}` : '-'}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-700 text-right whitespace-nowrap">
                              {shippingCost ? `¥${shippingCost.toLocaleString()}` : '-'}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-700 text-right font-medium whitespace-nowrap">
                              {total ? `¥${total.toLocaleString()}` : '-'}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                              {eq.orderReceivedDate || '-'}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                              {eq.deliveryDate || '-'}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                              {eq.paymentMethod || '-'}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                              {eq.transactionType || '-'}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                              {eq.userBurdenType || '-'}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-600 text-center whitespace-nowrap">
                              {eq.applicationStatus ? '○' : '-'}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                              {eq.applicationMunicipality || '-'}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                              {eq.salesPerson || '-'}
                            </td>
                          </tr>
                        );
                      })
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MonthlySalesExport;
