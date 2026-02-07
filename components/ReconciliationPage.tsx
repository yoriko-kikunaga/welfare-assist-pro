import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import {
  Client,
  WholesaleCompany,
  WHOLESALE_COMPANY_NAMES,
  ParsedInvoice,
  ReconciliationSummaryV2,
  OfficeLocation,
  ReconciliationDocument,
  SalesType,
  InvoiceConfirmationData,
  UploadedFileInfo,
  OcrNameMapping,
  UnmatchedItem,
  InvoiceItem
} from '../types';
import { parseWholesaleInvoice, parseNishikenCSV, parseParamountCSV } from '../services/geminiService';
import {
  aggregateAllSales,
  reconcileSalesWithInvoicesV2,
  generateReconciliationCSVV2,
  downloadCSV
} from '../services/reconciliationService';
import {
  getReconciliation,
  saveInvoiceData,
  clearInvoiceData,
  confirmInvoice,
  unconfirmInvoice,
  confirmMonthly,
  unconfirmMonthly,
  getOcrNameMappingsByCompany,
  saveOcrNameMappings,
  incrementMappingUsage
} from '../src/services/firestoreService';
import {
  initializeMasterCache,
  isMasterCacheInitialized,
  matchOcrNames,
  getMatchingStats
} from '../src/services/nameMatchingService';
import UnmatchedNamesList from './UnmatchedNamesList';

interface ReconciliationPageProps {
  clients: Client[];
  userEmail: string;
}

type MainTab = 'sales' | 'upload' | 'results';
type ResultTab = 'matched' | 'sales_only' | 'invoice_only';
type OfficeFilter = '全事業所' | OfficeLocation;

// Page statistics for detailed analysis
interface PageStats {
  pageNumber: number;
  itemCount: number;
  pageTotal: number;
}

// Potential missing/duplicate item
interface SuspiciousItem {
  customerName: string;
  itemName: string;
  amount: number;
  reason: string;
}

// OCR検証結果
interface VerificationResult {
  invoiceTotal: number | null;      // 請求書記載の合計金額
  calculatedTotal: number;          // 明細から計算した合計
  difference: number;               // 差額
  isMatched: boolean;               // 一致しているか
  discrepancyReason: string | null; // 不一致の理由
  pageStats?: PageStats[];          // ページごとの統計
  suspiciousItems?: SuspiciousItem[]; // 疑わしい明細
  analysisDetails?: string[];       // 詳細分析メッセージ
}

// 卸会社ごとのデータ（複数ファイル対応）
interface CompanyInvoiceData {
  files: UploadedFileInfo[];
  mergedInvoice: ParsedInvoice;
  verification?: VerificationResult;  // OCR検証結果
}

const WHOLESALE_COMPANIES: WholesaleCompany[] = ['Nikken', 'Nishiken', 'NihonCaresupply', 'ParamountCare', 'Noguchi', 'Kishiya', 'Other'];
const SALES_TYPES: SalesType[] = ['介護保険レンタル', '自費レンタル', '販売'];

