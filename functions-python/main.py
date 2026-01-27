
フォルダのハイライト
請求書解析のための TypeScript/Python コード群で、特に Nikken 向けPDF処理のV3 (pdfplumber) が中心機能である。

"""
Cloud Functions for PDF Invoice Parsing
Using pdfplumber for accurate table extraction from machine-generated PDFs.
Optimized for Nikken Lease invoice format (21-column table structure).
Falls back to Gemini OCR for scanned PDFs.
"""

import base64
import io
import json
import re
from typing import Any
from firebase_functions import https_fn, options
from firebase_admin import initialize_app
import pdfplumber

# Initialize Firebase Admin
initialize_app()

# Set function options
FUNCTION_OPTIONS = options.MemoryOption.GB_1
FUNCTION_TIMEOUT = 300  # 5 minutes
FUNCTION_REGION = "asia-northeast1"


def is_machine_generated_pdf(pdf_bytes: bytes) -> tuple[bool, int]:
    """
    Check if PDF is machine-generated (has selectable text) or scanned.
    Returns (is_machine_generated, page_count)
    """
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            page_count = len(pdf.pages)

            # Check first few pages for text content
            text_chars = 0
            pages_to_check = min(3, page_count)

            for i in range(pages_to_check):
                page = pdf.pages[i]
                text = page.extract_text() or ""
                # Count meaningful characters (excluding whitespace)
                meaningful = re.sub(r'\s+', '', text)
                text_chars += len(meaningful)

            # If average > 100 meaningful chars per page, it's machine-generated
            avg_chars = text_chars / pages_to_check if pages_to_check > 0 else 0
            is_machine = avg_chars > 100

            print(f"[V3] PDF analysis: {page_count} pages, {avg_chars:.0f} avg chars/page, machine_generated={is_machine}")
            return is_machine, page_count

    except Exception as e:
        print(f"[V3] PDF analysis error: {e}")
        return False, 0


def parse_amount(value: Any) -> int:
    """Parse amount string to integer, handling various formats."""
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)

    # Convert to string and clean
    s = str(value).strip()

    # Remove currency symbols, commas, spaces
    s = re.sub(r'[¥￥,、\s]', '', s)

    # Handle negative values in parentheses
    if s.startswith('(') and s.endswith(')'):
        s = '-' + s[1:-1]

    # Handle trailing minus
    if s.endswith('-'):
        s = '-' + s[:-1]

    try:
        return int(float(s))
    except (ValueError, TypeError):
        return 0


def merge_number_cells(cells: list, start_idx: int, count: int) -> int:
    """
    Merge comma-separated number cells.
    Example: ['3', '400'] -> 3400

    This handles Nikken Lease's format where large numbers are split across multiple cells.
    """
    parts = []
    for i in range(count):
        idx = start_idx + i
        if idx < len(cells) and cells[idx]:
            val = str(cells[idx]).strip()
            if val:
                parts.append(val)
    if not parts:
        return 0
    try:
        return int(''.join(parts).replace(',', ''))
    except ValueError:
        return 0


def parse_row_nikken(row: list) -> dict | None:
    """
    Parse a row from Nikken Lease invoice format.

    Table structure (21 columns):
    0: Customer name / Product name
    1: Customer No / Product code
    2: Category (科目)
    3: Tax rate (税)
    4-5: Quantity (2 cells)
    6-9: Unit price (4 cells)
    10: Period
    11-14: Billing amount (4 cells)
    15: Note (備考)
    16: Target month (対象月)
    17: First half (前半)
    18: Second half (後半)
    19: Delivery date (納品日)
    20: Billing start date (請求開始日)
    """
    if not row or len(row) < 21:
        return None

    col0 = str(row[0] or '').strip()
    col1 = str(row[1] or '').strip()
    col2 = str(row[2] or '').strip()

    # Skip header rows
    if '御' in col0 and '利' in col0 and '用' in col0:
        return {'type': 'header'}
    if '商' in col0 and '品' in col0 and '名' in col0:
        return {'type': 'header'}

    # Subtotal row identification
    if col2 == '非課税計':
        return {
            'type': 'subtotal_non_taxable',
            'amount': merge_number_cells(row, 11, 4)
        }
    if col2 == '１０％課税計' or col2 == '10%課税計':
        return {
            'type': 'subtotal_taxable_10',
            'amount': merge_number_cells(row, 11, 4)
        }
    if col2 == '１０％消費税' or col2 == '10%消費税':
        return {
            'type': 'tax_10',
            'amount': merge_number_cells(row, 11, 4)
        }
    if col2 == '御利用者様計':
        return {
            'type': 'customer_total',
            'amount': merge_number_cells(row, 11, 4)
        }

    # Customer header row (has 5-digit customer number)
    if col1 and re.match(r'^\d{5}$', col1):
        return {
            'type': 'customer_header',
            'customer_name': col0.replace(' 様', '様'),
            'customer_no': col1
        }

    # Facility name row (col0 has value, col1 and col2 are empty)
    if col0 and not col1 and not col2:
        return {
            'type': 'facility_name',
            'name': col0
        }

    # Item rows (category is 賃貸料, 販売, etc.)
    if col2 in ['賃貸料', '販売', '配送料', '引取料', '設置料', '撤去料']:
        tax_rate = str(row[3] or '0').strip()
        quantity = merge_number_cells(row, 4, 2)
        if quantity == 0:
            quantity = 1  # Default
        unit_price = merge_number_cells(row, 6, 4)

        period_str = str(row[10] or '1.0').strip()
        try:
            period = float(period_str)
        except ValueError:
            period = 1.0

        amount = merge_number_cells(row, 11, 4)

        return {
            'type': 'item',
            'product_name': col0,
            'product_code': col1,
            'category': col2,
            'tax_rate': tax_rate,
            'quantity': quantity,
            'unit_price': unit_price,
            'period': period,
            'amount': amount,
            'note': str(row[15] or '').strip(),
            'target_month': str(row[16] or '').strip(),
            'first_half': str(row[17] or '').strip(),
            'second_half': str(row[18] or '').strip(),
            'delivery_date': str(row[19] or '').strip(),
            'billing_start_date': str(row[20] or '').strip()
        }

    return None


