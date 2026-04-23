import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import {
  Client,
  WholesaleCompany,
  WHOLESALE_COMPANY_NAMES,
  ParsedInvoice,
  ReconciliationSummaryV2,
  ReconciliationResultV2,
  OfficeLocation,
  ReconciliationDocument,
  SalesType,
  SalesItem,
  InvoiceConfirmationData,
  UploadedFileInfo,
  OcrNameMapping,
  UnmatchedItem,
  InvoiceItem,
  InsuranceRentalItemMapping
} from '../types';
import { parseWholesaleInvoice, parseNishikenCSV, parseParamountCSV, parseNihonCareSupplyCSV } from '../services/geminiService';
import {
  aggregateAllSales,
  reconcileSalesWithInvoicesV2,
  generateReconciliationCSVV2,
  generateSplitReconciliationCSVs,
  downloadCSV,
  parseReconciliationCSV,
  mapWholesalerToCompany
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
  incrementMappingUsage,
  confirmInsuranceRentalCompany,
  unconfirmInsuranceRentalCompany,
  confirmSalesCompany,
  unconfirmSalesCompany,
  confirmSelfPayRentalCompany,
  unconfirmSelfPayRentalCompany,
} from '../src/services/firestoreService';
import {
  initializeMasterCache,
  isMasterCacheInitialized,
  matchOcrNames,
  getMatchingStats,
  normalizeName
} from '../src/services/nameMatchingService';
import {
  loadItemMappings,
  INSURANCE_RENTAL_COLLECTION,
  SALES_COLLECTION,
  SELF_PAY_RENTAL_COLLECTION
} from '../src/services/insuranceRentalMatchService';
import UnmatchedNamesList from './UnmatchedNamesList';
import ClientSearchModal from './ClientSearchModal';
import InvoiceItemPickerModal from './InvoiceItemPickerModal';
import InsuranceRentalReconciliationSection from './InsuranceRentalReconciliationSection';
import SalesClientReconciliationSection from './SalesClientReconciliationSection';
import SelfPayRentalClientReconciliationSection from './SelfPayRentalClientReconciliationSection';
import UnmatchedWholesalerItemsSection from './UnmatchedWholesalerItemsSection';

