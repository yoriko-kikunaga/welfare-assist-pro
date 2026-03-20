import {
  Client,
  WholesaleCompany,
  WHOLESALE_COMPANY_NAMES,
  ParsedInvoice,
  InvoiceItem,
  InsuranceRentalSalesItem,
  ReconciliationResult,
  ReconciliationSummary,
  MatchStatus,
  SalesItem,
  ReconciliationResultV2,
  ReconciliationSummaryV2,
  MatchStatusV2,
  WholesalerSummary,
  OfficeLocation
} from '../types';

/**
 * Aggregate insurance rental sales from all clients for a given billing month
 */
export function aggregateInsuranceRentalSales(
  clients: Client[],
  billingMonth: string
): InsuranceRentalSalesItem[] {
  const results: InsuranceRentalSalesItem[] = [];

  // Parse billing month to get date range (avoid timezone issues with toISOString)
  const [year, month] = billingMonth.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate(); // Last day of month

  const monthStartStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEndStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  clients.forEach(client => {
    // Filter for insurance rentals active in the billing month
    const insuranceRentals = (client.selectedEquipment || []).filter(eq => {
      // Must be 介護保険レンタル
      if (eq.status !== '介護保険レンタル') return false;

      const startDate = eq.startDate;
      const endDate = eq.endDate;

      // Must have a start date
      if (!startDate) return false;

      // Start date must be before or during billing month
      if (startDate > monthEndStr) return false;

      // If has end date, must end after billing month starts
      if (endDate && endDate < monthStartStr) return false;

      return true;
    });

    if (insuranceRentals.length > 0) {
      results.push({
        clientId: client.id,
        aozoraId: client.aozoraId,
        clientName: client.name,
        clientNameKana: client.nameKana,
        facilityName: client.facilityName || '在宅',
        equipment: insuranceRentals.map(eq => ({
          id: eq.id,
          name: eq.name || '',
          manufacturer: eq.manufacturer || '',
          wholesaler: eq.wholesaler || '',
          category: eq.category || '',
          units: eq.units || '0',
          taisCode: eq.taisCode || '',
          startDate: eq.startDate || '',
          endDate: eq.endDate
        })),
        totalUnits: insuranceRentals.reduce(
          (sum, eq) => sum + parseInt(eq.units || '0', 10),
          0
        )
      });
    }
  });

  return results;
}

/**
 * Aggregate ALL sales (insurance rental + self-pay rental + sales) from all clients for a given billing month
 */