def detect_invoice_format(pdf_bytes: bytes) -> str:
    """
    Detect the invoice format based on table structure.
    Returns: 'nikken' for Nikken Lease format (21 columns), 'generic' otherwise.
    """
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            if not pdf.pages:
                return 'generic'

            # Check first page tables
            tables = pdf.pages[0].extract_tables()
            if not tables:
                return 'generic'

            for table in tables:
                if table and len(table) > 0:
                    # Check if any row has ~21 columns (Nikken format)
                    for row in table[:5]:  # Check first 5 rows
                        if row and len(row) >= 20:
                            print(f"[V3] Detected Nikken format: {len(row)} columns")
                            return 'nikken'

            return 'generic'
    except Exception as e:
        print(f"[V3] Format detection error: {e}")
        return 'generic'


def extract_nikken_invoice(pdf_bytes: bytes) -> list[dict]:
    """
    Extract customer invoice data from Nikken Lease PDF format.
    Uses the 21-column table structure for accurate parsing.
    """
    customers = []
    current_customer = None

    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            print(f"[V3] Processing {len(pdf.pages)} pages (Nikken format)")

            for page_num, page in enumerate(pdf.pages):
                tables = page.extract_tables()

                for table in tables:
                    for row in table:
                        parsed = parse_row_nikken(row)
                        if not parsed:
                            continue

                        row_type = parsed.get('type')

                        if row_type == 'header':
                            continue

                        if row_type == 'customer_header':
                            # Save previous customer
                            if current_customer:
                                customers.append(current_customer)

                            current_customer = {
                                'customer_name': parsed['customer_name'],
                                'customer_no': parsed['customer_no'],
                                'facility_name': '',
                                'items': [],
                                'non_taxable_total': 0,
                                'taxable_total_10': 0,
                                'tax_10': 0,
                                'customer_total': 0
                            }

                        elif row_type == 'facility_name' and current_customer:
                            if not current_customer['facility_name']:
                                current_customer['facility_name'] = parsed['name']

                        elif row_type == 'item' and current_customer:
                            current_customer['items'].append(parsed)

                        elif row_type == 'subtotal_non_taxable' and current_customer:
                            current_customer['non_taxable_total'] = parsed['amount']

                        elif row_type == 'subtotal_taxable_10' and current_customer:
                            current_customer['taxable_total_10'] = parsed['amount']

                        elif row_type == 'tax_10' and current_customer:
                            current_customer['tax_10'] = parsed['amount']

                        elif row_type == 'customer_total' and current_customer:
                            current_customer['customer_total'] = parsed['amount']

            # Save last customer
            if current_customer:
                customers.append(current_customer)

    except Exception as e:
        print(f"[V3] Nikken extraction error: {e}")
        import traceback
        traceback.print_exc()

    return customers


