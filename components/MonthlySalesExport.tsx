import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Client, Equipment, OfficeLocation, SalesType, ReconciliationDocument } from '../types';
import { getReconciliation, confirmSales, unconfirmSales, saveInsuranceRentalBatch, clearAllInsuranceRental } from '../src/services/firestoreService';
import {
  previewInsuranceRentalImport,
  processInsuranceRentalImport,
  PreviewResult,
  BillingMatchResult,
  UnmatchedBilling,
} from '../src/services/kaipokeImportService';

interface MonthlySalesExportProps {
  clients: Client[];
  userEmail: string;
  onClientsUpdated?: () => void; // Callback to refresh clients after import
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

const MonthlySalesExport: React.FC<MonthlySalesExportProps> = ({ clients, userEmail, onClientsUpdated }) => {
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

  // CSV Import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [serviceCheckFile, setServiceCheckFile] = useState<File | null>(null);
  const [billingFile, setBillingFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<PreviewResult | null>(null);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [showUnmatchedDetails, setShowUnmatchedDetails] = useState<boolean>(false);
  const [showBillingMatchDetails, setShowBillingMatchDetails] = useState<boolean>(false);
  const [isClearing, setIsClearing] = useState<boolean>(false);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);

  // Manual billing linking state
  const [manualBillingLinks, setManualBillingLinks] = useState<Map<string, string>>(new Map());
  const [selectedUnmatchedClient, setSelectedUnmatchedClient] = useState<string | null>(null);

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

  // Reset import state when month changes
  useEffect(() => {
    setServiceCheckFile(null);
    setBillingFile(null);
    setImportPreview(null);
    setImportError(null);
    setImportSuccess(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [selectedMonth]);

  // Handle multi-file selection with auto-detection
  const handleFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) {
      setServiceCheckFile(null);
      setBillingFile(null);
      return;
    }

    let serviceCheck: File | null = null;
    let billing: File | null = null;

    // Auto-detect file types based on filename
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const name = file.name.toLowerCase();

      if (name.includes('サービスチェック') || name.includes('サービス_チェック') || name.includes('service')) {
        serviceCheck = file;
      } else if (name.includes('利用者請求') || name.includes('請求') || name.includes('billing')) {
        billing = file;
      } else {
        // If can't detect, assume first unknown is service check, second is billing
        if (!serviceCheck) {
          serviceCheck = file;
        } else if (!billing) {
          billing = file;
        }
      }
    }

    setServiceCheckFile(serviceCheck);
    setBillingFile(billing);
    setImportPreview(null);
    setImportError(null);
    setImportSuccess(null);
  };

