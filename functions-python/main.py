"""
Cloud Functions for PDF Invoice Parsing
Using pdfplumber for accurate table extraction from machine-generated PDFs.
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


def extract_tables_from_pdf(pdf_bytes: bytes) -> list[dict]:
    """
    Extract customer invoice data from PDF using pdfplumber.
    Designed for wholesale company invoice formats (e.g., Nikken Lease).
    """
    customers = []
    current_customer = None

    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            print(f"[V3] Processing {len(pdf.pages)} pages with pdfplumber")

            for page_num, page in enumerate(pdf.pages):
                # Extract tables from page
                tables = page.extract_tables()

                if not tables:
                    # Try extracting text if no tables found
                    text = page.extract_text()
                    if text:
                        print(f"[V3] Page {page_num + 1}: No tables, text length={len(text)}")
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

                        # Detect customer header row (contains customer number pattern)
                        customer_match = re.search(r'(\d{5,8})\s*様', row_text)
                        if not customer_match and '様' in row_text:
                            # Try to find customer name
                            name_match = re.search(r'([^\d\s]{2,20})\s*様', row_text)
                            if name_match:
                                # Save previous customer
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
                            # Save previous customer
                            if current_customer and current_customer.get('items'):
                                customers.append(current_customer)

                            # Extract customer name (before the number)
                            name_part = row_text[:customer_match.start()].strip()
                            if not name_part:
                                # Try to get name from same row
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
                                amount = find_amount_in_row(row)
                                current_customer['non_taxable_total'] = amount
                                continue
                            elif '課税計' in row_text and '非' not in row_text:
                                amount = find_amount_in_row(row)
                                current_customer['taxable_total_10'] = amount
                                continue
                            elif '消費税' in row_text:
                                amount = find_amount_in_row(row)
                                current_customer['tax_10'] = amount
                                continue
                            elif '御利用者様計' in row_text or 'ご利用者様計' in row_text or '利用者計' in row_text:
                                amount = find_amount_in_row(row)
                                current_customer['customer_total'] = amount
                                continue

                        # Detect item rows (rental items, etc.)
                        if current_customer and len(row) >= 3:
                            # Look for rental/sales category keywords
                            is_item_row = any(cat in row_text for cat in ['賃貸料', '販売', 'レンタル', '購入'])

                            # Or check if row has numeric values that look like amounts
                            if not is_item_row:
                                numeric_count = sum(1 for cell in row if cell and re.match(r'^[\d,]+$', cell.replace(',', '').strip()))
                                is_item_row = numeric_count >= 2

                            if is_item_row:
                                item = extract_item_from_row(row)
                                if item and item.get('amount', 0) != 0:
                                    current_customer['items'].append(item)

            # Don't forget the last customer
            if current_customer and current_customer.get('items'):
                customers.append(current_customer)

    except Exception as e:
        print(f"[V3] pdfplumber extraction error: {e}")
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
    """Extract item details from a table row."""
    try:
        # Filter out empty cells
        cells = [c for c in row if c and c.strip()]

        if len(cells) < 2:
            return None

        # Find cells that look like amounts (numeric with commas)
        amount_indices = []
        for i, cell in enumerate(cells):
            cleaned = cell.replace(',', '').replace('¥', '').replace('￥', '').strip()
            if cleaned.isdigit() or (cleaned.startswith('-') and cleaned[1:].isdigit()):
                amount_indices.append(i)

        if not amount_indices:
            return None

        # The last numeric value is usually the line amount
        amount_idx = amount_indices[-1]
        amount = parse_amount(cells[amount_idx])

        # Find product name (usually first non-empty, non-numeric cell)
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

        # Try to find quantity and unit price
        quantity = 1
        unit_price = amount

        if len(amount_indices) >= 2:
            # Multiple amounts: likely unit_price and total
            unit_price = parse_amount(cells[amount_indices[0]])
            if len(amount_indices) >= 3:
                quantity = parse_amount(cells[amount_indices[1]]) or 1

        return {
            'product_name': product_name,
            'product_code': '',
            'category': category or '賃貸料',
            'tax_rate': '0' if '非課税' in category else '10',
            'quantity': quantity,
            'unit_price': unit_price,
            'period': 1.0,
            'amount': amount
        }

    except Exception as e:
        print(f"[V3] Item extraction error: {e}")
        return None


def calculate_summary(customers: list[dict]) -> dict:
    """Calculate summary statistics from extracted customers."""
    total_items = 0
    grand_total = 0

    for customer in customers:
        total_items += len(customer.get('items', []))
        # Use customer_total if available, otherwise sum items
        if customer.get('customer_total', 0) > 0:
            grand_total += customer['customer_total']
        else:
            grand_total += sum(item.get('amount', 0) for item in customer.get('items', []))

    return {
        'customer_count': len(customers),
        'total_items': total_items,
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

        # Extract data using pdfplumber
        customers = extract_tables_from_pdf(pdf_bytes)
        summary = calculate_summary(customers)

        # Convert to simple format for reconciliation
        items = convert_to_simple_format(customers)

        print(f"[V3] Extraction complete: {summary['customer_count']} customers, {summary['total_items']} items, total: {summary['grand_total']}")

        return {
            'success': True,
            'items': items,
            'totalAmount': summary['grand_total'],
            'rawText': f"Extracted {summary['customer_count']} customers, {summary['total_items']} items from {page_count} pages",
            'processedWith': 'pdfplumber',
            'pageCount': page_count,
            'detailedData': {
                'customers': customers,
                'summary': summary
            }
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