export function aggregateAllSales(
  clients: Client[],
  billingMonth: string,
  officeFilter?: OfficeLocation | '全事業所'
): SalesItem[] {
  const results: SalesItem[] = [];

  // Parse billing month to get date range (avoid timezone issues with toISOString)
  const [year, month] = billingMonth.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate(); // Last day of month

  const monthStartStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEndStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  clients.forEach(client => {
    // Filter by office if specified
    if (officeFilter && officeFilter !== '全事業所' && client.office !== officeFilter) {
      return;
    }

    (client.selectedEquipment || []).forEach(eq => {
      const status = eq.status;
      if (!status) return;

      let shouldInclude = false;
      let salesAmount = 0;

      if (status === '介護保険レンタル' || status === '自費レンタル') {
        // Rental: active in the billing month
        // If startDate is not set, treat as currently active
        const startDate = eq.startDate;
        const endDate = eq.endDate;

        // If startDate exists and is after billing month, exclude
        if (startDate && startDate > monthEndStr) return;
        // If endDate exists and is before billing month, exclude
        if (endDate && endDate < monthStartStr) return;

        shouldInclude = true;

        // Calculate sales amount
        if (status === '介護保険レンタル') {
          // Insurance rental: units * unit price or monthly cost
          const units = parseInt(eq.units || '0', 10);
          salesAmount = eq.monthlyCost || units * 10; // 1 unit = 10 yen (typical)
        } else {
          // Self-pay rental: unitPrice * quantity（月次売上処理と同じ計算）
          const unitPrice = eq.unitPrice || 0;
          const quantity = eq.quantity || 1;
          salesAmount = unitPrice * quantity;
        }
      } else if (status === '販売') {
        // Sales: delivery date is in the billing month
        const deliveryDate = eq.deliveryDate;
        if (!deliveryDate) return;
        if (deliveryDate < monthStartStr || deliveryDate > monthEndStr) return;

        shouldInclude = true;
        // Sales amount: 税抜き（unitPrice * quantity） + 送料（税抜き）
        // unitPriceは税抜き単価なので直接使用（taxIncludedAmountはフォームで更新されない場合がある）
        const unitPrice = eq.unitPrice || 0;
        const quantity = eq.quantity || 1;
        let taxExcluded: number;
        if (unitPrice > 0) {
          taxExcluded = unitPrice * quantity;
        } else {
          // unitPrice未設定の古いデータ: taxIncludedAmountから税抜き逆算
          const taxIncluded = eq.taxIncludedAmount || 0;
          if (eq.taxType === '10％') {
            taxExcluded = Math.round(taxIncluded / 1.1);
          } else if (eq.taxType === '軽8％') {
            taxExcluded = Math.round(taxIncluded / 1.08);
          } else {
            taxExcluded = taxIncluded;
          }
        }
        // 送料も税抜きに変換（880円→800円等、10%課税前提）
        const shippingCost = eq.shippingCost || 0;
        const shippingExcluded = shippingCost > 0 ? Math.round(shippingCost / 1.1) : 0;
        salesAmount = taxExcluded + shippingExcluded;
      }

      if (shouldInclude) {
        results.push({
          id: `${client.aozoraId}-${eq.id}`,
          aozoraId: client.aozoraId,
          clientName: client.name,
          clientNameKana: client.nameKana,
          facilityName: client.facilityName || '在宅',
          equipmentId: eq.id,
          equipmentName: eq.name || eq.selfPayProductName || '',
          category: eq.category || '',
          status: status,
          wholesaler: eq.wholesaler || '',
          taisCode: eq.taisCode || '',
          quantity: eq.quantity || parseInt(eq.units || '1', 10),
          unitPrice: eq.unitPrice || eq.monthlyCost || 0,
          salesAmount,
          startDate: eq.startDate || '',
          endDate: eq.endDate,
          deliveryDate: eq.deliveryDate,
          office: eq.office || client.office
        });
      }
    });
  });

  return results;
}

/**
 * Reconcile sales data with invoice data
 */
export function reconcileSalesWithInvoices(
  salesItems: InsuranceRentalSalesItem[],
  invoices: ParsedInvoice[],
  billingMonth: string
): ReconciliationSummary {
  const results: ReconciliationResult[] = [];
  const allInvoiceItems = invoices.flatMap(inv => inv.items);
  const matchedInvoiceIds = new Set<string>();

  // Match each sales item against invoice items
  salesItems.forEach(sales => {
    const matchResult = findMatchingInvoiceItems(sales, allInvoiceItems, matchedInvoiceIds);

    const matchStatus = determineMatchStatus(sales, matchResult);

    results.push({
      id: sales.clientId,
      matchStatus,
      salesData: sales,
      invoiceItems: matchResult.matchedItems,
      customerNameMatch: matchResult.nameMatched,
      itemMatches: matchResult.itemMatches,
      discrepancies: matchResult.discrepancies
    });

    // Mark invoice items as matched
    matchResult.matchedItems.forEach(item => matchedInvoiceIds.add(item.id));
  });

  // Add unmatched invoice items
  allInvoiceItems
    .filter(item => !matchedInvoiceIds.has(item.id))
    .forEach(item => {
      results.push({
        id: `unmatched-invoice-${item.id}`,
        matchStatus: 'unmatched_invoice',
        salesData: undefined,
        invoiceItems: [item],
        customerNameMatch: false,
        itemMatches: [],
        discrepancies: []
      });
    });

  // Calculate summary statistics
  const matchedCount = results.filter(r => r.matchStatus === 'matched').length;
  const partialMatchCount = results.filter(r => r.matchStatus === 'partial_match').length;
  const unmatchedSalesCount = results.filter(r => r.matchStatus === 'unmatched_sales').length;
  const unmatchedInvoiceCount = results.filter(r => r.matchStatus === 'unmatched_invoice').length;

  // Aggregate by wholesaler
  const byWholesaler = aggregateByWholesaler(invoices, results);

  return {
    billingMonth,
    processedAt: new Date().toISOString(),
    totalSalesItems: salesItems.length,
    totalInvoiceItems: allInvoiceItems.length,
    matchedCount,
    unmatchedSalesCount,
    unmatchedInvoiceCount,
    partialMatchCount,
    results,
    byWholesaler
  };
}