  // Preview import
  const handlePreviewImport = async () => {
    if (!serviceCheckFile) {
      setImportError('サービスチェックシートCSVを選択してください');
      return;
    }

    setIsImporting(true);
    setImportError(null);
    setImportSuccess(null);

    try {
      const preview = await previewInsuranceRentalImport(serviceCheckFile, billingFile, clients);
      setImportPreview(preview);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'プレビューに失敗しました');
    } finally {
      setIsImporting(false);
    }
  };

  // Execute import
  const handleExecuteImport = async () => {
    if (!serviceCheckFile) {
      setImportError('サービスチェックシートCSVを選択してください');
      return;
    }

    setIsImporting(true);
    setImportError(null);
    setImportSuccess(null);

    try {
      const { equipmentByClient, billingByClient, result } = await processInsuranceRentalImport(
        serviceCheckFile,
        billingFile,
        clients,
        selectedMonth,
        manualBillingLinks.size > 0 ? manualBillingLinks : undefined
      );

      if (result.unmatchedUsers.length > 0) {
        setImportError(`${result.unmatchedUsers.length}件の未マッチ利用者がいます。続行しますか？`);
      }

      // Save to Firestore (including billing amounts)
      const { updatedCount, totalEquipmentCount } = await saveInsuranceRentalBatch(
        equipmentByClient,
        selectedMonth,
        userEmail,
        billingByClient
      );

      setImportSuccess(`インポート完了: ${updatedCount}名の利用者に${totalEquipmentCount}件の用具を登録しました`);
      setImportPreview(null);
      setServiceCheckFile(null);
      setBillingFile(null);
      setManualBillingLinks(new Map());
      setSelectedUnmatchedClient(null);
      if (fileInputRef.current) fileInputRef.current.value = '';

      // Refresh clients
      if (onClientsUpdated) {
        onClientsUpdated();
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'インポートに失敗しました');
    } finally {
      setIsImporting(false);
    }
  };

  // Clear import state
  const handleClearImport = () => {
    setServiceCheckFile(null);
    setBillingFile(null);
    setImportPreview(null);
    setImportError(null);
    setImportSuccess(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Clear all insurance rental data from Firestore
  const handleClearAllData = async () => {
    setIsClearing(true);
    setImportError(null);
    setImportSuccess(null);

    try {
      const clearedCount = await clearAllInsuranceRental(userEmail);
      setImportSuccess(`データクリア完了: ${clearedCount}名の介護保険レンタルデータを削除しました`);
      setShowClearConfirm(false);

      // Clear preview and file selection
      setImportPreview(null);
      setServiceCheckFile(null);
      setBillingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';

      // Refresh clients
      if (onClientsUpdated) {
        onClientsUpdated();
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'データクリアに失敗しました');
    } finally {
      setIsClearing(false);
    }
  };

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

    // 介護保険レンタル: Use stored billing totals (給付対象金額 from CSV)
    // This ensures the summary matches the preview amount exactly
    const processedClients = new Set<string>();
    insuranceRentalData.forEach(({ client, equipment }) => {
      equipment.forEach(() => {
        summary['介護保険レンタル'].count++;
      });
      // Only add billing total once per client (only clients with billing data)
      if (!processedClients.has(client.aozoraId)) {
        processedClients.add(client.aozoraId);
        if (client.insuranceRentalBillingTotal !== undefined) {
          summary['介護保険レンタル'].amount += client.insuranceRentalBillingTotal;
        }
      }
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

    // 販売: unitPrice * quantity + 送料（税抜き）
    salesData.forEach(({ equipment }) => {
      equipment.forEach(eq => {
        summary['販売'].count++;
        const quantity = eq.quantity || 1;
        const unitPrice = eq.unitPrice || 0;
        const shippingCost = eq.shippingCost || 0;
        const shippingExcluded = shippingCost > 0 ? Math.round(shippingCost / 1.1) : 0;
        summary['販売'].amount += unitPrice * quantity + shippingExcluded;
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
      '取引方法',
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
          eq.transactionType || '',
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
          <div className="space-y-6">
            {/* CSVインポートセクション */}
            <div className="bg-white rounded-lg shadow-sm border border-blue-200 overflow-hidden">
              <div className="bg-blue-50 border-b border-blue-100 px-6 py-4">
                <h3 className="text-lg font-bold text-blue-800 flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                  </svg>
                  CSVインポート（カイポケ）
                </h3>
                <p className="text-sm text-blue-600 mt-1">
                  カイポケからエクスポートしたCSVを取り込み、介護保険レンタルデータを更新します（洗い替え）
                </p>
              </div>

              <div className="p-6">
                {/* ファイル選択（マルチファイル） */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    CSVファイル選択（2ファイルまで同時選択可）
                  </label>
                  <div className="text-xs text-gray-500 mb-2">
                    <span className="text-red-500">*</span> サービスチェックシート.csv（必須）、利用者請求.csv（任意）
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    multiple
                    onChange={handleFilesChange}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  />
                  {/* 検出結果表示 */}
                  {(serviceCheckFile || billingFile) && (
                    <div className="mt-2 p-2 bg-gray-50 rounded text-xs space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={serviceCheckFile ? 'text-green-600' : 'text-red-500'}>
                          {serviceCheckFile ? '✓' : '✗'}
                        </span>
                        <span className="font-medium">サービスチェックシート:</span>
                        <span>{serviceCheckFile?.name || '未選択'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={billingFile ? 'text-green-600' : 'text-gray-400'}>
                          {billingFile ? '✓' : '-'}
                        </span>
                        <span className="font-medium">利用者請求:</span>
                        <span>{billingFile?.name || '（任意）'}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* エラー・成功メッセージ */}
                {importError && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                    {importError}
                  </div>
                )}
                {importSuccess && (
                  <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
                    {importSuccess}
                  </div>
                )}

                {/* ボタン */}
                <div className="flex gap-3 flex-wrap">
                  <button
                    onClick={handlePreviewImport}
                    disabled={!serviceCheckFile || isImporting || isClearing}
                    className="bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all"
                  >
                    {isImporting && !importPreview ? (
                      <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                      </svg>
                    )}
                    プレビュー
                  </button>
                  <button
                    onClick={handleExecuteImport}
                    disabled={!importPreview || isImporting || isClearing}
                    className="bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all"
                  >
                    {isImporting && importPreview ? (
                      <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                      </svg>
                    )}
                    インポート実行
                  </button>
                  {(serviceCheckFile || billingFile || importPreview) && (
                    <button
                      onClick={handleClearImport}
                      disabled={isImporting || isClearing}
                      className="bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:bg-gray-100 disabled:text-gray-400 px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                      選択クリア
                    </button>
                  )}
                  <div className="flex-1" />
                  <button
                    onClick={() => setShowClearConfirm(true)}
                    disabled={isImporting || isClearing}
                    className="bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all"
                  >
                    {isClearing ? (
                      <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                      </svg>
                    )}
                    データクリア
                  </button>
                </div>

                {/* データクリア確認ダイアログ */}
                {showClearConfirm && (
                  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl p-6 max-w-md mx-4">
                      <h4 className="text-lg font-bold text-red-600 mb-3 flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                        </svg>
                        データクリア確認
                      </h4>
                      <p className="text-gray-700 mb-4">
                        全ての介護保険レンタルデータを削除します。この操作は取り消せません。
                      </p>
                      <p className="text-sm text-gray-500 mb-4">
                        ※ 自費レンタル・販売データは影響を受けません
                      </p>
                      <div className="flex gap-3 justify-end">
                        <button
                          onClick={() => setShowClearConfirm(false)}
                          className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-all"
                        >
                          キャンセル
                        </button>
                        <button
                          onClick={handleClearAllData}
                          disabled={isClearing}
                          className="bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-300 px-4 py-2 rounded-lg font-bold transition-all flex items-center gap-2"
                        >
                          {isClearing && (
                            <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                          )}
                          削除する
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* プレビュー結果 */}
                {importPreview && (
                  <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <h4 className="text-sm font-bold text-gray-700 mb-3">プレビュー結果</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-white p-3 rounded border border-gray-200">
                        <div className="text-xs text-gray-500">マッチ成功</div>
                        <div className="text-xl font-bold text-green-600">{importPreview.matchedClients.length}名</div>
                      </div>
                      <div className="bg-white p-3 rounded border border-gray-200">
                        <div className="text-xs text-gray-500">未マッチ</div>
                        <div className="text-xl font-bold text-red-600">{importPreview.unmatchedUsers.length}名</div>
                        {importPreview.unmatchedUsers.length > 0 && (
                          <button
                            onClick={() => setShowUnmatchedDetails(!showUnmatchedDetails)}
                            className="text-xs text-blue-600 hover:underline mt-1"
                          >
                            {showUnmatchedDetails ? '閉じる' : '詳細表示'}
                          </button>
                        )}
                      </div>
                      <div className="bg-white p-3 rounded border border-gray-200">
                        <div className="text-xs text-gray-500">品目数</div>
                        <div className="text-xl font-bold text-blue-600">{importPreview.totalEquipmentCount}件</div>
                      </div>
                      <div className="bg-white p-3 rounded border border-gray-200">
                        <div className="text-xs text-gray-500">給付対象金額</div>
                        <div className="text-xl font-bold text-blue-600">{formatCurrency(importPreview.totalSalesAmount)}</div>
                      </div>
                    </div>

                    {/* 未マッチ詳細 */}
                    {showUnmatchedDetails && importPreview.unmatchedUsers.length > 0 && (
                      <div className="mt-4">
                        <h5 className="text-xs font-bold text-gray-600 mb-2">未マッチ利用者一覧</h5>
                        <div className="max-h-48 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="bg-gray-100">
                              <tr>
                                <th className="px-2 py-1 text-left">被保険者番号</th>
                                <th className="px-2 py-1 text-left">利用者名</th>
                                <th className="px-2 py-1 text-left">カナ</th>
                                <th className="px-2 py-1 text-left">事業所</th>
                                <th className="px-2 py-1 text-right">品目数</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {importPreview.unmatchedUsers.map((user, idx) => (
                                <tr key={idx} className="bg-red-50">
                                  <td className="px-2 py-1">{user.insuranceNumber || '-'}</td>
                                  <td className="px-2 py-1">{user.userName}</td>
                                  <td className="px-2 py-1">{user.nameKana || '-'}</td>
                                  <td className="px-2 py-1">{user.office || '-'}</td>
                                  <td className="px-2 py-1 text-right">{user.equipmentCount}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <p className="mt-2 text-xs text-gray-500">
                          未マッチの利用者はインポートされません。利用者マスターに登録してから再度お試しください。
                        </p>
                      </div>
                    )}

                    {/* Billing紐づけ詳細 */}
                    {importPreview.billingMatchResults && (
                      <div className="mt-4">
                        <div className="flex items-center justify-between mb-2">
                          <h5 className="text-xs font-bold text-gray-600">
                            請求金額の紐づけ状況
                            {importPreview.billingMatchResults.filter(r => r.billingAmount === null).length > 0 && (
                              <span className="ml-2 text-red-600">
                                （{importPreview.billingMatchResults.filter(r => r.billingAmount === null).length}件未紐づけ）
                              </span>
                            )}
                          </h5>
                          <button
                            onClick={() => setShowBillingMatchDetails(!showBillingMatchDetails)}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            {showBillingMatchDetails ? '閉じる' : '詳細表示'}
                          </button>
                        </div>

                        {showBillingMatchDetails && (
                          <div className="space-y-4">
                            {/* 未紐づけ利用者と未使用請求データの紐づけUI */}
                            {(() => {
                              const unmatchedClients = importPreview.billingMatchResults.filter(r => r.billingAmount === null);
                              const unmatchedBillings = importPreview.unmatchedBillings || [];

                              if (unmatchedClients.length === 0 && unmatchedBillings.length === 0) {
                                return (
                                  <div className="p-3 bg-green-50 rounded text-green-700 text-xs">
                                    すべての利用者と請求データが正常に紐づけされています。
                                  </div>
                                );
                              }

                              return (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  {/* 未紐づけ利用者リスト */}
                                  <div className="border border-red-200 rounded p-3">
                                    <h6 className="text-xs font-bold text-red-700 mb-2">
                                      請求データ未紐づけの利用者（{unmatchedClients.length}件）
                                    </h6>
                                    <div className="max-h-40 overflow-y-auto space-y-1">
                                      {unmatchedClients.map((client) => (
                                        <div
                                          key={client.aozoraId}
                                          className={`p-2 rounded text-xs cursor-pointer transition-colors ${
                                            selectedUnmatchedClient === client.aozoraId
                                              ? 'bg-blue-100 border border-blue-400'
                                              : manualBillingLinks.has(client.aozoraId)
                                              ? 'bg-green-100 border border-green-400'
                                              : 'bg-red-50 hover:bg-red-100'
                                          }`}
                                          onClick={() => setSelectedUnmatchedClient(
                                            selectedUnmatchedClient === client.aozoraId ? null : client.aozoraId
                                          )}
                                        >
                                          <div className="font-medium">{client.clientName}</div>
                                          <div className="text-gray-500">
                                            ID: {client.aozoraId} / 被保険者番号: {client.insuranceNumber || '-'}
                                          </div>
                                          {manualBillingLinks.has(client.aozoraId) && (
                                            <div className="text-green-600 mt-1">
                                              → 紐づけ済み
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>

                                  {/* 未使用請求データリスト */}
                                  <div className="border border-orange-200 rounded p-3">
                                    <h6 className="text-xs font-bold text-orange-700 mb-2">
                                      未使用の請求データ（{unmatchedBillings.length}件）
                                    </h6>
                                    <div className="max-h-40 overflow-y-auto space-y-1">
                                      {unmatchedBillings.map((billing, idx) => {
                                        const isLinked = Array.from(manualBillingLinks.values()).includes(billing.insuranceNumber);
                                        return (
                                          <div
                                            key={idx}
                                            className={`p-2 rounded text-xs transition-colors ${
                                              isLinked
                                                ? 'bg-green-100 border border-green-400'
                                                : selectedUnmatchedClient
                                                ? 'bg-orange-50 hover:bg-orange-100 cursor-pointer'
                                                : 'bg-orange-50'
                                            }`}
                                            onClick={() => {
                                              if (selectedUnmatchedClient && !isLinked) {
                                                const newLinks = new Map(manualBillingLinks);
                                                newLinks.set(selectedUnmatchedClient, billing.insuranceNumber);
                                                setManualBillingLinks(newLinks);
                                                setSelectedUnmatchedClient(null);
                                              }
                                            }}
                                          >
                                            <div className="font-medium">{billing.userName}</div>
                                            <div className="text-gray-500">
                                              被保険者番号: {billing.insuranceNumber} / カナ: {billing.nameKana || '-'}
                                            </div>
                                            <div className="text-orange-600">
                                              金額: ¥{billing.totalAmount.toLocaleString()}
                                            </div>
                                            {isLinked && (
                                              <div className="text-green-600 mt-1">
                                                ← 紐づけ済み
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                    {selectedUnmatchedClient && (
                                      <p className="mt-2 text-xs text-blue-600">
                                        上の請求データをクリックして紐づけてください
                                      </p>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}

                            {/* 紐づけ解除ボタン */}
                            {manualBillingLinks.size > 0 && (
                              <div className="flex justify-end">
                                <button
                                  onClick={() => setManualBillingLinks(new Map())}
                                  className="text-xs text-red-600 hover:underline"
                                >
                                  すべての手動紐づけを解除
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 介護保険レンタル一覧 */}
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