def extract_generic_invoice(pdf_bytes: bytes) -> list[dict]:
    """
    Extract customer invoice data from generic PDF format.
    Uses pattern matching for flexible parsing.
    """
    customers = []
    current_customer = None

    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            print(f"[V3] Processing {len(pdf.pages)} pages (generic format)")

            for page_num, page in enumerate(pdf.pages):
                tables = page.extract_tables()

                if not tables:
                    continue

                for table in tables:
                    if not table:
                        continue

                    for row in table:
                        if not row or all(cell is None or str(cell).strip() == '' for cell in row):
                            continue

                        # Clean row data
                        row = [str(cell).strip() if cell else '' for cell in row]
                        row_text = ' '.join(row)

                        # Skip header rows
                        if any(header in row_text for header in ['科目', '品番', '単価', '期間', '金額', 'ご請求']):
                            continue

                        # Detect customer header row
                        customer_match = re.search(r'(\d{5,8})\s*様', row_text)
                        if not customer_match and '様' in row_text:
                            name_match = re.search(r'([^\d\s]{2,20})\s*様', row_text)
                            if name_match:
                                if current_customer and current_customer.get('items'):
                                    customers.append(current_customer)

                                current_customer = {
                                    'customer_name': name_match.group(1).strip(),
                                    'customer_no': '',
                                    'facility_name': '',
                                    'items': [],
                                    'non_taxable_total': 0,
                                    'taxable_total_10': 0,
                                    'tax_10': 0,
                                    'customer_total': 0
                                }
                                continue

                        if customer_match:
                            if current_customer and current_customer.get('items'):
                                customers.append(current_customer)

                            name_part = row_text[:customer_match.start()].strip()
                            if not name_part:
                                for cell in row:
                                    if cell and '様' not in cell and not cell.isdigit():
                                        name_part = cell
                                        break

                            current_customer = {
                                'customer_name': name_part or customer_match.group(0).replace('様', '').strip(),
                                'customer_no': customer_match.group(1),
                                'facility_name': '',
                                'items': [],
                                'non_taxable_total': 0,
                                'taxable_total_10': 0,
                                'tax_10': 0,
                                'customer_total': 0
                            }
                            continue

                        # Detect subtotal rows
                        if current_customer:
                            if '非課税計' in row_text:
                                current_customer['non_taxable_total'] = find_amount_in_row(row)
                                continue
                            elif '課税計' in row_text and '非' not in row_text:
                                current_customer['taxable_total_10'] = find_amount_in_row(row)
                                continue
                            elif '消費税' in row_text:
                                current_customer['tax_10'] = find_amount_in_row(row)
                                continue
                            elif '御利用者様計' in row_text or 'ご利用者様計' in row_text or '利用者計' in row_text:
                                current_customer['customer_total'] = find_amount_in_row(row)
                                continue

                        # Detect item rows
                        if current_customer and len(row) >= 3:
                            is_item_row = any(cat in row_text for cat in ['賃貸料', '販売', 'レンタル', '購入'])

                            if not is_item_row:
                                numeric_count = sum(1 for cell in row if cell and re.match(r'^[\d,]+$', cell.replace(',', '').strip()))
                                is_item_row = numeric_count >= 2

                            if is_item_row:
                                item = extract_item_from_row(row)
                                if item and item.get('amount', 0) != 0:
                                    current_customer['items'].append(item)

            if current_customer and current_customer.get('items'):
                customers.append(current_customer)

    except Exception as e:
        print(f"[V3] Generic extraction error: {e}")
        import traceback
        traceback.print_exc()

    return customers


def find_amount_in_row(row: list[str]) -> int:
    """Find the largest amount value in a row (likely the total)."""
    amounts = []
    for cell in row:
        amount = parse_amount(cell)
        if amount != 0:
            amounts.append(abs(amount))

    return max(amounts) if amounts else 0


def extract_item_from_row(row: list[str]) -> dict | None:
    """Extract item details from a generic table row."""
    try:
        cells = [c for c in row if c and c.strip()]

        if len(cells) < 2:
            return None

        amount_indices = []
        for i, cell in enumerate(cells):
            cleaned = cell.replace(',', '').replace('¥', '').replace('￥', '').strip()
            if cleaned.isdigit() or (cleaned.startswith('-') and cleaned[1:].isdigit()):
                amount_indices.append(i)

        if not amount_indices:
            return None

        amount_idx = amount_indices[-1]
        amount = parse_amount(cells[amount_idx])

        product_name = ''
        category = ''

        for i, cell in enumerate(cells):
            if i in amount_indices:
                continue
            if any(cat in cell for cat in ['賃貸料', '販売', 'レンタル', '購入', '非課税', '課税']):
                category = cell
            elif not product_name and len(cell) > 1:
                product_name = cell

        if not product_name:
            return None

        quantity = 1
        unit_price = amount

        if len(amount_indices) >= 2:
            unit_price = parse_amount(cells[amount_indices[0]])
            if len(amount_indices) >= 3:
                quantity = parse_amount(cells[amount_indices[1]]) or 1

        return {
            'type': 'item',
            'product_name': product_name,
            'product_code': '',
            'category': category or '賃貸料',
            'tax_rate': '0' if '非課税' in category else '10',
            'quantity': quantity,
            'unit_price': unit_price,
            'period': 1.0,
            'amount': amount,
            'note': '',
            'target_month': '',
            'first_half': '',
            'second_half': '',
            'delivery_date': '',
            'billing_start_date': ''
        }

    except Exception as e:
        print(f"[V3] Item extraction error: {e}")
        return None


