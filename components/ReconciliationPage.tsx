import React, { useState, useRef } from 'react';
import {
  Client,
  WholesaleCompany,
  WHOLESALE_COMPANY_NAMES,
  ParsedInvoice,
  InsuranceRentalSalesItem,
  ReconciliationSummary,
  MatchStatus
} from '../types';
import { parseWholesaleInvoice } from '../services/geminiService';
import {
  aggregateInsuranceRentalSales,
  reconcileSalesWithInvoices,
  generateReconciliationCSV,
  downloadCSV
} from '../services/reconciliationService';

interface ReconciliationPageProps {
  clients: Client[];
}

const WHOLESALE_COMPANIES: WholesaleCompany[] = ['Nikken', 'Nishiken', 'NihonCaresupply', 'ParamountCare', 'Noguchi', 'Kishiya', 'Other'];

const ReconciliationPage: React.FC<ReconciliationPageProps> = ({ clients }) => {
  // State
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [uploadedInvoices, setUploadedInvoices] = useState<Map<WholesaleCompany, ParsedInvoice>>(new Map());
  const [processingCompany, setProcessingCompany] = useState<WholesaleCompany | null>(null);
  const [aggregatedSales, setAggregatedSales] = useState<InsuranceRentalSalesItem[]>([]);
  const [reconciliationResults, setReconciliationResults] = useState<ReconciliationSummary | null>(null);
  const [isReconciling, setIsReconciling] = useState<boolean>(false);
  const [statusFilter, setStatusFilter] = useState<'all' | MatchStatus>('all');
  const [ocrError, setOcrError] = useState<string | null>(null);

  // Refs for file inputs
  const fileInputRefs = useRef<Map<WholesaleCompany, HTMLInputElement | null>>(new Map());

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

  // Aggregate sales data from clients
  const handleAggregateSales = () => {
    const sales = aggregateInsuranceRentalSales(clients, selectedMonth);
    setAggregatedSales(sales);
    return sales;
  };

  // Run reconciliation
  const handleReconcile = async () => {
    setIsReconciling(true);

    try {
      // First aggregate sales if not already done
      const sales = aggregatedSales.length > 0 ? aggregatedSales : handleAggregateSales();

      // Get all uploaded invoices
      const invoices = Array.from(uploadedInvoices.values());

      if (invoices.length === 0) {
        setOcrError('請求書をアップロードしてください');
        setIsReconciling(false);
        return;
      }

      // Run reconciliation
      const results = reconcileSalesWithInvoices(sales, invoices, selectedMonth);
      setReconciliationResults(results);
    } catch (error) {
      setOcrError(error instanceof Error ? error.message : '突合処理でエラーが発生しました');
    } finally {
      setIsReconciling(false);
    }
  };

  // Export to CSV
  const handleExportCSV = () => {
    if (!reconciliationResults) return;

    const csv = generateReconciliationCSV(reconciliationResults);
    downloadCSV(csv, `介保レンタル突合_${selectedMonth}.csv`);
  };

  // Get filtered results
  const getFilteredResults = () => {
    if (!reconciliationResults) return [];
    if (statusFilter === 'all') return reconciliationResults.results;
    return reconciliationResults.results.filter(r => r.matchStatus === statusFilter);
  };

  // Get status badge color
  const getStatusBadge = (status: MatchStatus) => {
    switch (status) {
      case 'matched':
        return { bg: 'bg-green-100', text: 'text-green-800', label: '一致' };
      case 'partial_match':
        return { bg: 'bg-yellow-100', text: 'text-yellow-800', label: '部分一致' };
      case 'unmatched_sales':
        return { bg: 'bg-red-100', text: 'text-red-800', label: '売上のみ' };
      case 'unmatched_invoice':
        return { bg: 'bg-orange-100', text: 'text-orange-800', label: '請求のみ' };
      default:
        return { bg: 'bg-gray-100', text: 'text-gray-800', label: '不明' };
    }
  };

  return (
    <div className="flex-1 overflow-auto bg-gray-50">
      <div className="max-w-7xl mx-auto p-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-emerald-600">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
            </svg>
            介保レンタル売上・請求突合
          </h1>
          <p className="text-gray-600 mt-1">月次の介護保険レンタル売上と卸会社請求書を突合します</p>
        </div>

        {/* Month Selector */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">対象月度</label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => {
              setSelectedMonth(e.target.value);
              setReconciliationResults(null);
              setAggregatedSales([]);
            }}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {/* Invoice Upload Section */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">請求書アップロード（7社）</h2>

          {ocrError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {ocrError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
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
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 mb-6">
          <button
            onClick={handleReconcile}
            disabled={isReconciling || uploadedInvoices.size === 0}
            className={`flex-1 px-6 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors ${
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
                突合実行
              </>
            )}
          </button>

          {reconciliationResults && (
            <button
              onClick={handleExportCSV}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              CSVエクスポート
            </button>
          )}
        </div>

        {/* Results Section */}
        {reconciliationResults && (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <div className="text-2xl font-bold text-gray-900">{reconciliationResults.totalSalesItems}</div>
                <div className="text-sm text-gray-600">売上件数</div>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <div className="text-2xl font-bold text-gray-900">{reconciliationResults.totalInvoiceItems}</div>
                <div className="text-sm text-gray-600">請求件数</div>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-green-200 p-4 bg-green-50">
                <div className="text-2xl font-bold text-green-700">{reconciliationResults.matchedCount}</div>
                <div className="text-sm text-green-600">一致</div>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-red-200 p-4 bg-red-50">
                <div className="text-2xl font-bold text-red-700">{reconciliationResults.unmatchedSalesCount}</div>
                <div className="text-sm text-red-600">売上のみ</div>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-orange-200 p-4 bg-orange-50">
                <div className="text-2xl font-bold text-orange-700">{reconciliationResults.unmatchedInvoiceCount}</div>
                <div className="text-sm text-orange-600">請求のみ</div>
              </div>
            </div>

            {/* Filter Buttons */}
            <div className="flex gap-2 mb-4">
              {(['all', 'matched', 'partial_match', 'unmatched_sales', 'unmatched_invoice'] as const).map((filter) => {
                const isActive = statusFilter === filter;
                const labels: Record<typeof filter, string> = {
                  all: '全件',
                  matched: '一致',
                  partial_match: '部分一致',
                  unmatched_sales: '売上のみ',
                  unmatched_invoice: '請求のみ'
                };
                return (
                  <button
                    key={filter}
                    onClick={() => setStatusFilter(filter)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {labels[filter]}
                  </button>
                );
              })}
            </div>

            {/* Results Table */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ステータス</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">あおぞらID</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">利用者名</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">施設名</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">商品名</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">卸会社</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">単位数</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">請求額</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {getFilteredResults().map((result) => {
                      const badge = getStatusBadge(result.matchStatus);
                      const salesData = result.salesData;
                      const invoiceItem = result.invoiceItems[0];

                      return (
                        <tr key={result.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${badge.bg} ${badge.text}`}>
                              {badge.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {salesData?.aozoraId || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {salesData?.clientName || invoiceItem?.customerName || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {salesData?.facilityName || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {salesData?.equipment[0]?.name || invoiceItem?.itemName || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {salesData?.equipment[0]?.wholesaler || (invoiceItem ? WHOLESALE_COMPANY_NAMES[invoiceItem.wholesaleCompany] : '-')}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right">
                            {salesData?.totalUnits || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right">
                            {invoiceItem ? `¥${invoiceItem.amount.toLocaleString()}` : '-'}
                          </td>
                        </tr>
                      );
                    })}
                    {getFilteredResults().length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                          該当するデータがありません
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Empty State */}
        {!reconciliationResults && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-16 h-16 mx-auto text-gray-300 mb-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
            <h3 className="text-lg font-medium text-gray-700 mb-2">突合を開始するには</h3>
            <ol className="text-sm text-gray-500 text-left max-w-md mx-auto space-y-2">
              <li>1. 対象月度を選択してください</li>
              <li>2. 卸会社のPDF請求書をアップロードしてください</li>
              <li>3. 「突合実行」ボタンをクリックしてください</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReconciliationPage;