const ReconciliationPage: React.FC<ReconciliationPageProps> = ({ clients, userEmail }) => {
  // State
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [officeFilter, setOfficeFilter] = useState<OfficeFilter>('全事業所');
  const [mainTab, setMainTab] = useState<MainTab>('sales');
  const [resultTab, setResultTab] = useState<ResultTab>('matched');
  const [uploadedInvoices, setUploadedInvoices] = useState<Map<WholesaleCompany, CompanyInvoiceData>>(new Map());
  const [processingCompany, setProcessingCompany] = useState<WholesaleCompany | null>(null);
  const [reconciliationV2, setReconciliationV2] = useState<ReconciliationSummaryV2 | null>(null);
  const [isReconciling, setIsReconciling] = useState<boolean>(false);
  const [ocrError, setOcrError] = useState<string | null>(null);

  // Reconciliation document state (Firestore)
  const [reconciliationDoc, setReconciliationDoc] = useState<ReconciliationDocument | null>(null);
  const [isLoadingDoc, setIsLoadingDoc] = useState<boolean>(true);
  const [isConfirming, setIsConfirming] = useState<boolean>(false);

  // OCR Name Matching state
  const [learnedMappings, setLearnedMappings] = useState<Map<WholesaleCompany, OcrNameMapping[]>>(new Map());
  const [showUnmatchedModal, setShowUnmatchedModal] = useState<boolean>(false);
  const [unmatchedItems, setUnmatchedItems] = useState<UnmatchedItem[]>([]);
  const [pendingInvoice, setPendingInvoice] = useState<{
    company: WholesaleCompany;
    invoice: ParsedInvoice;
    file: UploadedFileInfo;
    verification?: VerificationResult;
  } | null>(null);

  // Refs for file inputs
  const fileInputRefs = useRef<Map<WholesaleCompany, HTMLInputElement | null>>(new Map());

  // Load reconciliation document from Firestore
  const loadReconciliationDoc = useCallback(async () => {
    setIsLoadingDoc(true);
    try {
      const doc = await getReconciliation(selectedMonth, officeFilter);
      setReconciliationDoc(doc);

      // If document exists and has invoice data, restore it
      // Preserve existing verification data (Firestore doesn't store verification)
      if (doc?.invoiceConfirmation) {
        setUploadedInvoices(prev => {
          const invoicesMap = new Map<WholesaleCompany, CompanyInvoiceData>();
          Object.entries(doc.invoiceConfirmation!).forEach(([company, data]) => {
            if (data.files && data.files.length > 0) {
              // Preserve existing verification from previous state
              const existingVerification = prev.get(company as WholesaleCompany)?.verification;
              invoicesMap.set(company as WholesaleCompany, {
                files: data.files,
                mergedInvoice: {
                  id: `${company}-merged`,
                  wholesaleCompany: company as WholesaleCompany,
                  fileName: `${data.files.length}ファイル`,
                  uploadedAt: data.files[data.files.length - 1]?.uploadedAt || new Date().toISOString(),
                  billingMonth: selectedMonth,
                  items: data.items,
                  totalAmount: data.totalAmount
                },
                verification: existingVerification,
              });
            }
          });
          return invoicesMap;
        });
      } else {
        setUploadedInvoices(new Map());
      }
    } catch (error) {
      console.error('Error loading reconciliation doc:', error);
    } finally {
      setIsLoadingDoc(false);
    }
  }, [selectedMonth, officeFilter]);

  // Load document on mount and when month/office changes
  useEffect(() => {
    loadReconciliationDoc();
    setReconciliationV2(null); // Reset results when changing filters
  }, [loadReconciliationDoc]);

  // Initialize master cache for name matching when clients change
  useEffect(() => {
    if (clients.length > 0 && !isMasterCacheInitialized()) {
      initializeMasterCache(clients);
      console.log('[ReconciliationPage] Master cache initialized for name matching');
    }
  }, [clients]);

  // Load learned mappings for all wholesale companies
  useEffect(() => {
    const loadLearnedMappings = async () => {
      const mappingsMap = new Map<WholesaleCompany, OcrNameMapping[]>();
      for (const company of WHOLESALE_COMPANIES) {
        try {
          const mappings = await getOcrNameMappingsByCompany(WHOLESALE_COMPANY_NAMES[company]);
          mappingsMap.set(company, mappings);
        } catch (error) {
          console.error(`Error loading mappings for ${company}:`, error);
          mappingsMap.set(company, []);
        }
      }
      setLearnedMappings(mappingsMap);
      console.log('[ReconciliationPage] Loaded learned mappings for all companies');
    };

    loadLearnedMappings();
  }, []);

  // Memoized: Aggregate all sales
  const allSales = useMemo(() => {
    return aggregateAllSales(clients, selectedMonth, officeFilter);
  }, [clients, selectedMonth, officeFilter]);

  // Memoized: Sales summary by type
  const salesSummary = useMemo(() => {
    const summary: Record<SalesType, { count: number; amount: number }> = {
      '介護保険レンタル': { count: 0, amount: 0 },
      '自費レンタル': { count: 0, amount: 0 },
      '販売': { count: 0, amount: 0 }
    };

    allSales.forEach(item => {
      const type = item.status as SalesType;
      if (summary[type]) {
        summary[type].count++;
        summary[type].amount += item.salesAmount;
      }
    });

    return summary;
  }, [allSales]);

  // Handle file upload for a wholesale company (supports multiple files, accumulates data)
  const handleFileUpload = async (company: WholesaleCompany, files: FileList) => {
    // Check if company is confirmed
    const invoiceConf = reconciliationDoc?.invoiceConfirmation?.[company];
    if (invoiceConf?.status === 'confirmed') {
      setOcrError('確定済みの卸会社にはアップロードできません。解除してから再度アップロードしてください。');
      return;
    }

    setProcessingCompany(company);
    setOcrError(null);

    try {
      // 既存データを取得（累積のため）
      const existingData = uploadedInvoices.get(company);
      const existingFiles = existingData?.files || [];
      const existingItems = existingData?.mergedInvoice.items || [];
      let existingTotal = existingData?.mergedInvoice.totalAmount || 0;

      const newFiles: UploadedFileInfo[] = [];
      const newItems: ParsedInvoice['items'] = [];
      let newTotal = 0;
      let successCount = 0;
      let latestVerification: VerificationResult | undefined;

      // Process each file
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log(`Processing file ${i + 1}/${files.length}: ${file.name}`);

        let result;
        const isCSV = file.name.toLowerCase().endsWith('.csv');
        if (isCSV) {
          if (company === 'Nishiken') {
            result = await parseNishikenCSV(file, selectedMonth);
          } else if (company === 'ParamountCare') {
            result = await parseParamountCSV(file, selectedMonth);
          } else {
            setOcrError(`${WHOLESALE_COMPANY_NAMES[company]}のCSVインポートには対応していません。PDFをアップロードしてください。`);
            setProcessingCompany(null);
            return;
          }
        } else {
          result = await parseWholesaleInvoice(file, company, selectedMonth);
        }

        if (result.success && result.invoice) {
          newItems.push(...result.invoice.items);
          newTotal += result.invoice.totalAmount;
          successCount++;

          // ファイル情報を記録
          newFiles.push({
            fileName: file.name,
            itemCount: result.invoice.items.length,
            totalAmount: result.invoice.totalAmount,
            uploadedAt: new Date().toISOString(),
          });

          // 検証結果を保存（最後のファイルの検証結果を使用）
          if (result.verification) {
            latestVerification = result.verification;
            console.log(`[ReconciliationPage] Verification result for ${file.name}:`, result.verification);
          }
        } else {
          console.warn(`Failed to process ${file.name}:`, result.error);
        }
      }

      if (successCount > 0) {
        // 既存データと新しいデータを結合
        const allFiles = [...existingFiles, ...newFiles];
        const allItems = [...existingItems, ...newItems];
        const totalAmount = existingTotal + newTotal;

        // 名前マッチングを実行
        const companyMappings = learnedMappings.get(company) || [];
        const ocrNames = newItems.map(item => item.customerName);
        const matchResults = matchOcrNames(ocrNames, companyMappings);

        // マッチング統計をログ
        const stats = getMatchingStats(matchResults);
        console.log(`[ReconciliationPage] Name matching stats for ${company}:`, stats);

        // マッチした場合は学習データの使用回数を増加
        const matchedMappings = matchResults
          .filter(r => r.status === 'matched' && r.matchedCandidate?.matchSource === 'learned')
          .map(r => companyMappings.find(m => m.ocrName === r.ocrNameNormalized))
          .filter((m): m is OcrNameMapping => m !== undefined);

        for (const mapping of matchedMappings) {
          try {
            await incrementMappingUsage(mapping.ocrName, mapping.wholesaleCompany);
          } catch (error) {
            console.warn('Failed to increment mapping usage:', error);
          }
        }

        // 候補ありのアイテム（ユーザー確認必要）を抽出
        const itemsNeedingConfirmation: UnmatchedItem[] = [];
        newItems.forEach((item, index) => {
          const matchResult = matchResults[index];
          if (matchResult && (matchResult.status === 'candidates' || matchResult.status === 'unmatched')) {
            itemsNeedingConfirmation.push({
              invoiceItem: item,
              matchResult,
            });
          }
        });

        // 候補ありがある場合はモーダルを表示
        if (itemsNeedingConfirmation.length > 0) {
          const mergedInvoice: ParsedInvoice = {
            id: `${company}-merged`,
            wholesaleCompany: company,
            fileName: `${allFiles.length}ファイル`,
            uploadedAt: new Date().toISOString(),
            billingMonth: selectedMonth,
            items: allItems,
            totalAmount,
          };

          setUnmatchedItems(itemsNeedingConfirmation);
          setPendingInvoice({
            company,
            invoice: mergedInvoice,
            file: newFiles[newFiles.length - 1],
            verification: latestVerification,
          });
          setShowUnmatchedModal(true);
          setProcessingCompany(null);
          return; // モーダル確定後に処理を続行
        }

        // 候補なしの場合はそのまま保存
        const mergedInvoice: ParsedInvoice = {
          id: `${company}-merged`,
          wholesaleCompany: company,
          fileName: `${allFiles.length}ファイル`,
          uploadedAt: new Date().toISOString(),
          billingMonth: selectedMonth,
          items: allItems,
          totalAmount,
        };

        const companyData: CompanyInvoiceData = {
          files: allFiles,
          mergedInvoice,
          verification: latestVerification,
        };

        setUploadedInvoices(prev => {
          const newMap = new Map(prev);
          newMap.set(company, companyData);
          return newMap;
        });

        // Save to Firestore
        const invoiceConfData: InvoiceConfirmationData = {
          status: 'draft' as const,
          files: allFiles,
          items: allItems,
          totalAmount
        };
        await saveInvoiceData(selectedMonth, officeFilter, company, invoiceConfData, userEmail);

        // Reload document
        await loadReconciliationDoc();

        if (successCount < files.length) {
          setOcrError(`${files.length}ファイル中${successCount}ファイルを処理しました（一部失敗）`);
        }
      } else {
        setOcrError('すべてのファイルの処理に失敗しました');
      }
    } catch (error) {
      setOcrError(error instanceof Error ? error.message : 'エラーが発生しました');
    } finally {
      setProcessingCompany(null);
    }
  };

  // Clear uploaded data for a specific company
  const handleClearCompany = async (company: WholesaleCompany) => {
    // Check if company is confirmed
    const invoiceConf = reconciliationDoc?.invoiceConfirmation?.[company];
    if (invoiceConf?.status === 'confirmed') {
      setOcrError('確定済みの卸会社はクリアできません。先に解除してください。');
      return;
    }

    setUploadedInvoices(prev => {
      const newMap = new Map(prev);
      newMap.delete(company);
      return newMap;
    });

    // Clear from Firestore
    await clearInvoiceData(selectedMonth, officeFilter, company, userEmail);
    await loadReconciliationDoc();
  };

  // Handle invoice confirmation
  const handleConfirmInvoice = async (company: WholesaleCompany) => {
    setIsConfirming(true);
    try {
      await confirmInvoice(selectedMonth, officeFilter, company, userEmail);
      await loadReconciliationDoc();
    } catch (error) {
      setOcrError(error instanceof Error ? error.message : '確定処理でエラーが発生しました');
    } finally {
      setIsConfirming(false);
    }
  };

  // Handle invoice unconfirmation
  const handleUnconfirmInvoice = async (company: WholesaleCompany) => {
    // Check if monthly is confirmed
    if (reconciliationDoc?.monthlyStatus === 'confirmed') {
      setOcrError('月次確定済みのため解除できません。先に月次確定を解除してください。');
      return;
    }

    setIsConfirming(true);
    try {
      await unconfirmInvoice(selectedMonth, officeFilter, company, userEmail);
      await loadReconciliationDoc();
    } catch (error) {
      setOcrError(error instanceof Error ? error.message : '解除処理でエラーが発生しました');
    } finally {
      setIsConfirming(false);
    }
  };

  // Handle monthly confirmation
  const handleConfirmMonthly = async () => {
    if (!reconciliationV2) {
      setOcrError('突合を実行してから月次確定してください');
      return;
    }

    setIsConfirming(true);
    try {
      await confirmMonthly(selectedMonth, officeFilter, reconciliationV2, userEmail);
      await loadReconciliationDoc();
    } catch (error) {
      setOcrError(error instanceof Error ? error.message : '月次確定処理でエラーが発生しました');
    } finally {
      setIsConfirming(false);
    }
  };

  // Handle monthly unconfirmation
  const handleUnconfirmMonthly = async () => {
    setIsConfirming(true);
    try {
      await unconfirmMonthly(selectedMonth, officeFilter, userEmail);
      await loadReconciliationDoc();
    } catch (error) {
      setOcrError(error instanceof Error ? error.message : '月次確定解除処理でエラーが発生しました');
    } finally {
      setIsConfirming(false);
    }
  };

  // Check if all sales are confirmed
  const allSalesConfirmed = useMemo(() => {
    if (!reconciliationDoc) return false;
    return SALES_TYPES.every(type =>
      reconciliationDoc.salesConfirmation?.[type]?.status === 'confirmed'
    );
  }, [reconciliationDoc]);

  // Check if all invoices are confirmed
  const allInvoicesConfirmed = useMemo(() => {
    if (!reconciliationDoc || uploadedInvoices.size === 0) return false;
    return Array.from(uploadedInvoices.keys()).every(company =>
      reconciliationDoc.invoiceConfirmation?.[company]?.status === 'confirmed'
    );
  }, [reconciliationDoc, uploadedInvoices]);

  // Count confirmed sales
  const confirmedSalesCount = useMemo(() => {
    if (!reconciliationDoc) return 0;
    return SALES_TYPES.filter(type =>
      reconciliationDoc.salesConfirmation?.[type]?.status === 'confirmed'
    ).length;
  }, [reconciliationDoc]);

  // Count confirmed invoices
  const confirmedInvoicesCount = useMemo(() => {
    if (!reconciliationDoc) return 0;
    return Array.from(uploadedInvoices.keys()).filter(company =>
      reconciliationDoc.invoiceConfirmation?.[company]?.status === 'confirmed'
    ).length;
  }, [reconciliationDoc, uploadedInvoices]);

  // Handle unmatched names confirmation (learning)
  const handleUnmatchedConfirm = useCallback(async (
    mappings: Omit<OcrNameMapping, 'id' | 'createdAt' | 'updatedAt'>[]
  ) => {
    if (!pendingInvoice) return;

    const { company, invoice } = pendingInvoice;

    try {
      // 学習データをFirestoreに保存
      if (mappings.length > 0) {
        await saveOcrNameMappings(mappings);
        console.log(`[ReconciliationPage] Saved ${mappings.length} new mappings for ${company}`);

        // ローカルの学習データを更新
        const updatedMappings = await getOcrNameMappingsByCompany(WHOLESALE_COMPANY_NAMES[company]);
        setLearnedMappings(prev => {
          const newMap = new Map(prev);
          newMap.set(company, updatedMappings);
          return newMap;
        });
      }

      // 既存データを取得
      const existingData = uploadedInvoices.get(company);
      const existingFiles = existingData?.files || [];

      // pendingInvoiceのファイルを追加
      const allFiles = [...existingFiles, pendingInvoice.file];

      const companyData: CompanyInvoiceData = {
        files: allFiles,
        mergedInvoice: invoice,
        verification: pendingInvoice.verification,
      };

      // Save to Firestore first
      const invoiceConfData: InvoiceConfirmationData = {
        status: 'draft' as const,
        files: allFiles,
        items: invoice.items,
        totalAmount: invoice.totalAmount
      };
      await saveInvoiceData(selectedMonth, officeFilter, company, invoiceConfData, userEmail);

      // Reload document from Firestore
      const doc = await getReconciliation(selectedMonth, officeFilter);
      setReconciliationDoc(doc);

      // Update uploadedInvoices while preserving verification
      // (Firestore doesn't store verification, so we need to keep it locally)
      setUploadedInvoices(prev => {
        const newMap = new Map<WholesaleCompany, CompanyInvoiceData>();

        // First, restore data from Firestore
        if (doc?.invoiceConfirmation) {
          Object.entries(doc.invoiceConfirmation).forEach(([comp, data]) => {
            if (data.files && data.files.length > 0) {
              // Get existing verification from prev state
              const existingVerification = prev.get(comp as WholesaleCompany)?.verification;
              newMap.set(comp as WholesaleCompany, {
                files: data.files,
                mergedInvoice: {
                  id: `${comp}-merged`,
                  wholesaleCompany: comp as WholesaleCompany,
                  fileName: `${data.files.length}ファイル`,
                  uploadedAt: data.files[data.files.length - 1]?.uploadedAt || new Date().toISOString(),
                  billingMonth: selectedMonth,
                  items: data.items,
                  totalAmount: data.totalAmount
                },
                verification: existingVerification,
              });
            }
          });
        }

        // Ensure current company has the verification we just processed
        const currentData = newMap.get(company);
        if (currentData) {
          currentData.verification = pendingInvoice.verification;
        }

        return newMap;
      });

    } catch (error) {
      console.error('Error saving mappings:', error);
      setOcrError('学習データの保存に失敗しました');
    } finally {
      setShowUnmatchedModal(false);
      setUnmatchedItems([]);
      setPendingInvoice(null);
    }
  }, [pendingInvoice, uploadedInvoices, selectedMonth, officeFilter, userEmail, loadReconciliationDoc]);

  // Handle unmatched names cancel
  const handleUnmatchedCancel = useCallback(() => {
    setShowUnmatchedModal(false);
    setUnmatchedItems([]);
    setPendingInvoice(null);
  }, []);

  // Run reconciliation
  const handleReconcile = async () => {
    setIsReconciling(true);
    setOcrError(null);

    try {
      // Get all uploaded invoices (extract mergedInvoice from CompanyInvoiceData)
      const invoiceDataList = [...uploadedInvoices.values()];
      const invoices = invoiceDataList.map(data => data.mergedInvoice);

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
            {reconciliationDoc?.monthlyStatus === 'confirmed' && (
              <span className="ml-2 px-3 py-1 bg-green-100 text-green-800 text-sm font-medium rounded-full flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                月次確定済
              </span>
            )}
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
            {isLoadingDoc && (
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <div className="animate-spin h-4 w-4 border-2 border-emerald-500 border-t-transparent rounded-full"></div>
                読み込み中...
              </div>
            )}
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
          <>
            {/* Sales Summary with Confirmation */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
              <h3 className="text-sm font-medium text-gray-700 mb-3">売上サマリー</h3>
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
                      <div className="mt-2">
                        {isConfirmed ? (
                          <div className="text-xs text-green-600">
                            {confirmation?.confirmedBy && (
                              <span>{confirmation.confirmedBy}</span>
                            )}
                            {confirmation?.confirmedAt && (
                              <span className="ml-1">
                                ({new Date((confirmation.confirmedAt as any)?.toDate?.() || confirmation.confirmedAt).toLocaleDateString('ja-JP')})
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400">
                            未確定（月次売上処理ページで確定）
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Total */}
                <div className="bg-gray-100 rounded-lg p-4">
                  <div className="text-sm font-medium text-gray-700 mb-2">合計</div>
                  <div className="text-lg font-bold text-gray-900">
                    {allSales.length}件
                  </div>
                  <div className="text-sm text-gray-600">
                    {formatCurrency(allSales.reduce((sum, item) => sum + item.salesAmount, 0))}
                  </div>
                  <div className="mt-2 text-xs text-gray-500">
                    {confirmedSalesCount}/3 確定済
                  </div>
                </div>
              </div>
            </div>

            {/* Sales Table */}
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
          </>
        )}

        {/* Tab Content: Invoice Upload */}
        {mainTab === 'upload' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">請求書アップロード（7社）</h2>
            <p className="text-sm text-gray-600 mb-4">金額なしの請求書（キシヤ等）も仕入金額0円として突合対象に含めます</p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
              {WHOLESALE_COMPANIES.map((company) => {
                const companyData = uploadedInvoices.get(company);
                const isProcessing = processingCompany === company;
                const invoiceConf = reconciliationDoc?.invoiceConfirmation?.[company];
                const isConfirmed = invoiceConf?.status === 'confirmed';

                return (
                  <div
                    key={company}
                    className={`border rounded-lg p-4 transition-colors ${
                      isConfirmed ? 'border-green-300 bg-green-50' :
                      companyData ? 'border-emerald-300 bg-emerald-50' :
                      'border-gray-200 hover:border-emerald-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium text-gray-700">
                        {WHOLESALE_COMPANY_NAMES[company]}
                      </div>
                      {isConfirmed ? (
                        <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                          </svg>
                          確定済
                        </span>
                      ) : companyData && (
                        <button
                          onClick={() => handleClearCompany(company)}
                          className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded transition-colors"
                          title="データをクリア"
                        >
                          クリア
                        </button>
                      )}
                    </div>

                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.csv"
                      multiple
                      ref={(el) => fileInputRefs.current.set(company, el)}
                      onChange={(e) => {
                        const files = e.target.files;
                        if (files && files.length > 0) {
                          handleFileUpload(company, files);
                          // Reset input to allow re-uploading same files
                          e.target.value = '';
                        }
                      }}
                      className="hidden"
                    />

                    {!isConfirmed && (
                      <button
                        onClick={() => fileInputRefs.current.get(company)?.click()}
                        disabled={isProcessing}
                        className={`w-full h-16 border-2 border-dashed rounded-lg flex flex-col items-center justify-center transition-colors ${
                          companyData
                            ? 'border-emerald-400 bg-white hover:bg-emerald-100'
                            : 'border-gray-300 hover:border-emerald-400 hover:bg-emerald-50'
                        } ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        {isProcessing ? (
                          <div className="flex items-center gap-2 text-gray-500">
                            <div className="animate-spin h-5 w-5 border-2 border-emerald-500 border-t-transparent rounded-full"></div>
                            <span className="text-xs">処理中...</span>
                          </div>
                        ) : companyData ? (
                          <div className="flex items-center gap-2 text-emerald-600">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                            </svg>
                            <span className="text-xs font-medium">追加アップロード</span>
                          </div>
                        ) : (
                          <>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-gray-400">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
                            </svg>
                            <span className="text-xs text-gray-500 mt-1">{company === 'Nishiken' || company === 'ParamountCare' ? 'PDF/画像/CSV（複数可）' : 'PDF/画像（複数可）'}</span>
                          </>
                        )}
                      </button>
                    )}

                    {/* アップロード済みファイルリスト */}
                    {companyData && (
                      <div className="mt-3 space-y-1">
                        <div className={`flex items-center justify-between text-xs font-medium border-b pb-1 mb-1 ${
                          isConfirmed ? 'text-green-700 border-green-200' : 'text-emerald-700 border-emerald-200'
                        }`}>
                          <span>合計: {companyData.mergedInvoice.items.length}件</span>
                          <span>¥{companyData.mergedInvoice.totalAmount.toLocaleString()}</span>
                        </div>
                        <div className="max-h-24 overflow-y-auto space-y-1">
                          {companyData.files.map((file, index) => (
                            <div key={index} className="flex items-center justify-between text-xs bg-white rounded px-2 py-1">
                              <span className="text-gray-600 truncate flex-1" title={file.fileName}>
                                {file.fileName}
                              </span>
                              <span className="text-gray-500 ml-2 whitespace-nowrap">
                                {file.itemCount}件
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* OCR検証結果表示 */}
                        {companyData.verification && (
                          <div className={`mt-2 p-2 rounded text-xs ${
                            companyData.verification.isMatched
                              ? companyData.verification.invoiceTotal === null
                                ? 'bg-gray-50 border border-gray-200'
                                : 'bg-green-50 border border-green-200'
                              : 'bg-red-50 border border-red-200'
                          }`}>
                            {companyData.verification.isMatched ? (
                              <div className={`flex items-center gap-1 ${companyData.verification.invoiceTotal === null ? 'text-gray-600' : 'text-green-700'}`}>
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                <span>{companyData.verification.invoiceTotal === null ? 'CSV取込（請求書合計なし）' : '検証OK: 請求書合計と一致'}</span>
                              </div>
                            ) : (
                              <div className="text-red-700 space-y-2">
                                {/* 差額サマリー */}
                                <div className="flex items-center gap-1 font-medium">
                                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                  </svg>
                                  <span>差額: ¥{Math.abs(companyData.verification.difference).toLocaleString()}</span>
                                </div>
                                <div className="text-xs">
                                  請求書: ¥{(companyData.verification.invoiceTotal || 0).toLocaleString()} /
                                  OCR: ¥{companyData.verification.calculatedTotal.toLocaleString()}
                                </div>

                                {/* 差額分析の詳細 */}
                                {companyData.verification.analysisDetails && companyData.verification.analysisDetails.length > 0 && (
                                  <div className="bg-red-100 rounded p-2 space-y-1">
                                    <div className="font-medium text-red-800">分析結果:</div>
                                    {companyData.verification.analysisDetails.map((detail, idx) => (
                                      <div key={idx} className="text-red-700 flex items-start gap-1">
                                        <span className="text-red-400">•</span>
                                        <span>{detail}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* 疑わしい明細リスト */}
                                {companyData.verification.suspiciousItems && companyData.verification.suspiciousItems.length > 0 && (
                                  <div className="bg-red-100 rounded p-2">
                                    <div className="font-medium text-red-800 mb-1">確認が必要な明細:</div>
                                    <div className="max-h-32 overflow-y-auto space-y-1">
                                      {companyData.verification.suspiciousItems.map((item, idx) => (
                                        <div key={idx} className="text-red-700 bg-white rounded px-2 py-1 flex justify-between items-center">
                                          <div className="truncate flex-1">
                                            <span className="font-medium">{item.customerName}</span>
                                            <span className="text-red-500 mx-1">|</span>
                                            <span>{item.itemName}</span>
                                          </div>
                                          <div className="text-right ml-2 whitespace-nowrap">
                                            <div>¥{item.amount.toLocaleString()}</div>
                                            <div className="text-xs text-red-500">{item.reason}</div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* ページ統計（折りたたみ） */}
                                {companyData.verification.pageStats && companyData.verification.pageStats.length > 0 && (
                                  <details className="bg-red-100 rounded p-2">
                                    <summary className="font-medium text-red-800 cursor-pointer">
                                      ページ別抽出状況（クリックで展開）
                                    </summary>
                                    <div className="mt-1 grid grid-cols-3 gap-1 text-xs">
                                      {companyData.verification.pageStats.map((stat) => (
                                        <div
                                          key={stat.pageNumber}
                                          className={`px-1 py-0.5 rounded text-center ${
                                            stat.itemCount === 0
                                              ? 'bg-red-300 text-red-900'
                                              : 'bg-white text-red-700'
                                          }`}
                                        >
                                          p{stat.pageNumber}: {stat.itemCount}件
                                        </div>
                                      ))}
                                    </div>
                                  </details>
                                )}

                                {companyData.verification.discrepancyReason && (
                                  <div className="text-xs font-medium pt-1 border-t border-red-200">
                                    {companyData.verification.discrepancyReason}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Confirm/Unconfirm Button */}
                    {companyData && (
                      <div className="mt-3">
                        {isConfirmed ? (
                          <button
                            onClick={() => handleUnconfirmInvoice(company)}
                            disabled={isConfirming || reconciliationDoc?.monthlyStatus === 'confirmed'}
                            className="w-full px-3 py-1.5 text-xs font-medium text-red-600 bg-white border border-red-200 rounded hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            解除
                          </button>
                        ) : (
                          <button
                            onClick={() => handleConfirmInvoice(company)}
                            disabled={isConfirming}
                            className="w-full px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            確定
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Invoice Summary */}
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  仕入確定状況: {confirmedInvoicesCount}/{uploadedInvoices.size} 社確定済
                </div>
                <div className="text-sm font-medium text-gray-900">
                  仕入合計: {formatCurrency(
                    [...uploadedInvoices.values()].reduce((sum, data) => sum + data.mergedInvoice.totalAmount, 0)
                  )}
                </div>
              </div>
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
            {/* Monthly Confirmation Section */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">月次確定</h3>
                  <div className="text-xs text-gray-500">
                    売上: {confirmedSalesCount}/3確定済 | 仕入: {confirmedInvoicesCount}/{uploadedInvoices.size}社確定済
                  </div>
                </div>
                <div>
                  {reconciliationDoc?.monthlyStatus === 'confirmed' ? (
                    <button
                      onClick={handleUnconfirmMonthly}
                      disabled={isConfirming}
                      className="px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      月次確定を解除
                    </button>
                  ) : (
                    <button
                      onClick={handleConfirmMonthly}
                      disabled={isConfirming || !allSalesConfirmed || !allInvoicesConfirmed}
                      className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        allSalesConfirmed && allInvoicesConfirmed
                          ? 'bg-green-600 hover:bg-green-700'
                          : 'bg-gray-400'
                      }`}
                    >
                      月次確定
                    </button>
                  )}
                </div>
              </div>
              {(!allSalesConfirmed || !allInvoicesConfirmed) && reconciliationDoc?.monthlyStatus !== 'confirmed' && (
                <div className="mt-2 text-xs text-amber-600 bg-amber-50 rounded px-3 py-2">
                  月次確定するには、すべての売上（3種類）とすべての仕入（アップロード済みの卸会社）を確定してください。
                </div>
              )}
            </div>

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

      {/* Unmatched Names Modal */}
      {showUnmatchedModal && pendingInvoice && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <UnmatchedNamesList
            unmatchedItems={unmatchedItems}
            wholesaleCompany={WHOLESALE_COMPANY_NAMES[pendingInvoice.company]}
            clients={clients}
            onConfirm={handleUnmatchedConfirm}
            onCancel={handleUnmatchedCancel}
          />
        </div>
      )}
    </div>
  );
};

export default ReconciliationPage;