/**
 * Find matching invoice items for a sales record
 */
interface MatchResult {
  matchedItems: InvoiceItem[];
  nameMatched: boolean;
  itemMatches: { salesEquipmentId: string; invoiceItemId: string; matchConfidence: number }[];
  discrepancies: { field: string; salesValue: string | number; invoiceValue: string | number }[];
}

function findMatchingInvoiceItems(
  sales: InsuranceRentalSalesItem,
  invoiceItems: InvoiceItem[],
  alreadyMatched: Set<string>
): MatchResult {
  // Normalize names for comparison
  const salesNameNorm = normalizeJapaneseName(sales.clientName);
  const salesKanaNorm = normalizeJapaneseName(sales.clientNameKana);

  // Find invoice items with matching customer name
  const candidates = invoiceItems
    .filter(item => !alreadyMatched.has(item.id))
    .filter(item => {
      const invoiceNameNorm = item.customerNameNormalized || normalizeJapaneseName(item.customerName);
      return (
        invoiceNameNorm === salesNameNorm ||
        invoiceNameNorm === salesKanaNorm ||
        fuzzyNameMatch(invoiceNameNorm, salesNameNorm) > 0.7 ||
        fuzzyNameMatch(invoiceNameNorm, salesKanaNorm) > 0.7
      );
    });

  if (candidates.length === 0) {
    return {
      matchedItems: [],
      nameMatched: false,
      itemMatches: [],
      discrepancies: []
    };
  }

  // Match equipment items
  const itemMatches: { salesEquipmentId: string; invoiceItemId: string; matchConfidence: number }[] = [];
  const discrepancies: { field: string; salesValue: string | number; invoiceValue: string | number }[] = [];

  sales.equipment.forEach(eq => {
    const eqNameNorm = normalizeJapaneseName(eq.name);

    candidates.forEach(inv => {
      const invItemNorm = inv.itemNameNormalized || normalizeJapaneseName(inv.itemName);
      const confidence = fuzzyNameMatch(eqNameNorm, invItemNorm);

      if (confidence > 0.5) {
        itemMatches.push({
          salesEquipmentId: eq.id,
          invoiceItemId: inv.id,
          matchConfidence: confidence
        });
      }
    });
  });

  return {
    matchedItems: candidates,
    nameMatched: true,
    itemMatches,
    discrepancies
  };
}

/**
 * Determine match status based on match result
 */
function determineMatchStatus(
  sales: InsuranceRentalSalesItem,
  matchResult: MatchResult
): MatchStatus {
  if (!matchResult.nameMatched || matchResult.matchedItems.length === 0) {
    return 'unmatched_sales';
  }

  if (matchResult.itemMatches.length === 0) {
    return 'partial_match';
  }

  // Check if all equipment items have matches
  const matchedEquipmentIds = new Set(matchResult.itemMatches.map(m => m.salesEquipmentId));
  const allEquipmentMatched = sales.equipment.every(eq => matchedEquipmentIds.has(eq.id));

  if (allEquipmentMatched) {
    return 'matched';
  }

  return 'partial_match';
}

/**
 * Aggregate results by wholesaler
 */
function aggregateByWholesaler(
  invoices: ParsedInvoice[],
  results: ReconciliationResult[]
): { company: WholesaleCompany; invoiceTotal: number; matchedTotal: number; discrepancyAmount: number }[] {
  const companies: WholesaleCompany[] = ['CompanyA', 'CompanyB', 'CompanyC', 'CompanyD', 'CompanyE'];

  return companies.map(company => {
    const companyInvoices = invoices.filter(inv => inv.wholesaleCompany === company);
    const invoiceTotal = companyInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0);

    const matchedItems = results
      .filter(r => r.matchStatus === 'matched' || r.matchStatus === 'partial_match')
      .flatMap(r => r.invoiceItems)
      .filter(item => item.wholesaleCompany === company);

    const matchedTotal = matchedItems.reduce((sum, item) => sum + item.amount, 0);

    return {
      company,
      invoiceTotal,
      matchedTotal,
      discrepancyAmount: invoiceTotal - matchedTotal
    };
  }).filter(item => item.invoiceTotal > 0);
}

/**
 * Normalize Japanese name for matching
 */
