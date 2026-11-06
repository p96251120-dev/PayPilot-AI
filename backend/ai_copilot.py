"""
PayPilot AI — Conversational Financial Intelligence & Copilot Engine
Answers natural-language business questions directly from SQLite records with zero hallucinations.
Supports multi-currency analytics, customer risk profiling, monthly revenue summaries,
actionable follow-up suggestions, and natural-language invoice generation.
"""

import re
import sqlite3
from datetime import datetime, timezone
from decimal import Decimal
from invoice_parser import parse_natural_language_invoice, is_ollama_ready

CURRENCY_SYMBOLS = {
    "USD": "$",
    "EUR": "€",
    "GBP": "£",
    "INR": "₹",
    "CAD": "CA$",
    "AUD": "AU$",
}

def format_currency_val(amount, currency="USD"):
    currency = (currency or "USD").upper().strip()
    sym = CURRENCY_SYMBOLS.get(currency, f"{currency} ")
    return f"{sym}{float(amount):,.2f}"

def format_multi_currency(curr_dict):
    if not curr_dict:
        return "$0.00 USD"
    parts = []
    for c, val in sorted(curr_dict.items()):
        if abs(val) > 0.0001 or len(curr_dict) == 1:
            parts.append(f"{format_currency_val(val, c)} {c}")
    return " · ".join(parts) if parts else "$0.00 USD"

def get_db_connection():
    import main
    return main.get_connection()

def detect_query_intent(query: str) -> tuple[str, dict]:
    """
    Classifies the user query into a business intent with extracted parameters.
    """
    q = (query or "").lower().strip()
    
    # 1. Invoice Drafting Intent
    invoice_draft_patterns = [
        r'\b(?:create|draft|generate|make|issue|new)\s+(?:an?\s+)?invoice\b',
        r'\bbill\s+[a-zA-Z]+\s+(?:for|email|\$|€|£|₹|\d)',
        r'\binvoice\s+for\s+[a-zA-Z]+'
    ]
    for pattern in invoice_draft_patterns:
        if re.search(pattern, q):
            return "draft_invoice", {}

    # 2. Specific Invoice ID Lookup
    inv_match = re.search(r'\b(inv-[a-zA-Z0-9_-]+)\b', q)
    if inv_match:
        return "invoice_lookup", {"invoice_id": inv_match.group(1).upper()}

    # 3. Follow-up Actions & Recommendations
    action_keywords = [
        "what should i do", "follow up", "follow-up", "action", "actions", "suggestion",
        "suggestions", "recommend", "recommendations", "next steps", "what actions", "to-do"
    ]
    if any(k in q for k in action_keywords):
        return "follow_up_actions", {}

    # 4. Monthly Summaries
    monthly_keywords = [
        "monthly", "month by month", "revenue by month", "monthly payment",
        "monthly summary", "monthly trend", "this month", "last month"
    ]
    if any(k in q for k in monthly_keywords):
        return "monthly_summary", {}

    # 5. Customers with pending / unpaid invoices (higher priority than general revenue)
    pending_cust_keywords = [
        "who owes", "pending customer", "pending clients", "customers with pending",
        "unpaid customer", "unpaid client", "who hasn't paid", "unsettled customer",
        "outstanding customer", "which customers", "customers who", "pending invoices"
    ]
    if any(k in q for k in pending_cust_keywords) and ("customer" in q or "client" in q or "who" in q):
        return "pending_customers", {}

    # 6. Specific Customer Profile lookup
    cust_match = re.search(r'(?:about|for|customer|client)\s+([a-zA-Z0-9_\.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+|[a-zA-Z]+(?:\s+[a-zA-Z]+)?)', q)
    if cust_match:
        cand = cust_match.group(1).strip()
        stop_words = ["an", "a", "the", "invoice", "payment", "revenue", "money", "pending", "paid", "overdue", "all", "customers", "clients"]
        if cand.lower() not in stop_words and len(cand) > 2:
            return "customer_lookup", {"customer_term": cand}

    # 7. Total revenue / Paid, Pending, Overdue breakdown (combines multiple statuses)
    if ("total" in q or "revenue" in q or "breakdown" in q or "summary" in q or "portfolio" in q) and ("paid" in q or "pending" in q or "overdue" in q or "all" in q):
        return "revenue_overview", {}

    # 8. Overdue Invoices (specific inquiry strictly about overdue)
    overdue_keywords = ["overdue", "late", "past due", "delinquent", "behind schedule"]
    if any(k in q for k in overdue_keywords):
        return "overdue_invoices", {}

    # 9. General revenue / financial health
    revenue_keywords = [
        "total revenue", "total paid", "how much money", "revenue summary",
        "portfolio", "receivables", "how much paid", "financial summary",
        "earnings", "collections", "cash flow", "overview"
    ]
    if any(k in q for k in revenue_keywords):
        return "revenue_overview", {}

    return "revenue_overview", {}


