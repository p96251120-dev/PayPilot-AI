from decimal import Decimal, InvalidOperation
from datetime import datetime, timezone, date
from typing import Optional

import requests
import os
import json
import sqlite3
import secrets
import re

from fastapi import FastAPI, HTTPException, Response, Request, Body, Query
import urllib.parse
import ipaddress
import csv
import io
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from invoice_parser import parse_natural_language_invoice
from ai_copilot import query_ai_copilot
from dotenv import load_dotenv

load_dotenv()

CHANNEL3_API_KEY = os.getenv("CHANNEL3_API_KEY")
PAYPAL_CLIENT_ID = os.getenv("PAYPAL_CLIENT_ID")
PAYPAL_CLIENT_SECRET = os.getenv("PAYPAL_CLIENT_SECRET")
PAYPAL_SANDBOX_BASE = "https://api-m.sandbox.paypal.com"


def validate_paypal_api_base(url: str | None = None) -> str:
    """
    Strictly validates that the PayPal API endpoint is the official PayPal Sandbox.
    Rejects Live PayPal URLs and any arbitrary or non-sandbox hostnames.
    """
    target_url = url if url is not None else os.getenv("PAYPAL_API_BASE", PAYPAL_SANDBOX_BASE)
    if not target_url or not isinstance(target_url, str):
        raise ValueError(
            "PAYPAL_API_BASE is empty or invalid. PayPilot AI strictly communicates with PayPal Sandbox only."
        )

    clean_url = target_url.strip().rstrip("/")
    if clean_url != PAYPAL_SANDBOX_BASE:
        raise ValueError(
            f"Security violation: PayPilot AI is strictly configured for PayPal Sandbox only. "
            f"Non-sandbox or invalid endpoint is not permitted: '{clean_url}'. "
            f"Expected '{PAYPAL_SANDBOX_BASE}'."
        )
    return clean_url


def get_paypal_api_base() -> str:
    """
    Validates and returns the strict PayPal Sandbox base URL before making PayPal requests.
    Raises HTTPException(500) if an invalid or non-sandbox URL is configured,
    preventing any non-sandbox communication and reporting safe errors without leaking credentials.
    """
    current_url = os.getenv("PAYPAL_API_BASE")
    if current_url is None:
        current_url = PAYPAL_API_BASE or PAYPAL_SANDBOX_BASE
    try:
        return validate_paypal_api_base(current_url)
    except ValueError as e:
        raise HTTPException(
            status_code=500,
            detail=f"PayPal API configuration error: {str(e)}"
        )


# Validate at application startup
try:
    PAYPAL_API_BASE = validate_paypal_api_base()
except ValueError:
    PAYPAL_API_BASE = None

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5174")


def is_safe_frontend_host(hostname: str | None) -> bool:
    """
    Checks if a hostname is a safe local development or private LAN host.
    Blocks all external/public internet domains and malicious origins.
    """
    if not hostname or not isinstance(hostname, str):
        return False
    h = hostname.strip().lower()
    if h in ("localhost", "127.0.0.1", "::1"):
        return True
    try:
        ip = ipaddress.ip_address(h)
        return ip.is_private or ip.is_loopback
    except ValueError:
        return False


def validate_frontend_origin(candidate: str | None) -> str:
    """
    Validates and normalizes candidate frontend origin.
    Prevents open redirect attacks by strictly allowing only localhost, 127.0.0.1,
    or private local LAN IP origins (e.g. 10.118.29.99, 192.168.x.x, 172.16-31.x.x)
    on valid ports. Falls back safely to FRONTEND_URL or http://localhost:5174.
    """
    fallback = os.getenv("FRONTEND_URL", "http://localhost:5174").rstrip("/")
    if not candidate or not isinstance(candidate, str):
        return fallback

    try:
        parsed = urllib.parse.urlsplit(candidate.strip())
        if parsed.scheme in ("http", "https") and is_safe_frontend_host(parsed.hostname):
            port_part = f":{parsed.port}" if parsed.port else ""
            return f"{parsed.scheme}://{parsed.hostname}{port_part}"
    except Exception:
        pass

    return fallback

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE = os.path.join(BASE_DIR, "paypilot.db")


# ---------------- DATABASE SETUP ----------------

def get_connection():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database():
    connection = get_connection()

    connection.execute("""
        CREATE TABLE IF NOT EXISTS invoices (
            id TEXT PRIMARY KEY,
            customer TEXT NOT NULL,
            email TEXT NOT NULL,
            items TEXT NOT NULL,
            total REAL NOT NULL,
            status TEXT NOT NULL,
            paypal_order_id TEXT,
            paypal_capture_id TEXT,
            paid_at TEXT
        )
    """)

    # Ensure existing tables have the PayPal, currency and due_date columns
    existing_cols = [row[1] for row in connection.execute("PRAGMA table_info(invoices)").fetchall()]
    if "paypal_order_id" not in existing_cols:
        connection.execute("ALTER TABLE invoices ADD COLUMN paypal_order_id TEXT")
    if "paypal_capture_id" not in existing_cols:
        connection.execute("ALTER TABLE invoices ADD COLUMN paypal_capture_id TEXT")
    if "paid_at" not in existing_cols:
        connection.execute("ALTER TABLE invoices ADD COLUMN paid_at TEXT")
    if "currency" not in existing_cols:
        connection.execute("ALTER TABLE invoices ADD COLUMN currency TEXT DEFAULT 'USD'")
    if "due_date" not in existing_cols:
        connection.execute("ALTER TABLE invoices ADD COLUMN due_date TEXT")

    # Safe creation of dedicated payments history table (RESTRICT deletion to protect audit ledger)
    connection.execute("""
        CREATE TABLE IF NOT EXISTS payments (
            id TEXT PRIMARY KEY,
            invoice_id TEXT NOT NULL,
            customer TEXT NOT NULL,
            email TEXT NOT NULL,
            amount REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'USD',
            status TEXT NOT NULL,
            provider TEXT NOT NULL DEFAULT 'PayPal Sandbox',
            paypal_order_id TEXT,
            paypal_capture_id TEXT,
            failure_reason TEXT,
            created_at TEXT NOT NULL,
            paid_at TEXT,
            FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE RESTRICT
        )
    """)

    # Non-destructive migration: convert legacy CASCADE constraint to RESTRICT if present
    payments_sql_row = connection.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='payments'"
    ).fetchone()
    if payments_sql_row and "CASCADE" in payments_sql_row[0].upper():
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS payments_restricted (
                id TEXT PRIMARY KEY,
                invoice_id TEXT NOT NULL,
                customer TEXT NOT NULL,
                email TEXT NOT NULL,
                amount REAL NOT NULL,
                currency TEXT NOT NULL DEFAULT 'USD',
                status TEXT NOT NULL,
                provider TEXT NOT NULL DEFAULT 'PayPal Sandbox',
                paypal_order_id TEXT,
                paypal_capture_id TEXT,
                failure_reason TEXT,
                created_at TEXT NOT NULL,
                paid_at TEXT,
                FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE RESTRICT
            );
            INSERT INTO payments_restricted SELECT id, invoice_id, customer, email, amount, currency, status, provider, paypal_order_id, paypal_capture_id, failure_reason, created_at, paid_at FROM payments;
            DROP TABLE payments;
            ALTER TABLE payments_restricted RENAME TO payments;
        """)
        connection.execute("PRAGMA foreign_keys = ON")

    # Helpful indexes for fast querying and duplicate prevention
    connection.execute("CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments (invoice_id)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_payments_paypal_order_id ON payments (paypal_order_id)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_payments_paypal_capture_id ON payments (paypal_capture_id)")

    # Ensure customer_id exists on invoices table
    if "customer_id" not in existing_cols:
        connection.execute("ALTER TABLE invoices ADD COLUMN customer_id TEXT")

    # Safe creation of dedicated customers directory table
    connection.execute("""
        CREATE TABLE IF NOT EXISTS customers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            phone TEXT,
            company TEXT,
            address TEXT,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)

    connection.execute("CREATE INDEX IF NOT EXISTS idx_customers_email ON customers (email)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices (customer_id)")

    # Idempotent backfill: automatically identify and register existing customers from invoices
    inv_cust_rows = connection.execute("""
        SELECT id, customer, email, paid_at FROM invoices ORDER BY rowid ASC
    """).fetchall()

    for inv in inv_cust_rows:
        raw_email = (inv["email"] or "").strip()
        if not raw_email:
            continue
        norm_email = raw_email.lower()

        existing_c = connection.execute(
            "SELECT id FROM customers WHERE LOWER(TRIM(email)) = ?", (norm_email,)
        ).fetchone()

        if existing_c:
            c_id = existing_c["id"]
        else:
            c_id = f"CUST-{secrets.token_hex(4).upper()}"
            c_name = (inv["customer"] or "").strip() or "Customer"
            now_iso = datetime.now(timezone.utc).isoformat()
            connection.execute("""
                INSERT INTO customers (id, name, email, phone, company, address, notes, created_at, updated_at)
                VALUES (?, ?, ?, NULL, NULL, NULL, 'Identified from historical invoices.', ?, ?)
            """, (c_id, c_name, norm_email, now_iso, now_iso))

        connection.execute("""
            UPDATE invoices
            SET customer_id = ?
            WHERE id = ? AND (customer_id IS NULL OR customer_id = '')
        """, (c_id, inv["id"]))

    # Backfill legacy paid or pending PayPal invoices into payments ledger if not already present
    legacy_invoices = connection.execute("""
        SELECT id, customer, email, total, currency, paypal_order_id, paypal_capture_id, paid_at, status
        FROM invoices
        WHERE (status = 'Paid' OR paypal_order_id IS NOT NULL OR paypal_capture_id IS NOT NULL)
          AND id NOT IN (SELECT invoice_id FROM payments)
    """).fetchall()

    for inv in legacy_invoices:
        inv_status = (inv["status"] or "").lower()
        payment_status = "Completed" if (inv_status == "paid" or inv["paypal_capture_id"] or inv["paid_at"]) else "Pending"

        # Check if capture ID is already used in payments
        if inv["paypal_capture_id"]:
            existing_cap = connection.execute(
                "SELECT id FROM payments WHERE paypal_capture_id = ?", (inv["paypal_capture_id"],)
            ).fetchone()
            if existing_cap:
                continue

        pay_id = f"PAY-{secrets.token_hex(4).upper()}"
        ts = inv["paid_at"] or datetime.now(timezone.utc).isoformat()
        connection.execute("""
            INSERT INTO payments (
                id, invoice_id, customer, email, amount, currency,
                status, provider, paypal_order_id, paypal_capture_id,
                failure_reason, created_at, paid_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'PayPal Sandbox', ?, ?, NULL, ?, ?)
        """, (
            pay_id,
            inv["id"],
            inv["customer"],
            inv["email"],
            inv["total"],
            inv["currency"] or "USD",
            payment_status,
            inv["paypal_order_id"],
            inv["paypal_capture_id"],
            ts,
            inv["paid_at"] if payment_status == "Completed" else None
        ))

    # Safe creation of application settings table
    connection.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)

    default_settings = {
        "business_name": "PayPilot Merchant",
        "business_email": "billing@paypilot.ai",
        "business_phone": "+1 (555) 019-2834",
        "business_address": "77 Market Street, Suite 500, San Francisco, CA 94105",
        "tax_id": "US-TAX-8829103",
        "default_currency": "USD",
        "default_due_days": "30",
        "invoice_prefix": "INV-",
        "default_notes": "Thank you for your business. Payment is due within the terms specified."
    }

    for k, v in default_settings.items():
        connection.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (k, v)
        )

    connection.commit()
    connection.close()