export function normalizeJapaneseName(name: string): string {
  if (!name) return '';
  return name
    .replace(/\s+/g, '')       // Remove ASCII spaces
    .replace(/　/g, '')         // Remove full-width spaces
    .replace(/[ー−―‐]/g, '')   // Remove various dashes
    .normalize('NFKC')          // Normalize Unicode
    .toLowerCase();
}

/**
 * Fuzzy name matching using Levenshtein distance
 */
function fuzzyNameMatch(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  // Simple containment check
  if (a.includes(b) || b.includes(a)) {
    return 0.9;
  }

  // Levenshtein distance
  const matrix: number[][] = [];

  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  const distance = matrix[a.length][b.length];
  const maxLength = Math.max(a.length, b.length);

  return 1 - distance / maxLength;
}

/**
 * Generate CSV content for reconciliation results
 */
export function generateReconciliationCSV(summary: ReconciliationSummary): string {
  const headers = [
    'ステータス',
    'あおぞらID',
    '利用者名',
    '施設名',
    '商品名',
    '商品区分',
    '卸会社',
    '単位数',
    '請求額',
    '備考'
  ];

  const rows: string[][] = [];

  summary.results.forEach(result => {
    const salesData = result.salesData;

    if (salesData) {
      // Output one row per equipment item
      salesData.equipment.forEach((eq, index) => {
        const invoiceItem = result.invoiceItems[index];
        const statusLabel = getStatusLabel(result.matchStatus);

        rows.push([
          statusLabel,
          salesData.aozoraId,
          salesData.clientName,
          salesData.facilityName,
          eq.name,
          eq.category,
          eq.wholesaler,
          eq.units,
          invoiceItem ? String(invoiceItem.amount) : '',
          result.discrepancies.map(d => `${d.field}: ${d.salesValue}≠${d.invoiceValue}`).join('; ')
        ]);
      });
    } else {
      // Unmatched invoice items
      result.invoiceItems.forEach(item => {
        rows.push([
          '請求のみ',
          '',
          item.customerName,
          '',
          item.itemName,
          '',
          WHOLESALE_COMPANY_NAMES[item.wholesaleCompany],
          '',
          String(item.amount),
          ''
        ]);
      });
    }
  });

  // Build CSV
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(escapeCSV).join(','))
  ].join('\n');

  return csvContent;
}

/**
 * Get status label for display
 */
function getStatusLabel(status: MatchStatus): string {
  switch (status) {
    case 'matched': return '一致';
    case 'partial_match': return '部分一致';
    case 'unmatched_sales': return '売上のみ';
    case 'unmatched_invoice': return '請求のみ';
    default: return '不明';
  }
}

/**
 * Escape CSV field value
 */