interface ReconciliationPageProps {
  clients: Client[];
  baseClients?: Client[];
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

const ReconciliationPage: React.FC<ReconciliationPageProps> = ({ clients, baseClients = [], userEmail }) => {
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
  const reconCSVInputRef = useRef<HTMLInputElement | null>(null);
  const [isImportingReconCSV, setIsImportingReconCSV] = useState<boolean>(false);

  // Inline editing modal state
  const [clientSearchTarget, setClientSearchTarget] = useState<{
    invoiceItem: InvoiceItem;
    mode: 'link' | 'edit';  // link=仕入のみ紐づけ, edit=突合済み編集
  } | null>(null);
  const [invoicePickerTarget, setInvoicePickerTarget] = useState<{
    salesAozoraId: string;
    salesClientName: string;
  } | null>(null);
  const [isUpdatingMatch, setIsUpdatingMatch] = useState<boolean>(false);

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

  // Memoized: Sales summary by type（月次売上処理と同じ計算方法）
  const salesSummary = useMemo(() => {
    const summary: Record<SalesType, { count: number; amount: number }> = {
      '介護保険レンタル': { count: 0, amount: 0 },
      '自費レンタル': { count: 0, amount: 0 },
      '販売': { count: 0, amount: 0 }
    };

    // 件数は allSales から（介護保険レンタルの金額は別途計算）
    allSales.forEach(item => {
      const type = item.status as SalesType;
      if (summary[type]) {
        summary[type].count++;
        if (type !== '介護保険レンタル') {
          summary[type].amount += item.salesAmount;
        }
      }
    });

    // 介護保険レンタルの金額: insuranceRentalBillingTotal（月次売上処理と同じ）
    const [year, month] = selectedMonth.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const monthStartStr = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthEndStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const processedClients = new Set<string>();
    clients.forEach(client => {
      if (officeFilter && officeFilter !== '全事業所' && client.office !== officeFilter) return;
      const hasInsurance = (client.selectedEquipment || []).some(eq =>
        eq.status === '介護保険レンタル' &&
        (!eq.startDate || eq.startDate <= monthEndStr) &&
        (!eq.endDate || eq.endDate >= monthStartStr)
      );
      if (hasInsurance && !processedClients.has(client.aozoraId)) {
        processedClients.add(client.aozoraId);
        if (client.insuranceRentalBillingTotal !== undefined) {
          summary['介護保険レンタル'].amount += client.insuranceRentalBillingTotal;
        }
      }
    });

    // baseClients フォールバック: insuranceRentalOverride=true でマージから消えた介護保険利用者を救済
    // （CSV出力の Pass 2 と同じ条件で合算）
    const mergedClientMap = new Map(clients.map(c => [c.aozoraId, c]));
    baseClients.forEach(bc => {
      if (officeFilter && officeFilter !== '全事業所' && bc.office !== officeFilter) return;
      if (processedClients.has(bc.aozoraId)) return;
      const merged = mergedClientMap.get(bc.aozoraId);
      const billingTotal = merged?.insuranceRentalBillingTotal;
      if (billingTotal === undefined || billingTotal <= 0) return;
      // merged に当月アクティブな介護保険品目があれば上のブロックで既に処理済み
      if (merged) {
        const fsItems = (merged.selectedEquipment || []).filter(eq => eq.status === '介護保険レンタル');
        const hasActiveMerged = fsItems.some(eq =>
          (!eq.startDate || eq.startDate <= monthEndStr) &&
          (!eq.endDate || eq.endDate >= monthStartStr)
        );
        if (hasActiveMerged) return;
        // Pass 2 と整合性を保つため、全品目が当月前に失効している利用者はスキップ
        // （月遅れ除外等で前月の billingTotal が残存しているケースを除外）
        if (fsItems.length > 0 && fsItems.every(eq => eq.endDate && eq.endDate < monthStartStr)) return;
      }
      const hasActiveBase = (bc.selectedEquipment || []).some(eq =>
        eq.status === '介護保険レンタル' &&
        (!eq.startDate || eq.startDate <= monthEndStr) &&
        (!eq.endDate || eq.endDate >= monthStartStr)
      );
      if (!hasActiveBase) return;
      processedClients.add(bc.aozoraId);
      summary['介護保険レンタル'].amount += billingTotal;
      summary['介護保険レンタル'].count++;
    });

    return summary;
  }, [allSales, clients, baseClients, selectedMonth, officeFilter]);

  // 介護保険レンタルあり・請求額未設定の利用者一覧（警告バナー用）
  const missingBillingClients = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const monthStartStr = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthEndStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return clients.filter(client => {
      if (officeFilter && officeFilter !== '全事業所' && client.office !== officeFilter) return false;
      const hasInsurance = (client.selectedEquipment || []).some(eq =>
        eq.status === '介護保険レンタル' &&
        (!eq.startDate || eq.startDate <= monthEndStr) &&
        (!eq.endDate || eq.endDate >= monthStartStr)
      );
      return hasInsurance && client.insuranceRentalBillingTotal === undefined;
    });
  }, [clients, selectedMonth, officeFilter]);

  // 全体売上合計（確定済みの場合は確定値、未確定は現在計算値）
  const totalSalesAmount = useMemo(() => {
    return SALES_TYPES.reduce((sum, type) => {
      const conf = reconciliationDoc?.salesConfirmation?.[type];
      return sum + (conf?.status === 'confirmed' ? conf.amount : salesSummary[type].amount);
    }, 0);
  }, [salesSummary, reconciliationDoc]);

  // 全体仕入合計（アップロード済み請求書の totalAmount を全社合算）
  const totalInvoiceAmount = useMemo(() => {
    let total = 0;
    uploadedInvoices.forEach(data => {
      total += data.mergedInvoice.totalAmount || 0;
    });
    return total;
  }, [uploadedInvoices]);

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
          } else if (company === 'NihonCaresupply') {
            result = await parseNihonCareSupplyCSV(file, selectedMonth);
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

        // 自動マッチしたaozoraIDをInvoiceItemにスタンプ
        newItems.forEach((item, index) => {
          const matchResult = matchResults[index];
          if (matchResult?.status === 'matched' && matchResult.matchedCandidate) {
            item.matchedAozoraId = matchResult.matchedCandidate.aozoraId;
          }
        });

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

  // Handle reconciliation CSV import (re-import edited CSV to update invoice data for all companies)
  const handleReconciliationCSVImport = async (file: File) => {
    setIsImportingReconCSV(true);
    setOcrError(null);

    try {
      // Read file (support both UTF-8 with BOM and Shift-JIS)
      let csvText: string;
      const buffer = await file.arrayBuffer();
      const uint8 = new Uint8Array(buffer);

      // Check for UTF-8 BOM
      if (uint8[0] === 0xEF && uint8[1] === 0xBB && uint8[2] === 0xBF) {
        csvText = new TextDecoder('utf-8').decode(buffer);
      } else {
        // Try UTF-8 first, fallback to Shift-JIS
        csvText = new TextDecoder('utf-8').decode(buffer);
        if (csvText.includes('\ufffd')) {
          csvText = new TextDecoder('shift-jis').decode(buffer);
        }
      }

      // Parse CSV into company-grouped InvoiceItems
      const companyItems = parseReconciliationCSV(csvText);

      if (companyItems.size === 0) {
        setOcrError('CSVから仕入データを抽出できませんでした。突合CSVのフォーマットを確認してください。');
        return;
      }

      const results: string[] = [];
      let totalItems = 0;

      for (const [company, items] of companyItems) {
        // Skip confirmed companies
        const invoiceConf = reconciliationDoc?.invoiceConfirmation?.[company];
        if (invoiceConf?.status === 'confirmed') {
          console.warn(`[ReconCSVImport] Skipping confirmed company: ${WHOLESALE_COMPANY_NAMES[company]}`);
          results.push(`${WHOLESALE_COMPANY_NAMES[company]}: 確定済みのためスキップ`);
          continue;
        }

        // Run name matching only for items without matchedAozoraId from CSV
        const companyMappings = learnedMappings.get(company) || [];
        const itemsNeedingMatch = items.filter(item => !item.matchedAozoraId);
        if (itemsNeedingMatch.length > 0) {
          const ocrNames = itemsNeedingMatch.map(item => item.customerName);
          const matchResultsList = matchOcrNames(ocrNames, companyMappings);

          // Stamp matchedAozoraId for items matched by name
          itemsNeedingMatch.forEach((item, index) => {
            const matchResult = matchResultsList[index];
            if (matchResult?.status === 'matched' && matchResult.matchedCandidate) {
              item.matchedAozoraId = matchResult.matchedCandidate.aozoraId;
            }
          });
        }

        const csvMatchedCount = items.filter(item => item.matchedAozoraId).length - itemsNeedingMatch.filter(item => item.matchedAozoraId).length;
        if (csvMatchedCount > 0) {
          console.log(`[ReconCSVImport] ${WHOLESALE_COMPANY_NAMES[company]}: ${csvMatchedCount}件はCSVのあおぞらIDで紐づけ`);
        }

        const totalAmount = items.reduce((sum, i) => sum + i.amount, 0);

        // Build file info
        const fileInfo: UploadedFileInfo = {
          fileName: file.name,
          itemCount: items.length,
          totalAmount,
          uploadedAt: new Date().toISOString(),
        };

        // Build InvoiceConfirmationData and save
        const invoiceConfData: InvoiceConfirmationData = {
          status: 'draft' as const,
          files: [fileInfo],
          items,
          totalAmount,
        };
        await saveInvoiceData(selectedMonth, officeFilter, company, invoiceConfData, userEmail);

        // Update local state
        const companyData: CompanyInvoiceData = {
          files: [fileInfo],
          mergedInvoice: {
            id: `${company}-merged`,
            wholesaleCompany: company,
            fileName: file.name,
            uploadedAt: new Date().toISOString(),
            billingMonth: selectedMonth,
            items,
            totalAmount,
          },
        };

        setUploadedInvoices(prev => {
          const newMap = new Map(prev);
          newMap.set(company, companyData);
          return newMap;
        });

        totalItems += items.length;
        results.push(`${WHOLESALE_COMPANY_NAMES[company]}: ${items.length}件 ¥${totalAmount.toLocaleString()}`);
      }

      // Reload Firestore document
      await loadReconciliationDoc();

      // Show summary
      alert(`突合CSVインポート完了\n${companyItems.size}社 計${totalItems}件\n\n${results.join('\n')}`);
    } catch (error) {
      setOcrError(error instanceof Error ? error.message : '突合CSVのインポートでエラーが発生しました');
    } finally {
      setIsImportingReconCSV(false);
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

      // 手動選択のmappingsからaozoraIDをInvoiceItemにスタンプ
      if (mappings.length > 0) {
        const mappingByNormalizedName = new Map(
          mappings.map(m => [m.ocrName, m.aozoraId])
        );
        invoice.items.forEach(item => {
          if (!item.matchedAozoraId) {
            const normalized = normalizeName(item.customerName);
            const aozoraId = mappingByNormalizedName.get(normalized);
            if (aozoraId) {
              item.matchedAozoraId = aozoraId;
            }
          }
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

  // Check if invoice is confirmed for a given wholesale company
  const isInvoiceConfirmedForCompany = (company: WholesaleCompany): boolean => {
    const invoiceConf = reconciliationDoc?.invoiceConfirmation?.[company];
    return invoiceConf?.status === 'confirmed' || reconciliationDoc?.monthlyStatus === 'confirmed';
  };

  // Update invoice item match (shared logic for inline editing)
  const updateInvoiceItemMatch = async (
    targetItem: InvoiceItem,
    newAozoraId: string | null,
    clientName: string | null,
    saveMapping: boolean
  ) => {
    setIsUpdatingMatch(true);
    setOcrError(null);

    try {
      const company = targetItem.wholesaleCompany;
      const companyData = uploadedInvoices.get(company);
      if (!companyData) {
        setOcrError('該当する卸会社のデータが見つかりません');
        return;
      }

      // Update matchedAozoraId for all items with the same normalized customerName (existing pattern L680-691)
      const targetNormalized = normalizeName(targetItem.customerName);
      companyData.mergedInvoice.items.forEach(item => {
        const normalized = normalizeName(item.customerName);
        if (normalized === targetNormalized) {
          if (newAozoraId) {
            item.matchedAozoraId = newAozoraId;
          } else {
            delete item.matchedAozoraId;
          }
        }
      });

      // Save to Firestore
      const invoiceConfData: InvoiceConfirmationData = {
        status: 'draft' as const,
        files: companyData.files,
        items: companyData.mergedInvoice.items,
        totalAmount: companyData.mergedInvoice.totalAmount,
      };
      await saveInvoiceData(selectedMonth, officeFilter, company, invoiceConfData, userEmail);

      // Save OCR name mapping for learning (only when linking, not unlinking)
      if (saveMapping && newAozoraId && clientName) {
        const mapping: Omit<OcrNameMapping, 'id' | 'createdAt' | 'updatedAt'> = {
          ocrName: targetNormalized,
          ocrNameOriginal: targetItem.customerName,
          aozoraId: newAozoraId,
          masterName: clientName,
          wholesaleCompany: WHOLESALE_COMPANY_NAMES[company],
          confidence: 1.0,
          usageCount: 1,
        };
        await saveOcrNameMappings([mapping]);

        // Reload learned mappings
        const updatedMappings = await getOcrNameMappingsByCompany(WHOLESALE_COMPANY_NAMES[company]);
        setLearnedMappings(prev => {
          const newMap = new Map(prev);
          newMap.set(company, updatedMappings);
          return newMap;
        });
      }

      // Force React state update with new Map (avoid stale closure issues)
      const newUploadedInvoices = new Map(uploadedInvoices);
      setUploadedInvoices(newUploadedInvoices);

      // Re-run reconciliation using the mutated data directly
      const invoices = [...newUploadedInvoices.values()].map(data => data.mergedInvoice);
      const oldResults = reconciliationV2;
      const results = reconcileSalesWithInvoicesV2(allSales, invoices, selectedMonth);

      console.log(`[InlineEdit] Updated match for "${targetItem.customerName}" → ${newAozoraId || '(unlinked)'}`);
      console.log(`[InlineEdit] Before: matched=${oldResults?.matchedCount}, salesOnly=${oldResults?.salesOnlyCount}, invoiceOnly=${oldResults?.invoiceOnlyCount}`);
      console.log(`[InlineEdit] After:  matched=${results.matchedCount}, salesOnly=${results.salesOnlyCount}, invoiceOnly=${results.invoiceOnlyCount}`);

      // Check how many items have matchedAozoraId set
      const allItems = invoices.flatMap(inv => inv.items);
      const linkedCount = allItems.filter(i => i.matchedAozoraId).length;
      console.log(`[InlineEdit] Total invoice items with matchedAozoraId: ${linkedCount}/${allItems.length}`);

      setReconciliationV2(results);

      // Show feedback to user
      const matchedDiff = results.matchedCount - (oldResults?.matchedCount || 0);
      const invoiceOnlyDiff = results.invoiceOnlyCount - (oldResults?.invoiceOnlyCount || 0);
      if (matchedDiff > 0) {
        console.log(`[InlineEdit] ${matchedDiff}件が突合済みに移動しました`);
      } else if (newAozoraId) {
        console.log(`[InlineEdit] 紐づけを保存しましたが、対応する売上データがないため突合済みには移動しませんでした`);
      }
    } catch (error) {
      console.error('Error updating match:', error);
      setOcrError(error instanceof Error ? error.message : '紐づけ更新でエラーが発生しました');
    } finally {
      setIsUpdatingMatch(false);
    }
  };

  // Handle inline link from invoice_only tab
  const handleInlineLink = (invoiceItem: InvoiceItem) => {
    // If already linked, open in edit mode (with unlink option)
    const mode = invoiceItem.matchedAozoraId ? 'edit' : 'link';
    setClientSearchTarget({ invoiceItem, mode });
  };

  // Handle inline edit from matched tab
  const handleInlineEdit = (invoiceItem: InvoiceItem) => {
    setClientSearchTarget({ invoiceItem, mode: 'edit' });
  };

  // Handle inline invoice picker from sales_only tab
  const handleInlineInvoicePick = (aozoraId: string, clientName: string) => {
    setInvoicePickerTarget({ salesAozoraId: aozoraId, salesClientName: clientName });
  };

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
  const handleExportCSV = async () => {
    if (!reconciliationV2) return;

    const results = reconciliationV2.results.map(r => ({ ...r }));
    const removedIds = new Set<string>();

    // 卸種別に応じたコレクション選択
    const getCollection = (salesType: string) => {
      if (salesType === '販売') return SALES_COLLECTION;
      if (salesType === '自費レンタル') return SELF_PAY_RENTAL_COLLECTION;
      return INSURANCE_RENTAL_COLLECTION;
    };

    // Firestoreマッピングを先に取得（Step 1, Step 2 共用）
    // matched行（matched-acc- 含む）から (company, aozoraId, salesType) の一意ペアを収集
    type MappingKey = { company: WholesaleCompany; aozoraId: string; salesType: string };
    const pairMap = new Map<string, MappingKey>();
    for (const r of results) {
      if (r.matchStatus === 'matched' && r.salesItem?.aozoraId && r.invoiceItem?.wholesaleCompany) {
        const key = `${r.invoiceItem.wholesaleCompany}__${r.salesItem.aozoraId}`;
        if (!pairMap.has(key)) {
          pairMap.set(key, {
            company: r.invoiceItem.wholesaleCompany,
            aozoraId: r.salesItem.aozoraId,
            salesType: r.salesItem.status || ''
          });
        }
      }
    }

    // Firestoreからマッピングを並行取得
    const allMappings = new Map<string, InsuranceRentalItemMapping[]>();
    await Promise.all([...pairMap.entries()].map(async ([key, pair]) => {
      const mappings = await loadItemMappings(pair.company, pair.aozoraId, getCollection(pair.salesType));
      if (mappings.length > 0) allMappings.set(key, mappings);
    }));

    // Phase 1: Firestoreマッピングが設定されている (company, aozoraId) ペアについて
    // 仕入金額をFirestoreマッピングを唯一の正解ソースとして最初から組み直す。
    //
    // この処理が解決する問題:
    // ① 1:1マッチングが誤った invoice item（例: クレジットノート -481,000）を弊社品目に紐づけた場合
    // ② matched-acc- 行の付属品が正しい弊社品目に統合されていない場合
    // ③ NS-600プラス相殺パターン（同名の正・負アイテムが複数件）
    //
    // 処理方針:
    // - マッピングあり → Firestoreマッピングに従い対応する弊社品目の仕入に加算（正・負両方）
    // - マッピングなし → 弊社品目空欄の「仕入のみ行」として独立出力
    for (const [mapKey, mappings] of allMappings.entries()) {
      const sepIdx = mapKey.indexOf('__');
      const pairCompany = mapKey.substring(0, sepIdx) as WholesaleCompany;
      const pairAozoraId = mapKey.substring(sepIdx + 2);

      // 親行: このaozoraIdの全売上行（matched + sales_only）
      // ※ invoiceItem の会社は問わない（Firestoreマッピングの会社と1:1マッチ結果の会社が
      //   異なるケースがあるため、会社フィルタを外してourItemRowMapを正しく構築する）
      const parentRows = results.filter(r =>
        !r.id.startsWith('matched-acc-') &&
        (r.matchStatus === 'matched' || r.matchStatus === 'sales_only') &&
        r.salesItem?.aozoraId === pairAozoraId &&
        !removedIds.has(r.id)
      );
      if (parentRows.length === 0) continue;

      // acc行: このペアの matched-acc- 行（会社フィルタあり）
      const accRows = results.filter(r =>
        r.id.startsWith('matched-acc-') &&
        r.invoiceItem?.wholesaleCompany === pairCompany &&
        r.invoiceItem?.matchedAozoraId === pairAozoraId &&
        !removedIds.has(r.id)
      );

      // ourItemName → 親行 のマップ（完全一致 + 部分一致フォールバック）
      const ourItemRowMap = new Map<string, typeof results[0]>();
      for (const r of parentRows) {
        const name = r.salesItem?.equipmentName;
        if (name) ourItemRowMap.set(name, r);
      }

      // このペアの全invoice item を収集（pairCompany のもののみ）
      // 収集対象: ① 親行の1:1マッチ分（pairCompany）② acc行 ③ 純仕入のみ行
      const allInvoiceForPair: InvoiceItem[] = [];

      // ① 親行のうち invoiceItem が pairCompany のもの → 収集してその分の purchaseAmount を差し引く
      //   （後でマッピングに従って正しい行に再割り当てするため）
      for (const r of parentRows) {
        if (r.invoiceItem?.wholesaleCompany === pairCompany) {
          allInvoiceForPair.push(r.invoiceItem);
          r.purchaseAmount = (r.purchaseAmount || 0) - r.invoiceItem.amount;
        }
      }

      // ② acc行
      for (const acc of accRows) {
        if (acc.invoiceItem) allInvoiceForPair.push(acc.invoiceItem);
      }

      // ③ 純仕入のみ行: matchedAozoraId が一致する invoice_only 行も吸収してマッピングで振り分け
      const pureInvoiceOnlyRows = results.filter(r =>
        r.matchStatus === 'invoice_only' &&
        r.invoiceItem?.wholesaleCompany === pairCompany &&
        r.invoiceItem?.matchedAozoraId === pairAozoraId &&
        !removedIds.has(r.id) &&
        !r.id.startsWith('io-rebuild-')
      );
      for (const r of pureInvoiceOnlyRows) {
        if (r.invoiceItem) allInvoiceForPair.push(r.invoiceItem);
        removedIds.add(r.id); // Phase 1 で再処理するため除外
      }

      // acc行をすべて除外（Phase 1 で再処理するため）
      for (const acc of accRows) removedIds.add(acc.id);


      // 各 invoice item を Firestoreマッピングに従って振り分け
      const newInvoiceOnlyRows: ReconciliationResultV2[] = [];
      for (const invoiceItem of allInvoiceForPair) {
        const mapping = mappings.find(m => m.wholesalerItemNames.includes(invoiceItem.itemName));
        if (!mapping) {
          // マッピングなし → 仕入のみ行として独立出力
          newInvoiceOnlyRows.push({
            id: `io-rebuild-${invoiceItem.id}`,
            matchStatus: 'invoice_only',
            invoiceItem,
            purchaseAmount: invoiceItem.amount
          });
          continue;
        }
        // 親行を特定: 完全一致 → 部分一致フォールバック
        let parentRow = ourItemRowMap.get(mapping.ourItemName);
        if (!parentRow) {
          for (const [name, row] of ourItemRowMap.entries()) {
            if (name.includes(mapping.ourItemName) || mapping.ourItemName.includes(name)) {
              parentRow = row;
              break;
            }
          }
        }
        if (!parentRow) {
          // 対応する弊社品目行が見つからない → 仕入のみ行
          newInvoiceOnlyRows.push({
            id: `io-rebuild-${invoiceItem.id}`,
            matchStatus: 'invoice_only',
            invoiceItem,
            purchaseAmount: invoiceItem.amount
          });
          continue;
        }
        // 親行に仕入金額を加算（正・負両方）
        parentRow.purchaseAmount = (parentRow.purchaseAmount || 0) + invoiceItem.amount;
        // sales_only行に仕入が付いた場合はmatched行に昇格
        if (parentRow.matchStatus === 'sales_only') {
          parentRow.matchStatus = 'matched';
          if (!parentRow.invoiceItem) {
            parentRow.invoiceItem = invoiceItem;
            parentRow.matchConfidence = 0.95;
          }
        }
      }

      // 粗利を再計算
      for (const r of parentRows) {
        r.grossProfit = (r.salesAmount || 0) - (r.purchaseAmount || 0);
        r.grossProfitRate = (r.salesAmount || 0) > 0
          ? ((r.grossProfit || 0) / (r.salesAmount || 0)) * 100 : 0;
      }

      results.push(...newInvoiceOnlyRows);
    }

    // 簡略Step 1: Phase 1 で処理されなかった matched-acc- 行（マッピングなし）→ 仕入のみ行
    for (const acc of results.filter(r => r.id.startsWith('matched-acc-') && !removedIds.has(r.id))) {
      acc.matchStatus = 'invoice_only';
      acc.salesItem = undefined;
      acc.salesAmount = 0;
    }

    const finalResults = results.filter(r => !removedIds.has(r.id));

    // 自社物件の仕入金額を 0 に強制
    // 自社所有品は外部仕入が発生しないため、Phase 1 で誤ってマッチした仕入を除去する
    for (const r of finalResults) {
      if (r.salesItem?.propertyAttribute === '自社物件') {
        r.purchaseAmount = 0;
        r.grossProfit = r.salesAmount || 0;
        r.grossProfitRate = (r.salesAmount || 0) > 0 ? 100 : 0;
      }
    }

    // clientBillingMap: Pass 1/2 補完ブロックで使用
    const clientBillingMap = new Map(clients.map(c => [c.aozoraId, c.insuranceRentalBillingTotal]));

    // Pass 1: allSales にいるが finalResults に存在しない介護保険レンタル利用者を補完
    // → Firestoreに3月データがあるがreconciliationV2に含まれない利用者（突合実行後にCSV再インポートした場合等）
    {
      const insuranceAozoraIdsInResults = new Set(
        finalResults
          .filter(r => r.salesItem?.status === '介護保険レンタル' && !r.id.startsWith('matched-acc-'))
          .map(r => r.salesItem!.aozoraId)
      );
      const missingByClient = new Map<string, typeof allSales>();
      for (const item of allSales) {
        if (item.status !== '介護保険レンタル') continue;
        if (insuranceAozoraIdsInResults.has(item.aozoraId)) continue;
        const target = clientBillingMap.get(item.aozoraId);
        if (!target || target <= 0) continue;
        if (!missingByClient.has(item.aozoraId)) missingByClient.set(item.aozoraId, []);
        missingByClient.get(item.aozoraId)!.push(item);
      }
      for (const [, items] of missingByClient) {
        items.forEach(item => {
          // allSales の salesAmount（monthlyCost ベース）をそのまま使用
          // monthlyCost = 単位数 × 10円 = 給付対象金額（利用者請求）と一致
          const newSalesAmount = item.salesAmount || 0;
          finalResults.push({
            id: item.id,
            matchStatus: 'sales_only',
            salesItem: item,
            salesAmount: newSalesAmount,
            purchaseAmount: 0,
            grossProfit: newSalesAmount,
            grossProfitRate: 100,
            matchConfidence: 0
          });
        });
      }
    }

    // Pass 2: totalSalesAmount との差分（ギャップ）を上限として、
    //          baseClientsに存在する介護保険レンタル利用者を sales_only 行として補完
    // → insuranceRentalOverride=true でFirestoreに当月品目がなく allSales から除外された利用者の救済
    // ギャップを超えて追加しないため、過去月インポートのstale利用者が混入しても合計は常に正確
    if (baseClients.length > 0) {
      // ギャップ計算: totalSalesAmount と現在のfinalResults合計の差
      const currentTotalBeforePass2 = finalResults.reduce((s, r) => s + (r.salesAmount || 0), 0);
      let remainingGap = totalSalesAmount - currentTotalBeforePass2;

      if (remainingGap > 0) {
        const alreadyInResults = new Set(
          finalResults
            .filter(r => r.salesItem?.status === '介護保険レンタル' && !r.id.startsWith('matched-acc-'))
            .map(r => r.salesItem!.aozoraId)
        );

        const [byear, bmonth] = selectedMonth.split('-').map(Number);
        const blastDay = new Date(byear, bmonth, 0).getDate();
        const bmonthStart = `${selectedMonth}-01`;
        const bmonthEnd = `${selectedMonth}-${String(blastDay).padStart(2, '0')}`;

        const mergedClientMap = new Map(clients.map(c => [c.aozoraId, c]));

        // 福岡（Lichi）を先に処理（欠落している22名はLichi利用者のため）
        const sortedBaseClients = [...baseClients].sort((a, b) => {
          const aLichi = a.office === '福岡（Lichi）' ? 0 : 1;
          const bLichi = b.office === '福岡（Lichi）' ? 0 : 1;
          return aLichi - bLichi;
        });

        for (const baseClient of sortedBaseClients) {
          if (remainingGap <= 0) break;
          if (officeFilter && officeFilter !== '全事業所' && baseClient.office !== officeFilter) continue;
          if (alreadyInResults.has(baseClient.aozoraId)) continue;
          const billingTotal = clientBillingMap.get(baseClient.aozoraId);
          if (!billingTotal || billingTotal <= 0) continue;

          // 当月有効なFirestore介護保険品目があればallSales/Pass1で処理済みのはずなのでスキップ
          const mergedClient = mergedClientMap.get(baseClient.aozoraId);
          if (mergedClient) {
            const fsItems = (mergedClient.selectedEquipment || []).filter(eq => eq.status === '介護保険レンタル');
            const hasActive = fsItems.some(eq =>
              (!eq.startDate || eq.startDate <= bmonthEnd) &&
              (!eq.endDate || eq.endDate >= bmonthStart)
            );
            if (hasActive) continue;
            // 全品目が当月前に失効している → staleとしてスキップ
            if (fsItems.length > 0 && fsItems.every(eq => eq.endDate && eq.endDate < bmonthStart)) continue;
          }

          const baseInsuranceItems = (baseClient.selectedEquipment || []).filter(eq => {
            if (eq.status !== '介護保険レンタル') return false;
            if (eq.startDate && eq.startDate > bmonthEnd) return false;
            if (eq.endDate && eq.endDate < bmonthStart) return false;
            return true;
          });
          if (baseInsuranceItems.length === 0) continue;

          // ギャップ上限チェック（stale利用者の過剰追加を防ぐ）
          remainingGap -= billingTotal;

          // baseClients の monthlyCost は古い/未設定の可能性があるため units*10 にフォールバック
          const itemsWithAmount = baseInsuranceItems.map(eq => ({
            eq,
            amount: eq.monthlyCost || parseInt(eq.units || '0', 10) * 10,
          }));
          const totalFromItems = itemsWithAmount.reduce((s, x) => s + x.amount, 0);

          if (totalFromItems === 0) {
            // 全品目に金額情報なし → 1行に集約（等分配分アーティファクトを防止）
            const salesItem: SalesItem = {
              id: `base-fallback-${baseClient.aozoraId}-collapsed`,
              aozoraId: baseClient.aozoraId,
              clientName: baseClient.name,
              clientNameKana: baseClient.nameKana || '',
              facilityName: baseClient.facilityName || '在宅',
              equipmentId: '',
              equipmentName: '介護保険レンタル（品目情報なし）',
              category: '',
              status: '介護保険レンタル',
              wholesaler: '',
              taisCode: '',
              quantity: 1,
              unitPrice: billingTotal,
              salesAmount: billingTotal,
              startDate: bmonthStart,
              office: mergedClientMap.get(baseClient.aozoraId)?.office || baseClient.office,
            };
            finalResults.push({
              id: salesItem.id,
              matchStatus: 'sales_only',
              salesItem,
              salesAmount: billingTotal,
              purchaseAmount: 0,
              grossProfit: billingTotal,
              grossProfitRate: 100,
              matchConfidence: 0
            });
          } else {
            // 品目ごとに金額を持たせて追加（後続の per-client 正規化で billingTotal に按分）
            itemsWithAmount.forEach(({ eq, amount }, i) => {
              const salesItem: SalesItem = {
                id: `base-fallback-${baseClient.aozoraId}-${i}`,
                aozoraId: baseClient.aozoraId,
                clientName: baseClient.name,
                clientNameKana: baseClient.nameKana || '',
                facilityName: baseClient.facilityName || '在宅',
                equipmentId: eq.id,
                equipmentName: eq.name || '介護保険レンタル',
                category: eq.category || '',
                status: '介護保険レンタル',
                wholesaler: eq.wholesaler || '',
                taisCode: eq.taisCode || '',
                quantity: parseInt(eq.units || '1', 10),
                unitPrice: amount,
                salesAmount: amount,
                startDate: eq.startDate || bmonthStart,
                endDate: eq.endDate,
                office: mergedClientMap.get(baseClient.aozoraId)?.office || baseClient.office,
              };

              finalResults.push({
                id: salesItem.id,
                matchStatus: 'sales_only',
                salesItem,
                salesAmount: amount,
                purchaseAmount: 0,
                grossProfit: amount,
                grossProfitRate: 100,
                matchConfidence: 0
              });
            });
          }
        }
      }
    }

    // per-client 正規化は廃止：
    // 福祉用具は全国一律 1単位=10円 で、アプリに支給限度額計算もないため、
    // 通常利用者は sum(monthlyCost) === billingTotal が自然に成立する。
    // 1円単位で食い違う場合は行をスケーリングせず monthlyCost をそのまま出力し、
    // CSV末尾サマリー（billingTotal ベース）との不一致はユーザーが目視で確認できるようにする。

    // 仕入サマリーは請求書アップロード実額（reconciliationV2.totalPurchaseAmount）を使用
    // → 自社物件ゼロ化後の行合計ではなく、請求書PDF実総額を正として表示
    //   （目視で「自社物件誤マッチ = 差額」を確認できるようにする）
    const totalPurchaseFixed = reconciliationV2.totalPurchaseAmount || 0;
    const grossProfit = totalSalesAmount - totalPurchaseFixed;
    const summaryForExport = {
      ...reconciliationV2,
      results: finalResults,
      totalSalesAmount,
      totalPurchaseAmount: totalPurchaseFixed,
      totalGrossProfit: grossProfit,
      grossProfitRate: totalSalesAmount > 0 ? (grossProfit / totalSalesAmount) * 100 : 0
    };
    const officeLabel = officeFilter === '全事業所' ? '全事業所' : officeFilter;
    const base = `売上仕入突合_${selectedMonth}_${officeLabel}`;

    // 全ダウンロード内容を先に生成してからタイマーで順次配信
    // → ブラウザの複数ダウンロードブロックを回避
    const pendingDownloads: Array<[string, string]> = [];

    const splits = generateSplitReconciliationCSVs(summaryForExport);
    pendingDownloads.push([generateReconciliationCSVV2(summaryForExport), `${base}_全量.csv`]);
    pendingDownloads.push([splits.matched,   `${base}_突合OK.csv`]);
    pendingDownloads.push([splits.salesOnly,  `${base}_売上のみ.csv`]);
    pendingDownloads.push([splits.invoiceOnly, `${base}_仕入のみ.csv`]);

    // 全事業所モードのとき、ACG・Lichi 別 CSV も追加出力
    if (!officeFilter || officeFilter === '全事業所') {
      const clientOfficeMap = new Map(clients.map(c => [c.aozoraId, c.office]));

      // 事業所別の売上合計を salesSummary と同じロジック（billingTotal ベース）で再計算
      // → 事業所 CSV サマリー = 行合計ベースではなく全事業所 CSV と整合
      const [y, mo] = selectedMonth.split('-').map(Number);
      const lastDay = new Date(y, mo, 0).getDate();
      const ms = `${y}-${String(mo).padStart(2, '0')}-01`;
      const me = `${y}-${String(mo).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      const mergedMap = new Map(clients.map(c => [c.aozoraId, c]));

      const computeOfficeTotalSales = (targetOffice: OfficeLocation): number => {
        let total = 0;
        // 非介護保険（自費・販売）: allSales を事業所でフィルタし salesAmount を合算
        allSales.forEach(item => {
          if (item.office !== targetOffice) return;
          if (item.status !== '介護保険レンタル') {
            total += item.salesAmount;
          }
        });
        // 介護保険: merged clients の billingTotal
        const processedIds = new Set<string>();
        clients.forEach(c => {
          if (c.office !== targetOffice) return;
          const hasInsurance = (c.selectedEquipment || []).some(eq =>
            eq.status === '介護保険レンタル' &&
            (!eq.startDate || eq.startDate <= me) &&
            (!eq.endDate || eq.endDate >= ms)
          );
          if (hasInsurance && !processedIds.has(c.aozoraId) && c.insuranceRentalBillingTotal !== undefined) {
            processedIds.add(c.aozoraId);
            total += c.insuranceRentalBillingTotal;
          }
        });
        // baseClients フォールバック（salesSummary と同じ条件）
        baseClients.forEach(bc => {
          if (bc.office !== targetOffice) return;
          if (processedIds.has(bc.aozoraId)) return;
          const merged = mergedMap.get(bc.aozoraId);
          const bt = merged?.insuranceRentalBillingTotal;
          if (bt === undefined || bt <= 0) return;
          if (merged) {
            const fsItems = (merged.selectedEquipment || []).filter(eq => eq.status === '介護保険レンタル');
            const hasActiveMerged = fsItems.some(eq =>
              (!eq.startDate || eq.startDate <= me) &&
              (!eq.endDate || eq.endDate >= ms)
            );
            if (hasActiveMerged) return;
            if (fsItems.length > 0 && fsItems.every(eq => eq.endDate && eq.endDate < ms)) return;
          }
          const hasActiveBase = (bc.selectedEquipment || []).some(eq =>
            eq.status === '介護保険レンタル' &&
            (!eq.startDate || eq.startDate <= me) &&
            (!eq.endDate || eq.endDate >= ms)
          );
          if (!hasActiveBase) return;
          processedIds.add(bc.aozoraId);
          total += bt;
        });
        return total;
      };

      const OFFICES: { key: OfficeLocation; label: string }[] = [
        { key: '鹿児島（ACG）', label: 'ACG' },
        { key: '福岡（Lichi）', label: 'Lichi' },
      ];

      for (const { key: office, label } of OFFICES) {
        // 最終補正済み finalResults からオフィスで絞り込む（shallow copy）
        // salesItem.office を正とする → clients.json の office 誤登録に影響されない
        const officeResults = finalResults
          .filter(r => {
            if (r.salesItem) return r.salesItem.office === office;
            if (r.invoiceItem?.matchedAozoraId) {
              return clientOfficeMap.get(r.invoiceItem.matchedAozoraId) === office;
            }
            return false;
          })
          .map(r => ({ ...r }));

        if (officeResults.length === 0) continue;

        // 事業所別売上サマリーは billingTotal ベース（全事業所CSVと整合）
        const officeTotalSales = computeOfficeTotalSales(office);

        // 仕入サマリーは行合計（=請求書マッチ額の事業所別集計）
        // 全事業所は reconciliationV2.totalPurchaseAmount（請求書実額合計）を使用するが、
        // 事業所別の請求書実額を正確に按分するロジックが現状ないため、暫定として行合計を使用。
        const oPurchaseTotal = officeResults.reduce((s, r) => s + (r.purchaseAmount || 0), 0);
        const oGrossProfit = officeTotalSales - oPurchaseTotal;
        const officeSummary = {
          ...reconciliationV2,
          results: officeResults,
          totalSalesAmount: officeTotalSales,
          totalPurchaseAmount: oPurchaseTotal,
          totalGrossProfit: oGrossProfit,
          grossProfitRate: officeTotalSales > 0 ? (oGrossProfit / officeTotalSales) * 100 : 0,
        };
        const oBase = `売上仕入突合_${selectedMonth}_${label}`;
        const oSplits = generateSplitReconciliationCSVs(officeSummary);
        pendingDownloads.push([generateReconciliationCSVV2(officeSummary), `${oBase}_全量.csv`]);
        pendingDownloads.push([oSplits.matched,    `${oBase}_突合OK.csv`]);
        pendingDownloads.push([oSplits.salesOnly,   `${oBase}_売上のみ.csv`]);
        pendingDownloads.push([oSplits.invoiceOnly,  `${oBase}_仕入のみ.csv`]);
      }
    }

    // 300ms 間隔で順次ダウンロード（ブラウザの同時ダウンロード制限を回避）
    pendingDownloads.forEach(([content, filename], i) => {
      setTimeout(() => downloadCSV(content, filename), i * 300);
    });
  };

  // Get filtered results by tab
  // 介護保険レンタルが有効な利用者のあおぞらIDセット（新セクション用フィルタリング）
  const insuranceRentalClientIds = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const monthStart = `${selectedMonth}-01`;
    const monthEnd = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;
    const ids = new Set<string>();
    for (const client of clients) {
      const hasActive = (client.selectedEquipment || []).some(eq => {
        if (eq.status !== '介護保険レンタル') return false;
        if (eq.startDate && eq.startDate > monthEnd) return false;
        if (eq.endDate && eq.endDate < monthStart) return false;
        return true;
      });
      if (hasActive) ids.add(client.aozoraId);
    }
    return ids;
  }, [clients, selectedMonth]);

  // 当月アクティブな自費レンタル利用者のあおぞらIDセット（自費レンタルセクション用フィルタリング）
  const selfPayRentalClientIds = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const monthStart = `${selectedMonth}-01`;
    const monthEnd = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;
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
  }, [clients, selectedMonth]);

  // 当月納品の販売利用者のあおぞらIDセット（販売セクション用フィルタリング）
  const salesClientIds = useMemo(() => {
    const monthStart = `${selectedMonth}-01`;
    const [year, month] = selectedMonth.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const monthEnd = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;
    const ids = new Set<string>();
    for (const client of clients) {
      const hasSales = (client.selectedEquipment || []).some(eq => {
        if (eq.status !== '販売') return false;
        const d = eq.deliveryDate;
        if (!d) return false;
        return d >= monthStart && d <= monthEnd;
      });
      if (hasSales) ids.add(client.aozoraId);
    }
    return ids;
  }, [clients, selectedMonth]);

  const getFilteredResults = () => {
    if (!reconciliationV2) return [];
    return reconciliationV2.results.filter(r => {
      if (r.matchStatus !== resultTab) return false;
      // 介護保険レンタル・販売・自費レンタルは新セクションで管理するため既存3セクションから除外
      if (r.matchStatus === 'matched' || r.matchStatus === 'sales_only') {
        if (r.salesItem?.status === '介護保険レンタル') return false;
        if (r.salesItem?.status === '販売') return false;
        if (r.salesItem?.status === '自費レンタル') return false;
      }
      if (r.matchStatus === 'invoice_only') {
        const aozoraId = r.invoiceItem?.matchedAozoraId;
        if (aozoraId && insuranceRentalClientIds.has(aozoraId)) return false;
        if (aozoraId && salesClientIds.has(aozoraId)) return false;
        if (aozoraId && selfPayRentalClientIds.has(aozoraId)) return false;
      }
      return true;
    });
  };

  // Format currency
  const formatCurrency = (amount: number) => `¥${amount.toLocaleString()}`;

  // 介護保険レンタル利用者別突合セクション用：会社別の請求書品目（matchedAozoraId付き）
  const invoiceItemsByCompany = useMemo(() => {
    const map = new Map<WholesaleCompany, InvoiceItem[]>();
    uploadedInvoices.forEach((data, company) => {
      map.set(company, data.mergedInvoice.items);
    });
    return map;
  }, [uploadedInvoices]);

  // 介護保険レンタル利用者別突合：会社単位の確定ハンドラ
  const handleConfirmInsuranceRentalCompany = async (company: WholesaleCompany) => {
    await confirmInsuranceRentalCompany(selectedMonth, officeFilter, company, userEmail);
    await loadReconciliationDoc();
  };

  const handleUnconfirmInsuranceRentalCompany = async (company: WholesaleCompany) => {
    await unconfirmInsuranceRentalCompany(selectedMonth, officeFilter, company, userEmail);
    await loadReconciliationDoc();
  };

  // 販売利用者別突合：会社単位の確定ハンドラ
  const handleConfirmSalesCompany = async (company: WholesaleCompany) => {
    await confirmSalesCompany(selectedMonth, officeFilter, company, userEmail);
    await loadReconciliationDoc();
  };

  const handleUnconfirmSalesCompany = async (company: WholesaleCompany) => {
    await unconfirmSalesCompany(selectedMonth, officeFilter, company, userEmail);
    await loadReconciliationDoc();
  };

  // 自費レンタル利用者別突合：会社単位の確定ハンドラ
  const handleConfirmSelfPayRentalCompany = async (company: WholesaleCompany) => {
    await confirmSelfPayRentalCompany(selectedMonth, officeFilter, company, userEmail);
    await loadReconciliationDoc();
  };

  const handleUnconfirmSelfPayRentalCompany = async (company: WholesaleCompany) => {
    await unconfirmSelfPayRentalCompany(selectedMonth, officeFilter, company, userEmail);
    await loadReconciliationDoc();
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
                    {SALES_TYPES.reduce((sum, type) => {
                      const conf = reconciliationDoc?.salesConfirmation?.[type];
                      return sum + (conf?.status === 'confirmed' ? conf.count : salesSummary[type].count);
                    }, 0)}件
                  </div>
                  <div className="text-sm text-gray-600">
                    {formatCurrency(SALES_TYPES.reduce((sum, type) => {
                      const conf = reconciliationDoc?.salesConfirmation?.[type];
                      return sum + (conf?.status === 'confirmed' ? conf.amount : salesSummary[type].amount);
                    }, 0))}
                  </div>
                  <div className="mt-2 text-xs text-gray-500">
                    {confirmedSalesCount}/3 確定済
                  </div>
                </div>
              </div>
            </div>

            {/* 請求額未設定の警告バナー */}
            {missingBillingClients.length > 0 && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded-lg text-amber-800 text-sm">
                <div className="font-bold mb-1">⚠️ 介護保険レンタル 請求額未設定: {missingBillingClients.length}名（売上集計に含まれていません）</div>
                <div className="text-xs mb-1 text-amber-700">カイポケCSVを再インポートするか、請求CSVに当該利用者が含まれているか確認してください。</div>
                <ul className="list-disc list-inside space-y-0.5">
                  {missingBillingClients.map(c => (
                    <li key={c.aozoraId}>
                      <span className="font-medium">{c.name || '（名前未設定）'}</span>
                      <span className="text-amber-600 ml-1">({c.aozoraId})</span>
                      {c.facilityName && <span className="text-amber-600 ml-1">・{c.facilityName}</span>}
                      {c.office && <span className="text-amber-600 ml-1">({c.office})</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

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
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-800">請求書アップロード（7社）</h2>
                <p className="text-sm text-gray-600 mt-1">金額なしの請求書（キシヤ等）も仕入金額0円として突合対象に含めます</p>
              </div>
              <div>
                <input
                  type="file"
                  accept=".csv"
                  ref={reconCSVInputRef}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      handleReconciliationCSVImport(f);
                      e.target.value = '';
                    }
                  }}
                  className="hidden"
                />
                <button
                  onClick={() => reconCSVInputRef.current?.click()}
                  disabled={isImportingReconCSV}
                  className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
                    isImportingReconCSV
                      ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                      : 'bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50 hover:border-emerald-400'
                  }`}
                  title="突合結果CSVを修正後にインポートし、各社の請求明細を一括更新します"
                >
                  {isImportingReconCSV ? (
                    <>
                      <div className="animate-spin h-4 w-4 border-2 border-emerald-500 border-t-transparent rounded-full"></div>
                      インポート中...
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                      </svg>
                      突合CSVインポート
                    </>
                  )}
                </button>
              </div>
            </div>

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
                  <div className="text-2xl font-bold text-blue-700">{formatCurrency(totalSalesAmount)}</div>
                  <div className="text-sm text-blue-600">売上合計 ({allSales.length}件)</div>
                </div>
                <div className="bg-orange-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-orange-700">{formatCurrency(totalInvoiceAmount)}</div>
                  <div className="text-sm text-orange-600">仕入合計（請求書アップロード分）</div>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-green-700">{formatCurrency(totalSalesAmount - totalInvoiceAmount)}</div>
                  <div className="text-sm text-green-600">粗利合計</div>
                </div>
                <div className="bg-purple-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-purple-700">
                    {totalSalesAmount > 0 ? ((totalSalesAmount - totalInvoiceAmount) / totalSalesAmount * 100).toFixed(1) : '0.0'}%
                  </div>
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
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {getFilteredResults().map((result) => {
                        const isConfirmed = result.invoiceItem ? isInvoiceConfirmedForCompany(result.invoiceItem.wholesaleCompany) : false;
                        const isAccessory = result.id.startsWith('matched-acc-');
                        return (
                        <tr key={result.id} className={`hover:bg-gray-50 ${isAccessory ? 'bg-blue-50' : ''}`}>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {isAccessory && <span className="text-xs text-blue-500 mr-1">┗</span>}
                            {result.salesItem?.clientName}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {isAccessory ? (
                              <span className="text-gray-600">{result.invoiceItem?.itemName}</span>
                            ) : result.salesItem?.equipmentName}
                          </td>
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
                          <td className="px-4 py-3 text-center">
                            {result.invoiceItem && (
                              <button
                                onClick={() => handleInlineEdit(result.invoiceItem!)}
                                disabled={isConfirmed || isUpdatingMatch}
                                className="p-1 text-gray-400 hover:text-blue-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                title={isConfirmed ? '確定済みのため編集不可' : '紐づけ編集'}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                                </svg>
                              </button>
                            )}
                          </td>
                        </tr>
                        );
                      })}
                      {getFilteredResults().length === 0 && (
                        <tr>
                          <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
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
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {getFilteredResults().map((result) => {
                        const hasInvoiceOnly = reconciliationV2 ? reconciliationV2.invoiceOnlyCount > 0 : false;
                        return (
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
                          <td className="px-4 py-3 text-center">
                            {result.salesItem && hasInvoiceOnly && (
                              <button
                                onClick={() => handleInlineInvoicePick(result.salesItem!.aozoraId, result.salesItem!.clientName)}
                                disabled={isUpdatingMatch}
                                className="px-2 py-1 text-xs text-purple-700 bg-purple-100 rounded hover:bg-purple-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                title="仕入データと紐づけ"
                              >
                                仕入紐づけ
                              </button>
                            )}
                          </td>
                        </tr>
                        );
                      })}
                      {getFilteredResults().length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
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
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {getFilteredResults().map((result) => {
                        const isConfirmed = result.invoiceItem ? isInvoiceConfirmedForCompany(result.invoiceItem.wholesaleCompany) : false;
                        const linkedAozoraId = result.invoiceItem?.matchedAozoraId;
                        const linkedClient = linkedAozoraId ? clients.find(c => c.aozoraId === linkedAozoraId) : null;
                        return (
                        <tr key={result.id} className={`hover:bg-gray-50 ${linkedAozoraId ? 'bg-blue-50' : ''}`}>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {result.invoiceItem?.customerName}
                            {linkedClient && (
                              <span className="ml-2 text-xs text-blue-600">
                                → {linkedClient.name} ({linkedAozoraId})
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">{result.invoiceItem?.itemName}</td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatCurrency(result.purchaseAmount || 0)}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {WHOLESALE_COMPANY_NAMES[result.invoiceItem?.wholesaleCompany || 'Other']}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {result.invoiceItem && (
                              <button
                                onClick={() => handleInlineLink(result.invoiceItem!)}
                                disabled={isConfirmed || isUpdatingMatch}
                                className={`px-2 py-1 text-xs rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                                  linkedAozoraId
                                    ? 'text-green-700 bg-green-100 hover:bg-green-200'
                                    : 'text-blue-700 bg-blue-100 hover:bg-blue-200'
                                }`}
                                title={isConfirmed ? '確定済みのため編集不可' : linkedAozoraId ? '紐づけ変更' : '利用者に紐づけ'}
                              >
                                {linkedAozoraId ? '変更' : '紐づけ'}
                              </button>
                            )}
                          </td>
                        </tr>
                        );
                      })}
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

        {/* 介護保険レンタル 利用者別突合セクション（請求書アップロード済みの場合に表示） */}
        {uploadedInvoices.size > 0 && (
          <div className="mt-6">
            <InsuranceRentalReconciliationSection
              clients={clients}
              invoiceItemsByCompany={invoiceItemsByCompany}
              billingMonth={selectedMonth}
              reconciliationDoc={reconciliationDoc}
              userEmail={userEmail}
              onConfirmCompany={handleConfirmInsuranceRentalCompany}
              onUnconfirmCompany={handleUnconfirmInsuranceRentalCompany}
            />
          </div>
        )}

        {/* 販売 利用者別突合セクション（請求書アップロード済みの場合に表示） */}
        {uploadedInvoices.size > 0 && (
          <div className="mt-6">
            <SalesClientReconciliationSection
              clients={clients}
              invoiceItemsByCompany={invoiceItemsByCompany}
              billingMonth={selectedMonth}
              reconciliationDoc={reconciliationDoc}
              userEmail={userEmail}
              onConfirmCompany={handleConfirmSalesCompany}
              onUnconfirmCompany={handleUnconfirmSalesCompany}
            />
          </div>
        )}

        {/* 自費レンタル 利用者別突合セクション（請求書アップロード済みの場合に表示） */}
        {uploadedInvoices.size > 0 && (
          <div className="mt-6">
            <SelfPayRentalClientReconciliationSection
              clients={clients}
              invoiceItemsByCompany={invoiceItemsByCompany}
              billingMonth={selectedMonth}
              reconciliationDoc={reconciliationDoc}
              userEmail={userEmail}
              onConfirmCompany={handleConfirmSelfPayRentalCompany}
              onUnconfirmCompany={handleUnconfirmSelfPayRentalCompany}
            />
          </div>
        )}

        {/* 卸品目 未紐づけ一覧（請求書アップロード済みの場合に表示） */}
        {uploadedInvoices.size > 0 && (
          <div className="mt-6">
            <UnmatchedWholesalerItemsSection
              clients={clients}
              invoiceItemsByCompany={invoiceItemsByCompany}
              billingMonth={selectedMonth}
            />
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

      {/* Client Search Modal (inline link/edit) */}
      {clientSearchTarget && (
        <ClientSearchModal
          title={clientSearchTarget.mode === 'link' ? '利用者に紐づけ' : '紐づけ編集'}
          subtitle={`${clientSearchTarget.invoiceItem.customerName} / ${clientSearchTarget.invoiceItem.itemName} / ¥${clientSearchTarget.invoiceItem.amount.toLocaleString()}`}
          clients={clients}
          currentAozoraId={clientSearchTarget.mode === 'edit' ? clientSearchTarget.invoiceItem.matchedAozoraId : undefined}
          showUnlink={clientSearchTarget.mode === 'edit'}
          onSelect={async (aozoraId, clientName) => {
            const target = clientSearchTarget;
            setClientSearchTarget(null);
            await updateInvoiceItemMatch(target.invoiceItem, aozoraId, clientName, true);
          }}
          onUnlink={async () => {
            const target = clientSearchTarget;
            setClientSearchTarget(null);
            await updateInvoiceItemMatch(target.invoiceItem, null, null, false);
          }}
          onClose={() => setClientSearchTarget(null)}
        />
      )}

      {/* Invoice Item Picker Modal (sales_only → pick invoice) */}
      {invoicePickerTarget && reconciliationV2 && (
        <InvoiceItemPickerModal
          title="仕入データを選択"
          subtitle={`売上: ${invoicePickerTarget.salesClientName} (${invoicePickerTarget.salesAozoraId})`}
          invoiceOnlyResults={reconciliationV2.results.filter(r => r.matchStatus === 'invoice_only')}
          onSelect={async (invoiceItem) => {
            const target = invoicePickerTarget;
            setInvoicePickerTarget(null);
            await updateInvoiceItemMatch(invoiceItem, target.salesAozoraId, target.salesClientName, true);
          }}
          onClose={() => setInvoicePickerTarget(null)}
        />
      )}
    </div>
  );
};

export default ReconciliationPage;