initialize_database()


# ---------------- PYDANTIC MODELS ----------------

class CustomerCreateRequest(BaseModel):
    name: str
    email: str
    phone: str | None = None
    company: str | None = None
    address: str | None = None
    notes: str | None = None


class CustomerUpdateRequest(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    company: str | None = None
    address: str | None = None
    notes: str | None = None


class ProductSearchRequest(BaseModel):
    query: str


class InvoiceRequest(BaseModel):
    id: str
    customer: str
    email: str
    items: list[dict]
    total: float
    currency: str | None = None
    status: str = "Draft"
    due_date: str | None = None
    customer_id: str | None = None
    paypal_order_id: str | None = None
    paypal_capture_id: str | None = None
    paid_at: str | None = None


class CreateOrderRequest(BaseModel):
    origin: str | None = None


class CapturePaymentRequest(BaseModel):
    order_id: str
    invoice_id: str


class CancelPaymentRequest(BaseModel):
    invoice_id: str
    order_id: str | None = None


class PaymentCreateRequest(BaseModel):
    invoice_id: str
    customer: str
    email: str
    amount: float
    currency: str = "USD"
    status: str = "Pending"  # Must be Pending, Completed, or Failed
    provider: str = "PayPal Sandbox"
    paypal_order_id: str | None = None
    paypal_capture_id: str | None = None
    failure_reason: str | None = None
    created_at: str | None = None
    paid_at: str | None = None


class GenerateInvoiceFromPromptRequest(BaseModel):
    prompt: str
    try_llm: bool = False


class CopilotQueryRequest(BaseModel):
    query: str


class SettingsUpdateRequest(BaseModel):
    business_name: str | None = None
    business_email: str | None = None
    business_phone: str | None = None
    business_address: str | None = None
    tax_id: str | None = None
    default_currency: str | None = None
    default_due_days: int | None = None
    invoice_prefix: str | None = None
    default_notes: str | None = None


# ---------------- FASTAPI APP ----------------

app = FastAPI(title="PayPilot AI API")

app.add_middleware(
    CORSMiddleware,
   
allow_origins=[
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5175",
    "http://localhost:5176",
    "http://127.0.0.1:5176",
    "http://10.118.29.99:5173",
    "http://10.118.29.99:5174",
    "http://10.118.29.99:5175",
    "http://10.118.29.99:5176",
],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$",

    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------- HOME & HEALTH ----------------

@app.get("/")
def home():
    return {
        "message": "PayPilot AI Backend is running!"
    }


@app.get("/health")
def health():
    try:
        get_paypal_api_base()
        paypal_mode = "sandbox"
    except HTTPException:
        paypal_mode = "blocked_non_sandbox"

    return {
        "status": "healthy",
        "channel3_configured": bool(CHANNEL3_API_KEY),
        "paypal_configured": bool(PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET),
        "paypal_mode": paypal_mode
    }


# ---------------- CHANNEL3 PRODUCT SEARCH ----------------

@app.post("/api/products/search")
def search_products(data: ProductSearchRequest):

    if not CHANNEL3_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Channel3 API key is not configured"
        )

    if not data.query.strip():
        raise HTTPException(
            status_code=400,
            detail="Product search query cannot be empty"
        )

    try:
        response = requests.post(
            "https://api.trychannel3.com/v1/search",
            headers={
                "x-api-key": CHANNEL3_API_KEY,
                "Content-Type": "application/json"
            },
            json={
                "query": data.query,
                "limit": 5
            },
            timeout=20
        )

        response.raise_for_status()
        return response.json()

    except requests.RequestException:
        raise HTTPException(
            status_code=502,
            detail="Channel3 product search failed"
        )


# ---------------- AI INVOICE GENERATOR ----------------

@app.post("/api/ai/generate-invoice")
@app.post("/api/invoices/generate-from-prompt")
def generate_invoice_from_prompt(req: GenerateInvoiceFromPromptRequest):
    try:
        return parse_natural_language_invoice(req.prompt, try_llm=req.try_llm)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse invoice description: {str(e)}")


# ---------------- AI COPILOT (read-only ledger questions) ----------------

@app.post("/api/ai/copilot")
def ai_copilot_query(req: CopilotQueryRequest):
    connection = get_connection()
    try:
        return query_ai_copilot(req.query, connection)
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Unable to answer that question from the ledger."
        )
    finally:
        connection.close()


# ---------------- CREATE INVOICE ----------------