function escapeCSV(value: string): string {
  if (!value) return '';
  // If contains comma, newline, or double quote, wrap in quotes
  if (value.includes(',') || value.includes('\n') || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Download CSV file
 */
export function downloadCSV(csvContent: string, filename: string): void {
  // Add BOM for Excel compatibility
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

// ===== V2 Functions for Sales-Purchase Reconciliation =====

/**
 * Map wholesaler name from Equipment to WholesaleCompany type
 */
export function mapWholesalerToCompany(wholesalerName: string): WholesaleCompany {
  if (!wholesalerName) return 'Other';

  const normalized = wholesalerName.toLowerCase();

  if (normalized.includes('日建') || normalized.includes('nikken')) return 'Nikken';
  if (normalized.includes('ニシケン') || normalized.includes('nishiken')) return 'Nishiken';
  if (normalized.includes('日本ケアサプライ') || normalized.includes('ケアサプライ')) return 'NihonCaresupply';
  if (normalized.includes('パラマウント') || normalized.includes('paramount')) return 'ParamountCare';
  if (normalized.includes('野口')) return 'Noguchi';
  if (normalized.includes('キシヤ') || normalized.includes('kishiya')) return 'Kishiya';

  return 'Other';
}

/**
 * Reconcile ALL sales data with invoice data (V2 with gross profit calculation)
 */
export function reconcileSalesWithInvoicesV2(
  salesItems: SalesItem[],
  invoices: ParsedInvoice[],
  billingMonth: string
): ReconciliationSummaryV2 {
  const results: ReconciliationResultV2[] = [];
  const allInvoiceItems = invoices.flatMap(inv => inv.items);
  const matchedInvoiceIds = new Set<string>();
  const matchedSalesIds = new Set<string>();

  // Helper: Extract last name (first part of Japanese name)
  const getLastName = (name: string): string => {
    const normalized = normalizeJapaneseName(name);
    // Japanese names: 姓 名 or 姓名 (family name first)
    const parts = normalized.split(/\s+/);
    return parts[0] || normalized;
  };

  // Match each sales item against invoice items
  salesItems.forEach(sales => {
    const salesNameNorm = normalizeJapaneseName(sales.clientName);
    const salesKanaNorm = normalizeJapaneseName(sales.clientNameKana);
    const salesLastName = getLastName(sales.clientName);
    const salesLastNameKana = getLastName(sales.clientNameKana);
    const salesEquipmentNorm = normalizeJapaneseName(sales.equipmentName);
    const salesTaisCode = sales.taisCode;
    const salesWholesaler = sales.wholesaler;

    let bestMatch: { item: InvoiceItem; confidence: number } | null = null;

    // Priority 0: aozoraID exact match (from OCR name matching)
    const aozoraIdMatches = allInvoiceItems
      .filter(item => !matchedInvoiceIds.has(item.id) && item.matchedAozoraId === sales.aozoraId);

    if (aozoraIdMatches.length > 0) {
      // If multiple invoice items match the same aozoraId, pick the best by item name similarity
      if (aozoraIdMatches.length === 1) {
        bestMatch = { item: aozoraIdMatches[0], confidence: 0.98 };
      } else {
        // Multiple items for same client - try to match by equipment name
        let bestItemMatch: { item: InvoiceItem; score: number } | null = null;
        for (const item of aozoraIdMatches) {
          const invoiceItemNorm = item.itemNameNormalized || normalizeJapaneseName(item.itemName);
          const itemScore = fuzzyNameMatch(invoiceItemNorm, salesEquipmentNorm);
          if (!bestItemMatch || itemScore > bestItemMatch.score) {
            bestItemMatch = { item, score: itemScore };
          }
        }
        if (bestItemMatch) {
          bestMatch = { item: bestItemMatch.item, confidence: 0.98 };
        }
      }
    }

    // Fallback to fuzzy matching if no aozoraID match
    if (!bestMatch) {
    // Find matching invoice items
    allInvoiceItems
      .filter(item => !matchedInvoiceIds.has(item.id))
      .forEach(item => {
        const invoiceNameNorm = item.customerNameNormalized || normalizeJapaneseName(item.customerName);
        const invoiceLastName = getLastName(item.customerName);
        const invoiceItemNorm = item.itemNameNormalized || normalizeJapaneseName(item.itemName);

        // Priority 1: Tais code exact match (if available)
        if (salesTaisCode && item.rawText?.includes(salesTaisCode)) {
          const nameScore = fuzzyNameMatch(invoiceNameNorm, salesNameNorm);
          if (nameScore > 0.3) {
            const confidence = 0.95; // High confidence for code match
            if (!bestMatch || confidence > bestMatch.confidence) {
              bestMatch = { item, confidence };
            }
          }
          return;
        }

        // Calculate name scores (multiple strategies)
        const fullNameScore = Math.max(
          fuzzyNameMatch(invoiceNameNorm, salesNameNorm),
          fuzzyNameMatch(invoiceNameNorm, salesKanaNorm)
        );

        // Last name only match (common in invoice data)
        const lastNameScore = Math.max(
          fuzzyNameMatch(invoiceLastName, salesLastName),
          fuzzyNameMatch(invoiceLastName, salesLastNameKana),
          fuzzyNameMatch(invoiceNameNorm, salesLastName), // Invoice might just have last name
          fuzzyNameMatch(invoiceNameNorm, salesLastNameKana)
        );

        // Use the best name score
        const nameScore = Math.max(fullNameScore, lastNameScore * 0.95);

        // Priority 2: High confidence name + item match
        if (nameScore > 0.6) {
          const itemScore = fuzzyNameMatch(invoiceItemNorm, salesEquipmentNorm);
          if (itemScore > 0.3) {
            const confidence = (nameScore * 0.5) + (itemScore * 0.5);
            if (!bestMatch || confidence > bestMatch.confidence) {
              bestMatch = { item, confidence };
            }
            return;
          }
        }

        // Priority 3: Very high name match only (name score > 0.85)
        if (nameScore > 0.85) {
          const confidence = nameScore * 0.9;
          if (!bestMatch || confidence > bestMatch.confidence) {
            bestMatch = { item, confidence };
          }
          return;
        }

        // Priority 4: Good name match with partial item match
        if (nameScore > 0.5) {
          const itemScore = fuzzyNameMatch(invoiceItemNorm, salesEquipmentNorm);
          // Check if any word in equipment name matches
          const equipmentWords = salesEquipmentNorm.split(/[\s　]+/).filter(w => w.length >= 2);
          const hasWordMatch = equipmentWords.some(word => invoiceItemNorm.includes(word));

          if (itemScore > 0.2 || hasWordMatch) {
            const confidence = (nameScore * 0.6) + (Math.max(itemScore, hasWordMatch ? 0.4 : 0) * 0.4);
            if (confidence > 0.45 && (!bestMatch || confidence > bestMatch.confidence)) {
              bestMatch = { item, confidence };
            }
          }
        }
      });
    } // end fallback fuzzy matching

    if (bestMatch && bestMatch.confidence > 0.45) {
      // Matched
      const purchaseAmount = bestMatch.item.amount;
      const salesAmount = sales.salesAmount;
      const grossProfit = salesAmount - purchaseAmount;
      const grossProfitRate = salesAmount > 0 ? (grossProfit / salesAmount) * 100 : 0;

      results.push({
        id: `matched-${sales.id}`,
        matchStatus: 'matched',
        salesItem: sales,
        invoiceItem: bestMatch.item,
        matchConfidence: bestMatch.confidence,
        salesAmount,
        purchaseAmount,
        grossProfit,
        grossProfitRate
      });

      matchedInvoiceIds.add(bestMatch.item.id);
      matchedSalesIds.add(sales.id);
    }
  });

  // Post-matching: 1:N matching for accessories (サイドレール等の附属品)
  // Invoice items with matchedAozoraId that weren't consumed in 1:1 matching
  // but belong to a client who HAS a matched sales item → treat as matched (accessory)
  const matchedAozoraIds = new Set<string>();
  results.filter(r => r.matchStatus === 'matched' && r.salesItem).forEach(r => {
    matchedAozoraIds.add(r.salesItem!.aozoraId);
  });

  allInvoiceItems
    .filter(item => !matchedInvoiceIds.has(item.id) && item.matchedAozoraId && matchedAozoraIds.has(item.matchedAozoraId))
    .forEach(item => {
      // Find the primary matched sales item for this client
      const primaryResult = results.find(
        r => r.matchStatus === 'matched' && r.salesItem?.aozoraId === item.matchedAozoraId
      );
      if (primaryResult && primaryResult.salesItem) {
        results.push({
          id: `matched-acc-${item.id}`,
          matchStatus: 'matched',
          salesItem: primaryResult.salesItem,
          invoiceItem: item,
          matchConfidence: 0.95,
          salesAmount: 0,  // Don't double-count sales
          purchaseAmount: item.amount,
          grossProfit: -item.amount,
          grossProfitRate: 0
        });
        matchedInvoiceIds.add(item.id);
      }
    });

  // Add unmatched sales items
  salesItems
    .filter(sales => !matchedSalesIds.has(sales.id))
    .forEach(sales => {
      results.push({
        id: `sales-only-${sales.id}`,
        matchStatus: 'sales_only',
        salesItem: sales,
        salesAmount: sales.salesAmount
      });
    });

  // Add unmatched invoice items (including zero-amount invoices like Kishiya)
  allInvoiceItems
    .filter(item => !matchedInvoiceIds.has(item.id))
    .forEach(item => {
      results.push({
        id: `invoice-only-${item.id}`,
        matchStatus: 'invoice_only',
        invoiceItem: item,
        purchaseAmount: item.amount
      });
    });

  // Calculate summary statistics
  const matchedCount = results.filter(r => r.matchStatus === 'matched').length;
  const salesOnlyCount = results.filter(r => r.matchStatus === 'sales_only').length;
  const invoiceOnlyCount = results.filter(r => r.matchStatus === 'invoice_only').length;

  const totalSalesAmount = results
    .filter(r => r.salesItem)
    .reduce((sum, r) => sum + (r.salesAmount || 0), 0);

  const totalPurchaseAmount = results
    .filter(r => r.invoiceItem)
    .reduce((sum, r) => sum + (r.purchaseAmount || 0), 0);

  const totalGrossProfit = results
    .filter(r => r.matchStatus === 'matched')
    .reduce((sum, r) => sum + (r.grossProfit || 0), 0);

  const grossProfitRate = totalSalesAmount > 0 ? (totalGrossProfit / totalSalesAmount) * 100 : 0;

  // Aggregate by wholesaler
  const byWholesaler = aggregateByWholesalerV2(salesItems, allInvoiceItems, results);

  return {
    billingMonth,
    processedAt: new Date().toISOString(),
    totalSalesCount: salesItems.length,
    totalInvoiceCount: allInvoiceItems.length,
    matchedCount,
    salesOnlyCount,
    invoiceOnlyCount,
    totalSalesAmount,
    totalPurchaseAmount,
    totalGrossProfit,
    grossProfitRate,
    results,
    byWholesaler
  };
}

/**
 * Aggregate results by wholesaler (V2)
 */
function aggregateByWholesalerV2(
  salesItems: SalesItem[],
  invoiceItems: InvoiceItem[],
  results: ReconciliationResultV2[]
): WholesalerSummary[] {
  const companies: WholesaleCompany[] = ['Nikken', 'Nishiken', 'NihonCaresupply', 'ParamountCare', 'Noguchi', 'Kishiya', 'Other'];

  return companies.map(company => {
    // Sales by this wholesaler
    const companySales = salesItems.filter(s => mapWholesalerToCompany(s.wholesaler) === company);
    const salesAmount = companySales.reduce((sum, s) => sum + s.salesAmount, 0);

    // Invoices from this wholesaler
    const companyInvoices = invoiceItems.filter(i => i.wholesaleCompany === company);
    const purchaseAmount = companyInvoices.reduce((sum, i) => sum + i.amount, 0);

    // Matched items for this wholesaler
    const matchedResults = results.filter(
      r => r.matchStatus === 'matched' &&
           r.invoiceItem?.wholesaleCompany === company
    );
    const matchedCount = matchedResults.length;

    const grossProfit = salesAmount - purchaseAmount;
    const grossProfitRate = salesAmount > 0 ? (grossProfit / salesAmount) * 100 : 0;

    return {
      company,
      companyName: WHOLESALE_COMPANY_NAMES[company],
      salesCount: companySales.length,
      invoiceCount: companyInvoices.length,
      matchedCount,
      salesAmount,
      purchaseAmount,
      grossProfit,
      grossProfitRate
    };
  }).filter(item => item.salesCount > 0 || item.invoiceCount > 0);
}

/**
 * Generate CSV content for reconciliation results (V2)
 */
export function generateReconciliationCSVV2(summary: ReconciliationSummaryV2): string {
  const sections: string[] = [];

  // Unified header for all sections
  const unifiedHeaders = [
    'あおぞらID',
    '利用者名',
    '商品名',
    '種別',
    '売上金額',
    '仕入金額',
    '粗利',
    '粗利率',
    '卸会社'
  ];

  // === Section 1: Matched ===
  const matchedRows = summary.results
    .filter(r => r.matchStatus === 'matched')
    .map(r => [
      r.salesItem?.aozoraId || '',
      r.salesItem?.clientName || '',
      r.salesItem?.equipmentName || '',
      r.salesItem?.status || '',
      String(r.salesAmount || 0),
      String(r.purchaseAmount || 0),
      String(r.grossProfit || 0),
      `${(r.grossProfitRate || 0).toFixed(1)}%`,
      r.salesItem?.wholesaler || WHOLESALE_COMPANY_NAMES[r.invoiceItem?.wholesaleCompany || 'Other']
    ]);

  sections.push('=== 突合済み ===');
  sections.push(unifiedHeaders.join(','));
  sections.push(...matchedRows.map(row => row.map(escapeCSV).join(',')));

  // === Section 2: Sales Only ===
  const salesOnlyRows = summary.results
    .filter(r => r.matchStatus === 'sales_only')
    .map(r => [
      r.salesItem?.aozoraId || '',
      r.salesItem?.clientName || '',
      r.salesItem?.equipmentName || '',
      r.salesItem?.status || '',
      String(r.salesAmount || 0),
      '',
      '',
      '',
      r.salesItem?.wholesaler || ''
    ]);

  sections.push('');
  sections.push('=== 売上のみ ===');
  sections.push(unifiedHeaders.join(','));
  sections.push(...salesOnlyRows.map(row => row.map(escapeCSV).join(',')));

  // === Section 3: Invoice Only ===
  const invoiceOnlyRows = summary.results
    .filter(r => r.matchStatus === 'invoice_only')
    .map(r => [
      r.invoiceItem?.matchedAozoraId || '',
      r.invoiceItem?.customerName || '',
      r.invoiceItem?.itemName || '',
      '',
      '',
      String(r.purchaseAmount || 0),
      '',
      '',
      WHOLESALE_COMPANY_NAMES[r.invoiceItem?.wholesaleCompany || 'Other']
    ]);

  sections.push('');
  sections.push('=== 仕入のみ ===');
  sections.push(unifiedHeaders.join(','));
  sections.push(...invoiceOnlyRows.map(row => row.map(escapeCSV).join(',')));

  // === Section 4: Summary ===
  sections.push('');
  sections.push('=== サマリー ===');
  sections.push('項目,金額');
  sections.push(`売上合計,${summary.totalSalesAmount}`);
  sections.push(`仕入合計,${summary.totalPurchaseAmount}`);
  sections.push(`粗利合計,${summary.totalGrossProfit}`);
  sections.push(`粗利率,${summary.grossProfitRate.toFixed(1)}%`);

  return sections.join('\n');
}

/**
 * Get status label for V2 display
 */
export function getStatusLabelV2(status: MatchStatusV2): string {
  switch (status) {
    case 'matched': return '突合済み';
    case 'sales_only': return '売上のみ';
    case 'invoice_only': return '仕入のみ';
    default: return '不明';
  }
}

/**
 * Parse reconciliation CSV (output from generateReconciliationCSVV2) to extract invoice items per wholesaler.
 * Extracts items from "突合済み" (with 仕入金額) and "仕入のみ" sections.
 */
export function parseReconciliationCSV(csvText: string): Map<WholesaleCompany, InvoiceItem[]> {
  const result = new Map<WholesaleCompany, InvoiceItem[]>();

  // Split into sections by === markers
  const sections = csvText.split(/^(=== .+ ===)$/m);

  let currentSection = '';
  for (const part of sections) {
    const sectionMatch = part.match(/^=== (.+) ===$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }

    if (currentSection !== '突合済み' && currentSection !== '仕入のみ') {
      continue;
    }

    const lines = part.split('\n').filter(line => line.trim() !== '');
    if (lines.length < 2) continue; // Need header + at least 1 data line

    const headerLine = lines[0];
    const headers = parseCSVLine(headerLine);

    // Unified header: あおぞらID, 利用者名, 商品名, 種別, 売上金額, 仕入金額, 粗利, 粗利率, 卸会社
    const aozoraIdIdx = headers.indexOf('あおぞらID');
    const nameIdx = headers.indexOf('利用者名');
    const itemIdx = headers.indexOf('商品名');
    const purchaseIdx = headers.indexOf('仕入金額');
    const wholesalerIdx = headers.indexOf('卸会社');

    if (nameIdx < 0 || purchaseIdx < 0 || wholesalerIdx < 0) continue;

    const idPrefix = currentSection === '突合済み' ? 'csv-recon' : 'csv-recon-inv';

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      const purchaseStr = cols[purchaseIdx]?.trim();
      const wholesalerName = cols[wholesalerIdx]?.trim();

      if (!purchaseStr || !wholesalerName) continue;
      const amount = parseInt(purchaseStr, 10);
      if (isNaN(amount)) continue;

      const company = mapWholesalerToCompany(wholesalerName);
      const customerName = cols[nameIdx]?.trim() || '';
      const itemName = itemIdx >= 0 ? (cols[itemIdx]?.trim() || '') : '';
      const aozoraId = aozoraIdIdx >= 0 ? (cols[aozoraIdIdx]?.trim() || '') : '';

      const item: InvoiceItem = {
        id: `${idPrefix}-${company}-${i}`,
        wholesaleCompany: company,
        customerName,
        customerNameNormalized: normalizeJapaneseName(customerName),
        itemName,
        itemNameNormalized: normalizeJapaneseName(itemName),
        quantity: 1,
        unitPrice: amount,
        amount,
        // Set matchedAozoraId from CSV if present
        ...(aozoraId ? { matchedAozoraId: aozoraId } : {}),
      };

      if (!result.has(company)) {
        result.set(company, []);
      }
      result.get(company)!.push(item);
    }
  }

  return result;
}

/**
 * Parse a single CSV line handling quoted fields with commas
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}
