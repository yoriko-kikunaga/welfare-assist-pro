import {
  Client,
  WholesaleCompany,
  WHOLESALE_COMPANY_NAMES,
  ParsedInvoice,
  InvoiceItem,
  InsuranceRentalSalesItem,
  ReconciliationResult,
  ReconciliationSummary,
  MatchStatus
} from '../types';

/**
 * Aggregate insurance rental sales from all clients for a given billing month
 */
export function aggregateInsuranceRentalSales(
  clients: Client[],
  billingMonth: string
): InsuranceRentalSalesItem[] {
  const results: InsuranceRentalSalesItem[] = [];

  // Parse billing month to get date range
  const [year, month] = billingMonth.split('-').map(Number);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0); // Last day of month

  const monthStartStr = monthStart.toISOString().split('T')[0];
  const monthEndStr = monthEnd.toISOString().split('T')[0];

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
function normalizeJapaneseName(name: string): string {
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