def calculate_summary(customers: list[dict]) -> dict:
    """Calculate summary statistics from extracted customers."""
    total_items = 0
    total_non_taxable = 0
    total_taxable_10 = 0
    total_tax_10 = 0
    grand_total = 0

    for customer in customers:
        total_items += len(customer.get('items', []))
        total_non_taxable += customer.get('non_taxable_total', 0)
        total_taxable_10 += customer.get('taxable_total_10', 0)
        total_tax_10 += customer.get('tax_10', 0)
        # Always use customer_total (may be 0 if not present in PDF)
        grand_total += customer.get('customer_total', 0)

    return {
        'customer_count': len(customers),
        'total_items': total_items,
        'non_taxable_total': total_non_taxable,
        'taxable_total_10': total_taxable_10,
        'tax_total_10': total_tax_10,
        'grand_total': grand_total
    }


def convert_to_simple_format(customers: list[dict]) -> list[dict]:
    """Convert detailed customer data to simple format for reconciliation."""
    items = []

    for customer in customers:
        customer_name = customer.get('customer_name', '')

        for item in customer.get('items', []):
            items.append({
                'customerName': customer_name,
                'itemName': item.get('product_name', ''),
                'quantity': item.get('quantity', 1),
                'unitPrice': item.get('unit_price', 0),
                'amount': item.get('amount', 0)
            })

    return items


@https_fn.on_call(
    region=FUNCTION_REGION,
    memory=FUNCTION_OPTIONS,
    timeout_sec=FUNCTION_TIMEOUT,
    max_instances=10
)
def parse_invoice_v3(req: https_fn.CallableRequest) -> dict:
    """
    Parse wholesale invoice PDF using pdfplumber for machine-generated PDFs.
    Automatically detects Nikken Lease format (21 columns) for optimal parsing.
    Falls back to Gemini OCR for scanned PDFs.
    """
    try:
        # Get request data
        file_base64 = req.data.get('fileBase64')
        mime_type = req.data.get('mimeType')
        wholesale_company = req.data.get('wholesaleCompany', 'unknown')
        billing_month = req.data.get('billingMonth', '')

        if not file_base64 or not mime_type:
            return {
                'success': False,
                'error': 'fileBase64 and mimeType are required'
            }

        print(f"[V3] Processing invoice: {wholesale_company}, {billing_month}, mimeType: {mime_type}")

        # Decode PDF
        pdf_bytes = base64.b64decode(file_base64)

        # Check if machine-generated or scanned
        is_machine, page_count = is_machine_generated_pdf(pdf_bytes)

        if not is_machine:
            print("[V3] Scanned PDF detected, returning for Gemini OCR fallback")
            return {
                'success': True,
                'items': [],
                'totalAmount': 0,
                'rawText': '',
                'processedWith': 'needs-ocr-fallback',
                'pageCount': page_count
            }

        # Detect invoice format and extract accordingly
        invoice_format = detect_invoice_format(pdf_bytes)

        if invoice_format == 'nikken':
            customers = extract_nikken_invoice(pdf_bytes)
        else:
            customers = extract_generic_invoice(pdf_bytes)

        summary = calculate_summary(customers)

        # Convert to simple format for reconciliation
        items = convert_to_simple_format(customers)

        print(f"[V3] Extraction complete ({invoice_format}): {summary['customer_count']} customers, {summary['total_items']} items, total: {summary['grand_total']}")

        # Note: detailedData omitted to reduce response size for emulator compatibility
        return {
            'success': True,
            'items': items,
            'totalAmount': summary['grand_total'],
            'rawText': f"Extracted {summary['customer_count']} customers, {summary['total_items']} items from {page_count} pages ({invoice_format} format)",
            'processedWith': 'pdfplumber',
            'pageCount': page_count,
            'summary': summary
        }

    except Exception as e:
        print(f"[V3] Error: {e}")
        import traceback
        traceback.print_exc()
        return {
            'success': False,
            'error': str(e),
            'processedWith': 'error'
        }
