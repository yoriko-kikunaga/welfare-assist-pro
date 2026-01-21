import React, { useState, useRef, useMemo } from 'react';
import {
  Client,
  WholesaleCompany,
  WHOLESALE_COMPANY_NAMES,
  ParsedInvoice,
  ReconciliationSummaryV2,
  OfficeLocation
} from '../types';
import { parseWholesaleInvoice } from '../services/geminiService';
import {
  aggregateAllSales,
  reconcileSalesWithInvoicesV2,
  generateReconciliationCSVV2,
  downloadCSV
} from '../services/reconciliationService';

interface ReconciliationPageProps {
  clients: Client[];
}

type MainTab = 'sales' | 'upload' | 'results';
type ResultTab = 'matched' | 'sales_only' | 'invoice_only';
type OfficeFilter = '全事業所' | OfficeLocation;

const WHOLESALE_COMPANIES: WholesaleCompany[] = ['Nikken', 'Nishiken', 'NihonCaresupply', 'ParamountCare', 'Noguchi', 'Kishiya', 'Other'];

const ReconciliationPage: React.FC<ReconciliationPageProps> = ({ clients }) => {
  // State
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [officeFilter, setOfficeFilter] = useState<OfficeFilter>('全事業所');
  const [mainTab, setMainTab] = useState<MainTab>('sales');
  const [resultTab, setResultTab] = useState<ResultTab>('matched');
  const [uploadedInvoices, setUploadedInvoices] = useState<Map<WholesaleCompany, ParsedInvoice>>(new Map());
  const [processingCompany, setProcessingCompany] = useState<WholesaleCompany | null>(null);
  const [reconciliationV2, setReconciliationV2] = useState<ReconciliationSummaryV2 | null>(null);
  const [isReconciling, setIsReconciling] = useState<boolean>(false);
  const [ocrError, setOcrError] = useState<string | null>(null);

  // Refs for file inputs
  const fileInputRefs = useRef<Map<WholesaleCompany, HTMLInputElement | null>>(new Map());

  // Memoized: Aggregate all sales
  const allSales = useMemo(() => {
    return aggregateAllSales(clients, selectedMonth, officeFilter);
  }, [clients, selectedMonth, officeFilter]);

  // Handle file upload for a wholesale company
  const handleFileUpload = async (company: WholesaleCompany, file: File) => {
    setProcessingCompany(company);
    setOcrError(null);

    try {
      const result = await parseWholesaleInvoice(file, company, selectedMonth);

      if (result.success && result.invoice) {
        setUploadedInvoices(prev => {
          const newMap = new Map(prev);
          newMap.set(company, result.invoice!);
          return newMap;
        });
      } else {
        setOcrError(result.error || 'OCR処理に失敗しました');
      }
    } catch (error) {
      setOcrError(error instanceof Error ? error.message : 'エラーが発生しました');
    } finally {
      setProcessingCompany(null);
    }
  };

  // Run reconciliation
  const handleReconcile = async () => {
    setIsReconciling(true);
    setOcrError(null);

    try {
      // Get all uploaded invoices
      const invoices = Array.from(uploadedInvoices.values());

      if (invoices.length === 0) {
        setOcrError('請求書をアップロードしてください');
        setIsReconciling(false);
        return;
      }

      // Run reconciliation V2
      const results = reconcileSalesWithInvoicesV2(allSales, invoices, selectedMonth);
      setReconciliationV2(results);
      setMainTab('results');
    } catch (error) {
      setOcrError(error instanceof Error ? error.message : '突合処理でエラーが発生しました');
    } finally {
      setIsReconciling(false);
    }
  };

  // Export to CSV
  const handleExportCSV = () => {
    if (!reconciliationV2) return;

    const csv = generateReconciliationCSVV2(reconciliationV2);
    const officeLabel = officeFilter === '全事業所' ? '全事業所' : officeFilter;
    downloadCSV(csv, `売上仕入突合_${selectedMonth}_${officeLabel}.csv`);
  };

  // Get filtered results by tab
  const getFilteredResults = () => {
    if (!reconciliationV2) return [];
    return reconciliationV2.results.filter(r => r.matchStatus === resultTab);
  };

  // Format currency
  const formatCurrency = (amount: number) => `¥${amount.toLocaleString()}`;

  return (
    <div className="flex-1 overflow-auto bg-gray-50">
      <div className="max-w-7xl mx-auto p-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-emerald-600">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
            </svg>
            売上・仕入突合
          </h1>
          <p className="text-gray-600 mt-1">月次の売上（介護保険レンタル・自費レンタル・販売）と卸会社請求書（仕入）を突合し、粗利を計算します</p>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">対象月度</label>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => {
                  setSelectedMonth(e.target.value);
                  setReconciliationV2(null);
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">事業所</label>
              <select
                value={officeFilter}
                onChange={(e) => {
                  setOfficeFilter(e.target.value as OfficeFilter);
                  setReconciliationV2(null);
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="全事業所">全事業所</option>
                <option value="鹿児島（ACG）">鹿児島（ACG）</option>
                <option value="福岡（Lichi）">福岡（Lichi）</option>
              </select>
            </div>
          </div>
        </div>

        {/* Main Tabs */}
        <div className="flex gap-2 mb-4">
          {(['sales', 'upload', 'results'] as MainTab[]).map((tab) => {
            const labels: Record<MainTab, string> = {
              sales: `売上一覧 (${allSales.length})`,
              upload: `請求書アップロード (${uploadedInvoices.size})`,
              results: '突合結果'
            };
            const isActive = mainTab === tab;
            const isDisabled = tab === 'results' && !reconciliationV2;

            return (
              <button
                key={tab}
                onClick={() => !isDisabled && setMainTab(tab)}
                disabled={isDisabled}
                className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                  isActive
                    ? 'bg-emerald-600 text-white'
                    : isDisabled
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>

        {ocrError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {ocrError}
          </div>
        )}

        {/* Tab Content: Sales List */}
        {mainTab === 'sales' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <h2 className="text-lg font-semibold text-gray-800">
                {selectedMonth} の売上一覧
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                介護保険レンタル・自費レンタル・販売の合計 {allSales.length} 件
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">種別</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">あおぞらID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">利用者名</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">施設名</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">商品名</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">卸会社</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">売上金額</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {allSales.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                          item.status === '介護保険レンタル' ? 'bg-blue-100 text-blue-800' :
                          item.status === '自費レンタル' ? 'bg-purple-100 text-purple-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">{item.aozoraId}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{item.clientName}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{item.facilityName}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{item.equipmentName}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{item.wholesaler || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatCurrency(item.salesAmount)}</td>
                    </tr>
                  ))}
                  {allSales.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                        該当する売上データがありません
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab Content: Invoice Upload */}
        {mainTab === 'upload' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">請求書アップロード（7社）</h2>
            <p className="text-sm text-gray-600 mb-4">金額なしの請求書（キシヤ等）も仕入金額0円として突合対象に含めます</p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4 mb-6">
              {WHOLESALE_COMPANIES.map((company) => {
                const invoice = uploadedInvoices.get(company);
                const isProcessing = processingCompany === company;

                return (
                  <div
                    key={company}
                    className="border border-gray-200 rounded-lg p-4 hover:border-emerald-300 transition-colors"
                  >
                    <div className="text-sm font-medium text-gray-700 mb-2">
                      {WHOLESALE_COMPANY_NAMES[company]}
                    </div>

                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg"
                      ref={(el) => fileInputRefs.current.set(company, el)}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(company, file);
                      }}
                      className="hidden"
                    />

                    <button
                      onClick={() => fileInputRefs.current.get(company)?.click()}
                      disabled={isProcessing}
                      className={`w-full h-20 border-2 border-dashed rounded-lg flex flex-col items-center justify-center transition-colors ${
                        invoice
                          ? 'border-emerald-300 bg-emerald-50'
                          : 'border-gray-300 hover:border-emerald-400 hover:bg-emerald-50'
                      } ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      {isProcessing ? (
                        <div className="flex items-center gap-2 text-gray-500">
                          <div className="animate-spin h-5 w-5 border-2 border-emerald-500 border-t-transparent rounded-full"></div>
                          <span className="text-xs">処理中...</span>
                        </div>
                      ) : invoice ? (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-emerald-600">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                          </svg>
                          <span className="text-xs text-emerald-700 mt-1">{invoice.items.length}件抽出</span>
                        </>
                      ) : (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-gray-400">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
                          </svg>
                          <span className="text-xs text-gray-500 mt-1">PDF/画像</span>
                        </>
                      )}
                    </button>

                    {invoice && (
                      <div className="mt-2 text-xs text-gray-500 truncate" title={invoice.fileName}>
                        {invoice.fileName}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Action Button */}
            <button
              onClick={handleReconcile}
              disabled={isReconciling || uploadedInvoices.size === 0}
              className={`w-full px-6 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors ${
                isReconciling || uploadedInvoices.size === 0
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
            >
              {isReconciling ? (
                <>
                  <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></div>
                  突合処理中...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                  </svg>
                  突合実行 (売上{allSales.length}件 × 請求書{uploadedInvoices.size}社)
                </>
              )}
            </button>
          </div>
        )}

        {/* Tab Content: Results */}
        {mainTab === 'results' && reconciliationV2 && (
          <>
            {/* Summary */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">サマリー</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-blue-700">{formatCurrency(reconciliationV2.totalSalesAmount)}</div>
                  <div className="text-sm text-blue-600">売上合計 ({reconciliationV2.totalSalesCount}件)</div>
                </div>
                <div className="bg-orange-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-orange-700">{formatCurrency(reconciliationV2.totalPurchaseAmount)}</div>
                  <div className="text-sm text-orange-600">仕入合計 ({reconciliationV2.totalInvoiceCount}件)</div>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-green-700">{formatCurrency(reconciliationV2.totalGrossProfit)}</div>
                  <div className="text-sm text-green-600">粗利合計</div>
                </div>
                <div className="bg-purple-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-purple-700">{reconciliationV2.grossProfitRate.toFixed(1)}%</div>
                  <div className="text-sm text-purple-600">粗利率</div>
                </div>
              </div>

              <div className="flex gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-3 h-3 bg-green-500 rounded-full"></span>
                  <span>突合済み: {reconciliationV2.matchedCount}件</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-block w-3 h-3 bg-red-500 rounded-full"></span>
                  <span>売上のみ: {reconciliationV2.salesOnlyCount}件</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-block w-3 h-3 bg-orange-500 rounded-full"></span>
                  <span>仕入のみ: {reconciliationV2.invoiceOnlyCount}件</span>
                </div>
              </div>
            </div>

            {/* Result Sub-tabs */}
            <div className="flex gap-2 mb-4">
              {(['matched', 'sales_only', 'invoice_only'] as ResultTab[]).map((tab) => {
                const counts: Record<ResultTab, number> = {
                  matched: reconciliationV2.matchedCount,
                  sales_only: reconciliationV2.salesOnlyCount,
                  invoice_only: reconciliationV2.invoiceOnlyCount
                };
                const labels: Record<ResultTab, string> = {
                  matched: '突合済み',
                  sales_only: '売上のみ',
                  invoice_only: '仕入のみ'
                };
                const isActive = resultTab === tab;

                return (
                  <button
                    key={tab}
                    onClick={() => setResultTab(tab)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {labels[tab]} ({counts[tab]})
                  </button>
                );
              })}

              <div className="flex-1"></div>

              <button
                onClick={handleExportCSV}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                CSVエクスポート
              </button>
            </div>

            {/* Results Table */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                {/* Matched Table */}
                {resultTab === 'matched' && (
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">利用者</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">商品名</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">種別</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">売上</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">仕入</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">粗利</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">粗利率</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">卸会社</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {getFilteredResults().map((result) => (
                        <tr key={result.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-900">{result.salesItem?.clientName}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{result.salesItem?.equipmentName}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                              result.salesItem?.status === '介護保険レンタル' ? 'bg-blue-100 text-blue-800' :
                              result.salesItem?.status === '自費レンタル' ? 'bg-purple-100 text-purple-800' :
                              'bg-amber-100 text-amber-800'
                            }`}>
                              {result.salesItem?.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatCurrency(result.salesAmount || 0)}</td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatCurrency(result.purchaseAmount || 0)}</td>
                          <td className="px-4 py-3 text-sm text-right">
                            <span className={result.grossProfit && result.grossProfit >= 0 ? 'text-green-600' : 'text-red-600'}>
                              {formatCurrency(result.grossProfit || 0)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-right">
                            <span className={result.grossProfitRate && result.grossProfitRate >= 0 ? 'text-green-600' : 'text-red-600'}>
                              {(result.grossProfitRate || 0).toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {result.salesItem?.wholesaler || WHOLESALE_COMPANY_NAMES[result.invoiceItem?.wholesaleCompany || 'Other']}
                          </td>
                        </tr>
                      ))}
                      {getFilteredResults().length === 0 && (
                        <tr>
                          <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                            該当するデータがありません
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}

                {/* Sales Only Table */}
                {resultTab === 'sales_only' && (
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">利用者</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">商品名</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">種別</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">売上金額</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">卸会社</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {getFilteredResults().map((result) => (
                        <tr key={result.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-900">{result.salesItem?.clientName}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{result.salesItem?.equipmentName}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                              result.salesItem?.status === '介護保険レンタル' ? 'bg-blue-100 text-blue-800' :
                              result.salesItem?.status === '自費レンタル' ? 'bg-purple-100 text-purple-800' :
                              'bg-amber-100 text-amber-800'
                            }`}>
                              {result.salesItem?.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatCurrency(result.salesAmount || 0)}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{result.salesItem?.wholesaler || '-'}</td>
                        </tr>
                      ))}
                      {getFilteredResults().length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                            該当するデータがありません
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}

                {/* Invoice Only Table */}
                {resultTab === 'invoice_only' && (
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">利用者</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">商品名</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">仕入金額</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">卸会社</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {getFilteredResults().map((result) => (
                        <tr key={result.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-900">{result.invoiceItem?.customerName}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{result.invoiceItem?.itemName}</td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatCurrency(result.purchaseAmount || 0)}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {WHOLESALE_COMPANY_NAMES[result.invoiceItem?.wholesaleCompany || 'Other']}
                          </td>
                        </tr>
                      ))}
                      {getFilteredResults().length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                            該当するデータがありません
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        )}

        {/* Empty State (when on results tab but no results) */}
        {mainTab === 'results' && !reconciliationV2 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-16 h-16 mx-auto text-gray-300 mb-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
            <h3 className="text-lg font-medium text-gray-700 mb-2">突合結果がありません</h3>
            <p className="text-sm text-gray-500">請求書アップロードタブで請求書をアップロードし、突合を実行してください</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReconciliationPage;