def query_ai_copilot(query: str, conn=None) -> dict:
    """
    Main entry point for processing AI Copilot queries.
    Queries SQLite live and generates structured responses.
    """
    if not query or not query.strip():
        return {
            "query": "",
            "intent": "empty",
            "title": "PayPilot AI Copilot",
            "narrative": "Please enter a question or business instruction. You can ask about total revenue, pending invoices, customer debts, monthly summaries, or ask to draft a new invoice.",
            "metrics": [],
            "table": None,
            "suggestions": [],
            "draft_invoice": None,
            "engine": "Deterministic Financial Intelligence (Local & Offline Safe)",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

    close_conn = False
    if conn is None:
        conn = get_db_connection()
        close_conn = True

    try:
        intent, params = detect_query_intent(query)

        if intent == "draft_invoice":
            res = handle_invoice_drafting(query)
        elif intent == "invoice_lookup":
            res = handle_invoice_lookup(conn, query, params.get("invoice_id"))
        elif intent == "follow_up_actions":
            res = handle_follow_up_actions(conn, query)
        elif intent == "overdue_invoices":
            res = handle_overdue_invoices(conn, query)
        elif intent == "pending_customers":
            res = handle_pending_customers(conn, query)
        elif intent == "monthly_summary":
            res = handle_monthly_summary(conn, query)
        elif intent == "customer_lookup":
            res = handle_customer_lookup(conn, query, params.get("customer_term"))
        elif intent == "revenue_overview":
            res = handle_revenue_overview(conn, query)
        else:
            res = handle_general_overview(conn, query)

        res["query"] = query
        res["engine"] = "Deterministic Financial Intelligence (Local & Offline Safe)"
        res["timestamp"] = datetime.now(timezone.utc).isoformat()
        return res
    finally:
        if close_conn and conn:
            conn.close()


# ---------------- INTENT HANDLERS ----------------

def handle_revenue_overview(conn, query: str) -> dict:
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    invoices = [dict(r) for r in conn.execute("SELECT * FROM invoices").fetchall()]
    payments = [dict(r) for r in conn.execute("SELECT * FROM payments").fetchall()]

    paid_totals = {}
    pending_totals = {}
    draft_totals = {}
    overdue_totals = {}
    total_portfolio = {}

    paid_count = 0
    pending_count = 0
    draft_count = 0
    overdue_count = 0

    for inv in invoices:
        c = (inv.get("currency") or "USD").upper().strip()
        amt = float(inv.get("total") or 0.0)
        status = (inv.get("status") or "Draft").capitalize()
        due = inv.get("due_date")
        due_str = str(due).strip()[:10] if due else None

        total_portfolio[c] = round(total_portfolio.get(c, 0.0) + amt, 2)

        is_overdue = False
        if status != "Paid" and due_str and due_str < today_str:
            is_overdue = True
            overdue_count += 1
            overdue_totals[c] = round(overdue_totals.get(c, 0.0) + amt, 2)

        if status == "Paid":
            paid_count += 1
            paid_totals[c] = round(paid_totals.get(c, 0.0) + amt, 2)
        elif status == "Pending":
            pending_count += 1
            pending_totals[c] = round(pending_totals.get(c, 0.0) + amt, 2)
        elif status == "Draft":
            draft_count += 1
            draft_totals[c] = round(draft_totals.get(c, 0.0) + amt, 2)

    narrative = (
        f"PayPilot AI has settled {format_multi_currency(paid_totals)} across {paid_count} completed invoice{'s' if paid_count != 1 else ''}. "
        f"There are currently {pending_count} pending checkout invoice{'s' if pending_count != 1 else ''} ({format_multi_currency(pending_totals)}) "
        f"and {draft_count} in-flight draft{'s' if draft_count != 1 else ''} ({format_multi_currency(draft_totals)}). "
        f"Overdue exposure is {format_multi_currency(overdue_totals)} across {overdue_count} invoice{'s' if overdue_count != 1 else ''} past payment terms."
    )

    metrics = [
        {"label": "Settled Revenue", "value": format_multi_currency(paid_totals), "badge": f"{paid_count} Paid", "type": "success"},
        {"label": "Pending Checkout", "value": format_multi_currency(pending_totals), "badge": f"{pending_count} Pending", "type": "warning"},
        {"label": "Overdue Risk", "value": format_multi_currency(overdue_totals), "badge": f"{overdue_count} Overdue", "type": "danger"},
        {"label": "In-Flight Drafts", "value": format_multi_currency(draft_totals), "badge": f"{draft_count} Drafts", "type": "neutral"},
    ]

    table = {
        "columns": ["Invoice Status", "Count", "Aggregate Value", "Settlement State"],
        "rows": [
            ["Paid (Settled)", str(paid_count), format_multi_currency(paid_totals), "Fully settled via verified capture"],
            ["Pending Checkout", str(pending_count), format_multi_currency(pending_totals), "Awaiting buyer sandbox authorization"],
            ["Overdue Risk", str(overdue_count), format_multi_currency(overdue_totals), "Due date elapsed · Action required"],
            ["Drafts", str(draft_count), format_multi_currency(draft_totals), "Saved in local ledger"],
            ["Total Portfolio", str(len(invoices)), format_multi_currency(total_portfolio), "Combined portfolio volume"]
        ]
    }

    suggestions = []
    if overdue_count > 0:
        suggestions.append({
            "id": "act-overdue",
            "title": "Address Delinquent Invoices",
            "description": f"You have {overdue_count} overdue invoice(s) with {format_multi_currency(overdue_totals)} in uncollected receivables.",
            "action_type": "navigate",
            "target_page": "Invoices",
            "filter_status": "Overdue",
            "button_label": "View Overdue Invoices →"
        })
    if pending_count > 0:
        suggestions.append({
            "id": "act-pending",
            "title": "Review Pending Checkout Orders",
            "description": f"{pending_count} invoice(s) have active payment orders awaiting PayPal confirmation.",
            "action_type": "navigate",
            "target_page": "Payments",
            "filter_status": "Pending",
            "button_label": "Inspect Payments Ledger →"
        })

    return {
        "intent": "revenue_overview",
        "title": "Revenue & Portfolio Summary",
        "narrative": narrative,
        "metrics": metrics,
        "table": table,
        "suggestions": suggestions,
        "draft_invoice": None
    }


def handle_pending_customers(conn, query: str) -> dict:
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    invoices = [dict(r) for r in conn.execute("SELECT * FROM invoices").fetchall()]
    customers = {r["email"].lower(): dict(r) for r in conn.execute("SELECT * FROM customers WHERE email IS NOT NULL").fetchall()}

    pending_invoices = [inv for inv in invoices if (inv.get("status") or "").lower() in ["pending", "draft"]]
    
    # Group by customer
    client_map = {}
    pending_totals = {}

    for inv in pending_invoices:
        cust_name = inv.get("customer") or "Unknown"
        cust_email = (inv.get("email") or "unknown@example.com").strip().lower()
        key = cust_email or cust_name.lower()
        c = (inv.get("currency") or "USD").upper().strip()
        amt = float(inv.get("total") or 0.0)
        status = inv.get("status")
        due = inv.get("due_date")
        
        is_overdue = False
        if status != "Paid" and due and str(due)[:10] < today_str:
            is_overdue = True

        pending_totals[c] = round(pending_totals.get(c, 0.0) + amt, 2)

        if key not in client_map:
            cust_record = customers.get(cust_email, {})
            client_map[key] = {
                "name": cust_name,
                "email": cust_email,
                "company": cust_record.get("company") or "—",
                "phone": cust_record.get("phone") or "—",
                "customer_id": cust_record.get("id") or "—",
                "invoices": [],
                "totals": {},
                "has_overdue": False
            }
        
        client_map[key]["invoices"].append(inv["id"])
        client_map[key]["totals"][c] = round(client_map[key]["totals"].get(c, 0.0) + amt, 2)
        if is_overdue:
            client_map[key]["has_overdue"] = True

    table_rows = []
    suggestions = []

    for key, data in sorted(client_map.items(), key=lambda x: len(x[1]["invoices"]), reverse=True):
        amt_str = format_multi_currency(data["totals"])
        invs_str = ", ".join(data["invoices"])
        status_tag = "⚠️ Overdue" if data["has_overdue"] else "Pending Payment"
        table_rows.append([
            data["name"],
            data["email"],
            data["company"],
            str(len(data["invoices"])),
            amt_str,
            invs_str,
            status_tag
        ])

        suggestions.append({
            "id": f"cust-remind-{data['name'].lower().replace(' ', '-')}",
            "title": f"Follow Up with {data['name']}",
            "description": f"Owes {amt_str} across {len(data['invoices'])} invoice(s) ({invs_str}).",
            "action_type": "filter_invoices",
            "target_page": "Invoices",
            "search_term": data["email"] if data["email"] != "unknown@example.com" else data["name"],
            "button_label": f"Filter Invoices for {data['name']} →"
        })

    narrative = (
        f"Identified {len(client_map)} customer(s) with unpaid or pending invoices totaling {format_multi_currency(pending_totals)} "
        f"across {len(pending_invoices)} invoice(s)."
    )

    metrics = [
        {"label": "Clients with Unpaid Invoices", "value": str(len(client_map)), "type": "warning"},
        {"label": "Total Unpaid Receivables", "value": format_multi_currency(pending_totals), "type": "danger"},
        {"label": "Unpaid Invoices Count", "value": str(len(pending_invoices)), "type": "neutral"},
    ]

    table = {
        "columns": ["Customer", "Email", "Company", "Invoices Count", "Balance Owed", "Invoice IDs", "Status"],
        "rows": table_rows
    }

    return {
        "intent": "pending_customers",
        "title": "Customers with Pending Invoices",
        "narrative": narrative,
        "metrics": metrics,
        "table": table,
        "suggestions": suggestions[:4],
        "draft_invoice": None
    }


def handle_monthly_summary(conn, query: str) -> dict:
    invoices = [dict(r) for r in conn.execute("SELECT * FROM invoices").fetchall()]
    payments = [dict(r) for r in conn.execute("SELECT * FROM payments").fetchall()]

    monthly_data = {}

    for inv in invoices:
        paid_at = inv.get("paid_at")
        due = inv.get("due_date")
        ref_date = str(paid_at or due or "2026-11-01")[:7]
        if not re.match(r"^\d{4}-\d{2}$", ref_date):
            ref_date = "2026-11"

        c = (inv.get("currency") or "USD").upper().strip()
        amt = float(inv.get("total") or 0.0)
        status = (inv.get("status") or "Draft").capitalize()

        if ref_date not in monthly_data:
            monthly_data[ref_date] = {
                "month": ref_date,
                "invoiced_count": 0,
                "invoiced_amounts": {},
                "paid_amounts": {},
                "completed_payments": 0,
                "failed_payments": 0,
                "pending_payments": 0
            }

        monthly_data[ref_date]["invoiced_count"] += 1
        monthly_data[ref_date]["invoiced_amounts"][c] = round(
            monthly_data[ref_date]["invoiced_amounts"].get(c, 0.0) + amt, 2
        )
        if status == "Paid":
            monthly_data[ref_date]["paid_amounts"][c] = round(
                monthly_data[ref_date]["paid_amounts"].get(c, 0.0) + amt, 2
            )

    for p in payments:
        p_date = str(p.get("paid_at") or p.get("created_at") or "2026-11-01")[:7]
        if not re.match(r"^\d{4}-\d{2}$", p_date):
            p_date = "2026-11"
        st = (p.get("status") or "").lower()
        if p_date in monthly_data:
            if st == "completed":
                monthly_data[p_date]["completed_payments"] += 1
            elif st == "failed":
                monthly_data[p_date]["failed_payments"] += 1
            elif st == "pending":
                monthly_data[p_date]["pending_payments"] += 1

    table_rows = []
    total_paid_all = {}
    total_invoiced_all = {}

    for m in sorted(monthly_data.keys(), reverse=True):
        d = monthly_data[m]
        inv_amt = format_multi_currency(d["invoiced_amounts"])
        paid_amt = format_multi_currency(d["paid_amounts"])
        
        for c, v in d["paid_amounts"].items():
            total_paid_all[c] = round(total_paid_all.get(c, 0.0) + v, 2)
        for c, v in d["invoiced_amounts"].items():
            total_invoiced_all[c] = round(total_invoiced_all.get(c, 0.0) + v, 2)

        tot_tx = d["completed_payments"] + d["failed_payments"]
        rate = f"{round((d['completed_payments'] / tot_tx) * 100)}%" if tot_tx > 0 else "100%"

        table_rows.append([
            m,
            str(d["invoiced_count"]),
            inv_amt,
            paid_amt,
            str(d["completed_payments"]),
            rate
        ])

    narrative = (
        f"Aggregated monthly financial records across {len(monthly_data)} billing period(s). "
        f"Cumulative settled revenue is {format_multi_currency(total_paid_all)} out of {format_multi_currency(total_invoiced_all)} invoiced."
    )

    metrics = [
        {"label": "Active Periods", "value": f"{len(monthly_data)} Months", "type": "neutral"},
        {"label": "Total Invoiced", "value": format_multi_currency(total_invoiced_all), "type": "neutral"},
        {"label": "Total Settled", "value": format_multi_currency(total_paid_all), "type": "success"},
    ]

    table = {
        "columns": ["Billing Month", "Invoices Created", "Invoiced Volume", "Settled Revenue", "Completed Tx", "Success Rate"],
        "rows": table_rows
    }

    suggestions = [
        {
            "id": "act-reports",
            "title": "Open Visual Reports Dashboard",
            "description": "View monthly distribution charts and CSV export tools.",
            "action_type": "navigate",
            "target_page": "Reports",
            "button_label": "View Reports & Charts →"
        }
    ]

    return {
        "intent": "monthly_summary",
        "title": "Monthly Payment & Billing Summary",
        "narrative": narrative,
        "metrics": metrics,
        "table": table,
        "suggestions": suggestions,
        "draft_invoice": None
    }


def handle_overdue_invoices(conn, query: str) -> dict:
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    today_dt = datetime.strptime(today_str, "%Y-%m-%d").date()
    invoices = [dict(r) for r in conn.execute("SELECT * FROM invoices").fetchall()]

    overdue_invoices = []
    overdue_totals = {}

    for inv in invoices:
        status = (inv.get("status") or "Draft").capitalize()
        due = inv.get("due_date")
        if status != "Paid" and due:
            due_str = str(due)[:10]
            if due_str < today_str:
                c = (inv.get("currency") or "USD").upper().strip()
                amt = float(inv.get("total") or 0.0)
                overdue_totals[c] = round(overdue_totals.get(c, 0.0) + amt, 2)
                
                days_over = 0
                try:
                    due_d = datetime.strptime(due_str, "%Y-%m-%d").date()
                    days_over = (today_dt - due_d).days
                except Exception:
                    pass

                overdue_invoices.append({
                    "id": inv["id"],
                    "customer": inv.get("customer") or "Unknown",
                    "email": inv.get("email") or "—",
                    "total": amt,
                    "currency": c,
                    "due_date": due_str,
                    "days_overdue": days_over
                })

    overdue_invoices.sort(key=lambda x: x["days_overdue"], reverse=True)

    table_rows = []
    suggestions = []

    for inv in overdue_invoices:
        amt_str = f"{format_currency_val(inv['total'], inv['currency'])} {inv['currency']}"
        table_rows.append([
            inv["id"],
            inv["customer"],
            inv["email"],
            amt_str,
            inv["due_date"],
            f"{inv['days_overdue']} days overdue"
        ])

        suggestions.append({
            "id": f"act-overdue-{inv['id']}",
            "title": f"Follow Up on {inv['id']}",
            "description": f"{inv['customer']} owes {amt_str} (Due on {inv['due_date']}, {inv['days_overdue']} days late).",
            "action_type": "filter_invoices",
            "target_page": "Invoices",
            "search_term": inv["id"],
            "button_label": f"Inspect {inv['id']} →"
        })

    if overdue_invoices:
        narrative = (
            f"Found {len(overdue_invoices)} overdue invoice(s) totaling {format_multi_currency(overdue_totals)}. "
            f"The oldest delinquent invoice is {overdue_invoices[0]['id']} ({overdue_invoices[0]['days_overdue']} days past due)."
        )
    else:
        narrative = "Good news! There are currently zero overdue invoices in your portfolio."

    metrics = [
        {"label": "Overdue Invoices", "value": str(len(overdue_invoices)), "type": "danger" if overdue_invoices else "success"},
        {"label": "Total Delinquent Value", "value": format_multi_currency(overdue_totals), "type": "danger" if overdue_invoices else "success"},
    ]

    table = {
        "columns": ["Invoice ID", "Customer", "Email", "Amount", "Due Date", "Days Delinquent"],
        "rows": table_rows
    } if overdue_invoices else None

    return {
        "intent": "overdue_invoices",
        "title": "Delinquent & Overdue Invoices Analysis",
        "narrative": narrative,
        "metrics": metrics,
        "table": table,
        "suggestions": suggestions[:4],
        "draft_invoice": None
    }


def handle_follow_up_actions(conn, query: str) -> dict:
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    today_dt = datetime.strptime(today_str, "%Y-%m-%d").date()
    invoices = [dict(r) for r in conn.execute("SELECT * FROM invoices").fetchall()]

    suggestions = []
    table_rows = []

    # 1. Check for overdue invoices
    for inv in invoices:
        status = (inv.get("status") or "Draft").capitalize()
        due = inv.get("due_date")
        if status != "Paid" and due:
            due_str = str(due)[:10]
            if due_str < today_str:
                days_over = (today_dt - datetime.strptime(due_str, "%Y-%m-%d").date()).days
                amt_str = f"{format_currency_val(inv['total'], inv['currency'])} {inv.get('currency', 'USD')}"
                table_rows.append(["High", f"Delinquent Invoice {inv['id']}", inv.get("customer", "Unknown"), f"Send payment reminder ({days_over} days late, {amt_str})"])
                suggestions.append({
                    "id": f"act-rec-overdue-{inv['id']}",
                    "priority": "High",
                    "title": f"Dispatch Reminder: {inv['id']} ({inv.get('customer')})",
                    "description": f"Invoice {inv['id']} is {days_over} days overdue ({amt_str}). Follow up with {inv.get('email')}.",
                    "action_type": "filter_invoices",
                    "target_page": "Invoices",
                    "search_term": inv["id"],
                    "button_label": f"Inspect {inv['id']} →"
                })

    # 2. Check for pending checkout invoices (order created but not captured)
    for inv in invoices:
        if (inv.get("status") or "").capitalize() == "Pending":
            amt_str = f"{format_currency_val(inv['total'], inv['currency'])} {inv.get('currency', 'USD')}"
            table_rows.append(["Medium", f"Pending Checkout {inv['id']}", inv.get("customer", "Unknown"), f"Verify PayPal capture ({amt_str})"])
            suggestions.append({
                "id": f"act-rec-pending-{inv['id']}",
                "priority": "Medium",
                "title": f"Complete PayPal Checkout: {inv['id']}",
                "description": f"Order {inv.get('paypal_order_id') or 'N/A'} is awaiting completion for {amt_str}.",
                "action_type": "filter_invoices",
                "target_page": "Invoices",
                "search_term": inv["id"],
                "button_label": f"Open Checkout for {inv['id']} →"
            })

    # 3. Check for draft invoices
    drafts = [inv for inv in invoices if (inv.get("status") or "").capitalize() == "Draft"]
    if drafts:
        table_rows.append(["Low", f"{len(drafts)} Draft Invoices", "Multiple Clients", "Finalize and dispatch drafts to clients"])
        suggestions.append({
            "id": "act-rec-drafts",
            "priority": "Low",
            "title": f"Review {len(drafts)} In-Flight Drafts",
            "description": f"You have {len(drafts)} draft invoice(s) ready to be sent or checked out.",
            "action_type": "navigate",
            "target_page": "Invoices",
            "filter_status": "Draft",
            "button_label": "Review Draft Invoices →"
        })

    narrative = (
        f"Generated {len(suggestions)} prioritized business follow-up recommendation(s) based on live ledger analysis. "
        f"Focus on resolving delinquent receivables and capturing open checkout transactions."
    )

    metrics = [
        {"label": "Recommended Actions", "value": str(len(suggestions)), "type": "warning"},
        {"label": "High Priority", "value": str(sum(1 for s in suggestions if s.get("priority") == "High")), "type": "danger"},
        {"label": "Medium Priority", "value": str(sum(1 for s in suggestions if s.get("priority") == "Medium")), "type": "neutral"},
    ]

    table = {
        "columns": ["Priority", "Task / Target", "Entity", "Recommended Action"],
        "rows": table_rows
    } if table_rows else None

    return {
        "intent": "follow_up_actions",
        "title": "Actionable Business Recommendations",
        "narrative": narrative,
        "metrics": metrics,
        "table": table,
        "suggestions": suggestions[:5],
        "draft_invoice": None
    }


def handle_customer_lookup(conn, query: str, customer_term: str) -> dict:
    if not customer_term:
        return handle_general_overview(conn, query)

    term = customer_term.strip().lower()
    invoices = [dict(r) for r in conn.execute("SELECT * FROM invoices").fetchall()]
    customers = [dict(r) for r in conn.execute("SELECT * FROM customers").fetchall()]

    # Match customer
    matched_cust = None
    for c in customers:
        if term in (c.get("name") or "").lower() or term in (c.get("email") or "").lower():
            matched_cust = c
            break

    cust_invoices = [
        inv for inv in invoices
        if term in (inv.get("customer") or "").lower() or term in (inv.get("email") or "").lower()
    ]

    if not cust_invoices and not matched_cust:
        return {
            "intent": "customer_lookup",
            "title": f"Customer Lookup: {customer_term}",
            "narrative": f"No customer record or invoice history was found matching '{customer_term}'.",
            "metrics": [{"label": "Search Term", "value": customer_term, "type": "neutral"}],
            "table": None,
            "suggestions": [
                {
                    "id": "act-add-cust",
                    "title": "Create Customer Record",
                    "description": f"Add {customer_term} to the Customer Directory.",
                    "action_type": "navigate",
                    "target_page": "Customers",
                    "button_label": "Go to Customers Directory →"
                }
            ],
            "draft_invoice": None
        }

    cust_name = matched_cust.get("name") if matched_cust else cust_invoices[0].get("customer")
    cust_email = matched_cust.get("email") if matched_cust else cust_invoices[0].get("email")

    paid_totals = {}
    pending_totals = {}

    table_rows = []
    for inv in cust_invoices:
        c = (inv.get("currency") or "USD").upper().strip()
        amt = float(inv.get("total") or 0.0)
        status = (inv.get("status") or "Draft").capitalize()
        
        if status == "Paid":
            paid_totals[c] = round(paid_totals.get(c, 0.0) + amt, 2)
        else:
            pending_totals[c] = round(pending_totals.get(c, 0.0) + amt, 2)

        table_rows.append([
            inv["id"],
            f"{format_currency_val(amt, c)} {c}",
            status,
            str(inv.get("due_date") or "—"),
            str(inv.get("paypal_order_id") or "—")
        ])

    narrative = (
        f"Customer profile for {cust_name} ({cust_email}): Total paid is {format_multi_currency(paid_totals)} "
        f"across {len([i for i in cust_invoices if i.get('status') == 'Paid'])} paid invoice(s). "
        f"Outstanding balance is {format_multi_currency(pending_totals)} across {len([i for i in cust_invoices if i.get('status') != 'Paid'])} unpaid invoice(s)."
    )

    metrics = [
        {"label": "Total Invoices", "value": str(len(cust_invoices)), "type": "neutral"},
        {"label": "Settled Revenue", "value": format_multi_currency(paid_totals), "type": "success"},
        {"label": "Outstanding Balance", "value": format_multi_currency(pending_totals), "type": "warning" if pending_totals else "neutral"},
    ]

    table = {
        "columns": ["Invoice ID", "Amount", "Status", "Due Date", "PayPal Order Ref"],
        "rows": table_rows
    }

    suggestions = [
        {
            "id": f"act-filter-{cust_name.lower().replace(' ', '-')}",
            "title": f"View All Invoices for {cust_name}",
            "description": f"Filter the invoice management view for {cust_name}.",
            "action_type": "filter_invoices",
            "target_page": "Invoices",
            "search_term": cust_email,
            "button_label": "View Invoices →"
        }
    ]

    return {
        "intent": "customer_lookup",
        "title": f"Customer Profile: {cust_name}",
        "narrative": narrative,
        "metrics": metrics,
        "table": table,
        "suggestions": suggestions,
        "draft_invoice": None
    }


def handle_invoice_lookup(conn, query: str, invoice_id: str) -> dict:
    inv = conn.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,)).fetchone()
    if not inv:
        return {
            "intent": "invoice_lookup",
            "title": f"Invoice Lookup: {invoice_id}",
            "narrative": f"Invoice '{invoice_id}' was not found in SQLite records.",
            "metrics": [{"label": "Invoice ID", "value": invoice_id, "type": "neutral"}],
            "table": None,
            "suggestions": [],
            "draft_invoice": None
        }

    inv = dict(inv)
    payments = [dict(r) for r in conn.execute("SELECT * FROM payments WHERE invoice_id = ?", (invoice_id,)).fetchall()]

    amt_str = f"{format_currency_val(inv['total'], inv['currency'])} {inv.get('currency', 'USD')}"
    status = inv.get("status") or "Draft"

    narrative = (
        f"Invoice {invoice_id} for {inv.get('customer')} ({inv.get('email')}): "
        f"Amount is {amt_str}, Status is '{status}'. "
        f"Due date: {inv.get('due_date') or 'None specified'}. "
        f"PayPal Order ID: {inv.get('paypal_order_id') or 'None'}. "
        f"Capture Ref: {inv.get('paypal_capture_id') or 'None'}."
    )

    metrics = [
        {"label": "Invoice Total", "value": amt_str, "type": "neutral"},
        {"label": "Current Status", "value": status, "type": "success" if status == "Paid" else "warning"},
        {"label": "Payment Attempts", "value": str(len(payments)), "type": "neutral"},
    ]

    table_rows = []
    for p in payments:
        p_amt = f"{format_currency_val(p['amount'], p['currency'])} {p.get('currency', 'USD')}"
        table_rows.append([
            p["id"],
            p_amt,
            p.get("status") or "—",
            p.get("provider") or "PayPal Sandbox",
            str(p.get("created_at") or "")[:19],
            str(p.get("paypal_capture_id") or p.get("paypal_order_id") or "—")
        ])

    table = {
        "columns": ["Payment ID", "Amount", "Status", "Provider", "Created At", "Transaction Ref"],
        "rows": table_rows
    } if table_rows else None

    suggestions = [
        {
            "id": f"act-view-{invoice_id}",
            "title": f"Open Invoice {invoice_id}",
            "description": f"Inspect or edit details for invoice {invoice_id}.",
            "action_type": "filter_invoices",
            "target_page": "Invoices",
            "search_term": invoice_id,
            "button_label": "View in Invoice Ledger →"
        }
    ]

    return {
        "intent": "invoice_lookup",
        "title": f"Invoice Details: {invoice_id}",
        "narrative": narrative,
        "metrics": metrics,
        "table": table,
        "suggestions": suggestions,
        "draft_invoice": None
    }


