import React, { useState, useMemo } from 'react';
import { Client, Equipment } from '../types';

interface MonthlySalesExportProps {
  clients: Client[];
}

type TabType = 'selfPayRental' | 'sales';

const MonthlySalesExport: React.FC<MonthlySalesExportProps> = ({ clients }) => {
  const [activeTab, setActiveTab] = useState<TabType>('selfPayRental');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // 月の開始日と終了日を計算
  const { monthStart, monthEnd } = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0); // 月末
    return {
      monthStart: start.toISOString().split('T')[0],
      monthEnd: end.toISOString().split('T')[0]
    };
  }, [selectedMonth]);

  // 自費レンタル利用者を抽出
  const selfPayRentalData = useMemo(() => {
    const result: Array<{
      client: Client;
      equipment: Equipment[];
    }> = [];

    clients.forEach(client => {
      const selfPayEquipment = (client.selectedEquipment || []).filter(eq => {
        if (eq.status !== '自費レンタル') return false;

        // 利用期間が選択月と重なるかチェック
        const startDate = eq.startDate || '1900-01-01';
        const endDate = eq.endDate || '2999-12-31';

        // 利用開始日が月末以前 AND 利用終了日が月初以降
        return startDate <= monthEnd && endDate >= monthStart;
      });

      if (selfPayEquipment.length > 0) {
        result.push({ client, equipment: selfPayEquipment });
      }
    });

    return result.sort((a, b) => a.client.aozoraId.localeCompare(b.client.aozoraId));
  }, [clients, monthStart, monthEnd]);

  // 販売データを抽出（納品日で集計）
  const salesData = useMemo(() => {
    const result: Array<{
      client: Client;
      equipment: Equipment[];
    }> = [];

    clients.forEach(client => {
      const salesEquipment = (client.selectedEquipment || []).filter(eq => {
        if (eq.status !== '販売') return false;

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
  }, [clients, monthStart, monthEnd]);

  // CSV出力（自費レンタル）
  const exportSelfPayRentalCSV = () => {
    const headers = [
      'あおぞらID',
      '氏名',
      '氏名カナ',
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
          client.nameKana,
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

    downloadCSV(headers, rows, `自費レンタル_${selectedMonth}.csv`);
  };

  // CSV出力（販売）
  const exportSalesCSV = () => {
    const headers = [
      'あおぞらID',
      '氏名',
      '氏名カナ',
      '施設名',
      '商品名',
      '数量',
      '単価',
      '金額',
      '納品日',
      '備考'
    ];

    const rows = salesData.flatMap(({ client, equipment }) =>
      equipment.map(eq => [
        client.aozoraId,
        client.name,
        client.nameKana,
        client.facilityName || '',
        eq.name || '',
        '1',
        eq.unitPrice?.toString() || '',
        eq.unitPrice?.toString() || '',
        eq.deliveryDate || '',
        eq.note || ''
      ])
    );

    downloadCSV(headers, rows, `販売_${selectedMonth}.csv`);
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

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* ヘッダー */}
      <div className="bg-white border-b border-gray-200 p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">月次売上処理</h2>

        {/* 月度選択 */}
        <div className="flex items-center gap-4 mb-4">
          <label className="text-sm font-bold text-gray-600">月度選択:</label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
          />
          <span className="text-lg font-bold text-primary-600">{formatMonth(selectedMonth)}</span>
        </div>

        {/* タブ切り替え */}
        <div className="flex gap-2">
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
              {selfPayRentalData.length}件
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
              {salesData.length}件
            </span>
          </button>
        </div>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 overflow-y-auto p-6">
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
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">あおぞらID</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">氏名</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">施設名</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">商品名</th>
                    <th className="px-4 py-3 text-right text-xs font-bold text-gray-600 uppercase">単価</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">納品日</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {salesData.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                        {formatMonth(selectedMonth)}の販売データはありません
                      </td>
                    </tr>
                  ) : (
                    salesData.flatMap(({ client, equipment }) =>
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
                          <td className="px-4 py-3 text-sm text-gray-700 text-right">
                            {eq.unitPrice ? `¥${eq.unitPrice.toLocaleString()}` : '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {eq.deliveryDate || '-'}
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
      </div>
    </div>
  );
};

export default MonthlySalesExport;