@app.post("/api/invoices")
def create_invoice(invoice: InvoiceRequest):

    connection = get_connection()

    try:
        target_currency = invoice.currency.strip().upper() if invoice.currency and invoice.currency.strip() else "USD"

        # Link customer_id if provided or match existing customer by normalized email
        linked_customer_id = invoice.customer_id
        norm_email = (invoice.email or "").strip().lower()
        if not linked_customer_id and norm_email:
            matched_c = connection.execute(
                "SELECT id FROM customers WHERE LOWER(TRIM(email)) = ?", (norm_email,)
            ).fetchone()
            if matched_c:
                linked_customer_id = matched_c["id"]

        connection.execute("""
            INSERT INTO invoices
            (id, customer, email, items, total, status, currency, due_date, customer_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            invoice.id,
            invoice.customer,
            invoice.email,
            json.dumps(invoice.items),
            invoice.total,
            invoice.status,
            target_currency,
            invoice.due_date,
            linked_customer_id
        ))

        connection.commit()

        return {
            "message": "Invoice saved successfully",
            "invoice": invoice.model_dump()
        }

    except sqlite3.IntegrityError:
        raise HTTPException(
            status_code=409,
            detail="Invoice with this ID already exists"
        )

    finally:
        connection.close()


# ---------------- GET ALL INVOICES ----------------

@app.get("/api/invoices")
def get_invoices():

    connection = get_connection()

    rows = connection.execute(
        "SELECT * FROM invoices ORDER BY rowid DESC"
    ).fetchall()

    connection.close()

    invoices = []

    for row in rows:
        row_keys = row.keys()
        invoices.append({
            "id": row["id"],
            "customer": row["customer"],
            "email": row["email"],
            "items": json.loads(row["items"]),
            "total": row["total"],
            "status": row["status"],
            "currency": row["currency"] if "currency" in row_keys and row["currency"] else "USD",
            "due_date": row["due_date"] if "due_date" in row_keys else None,
            "paypal_order_id": row["paypal_order_id"] if "paypal_order_id" in row_keys else None,
            "paypal_capture_id": row["paypal_capture_id"] if "paypal_capture_id" in row_keys else None,
            "paid_at": row["paid_at"] if "paid_at" in row_keys else None,
            "customer_id": row["customer_id"] if "customer_id" in row_keys else None
        })

    return invoices


# ---------------- SMART PAYMENT REMINDERS NOTIFICATIONS ----------------

@app.get("/api/notifications/reminders")
def get_payment_reminders(override_today: Optional[str] = None):
    """
    Returns calculated smart payment reminders:
    1. Upcoming Due: Pending invoice due within the next 3 calendar days (1 to 3 days ahead).
    2. Due Today: Pending invoice whose due date is today.
    3. Overdue: Unpaid invoice whose due date has passed.
    Draft and Paid invoices are strictly excluded.
    """
    today_date = date.today()
    if override_today:
        try:
            today_date = datetime.strptime(override_today.strip()[:10], "%Y-%m-%d").date()
        except Exception:
            pass

    connection = get_connection()
    rows = connection.execute("SELECT * FROM invoices ORDER BY rowid DESC").fetchall()
    connection.close()

    reminders = []
    seen = set()

    for row in rows:
        row_keys = row.keys()
        status = (row["status"] or "").lower().strip()
        # Business rule: Never generate payment reminders for Draft or Paid invoices
        if status in ("paid", "draft"):
            continue

        due_date_str = (row["due_date"] or "").strip()[:10] if "due_date" in row_keys and row["due_date"] else None
        if not due_date_str or len(due_date_str) != 10:
            continue

        try:
            due_d = datetime.strptime(due_date_str, "%Y-%m-%d").date()
        except Exception:
            continue

        diff = (due_d - today_date).days
        category = None
        category_label = None

        if diff < 0:
            category = "overdue"
            category_label = "Overdue"
        elif diff == 0:
            category = "due_today"
            category_label = "Due Today"
        elif 1 <= diff <= 3:
            category = "upcoming"
            category_label = "Upcoming Due"

        if not category:
            continue

        key = (row["id"], category)
        if key in seen:
            continue
        seen.add(key)

        currency = row["currency"] if "currency" in row_keys and row["currency"] else "USD"
        reminders.append({
            "id": f"{row['id']}-{category}",
            "invoice_id": row["id"],
            "customer": row["customer"],
            "email": row["email"],
            "amount": float(row["total"]),
            "currency": currency,
            "due_date": due_date_str,
            "days_diff": diff,
            "category": category,
            "category_label": category_label,
            "status": row["status"]
        })

    # Sort: Overdue first (most overdue first), then Due Today, then Upcoming
    def sort_key(r):
        order = {"overdue": 0, "due_today": 1, "upcoming": 2}
        return (order.get(r["category"], 9), r["days_diff"])

    reminders.sort(key=sort_key)

    overdue_count = sum(1 for r in reminders if r["category"] == "overdue")
    due_today_count = sum(1 for r in reminders if r["category"] == "due_today")
    upcoming_count = sum(1 for r in reminders if r["category"] == "upcoming")

    return {
        "total_count": len(reminders),
        "overdue_count": overdue_count,
        "due_today_count": due_today_count,
        "upcoming_count": upcoming_count,
        "reminders": reminders
    }


# ---------------- UPDATE INVOICE ----------------

@app.put("/api/invoices/{invoice_id}")
def update_invoice(invoice_id: str, invoice: InvoiceRequest):

    connection = get_connection()
    existing = connection.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,)).fetchone()

    if not existing:
        connection.close()
        raise HTTPException(
            status_code=404,
            detail="Invoice not found"
        )

    existing_keys = existing.keys()
    existing_currency = existing["currency"] if "currency" in existing_keys and existing["currency"] else "USD"

    # If currency is provided explicitly, validate and use it; otherwise preserve existing currency from SQLite
    if invoice.currency is not None and invoice.currency.strip():
        new_currency = invoice.currency.strip().upper()
    else:
        new_currency = existing_currency

    if existing["status"] == "Paid":
        existing_total = Decimal(str(existing["total"])).quantize(Decimal("0.01"))
        new_total = Decimal(str(invoice.total)).quantize(Decimal("0.01"))

        # Prevent changing a Paid invoice back to Draft or unpaid status
        if invoice.status != "Paid":
            connection.close()
            raise HTTPException(
                status_code=400,
                detail="Cannot change a Paid invoice back to Draft or unpaid status."
            )

        # Prevent changing the paid total amount
        if new_total != existing_total:
            connection.close()
            raise HTTPException(
                status_code=400,
                detail=f"Cannot alter invoice total on a Paid invoice. Paid total: {existing_total}, requested: {new_total}."
            )

        # Prevent changing currency on a paid invoice
        if new_currency.upper() != existing_currency.upper():
            connection.close()
            raise HTTPException(
                status_code=400,
                detail=f"Cannot alter currency on a Paid invoice. Existing currency: {existing_currency}, requested: {new_currency}."
            )

    existing_due_date = existing["due_date"] if "due_date" in existing_keys else None
    if invoice.due_date is not None:
        new_due_date = invoice.due_date if invoice.due_date.strip() else None
    else:
        new_due_date = existing_due_date

    cursor = connection.execute("""
        UPDATE invoices
        SET customer = ?,
            email = ?,
            items = ?,
            total = ?,
            status = ?,
            currency = ?,
            due_date = ?
        WHERE id = ?
    """, (
        invoice.customer,
        invoice.email,
        json.dumps(invoice.items),
        invoice.total,
        invoice.status,
        new_currency,
        new_due_date,
        invoice_id
    ))

    connection.commit()
    updated = cursor.rowcount
    connection.close()

    if updated == 0:
        raise HTTPException(
            status_code=404,
            detail="Invoice not found"
        )

    return {
        "message": "Invoice updated successfully"
    }


# ---------------- DELETE INVOICE ----------------

@app.delete("/api/invoices/{invoice_id}")
def delete_invoice(invoice_id: str):

    connection = get_connection()

    # Financial ledger integrity check: invoices with payment history cannot be deleted
    payment_count_row = connection.execute(
        "SELECT COUNT(*) FROM payments WHERE invoice_id = ?",
        (invoice_id,)
    ).fetchone()
    payment_count = payment_count_row[0] if payment_count_row else 0

    if payment_count > 0:
        connection.close()
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete invoice '{invoice_id}': {payment_count} payment record(s) exist in the ledger. Financial audit history must be preserved."
        )

    cursor = connection.execute(
        "DELETE FROM invoices WHERE id = ?",
        (invoice_id,)
    )

    connection.commit()
    deleted = cursor.rowcount
    connection.close()

    if deleted == 0:
        raise HTTPException(
            status_code=404,
            detail="Invoice not found"
        )

    return {
        "message": "Invoice deleted successfully"
    }


# ---------------- PAYPAL SANDBOX INTEGRATION ----------------

def get_paypal_access_token():
    if not PAYPAL_CLIENT_ID or not PAYPAL_CLIENT_SECRET:
        raise HTTPException(
            status_code=500,
            detail="PayPal credentials (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET) are not configured in environment"
        )

    api_base = get_paypal_api_base()

    try:
        response = requests.post(
            f"{api_base}/v1/oauth2/token",
            auth=(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET),
            data={"grant_type": "client_credentials"},
            headers={"Accept": "application/json", "Accept-Language": "en_US"},
            timeout=20
        )
        response.raise_for_status()
        token_data = response.json()
        return token_data.get("access_token")
    except requests.RequestException as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to authenticate with PayPal: {str(e)}"
        )


@app.post("/api/payments/create-order/{invoice_id}")
def create_paypal_order(
    invoice_id: str,
    payload: CreateOrderRequest | None = None,
    request: Request = None,
    origin: str | None = None
):
    connection = get_connection()
    row = connection.execute(
        "SELECT * FROM invoices WHERE id = ?", (invoice_id,)
    ).fetchone()

    if not row:
        connection.close()
        raise HTTPException(status_code=404, detail="Invoice not found")

    if row["status"] == "Paid":
        connection.close()
        raise HTTPException(status_code=400, detail="Invoice is already paid")

    total_amount = float(row["total"])
    if total_amount <= 0:
        connection.close()
        raise HTTPException(status_code=400, detail="Invoice amount must be greater than zero")

    try:
        api_base = get_paypal_api_base()
        access_token = get_paypal_access_token()
    except Exception:
        connection.close()
        raise

    # Dynamically resolve safe frontend origin for return and cancel redirects
    raw_origin = None
    if payload and payload.origin:
        raw_origin = payload.origin
    elif origin:
        raw_origin = origin
    elif request:
        try:
            raw_origin = request.headers.get("origin") or request.headers.get("referer")
        except Exception:
            raw_origin = None

    target_frontend = validate_frontend_origin(raw_origin)
    return_url = f"{target_frontend}/?payment=success&invoiceId={invoice_id}"
    cancel_url = f"{target_frontend}/?payment=cancel&invoiceId={invoice_id}"

    invoice_currency = row["currency"] if "currency" in row.keys() and row["currency"] else "USD"

    order_payload = {
        "intent": "CAPTURE",
        "purchase_units": [
            {
                "reference_id": invoice_id,
                "description": f"PayPilot AI Invoice {invoice_id} for {row['customer']}",
                "amount": {
                    "currency_code": invoice_currency,
                    "value": f"{total_amount:.2f}"
                }
            }
        ],
        "application_context": {
            "brand_name": "PayPilot AI",
            "landing_page": "NO_PREFERENCE",
            "user_action": "PAY_NOW",
            "return_url": return_url,
            "cancel_url": cancel_url
        }
    }

    try:
        res = requests.post(
            f"{api_base}/v2/checkout/orders",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {access_token}"
            },
            json=order_payload,
            timeout=20
        )
        res.raise_for_status()
        order_data = res.json()
        order_id = order_data.get("id")

        approval_url = None
        for link in order_data.get("links", []):
            if link.get("rel") == "approve":
                approval_url = link.get("href")
                break

        if not approval_url:
            raise HTTPException(status_code=502, detail="PayPal did not return an approval URL")

        # Save paypal_order_id and set status to Pending in SQLite
        connection.execute(
            "UPDATE invoices SET paypal_order_id = ?, status = 'Pending' WHERE id = ? AND status != 'Paid'",
            (order_id, invoice_id)
        )

        # Log Pending payment attempt in payments history
        now_iso = datetime.now(timezone.utc).isoformat()
        pay_id = f"PAY-{secrets.token_hex(4).upper()}"
        connection.execute("""
            INSERT INTO payments (
                id, invoice_id, customer, email, amount, currency,
                status, provider, paypal_order_id, paypal_capture_id,
                failure_reason, created_at, paid_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 'Pending', 'PayPal Sandbox', ?, NULL, NULL, ?, NULL)
        """, (
            pay_id,
            invoice_id,
            row["customer"],
            row["email"],
            row["total"],
            invoice_currency,
            order_id,
            now_iso
        ))

        connection.commit()
        connection.close()

        return {
            "order_id": order_id,
            "approval_url": approval_url,
            "message": "PayPal order created successfully"
        }

    except requests.RequestException as e:
        connection.close()
        raise HTTPException(status_code=502, detail=f"Failed to create PayPal order: {str(e)}")


@app.post("/api/payments/capture-order")
def capture_paypal_order(data: CapturePaymentRequest):
    connection = get_connection()
    row = connection.execute(
        "SELECT * FROM invoices WHERE id = ?", (data.invoice_id,)
    ).fetchone()

    if not row:
        connection.close()
        raise HTTPException(status_code=404, detail="Invoice not found")

    row_keys = row.keys()

    # 4. Duplicate capture check: short-circuit if already paid
    if row["status"] == "Paid":
        connection.close()
        return {
            "status": "COMPLETED",
            "invoice_id": data.invoice_id,
            "capture_id": row["paypal_capture_id"] if "paypal_capture_id" in row_keys else None,
            "paid_at": row["paid_at"] if "paid_at" in row_keys else None,
            "message": "Invoice has already been marked as Paid."
        }

    # 3. PayPal order binding: verify data.order_id matches stored paypal_order_id
    stored_order_id = row["paypal_order_id"] if "paypal_order_id" in row_keys else None
    if not stored_order_id:
        connection.close()
        raise HTTPException(
            status_code=400,
            detail="No PayPal order has been initiated for this invoice."
        )
    if stored_order_id != data.order_id:
        connection.close()
        raise HTTPException(
            status_code=400,
            detail=f"PayPal order binding mismatch: order {data.order_id} does not match expected {stored_order_id}."
        )

    try:
        api_base = get_paypal_api_base()
        access_token = get_paypal_access_token()
    except Exception:
        connection.close()
        raise

    try:
        res = requests.post(
            f"{api_base}/v2/checkout/orders/{data.order_id}/capture",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {access_token}"
            },
            json={},
            timeout=20
        )
        res.raise_for_status()
        capture_data = res.json()

        paypal_status = capture_data.get("status")
        if paypal_status != "COMPLETED":
            connection.execute("""
                UPDATE payments
                SET status = 'Failed',
                    failure_reason = ?
                WHERE paypal_order_id = ?
            """, (f"PayPal capture not completed. Status: {paypal_status}", data.order_id))
            connection.commit()
            connection.close()
            raise HTTPException(
                status_code=400,
                detail=f"PayPal payment not completed. Current status: {paypal_status}"
            )

        purchase_units = capture_data.get("purchase_units", [])
        if not purchase_units:
            connection.close()
            raise HTTPException(status_code=400, detail="Missing purchase units in PayPal response.")

        # Verify reference_id matches invoice ID
        ref_id = purchase_units[0].get("reference_id")
        if ref_id and ref_id != data.invoice_id:
            connection.close()
            raise HTTPException(
                status_code=400,
                detail=f"PayPal purchase unit reference mismatch: expected {data.invoice_id}, received {ref_id}."
            )

        payments = purchase_units[0].get("payments", {})
        captures = payments.get("captures", [])
        if not captures:
            connection.close()
            raise HTTPException(status_code=400, detail="No capture details found in PayPal response.")

        capture_obj = captures[0]
        capture_id = capture_obj.get("id")

        # 1. Decimal-safe monetary amount verification
        amount_info = capture_obj.get("amount", {})
        captured_val_str = amount_info.get("value")
        captured_currency = amount_info.get("currency_code")

        if not captured_val_str or not captured_currency:
            connection.close()
            raise HTTPException(status_code=400, detail="PayPal capture missing amount or currency information.")

        try:
            captured_decimal = Decimal(str(captured_val_str)).quantize(Decimal("0.01"))
        except (InvalidOperation, TypeError, ValueError):
            connection.close()
            raise HTTPException(status_code=400, detail="Invalid monetary amount returned by PayPal.")

        expected_decimal = Decimal(str(row["total"])).quantize(Decimal("0.01"))
        if captured_decimal != expected_decimal:
            connection.execute("""
                UPDATE payments
                SET status = 'Failed',
                    failure_reason = ?
                WHERE paypal_order_id = ?
            """, (f"Captured amount mismatch: invoice total is {expected_decimal}, but PayPal captured {captured_decimal}.", data.order_id))
            connection.commit()
            connection.close()
            raise HTTPException(
                status_code=400,
                detail=f"Captured amount mismatch: invoice total is {expected_decimal}, but PayPal captured {captured_decimal}."
            )

        # 2. Strict currency verification
        expected_currency = row["currency"] if "currency" in row_keys and row["currency"] else "USD"
        if captured_currency.upper() != expected_currency.upper():
            connection.execute("""
                UPDATE payments
                SET status = 'Failed',
                    failure_reason = ?
                WHERE paypal_order_id = ?
            """, (f"Captured currency mismatch: invoice currency is {expected_currency}, but PayPal captured {captured_currency}.", data.order_id))
            connection.commit()
            connection.close()
            raise HTTPException(
                status_code=400,
                detail=f"Captured currency mismatch: invoice currency is {expected_currency}, but PayPal captured {captured_currency}."
            )

        paid_at = datetime.now(timezone.utc).isoformat()
        actual_capture_id = capture_id or data.order_id

        # 4. Duplicate/Concurrent capture protection via conditional atomic update
        cursor = connection.execute("""
            UPDATE invoices
            SET status = 'Paid',
                paypal_capture_id = ?,
                paid_at = ?
            WHERE id = ? AND status != 'Paid'
        """, (actual_capture_id, paid_at, data.invoice_id))

        # Update or record Completed payment in payments history
        existing_pay = connection.execute(
            "SELECT id FROM payments WHERE paypal_order_id = ?", (data.order_id,)
        ).fetchone()

        if existing_pay:
            connection.execute("""
                UPDATE payments
                SET status = 'Completed',
                    paypal_capture_id = ?,
                    paid_at = ?,
                    failure_reason = NULL
                WHERE id = ?
            """, (actual_capture_id, paid_at, existing_pay["id"]))
        else:
            pay_id = f"PAY-{secrets.token_hex(4).upper()}"
            connection.execute("""
                INSERT INTO payments (
                    id, invoice_id, customer, email, amount, currency,
                    status, provider, paypal_order_id, paypal_capture_id,
                    failure_reason, created_at, paid_at
                )
                VALUES (?, ?, ?, ?, ?, ?, 'Completed', 'PayPal Sandbox', ?, ?, NULL, ?, ?)
            """, (
                pay_id,
                data.invoice_id,
                row["customer"],
                row["email"],
                row["total"],
                expected_currency,
                data.order_id,
                actual_capture_id,
                paid_at,
                paid_at
            ))

        connection.commit()

        if cursor.rowcount == 0:
            # Another concurrent request already finalized this invoice
            updated_row = connection.execute("SELECT * FROM invoices WHERE id = ?", (data.invoice_id,)).fetchone()
            connection.close()
            return {
                "status": "COMPLETED",
                "invoice_id": data.invoice_id,
                "capture_id": updated_row["paypal_capture_id"] if "paypal_capture_id" in updated_row.keys() else actual_capture_id,
                "paid_at": updated_row["paid_at"] if "paid_at" in updated_row.keys() else paid_at,
                "message": "Invoice has already been marked as Paid."
            }

        connection.close()

        return {
            "status": "COMPLETED",
            "invoice_id": data.invoice_id,
            "capture_id": capture_id or data.order_id,
            "paid_at": paid_at,
            "message": "Payment captured successfully and invoice marked as Paid."
        }

    except requests.RequestException as e:
        connection.close()
        raise HTTPException(
            status_code=502,
            detail=f"Failed to capture PayPal payment: {str(e)}"
        )


# ---------------- PAYMENTS HISTORY & MANAGEMENT ----------------

@app.get("/api/payments")
def list_payments():
    """
    Retrieves all payment history records ordered chronologically by newest first.
    """
    connection = get_connection()
    rows = connection.execute("""
        SELECT * FROM payments
        ORDER BY datetime(created_at) DESC, rowid DESC
    """).fetchall()
    connection.close()

    payments = []
    for r in rows:
        payments.append({
            "id": r["id"],
            "invoice_id": r["invoice_id"],
            "customer": r["customer"],
            "email": r["email"],
            "amount": r["amount"],
            "currency": (r["currency"] or "USD").upper().strip(),
            "status": r["status"],
            "provider": r["provider"] or "PayPal Sandbox",
            "paypal_order_id": r["paypal_order_id"],
            "paypal_capture_id": r["paypal_capture_id"],
            "failure_reason": r["failure_reason"],
            "created_at": r["created_at"],
            "paid_at": r["paid_at"]
        })
    return payments


@app.get("/api/payments/{payment_id}")
def get_payment(payment_id: str):
    """
    Retrieves a single payment record by ID.
    """
    connection = get_connection()
    row = connection.execute("SELECT * FROM payments WHERE id = ?", (payment_id,)).fetchone()
    connection.close()

    if not row:
        raise HTTPException(status_code=404, detail=f"Payment record '{payment_id}' not found")

    return {
        "id": row["id"],
        "invoice_id": row["invoice_id"],
        "customer": row["customer"],
        "email": row["email"],
        "amount": row["amount"],
        "currency": (row["currency"] or "USD").upper().strip(),
        "status": row["status"],
        "provider": row["provider"] or "PayPal Sandbox",
        "paypal_order_id": row["paypal_order_id"],
        "paypal_capture_id": row["paypal_capture_id"],
        "failure_reason": row["failure_reason"],
        "created_at": row["created_at"],
        "paid_at": row["paid_at"]
    }


@app.post("/api/payments/record-cancel")
def record_payment_cancel(data: CancelPaymentRequest):
    """
    Records a cancelled PayPal payment attempt and reverts pending status if unpaid.
    Rejects cancellation if payment or invoice is already Completed/Paid.
    """
    connection = get_connection()
    row = connection.execute("SELECT * FROM invoices WHERE id = ?", (data.invoice_id,)).fetchone()
    if not row:
        connection.close()
        raise HTTPException(status_code=404, detail="Invoice not found")

    # If invoice is already paid, Completed payments are immutable
    if row["status"] == "Paid":
        connection.close()
        raise HTTPException(
            status_code=400,
            detail="Cannot cancel payment: Invoice is already Paid and Completed."
        )

    # Check if payment row is already Completed
    if data.order_id:
        pay_row = connection.execute(
            "SELECT id, status FROM payments WHERE paypal_order_id = ?", (data.order_id,)
        ).fetchone()
    else:
        pay_row = connection.execute(
            "SELECT id, status FROM payments WHERE invoice_id = ? ORDER BY rowid DESC",
            (data.invoice_id,)
        ).fetchone()

    if pay_row and pay_row["status"] == "Completed":
        connection.close()
        raise HTTPException(
            status_code=400,
            detail="Cannot cancel payment: Payment record is already Completed and immutable."
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    reason = "PayPal payment was cancelled by customer before capture."

    if pay_row:
        connection.execute("""
            UPDATE payments
            SET status = 'Failed',
                failure_reason = ?
            WHERE id = ? AND status != 'Completed'
        """, (reason, pay_row["id"]))
    else:
        pay_id = f"PAY-{secrets.token_hex(4).upper()}"
        connection.execute("""
            INSERT INTO payments (
                id, invoice_id, customer, email, amount, currency,
                status, provider, paypal_order_id, paypal_capture_id,
                failure_reason, created_at, paid_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 'Failed', 'PayPal Sandbox', ?, NULL, ?, ?, NULL)
        """, (
            pay_id,
            data.invoice_id,
            row["customer"],
            row["email"],
            row["total"],
            row["currency"] or "USD",
            data.order_id,
            reason,
            now_iso
        ))

    # Revert invoice to Draft if it was Pending
    connection.execute(
        "UPDATE invoices SET status = 'Draft' WHERE id = ? AND status = 'Pending'",
        (data.invoice_id,)
    )

    connection.commit()
    connection.close()
    return {"message": "Payment cancellation recorded successfully", "status": "Failed"}


@app.post("/api/payments")
def create_payment(payment: PaymentCreateRequest):
    """
    Creates a payment record with full Pydantic validation, decimal verification,
    and duplicate protection. Restricts direct creation of Completed payments.
    """
    # 1. Enforce that Completed status can only be granted by verified PayPal capture
    if payment.status == "Completed":
        raise HTTPException(
            status_code=400,
            detail="Direct creation of Completed payments is restricted. Payments can only be transitioned to Completed via verified PayPal Sandbox capture."
        )

    valid_statuses = {"Pending", "Failed"}
    if payment.status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid payment status '{payment.status}'. Must be one of: {sorted(list(valid_statuses))}"
        )

    if payment.amount < 0:
        raise HTTPException(status_code=400, detail="Payment amount cannot be negative.")

    connection = get_connection()
    inv = connection.execute(
        "SELECT id, customer, email, total, currency, status FROM invoices WHERE id = ?",
        (payment.invoice_id,)
    ).fetchone()
    if not inv:
        connection.close()
        raise HTTPException(status_code=404, detail=f"Linked invoice '{payment.invoice_id}' not found.")

    # 2. Reject new payment creation on already Paid invoices
    if inv["status"] == "Paid":
        connection.close()
        raise HTTPException(
            status_code=400,
            detail=f"Invoice '{payment.invoice_id}' is already Paid. New payments cannot be initiated."
        )

    # 3. Decimal-safe amount verification against actual invoice
    expected_amt = Decimal(str(inv["total"])).quantize(Decimal("0.01"))
    try:
        req_amt = Decimal(str(payment.amount)).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError):
        connection.close()
        raise HTTPException(status_code=400, detail="Invalid payment amount format.")

    if req_amt != expected_amt:
        connection.close()
        raise HTTPException(
            status_code=400,
            detail=f"Payment amount mismatch: requested {req_amt}, but invoice total is {expected_amt}."
        )

    # 4. Strict currency verification against actual invoice
    expected_curr = (inv["currency"] or "USD").upper().strip()
    req_curr = (payment.currency or "USD").upper().strip()
    if req_curr != expected_curr:
        connection.close()
        raise HTTPException(
            status_code=400,
            detail=f"Payment currency mismatch: requested {req_curr}, but invoice currency is {expected_curr}."
        )

    # 5. Duplicate prevention: prevent duplicate paypal_capture_id
    if payment.paypal_capture_id:
        existing_cap = connection.execute(
            "SELECT id FROM payments WHERE paypal_capture_id = ?", (payment.paypal_capture_id,)
        ).fetchone()
        if existing_cap:
            connection.close()
            raise HTTPException(
                status_code=409,
                detail=f"Payment with capture ID '{payment.paypal_capture_id}' already exists (ID: {existing_cap['id']})."
            )

    now_iso = datetime.now(timezone.utc).isoformat()
    pay_id = f"PAY-{secrets.token_hex(4).upper()}"
    created_at = payment.created_at or now_iso

    # Enforce customer and email from verified invoice record
    verified_customer = inv["customer"]
    verified_email = inv["email"]

    connection.execute("""
        INSERT INTO payments (
            id, invoice_id, customer, email, amount, currency,
            status, provider, paypal_order_id, paypal_capture_id,
            failure_reason, created_at, paid_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    """, (
        pay_id,
        payment.invoice_id,
        verified_customer,
        verified_email,
        float(expected_amt),
        expected_curr,
        payment.status,
        payment.provider or "PayPal Sandbox",
        payment.paypal_order_id,
        payment.paypal_capture_id,
        payment.failure_reason,
        created_at
    ))

    # If status is Pending, keep invoice status in sync
    if payment.status == "Pending":
        connection.execute(
            "UPDATE invoices SET status = 'Pending', paypal_order_id = COALESCE(?, paypal_order_id) WHERE id = ? AND status != 'Paid'",
            (payment.paypal_order_id, payment.invoice_id)
        )

    connection.commit()
    connection.close()

    return {
        "id": pay_id,
        "invoice_id": payment.invoice_id,
        "customer": verified_customer,
        "email": verified_email,
        "amount": float(expected_amt),
        "currency": expected_curr,
        "status": payment.status,
        "provider": payment.provider or "PayPal Sandbox",
        "paypal_order_id": payment.paypal_order_id,
        "paypal_capture_id": payment.paypal_capture_id,
        "failure_reason": payment.failure_reason,
        "created_at": created_at,
        "paid_at": None
    }


# ---------------- CUSTOMER MANAGEMENT HELPERS & ENDPOINTS ----------------

def validate_customer_email(email: str) -> str:
    if not email or not isinstance(email, str) or not email.strip():
        raise HTTPException(status_code=400, detail="Customer email is required and cannot be empty.")
    clean = email.strip().lower()
    email_regex = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
    if not re.match(email_regex, clean):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid email address format: '{email}'. A valid email address (e.g., customer@example.com) is required."
        )
    return clean


def calculate_customer_stats(connection, customer_id: str, customer_email: str):
    """
    Calculates multi-currency financial statistics and associated invoice records for a customer.
    Separates currencies strictly without cross-currency addition.
    Excludes failed payment attempts from revenue.
    """
    norm_email = customer_email.strip().lower()
    invoices = connection.execute("""
        SELECT * FROM invoices
        WHERE customer_id = ? OR LOWER(TRIM(email)) = ?
        ORDER BY rowid DESC
    """, (customer_id, norm_email)).fetchall()

    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    total_invoices = len(invoices)
    paid_count = 0
    pending_count = 0
    overdue_count = 0

    total_paid = {}
    outstanding = {}

    invoice_list = []

    for inv in invoices:
        inv_keys = inv.keys()
        curr = (inv["currency"] if "currency" in inv_keys and inv["currency"] else "USD").upper().strip()
        status = (inv["status"] or "Draft").capitalize()
        status_lower = status.lower()
        amt = float(inv["total"] or 0)
        due_date = inv["due_date"] if "due_date" in inv_keys else None

        # Overdue: unpaid and due_date < today
        is_overdue = False
        if status_lower not in ("paid", "draft") and due_date and str(due_date).strip()[:10] < today_str:
            is_overdue = True

        if status_lower == "paid":
            paid_count += 1
            total_paid[curr] = round(total_paid.get(curr, 0.0) + amt, 2)
        elif status_lower == "pending":
            pending_count += 1
            outstanding[curr] = round(outstanding.get(curr, 0.0) + amt, 2)
        else: # Draft / unpaid
            outstanding[curr] = round(outstanding.get(curr, 0.0) + amt, 2)

        if is_overdue:
            overdue_count += 1

        invoice_list.append({
            "id": inv["id"],
            "customer": inv["customer"],
            "email": inv["email"],
            "total": amt,
            "currency": curr,
            "status": status,
            "due_date": due_date,
            "is_overdue": is_overdue,
            "paypal_order_id": inv["paypal_order_id"] if "paypal_order_id" in inv_keys else None,
            "paypal_capture_id": inv["paypal_capture_id"] if "paypal_capture_id" in inv_keys else None,
            "paid_at": inv["paid_at"] if "paid_at" in inv_keys else None
        })

    return {
        "total_invoices": total_invoices,
        "paid_invoices": paid_count,
        "pending_invoices": pending_count,
        "overdue_invoices": overdue_count,
        "total_paid": total_paid,
        "outstanding": outstanding,
        "invoices": invoice_list
    }


@app.get("/api/customers")
def get_customers(q: str | None = None):
    """
    Returns customer directory with real-time multi-currency invoice statistics.
    Supports optional search filter across name, email and company.
    """
    connection = get_connection()
    query = "SELECT * FROM customers"
    params = []
    if q and q.strip():
        search = f"%{q.strip().lower()}%"
        query += " WHERE LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(COALESCE(company, '')) LIKE ?"
        params.extend([search, search, search])
    query += " ORDER BY name ASC"

    rows = connection.execute(query, params).fetchall()

    result = []
    for row in rows:
        stats = calculate_customer_stats(connection, row["id"], row["email"])
        result.append({
            "id": row["id"],
            "name": row["name"],
            "email": row["email"],
            "phone": row["phone"],
            "company": row["company"],
            "address": row["address"],
            "notes": row["notes"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "total_invoices": stats["total_invoices"],
            "paid_invoices": stats["paid_invoices"],
            "pending_invoices": stats["pending_invoices"],
            "overdue_invoices": stats["overdue_invoices"],
            "total_paid": stats["total_paid"],
            "outstanding": stats["outstanding"]
        })

    connection.close()
    return result


@app.get("/api/customers/{customer_id}")
def get_customer(customer_id: str):
    """
    Returns full profile details for a customer, including multi-currency stats
    and associated invoice audit history.
    """
    connection = get_connection()
    row = connection.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
    if not row:
        connection.close()
        raise HTTPException(status_code=404, detail=f"Customer '{customer_id}' not found.")

    stats = calculate_customer_stats(connection, row["id"], row["email"])
    connection.close()

    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "phone": row["phone"],
        "company": row["company"],
        "address": row["address"],
        "notes": row["notes"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "total_invoices": stats["total_invoices"],
        "paid_invoices": stats["paid_invoices"],
        "pending_invoices": stats["pending_invoices"],
        "overdue_invoices": stats["overdue_invoices"],
        "total_paid": stats["total_paid"],
        "outstanding": stats["outstanding"],
        "invoices": stats["invoices"]
    }


@app.post("/api/customers", status_code=201)
def create_customer(data: CustomerCreateRequest):
    """
    Creates a new customer with normalized email uniqueness enforcement.
    Links existing unassociated invoices matching this normalized email.
    """
    if not data.name or not data.name.strip():
        raise HTTPException(status_code=400, detail="Customer name is required and cannot be empty.")

    clean_name = data.name.strip()
    clean_email = validate_customer_email(data.email)

    connection = get_connection()
    existing = connection.execute(
        "SELECT id FROM customers WHERE LOWER(TRIM(email)) = ?", (clean_email,)
    ).fetchone()

    if existing:
        connection.close()
        raise HTTPException(
            status_code=409,
            detail=f"A customer with email '{clean_email}' already exists (Customer ID: {existing['id']}). Duplicate customer emails are not permitted."
        )

    cust_id = f"CUST-{secrets.token_hex(4).upper()}"
    now_iso = datetime.now(timezone.utc).isoformat()

    phone_val = data.phone.strip() if data.phone and data.phone.strip() else None
    company_val = data.company.strip() if data.company and data.company.strip() else None
    address_val = data.address.strip() if data.address and data.address.strip() else None
    notes_val = data.notes.strip() if data.notes and data.notes.strip() else None

    connection.execute("""
        INSERT INTO customers (id, name, email, phone, company, address, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (cust_id, clean_name, clean_email, phone_val, company_val, address_val, notes_val, now_iso, now_iso))

    # Link historical invoices matching this email that lack customer_id
    connection.execute("""
        UPDATE invoices
        SET customer_id = ?
        WHERE LOWER(TRIM(email)) = ? AND (customer_id IS NULL OR customer_id = '')
    """, (cust_id, clean_email))

    connection.commit()
    connection.close()

    return {
        "id": cust_id,
        "name": clean_name,
        "email": clean_email,
        "phone": phone_val,
        "company": company_val,
        "address": address_val,
        "notes": notes_val,
        "created_at": now_iso,
        "updated_at": now_iso
    }


@app.put("/api/customers/{customer_id}")
def update_customer(customer_id: str, data: CustomerUpdateRequest):
    """
    Updates an existing customer record. Validates email uniqueness against other records.
    Preserves historical customer information on invoices.
    """
    connection = get_connection()
    existing = connection.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
    if not existing:
        connection.close()
        raise HTTPException(status_code=404, detail=f"Customer '{customer_id}' not found.")

    new_name = existing["name"]
    if data.name is not None:
        if not data.name.strip():
            connection.close()
            raise HTTPException(status_code=400, detail="Customer name cannot be empty.")
        new_name = data.name.strip()

    new_email = existing["email"]
    if data.email is not None:
        clean_email = validate_customer_email(data.email)
        duplicate = connection.execute(
            "SELECT id FROM customers WHERE LOWER(TRIM(email)) = ? AND id != ?",
            (clean_email, customer_id)
        ).fetchone()
        if duplicate:
            connection.close()
            raise HTTPException(
                status_code=409,
                detail=f"Cannot update customer: Email '{clean_email}' is already in use by another customer (ID: {duplicate['id']})."
            )
        new_email = clean_email

    new_phone = data.phone.strip() if data.phone is not None and data.phone.strip() else (existing["phone"] if data.phone is None else None)
    new_company = data.company.strip() if data.company is not None and data.company.strip() else (existing["company"] if data.company is None else None)
    new_address = data.address.strip() if data.address is not None and data.address.strip() else (existing["address"] if data.address is None else None)
    new_notes = data.notes.strip() if data.notes is not None and data.notes.strip() else (existing["notes"] if data.notes is None else None)
    now_iso = datetime.now(timezone.utc).isoformat()

    connection.execute("""
        UPDATE customers
        SET name = ?, email = ?, phone = ?, company = ?, address = ?, notes = ?, updated_at = ?
        WHERE id = ?
    """, (new_name, new_email, new_phone, new_company, new_address, new_notes, now_iso, customer_id))

    connection.commit()
    connection.close()

    return {
        "id": customer_id,
        "name": new_name,
        "email": new_email,
        "phone": new_phone,
        "company": new_company,
        "address": new_address,
        "notes": new_notes,
        "created_at": existing["created_at"],
        "updated_at": now_iso
    }


@app.delete("/api/customers/{customer_id}")
def delete_customer(customer_id: str):
    """
    Deletes a customer record. Strictly restricted if customer is associated with existing invoices
    to preserve historical financial records and audit integrity.
    Never cascade-deletes invoices or payment history.
    """
    connection = get_connection()
    existing = connection.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
    if not existing:
        connection.close()
        raise HTTPException(status_code=404, detail=f"Customer '{customer_id}' not found.")

    norm_email = existing["email"].strip().lower()
    inv_count = connection.execute("""
        SELECT COUNT(*) FROM invoices
        WHERE customer_id = ? OR LOWER(TRIM(email)) = ?
    """, (customer_id, norm_email)).fetchone()[0]

    if inv_count > 0:
        connection.close()
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete customer '{customer_id}' ({existing['name']}): {inv_count} associated invoice(s) exist. Historical accounting records must be preserved."
        )

    connection.execute("DELETE FROM customers WHERE id = ?", (customer_id,))
    connection.commit()
    connection.close()

    return {
        "message": "Customer deleted successfully",
        "id": customer_id
    }


# ---------------- REPORTS & ANALYTICS ENDPOINTS (PHASE B) ----------------

@app.get("/api/reports/analytics")
def get_reports_analytics(
    start_date: str | None = None,
    end_date: str | None = None,
    currency: str | None = None
):
    """
    Computes rigorous, multi-currency financial analytics directly from SQLite records.
    Strictly segregates USD, INR, EUR, etc. Never performs fake conversion or arithmetic cross-currency summing.
    """
    connection = get_connection()
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Fetch all invoices
    inv_rows = connection.execute("SELECT * FROM invoices ORDER BY rowid ASC").fetchall()

    # Filter invoices by date range and currency
    filtered_invoices = []
    target_currency = currency.strip().upper() if currency and currency.strip() else None

    for r in inv_rows:
        r_keys = r.keys()
        r_curr = (r["currency"] if "currency" in r_keys and r["currency"] else "USD").upper().strip()
        if target_currency and r_curr != target_currency:
            continue

        # Effective date: paid_at date if paid, else due_date, else fallback
        paid_at = r["paid_at"] if "paid_at" in r_keys else None
        due_date = r["due_date"] if "due_date" in r_keys else None
        eff_date = str(paid_at or due_date or "2026-01-01").strip()[:10]

        if start_date and eff_date < start_date.strip():
            continue
        if end_date and eff_date > end_date.strip():
            continue

        filtered_invoices.append(r)

    # Fetch all payments
    pay_rows = connection.execute("SELECT * FROM payments ORDER BY rowid ASC").fetchall()
    filtered_payments = []
    for p in pay_rows:
        p_curr = (p["currency"] or "USD").upper().strip()
        if target_currency and p_curr != target_currency:
            continue
        p_date = str(p["paid_at"] or p["created_at"] or "2026-01-01").strip()[:10]
        if start_date and p_date < start_date.strip():
            continue
        if end_date and p_date > end_date.strip():
            continue
        filtered_payments.append(p)

    # Compute Revenue & Status Metrics
    status_distribution = {
        "Paid": {"count": 0, "amounts": {}},
        "Pending": {"count": 0, "amounts": {}},
        "Draft": {"count": 0, "amounts": {}},
        "Overdue": {"count": 0, "amounts": {}}
    }

    total_paid = {}
    total_outstanding = {}
    total_overdue = {}
    total_portfolio = {}
    unique_currencies = set()
    monthly_map = {}
    customer_map = {}

    current_aging = {}
    overdue_1_30 = {}
    overdue_30_plus = {}

    for inv in filtered_invoices:
        inv_keys = inv.keys()
        c = (inv["currency"] if "currency" in inv_keys and inv["currency"] else "USD").upper().strip()
        unique_currencies.add(c)
        amt = float(inv["total"] or 0)
        status = (inv["status"] or "Draft").capitalize()
        due = inv["due_date"] if "due_date" in inv_keys else None

        # Check overdue
        is_overdue = False
        due_str = str(due).strip()[:10] if due else None
        if status not in ("Paid", "Draft") and due_str and due_str < today_str:
            is_overdue = True

        # Status bucket
        if status in status_distribution:
            status_distribution[status]["count"] += 1
            status_distribution[status]["amounts"][c] = round(
                status_distribution[status]["amounts"].get(c, 0.0) + amt, 2
            )
        else:
            status_distribution["Draft"]["count"] += 1
            status_distribution["Draft"]["amounts"][c] = round(
                status_distribution["Draft"]["amounts"].get(c, 0.0) + amt, 2
            )

        if is_overdue:
            status_distribution["Overdue"]["count"] += 1
            status_distribution["Overdue"]["amounts"][c] = round(
                status_distribution["Overdue"]["amounts"].get(c, 0.0) + amt, 2
            )
            total_overdue[c] = round(total_overdue.get(c, 0.0) + amt, 2)

            # Aging breakdown
            try:
                due_dt = datetime.strptime(due_str, "%Y-%m-%d").date()
                today_dt = datetime.strptime(today_str, "%Y-%m-%d").date()
                days_over = (today_dt - due_dt).days
                if days_over > 30:
                    overdue_30_plus[c] = round(overdue_30_plus.get(c, 0.0) + amt, 2)
                else:
                    overdue_1_30[c] = round(overdue_1_30.get(c, 0.0) + amt, 2)
            except Exception:
                overdue_1_30[c] = round(overdue_1_30.get(c, 0.0) + amt, 2)
        elif status != "Paid":
            current_aging[c] = round(current_aging.get(c, 0.0) + amt, 2)

        total_portfolio[c] = round(total_portfolio.get(c, 0.0) + amt, 2)

        if status == "Paid":
            total_paid[c] = round(total_paid.get(c, 0.0) + amt, 2)
        else:
            total_outstanding[c] = round(total_outstanding.get(c, 0.0) + amt, 2)

        # Monthly aggregation
        paid_at = inv["paid_at"] if "paid_at" in inv_keys else None
        ref_ts = paid_at or due or "2026-11-01"
        month_key = str(ref_ts)[:7]
        if not re.match(r"^\d{4}-\d{2}$", month_key):
            month_key = "2026-11"

        if month_key not in monthly_map:
            monthly_map[month_key] = {"month": month_key, "paid": {}, "invoiced": {}}
        monthly_map[month_key]["invoiced"][c] = round(
            monthly_map[month_key]["invoiced"].get(c, 0.0) + amt, 2
        )
        if status == "Paid":
            monthly_map[month_key]["paid"][c] = round(
                monthly_map[month_key]["paid"].get(c, 0.0) + amt, 2
            )

        # Customer aggregation
        cust_name = (inv["customer"] or "Unknown").strip()
        cust_email = (inv["email"] or "unknown@example.com").strip().lower()
        cust_key = f"{cust_name}___{cust_email}"
        if cust_key not in customer_map:
            customer_map[cust_key] = {
                "name": cust_name,
                "email": cust_email,
                "invoices_count": 0,
                "paid": {},
                "outstanding": {}
            }
        customer_map[cust_key]["invoices_count"] += 1
        if status == "Paid":
            customer_map[cust_key]["paid"][c] = round(
                customer_map[cust_key]["paid"].get(c, 0.0) + amt, 2
            )
        else:
            customer_map[cust_key]["outstanding"][c] = round(
                customer_map[cust_key]["outstanding"].get(c, 0.0) + amt, 2
            )

    # Sort monthly trends chronologically
    sorted_monthly = sorted(monthly_map.values(), key=lambda x: x["month"])

    # Sort customer breakdown by highest invoice count and revenue
    sorted_customers = sorted(
        customer_map.values(),
        key=lambda x: (sum(x["paid"].values()), x["invoices_count"]),
        reverse=True
    )

    # Payments Gateway Statistics
    completed_pays = [p for p in filtered_payments if (p["status"] or "").lower() == "completed"]
    pending_pays = [p for p in filtered_payments if (p["status"] or "").lower() == "pending"]
    failed_pays = [p for p in filtered_payments if (p["status"] or "").lower() == "failed"]

    settled_volume = {}
    for p in completed_pays:
        c = (p["currency"] or "USD").upper().strip()
        settled_volume[c] = round(settled_volume.get(c, 0.0) + float(p["amount"] or 0), 2)

    failed_volume = {}
    for p in failed_pays:
        c = (p["currency"] or "USD").upper().strip()
        failed_volume[c] = round(failed_volume.get(c, 0.0) + float(p["amount"] or 0), 2)

    total_attempts = len(completed_pays) + len(failed_pays)
    success_rate = round((len(completed_pays) / total_attempts * 100.0), 1) if total_attempts > 0 else 100.0

    connection.close()

    return {
        "date_range": {
            "start_date": start_date,
            "end_date": end_date
        },
        "currencies": sorted(list(unique_currencies)),
        "total_invoices_count": len(filtered_invoices),
        "status_distribution": status_distribution,
        "revenue_overview": {
            "total_paid": total_paid,
            "total_outstanding": total_outstanding,
            "total_overdue": total_overdue,
            "total_portfolio": total_portfolio
        },
        "payments_stats": {
            "total_transactions": len(filtered_payments),
            "completed_count": len(completed_pays),
            "pending_count": len(pending_pays),
            "failed_count": len(failed_pays),
            "success_rate_percent": success_rate,
            "settled_volume": settled_volume,
            "failed_volume": failed_volume
        },
        "monthly_trends": sorted_monthly,
        "customer_breakdown": sorted_customers,
        "outstanding_aging": {
            "current": current_aging,
            "overdue_1_30_days": overdue_1_30,
            "overdue_30_plus_days": overdue_30_plus
        }
    }


@app.get("/api/reports/export-csv")
def export_reports_csv(
    start_date: str | None = None,
    end_date: str | None = None,
    currency: str | None = None
):
    """
    Exports a structured CSV audit report of all invoices and their payment states.
    Allows date-range and currency filtering.
    """
    connection = get_connection()
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    inv_rows = connection.execute("SELECT * FROM invoices ORDER BY rowid DESC").fetchall()
    target_currency = currency.strip().upper() if currency and currency.strip() else None

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Invoice ID",
        "Customer Name",
        "Email",
        "Total Amount",
        "Currency",
        "Status",
        "Due Date",
        "Is Overdue",
        "Paid Date",
        "PayPal Order ID",
        "PayPal Capture ID"
    ])

    for inv in inv_rows:
        inv_keys = inv.keys()
        c = (inv["currency"] if "currency" in inv_keys and inv["currency"] else "USD").upper().strip()
        if target_currency and c != target_currency:
            continue

        paid_at = inv["paid_at"] if "paid_at" in inv_keys else None
        due_date = inv["due_date"] if "due_date" in inv_keys else None
        eff_date = str(paid_at or due_date or "2026-01-01").strip()[:10]

        if start_date and eff_date < start_date.strip():
            continue
        if end_date and eff_date > end_date.strip():
            continue

        status = (inv["status"] or "Draft").capitalize()
        due_str = str(due_date).strip()[:10] if due_date else ""
        is_overdue = "Yes" if (status not in ("Paid", "Draft") and due_str and due_str < today_str) else "No"

        writer.writerow([
            inv["id"],
            inv["customer"],
            inv["email"],
            f"{float(inv['total'] or 0):.2f}",
            c,
            status,
            due_str or "N/A",
            is_overdue,
            str(paid_at)[:19] if paid_at else "N/A",
            inv["paypal_order_id"] if "paypal_order_id" in inv_keys and inv["paypal_order_id"] else "N/A",
            inv["paypal_capture_id"] if "paypal_capture_id" in inv_keys and inv["paypal_capture_id"] else "N/A"
        ])

    connection.close()

    csv_data = output.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=paypilot_financial_report.csv",
            "Cache-Control": "no-cache"
        }
    )