def handle_invoice_drafting(query: str) -> dict:
    parsed = parse_natural_language_invoice(query)
    cust = parsed.get("customer") or "Client"
    curr = parsed.get("currency") or "USD"
    tot = parsed.get("total") or 0.0

    narrative = (
        f"Parsed invoice draft for {cust}: Extracted {len(parsed.get('items', []))} line item(s) "
        f"totaling {format_currency_val(tot, curr)} {curr}. You can review and transfer this draft directly to the invoice form."
    )

    metrics = [
        {"label": "Customer", "value": cust, "type": "neutral"},
        {"label": "Draft Total", "value": f"{format_currency_val(tot, curr)} {curr}", "type": "success"},
        {"label": "Line Items", "value": str(len(parsed.get("items", []))), "type": "neutral"},
    ]

    return {
        "intent": "draft_invoice",
        "title": f"Invoice Draft Blueprint ({cust})",
        "narrative": narrative,
        "metrics": metrics,
        "table": None,
        "suggestions": [
            {
                "id": "act-transfer-form",
                "title": "Transfer to Invoice Form",
                "description": "Pre-populates the standard invoice form with these parsed line items.",
                "action_type": "transfer_draft",
                "button_label": "Transfer to Form →"
            }
        ],
        "draft_invoice": parsed
    }


def handle_general_overview(conn, query: str) -> dict:
    return handle_revenue_overview(conn, query)