# ---------------- APPLICATION SETTINGS ENDPOINTS (PHASE E) ----------------

@app.get("/api/settings")
def get_settings():
    """
    Returns current application and business invoicing preferences.
    """
    connection = get_connection()
    rows = connection.execute("SELECT key, value FROM settings").fetchall()
    connection.close()

    result = {}
    for r in rows:
        key = r["key"]
        val = r["value"]
        if key == "default_due_days":
            try:
                result[key] = int(val)
            except ValueError:
                result[key] = 30
        else:
            result[key] = val

    return result


@app.put("/api/settings")
def update_settings(data: SettingsUpdateRequest):
    """
    Updates application and business invoicing preferences with validation.
    """
    connection = get_connection()

    updates = {}
    if data.business_name is not None:
        if not data.business_name.strip():
            connection.close()
            raise HTTPException(status_code=400, detail="Business name cannot be empty.")
        updates["business_name"] = data.business_name.strip()

    if data.business_email is not None:
        clean_email = validate_customer_email(data.business_email)
        updates["business_email"] = clean_email

    if data.business_phone is not None:
        updates["business_phone"] = data.business_phone.strip()

    if data.business_address is not None:
        updates["business_address"] = data.business_address.strip()

    if data.tax_id is not None:
        updates["tax_id"] = data.tax_id.strip()

    if data.default_currency is not None:
        curr = data.default_currency.strip().upper()
        allowed_currencies = {"USD", "EUR", "GBP", "INR", "CAD", "AUD"}
        if curr not in allowed_currencies:
            connection.close()
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported currency '{curr}'. Must be one of: {sorted(list(allowed_currencies))}"
            )
        updates["default_currency"] = curr

    if data.default_due_days is not None:
        if data.default_due_days < 0 or data.default_due_days > 365:
            connection.close()
            raise HTTPException(status_code=400, detail="Default due days must be between 0 and 365.")
        updates["default_due_days"] = str(data.default_due_days)

    if data.invoice_prefix is not None:
        prefix = data.invoice_prefix.strip()
        if not prefix:
            connection.close()
            raise HTTPException(status_code=400, detail="Invoice prefix cannot be empty.")
        updates["invoice_prefix"] = prefix

    if data.default_notes is not None:
        updates["default_notes"] = data.default_notes.strip()

    for k, v in updates.items():
        connection.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
            (k, str(v), str(v))
        )

    connection.commit()
    connection.close()

    return get_settings()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
