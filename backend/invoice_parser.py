import re
import json
import urllib.request
import datetime
from decimal import Decimal, ROUND_HALF_UP

CURRENCY_SYMBOLS = {
    "$": "USD",
    "€": "EUR",
    "£": "GBP",
    "₹": "INR",
}

CURRENCY_WORDS = {
    "usd": "USD",
    "dollar": "USD",
    "dollars": "USD",
    "eur": "EUR",
    "euro": "EUR",
    "euros": "EUR",
    "gbp": "GBP",
    "pound": "GBP",
    "pounds": "GBP",
    "inr": "INR",
    "rupee": "INR",
    "rupees": "INR",
    "cad": "CAD",
    "aud": "AUD",
}

NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "twenty": 20, "thirty": 30,
    "forty": 40, "fifty": 50, "hundred": 100
}


def is_ollama_ready() -> bool:
    """Fast probe (200ms) to check if local Ollama daemon is active."""
    try:
        with urllib.request.urlopen("http://localhost:11434/api/tags", timeout=0.2) as resp:
            return resp.status == 200
    except Exception:
        return False


def query_ollama_parser(prompt: str, timeout_sec: float = 3.0) -> dict | None:
    """
    Attempts to parse invoice using local Ollama model (qwen3:8b) if requested.
    Returns structured dict if successful within timeout, or None on failure/timeout.
    """
    if not is_ollama_ready():
        return None

    try:
        req_data = {
            "model": "qwen3:8b-q4_K_M",
            "prompt": f"""You are an invoice parser. Extract the structured invoice data from the description.
Respond ONLY with a valid JSON object matching this schema:
{{
  "customer": "Customer Name",
  "email": "customer@example.com",
  "currency": "USD",
  "due_date": "YYYY-MM-DD",
  "items": [
    {{
      "description": "Item description",
      "quantity": 1,
      "price": 25.0
    }}
  ]
}}
Do not write markdown formatting, backticks, or explanation. Just the raw JSON.
Text: {prompt}""",
            "stream": False,
            "format": "json",
            "options": {
                "temperature": 0.1,
                "num_predict": 250
            }
        }
        req = urllib.request.Request(
            "http://localhost:11434/api/generate",
            data=json.dumps(req_data).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            parsed = json.loads(data.get("response", "{}"))
            if parsed and isinstance(parsed, dict) and "items" in parsed:
                return parsed
    except Exception:
        return None
    return None


def parse_natural_language_invoice(prompt: str, try_llm: bool = False) -> dict:
    """
    Parses a natural-language description into structured invoice data.

    Extracts:
      - Customer name
      - Customer email
      - Currency (with single-currency-per-invoice validation)
      - Due date (explicit dates or relative offsets like 'due in 15 days')
      - Line items (description, quantity, unit price, line total)
      - Grand total (using decimal-safe arithmetic)
      - Missing fields checklist for user clarification
      - Engine metadata (distinguishing local LLM vs deterministic fallback)
    """
    if not prompt or not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("Please provide an invoice description.")

    text = prompt.strip()

    # If explicitly requested and available, attempt local Ollama LLM
    if try_llm:
        llm_result = query_ollama_parser(text, timeout_sec=2.5)
        if llm_result and isinstance(llm_result, dict):
            customer = str(llm_result.get("customer") or "").strip()
            email = str(llm_result.get("email") or "").strip()
            currency = str(llm_result.get("currency") or "USD").upper().strip()
            due_date = str(llm_result.get("due_date") or "").strip() or None
            raw_items = llm_result.get("items") or []

            items = []
            for it in raw_items:
                desc = str(it.get("description") or "Item").strip()
                qty = max(1, int(it.get("quantity") or 1))
                try:
                    price = float(Decimal(str(it.get("price") or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
                except Exception:
                    price = 0.0
                line_tot = float((Decimal(str(qty)) * Decimal(str(price))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
                items.append({
                    "description": desc,
                    "quantity": qty,
                    "price": price,
                    "total": line_tot
                })

            grand_total = Decimal("0.00")
            for it in items:
                grand_total += Decimal(str(it["total"]))
            grand_total_float = float(grand_total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))

            missing_fields = []
            if not customer:
                missing_fields.append("Customer name is missing.")
            if not email or "@" not in email:
                missing_fields.append("Customer email is missing or invalid.")
            if not items:
                missing_fields.append("No line items could be extracted.")

            return {
                "customer": customer,
                "email": email,
                "currency": currency,
                "due_date": due_date,
                "items": items,
                "total": grand_total_float,
                "missing_fields": missing_fields,
                "is_complete": len(missing_fields) == 0,
                "engine": "Local Ollama LLM (qwen3:8b)",
                "engine_type": "local_llm",
                "engine_badge": "🤖 Local Ollama LLM (qwen3:8b)"
            }

    # Deterministic Local NLP Parser Engine
    engine_used = "Deterministic Local NLP Parser"
    engine_badge = "⚡ Local NLP Parser (Deterministic & Instant)"

    # 1. Detect Currency and check for conflicts
    found_currencies = set()
    for sym, curr in CURRENCY_SYMBOLS.items():
        if sym in text:
            found_currencies.add(curr)

    for word, curr in CURRENCY_WORDS.items():
        if re.search(r'\b' + re.escape(word) + r'\b', text, re.IGNORECASE):
            found_currencies.add(curr)

    if len(found_currencies) > 1:
        curr_list = ", ".join(sorted(found_currencies))
        raise ValueError(
            f"Multiple currencies detected ({curr_list}). PayPilot AI invoices strictly support a single currency per invoice."
        )

    currency = found_currencies.pop() if len(found_currencies) == 1 else "USD"

    # 2. Extract Customer Email
    email_match = re.search(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', text)
    email = email_match.group(0) if email_match else ""

    working_text = text
    if email:
        # Strip email and preceding 'email:' or ', email' cleanly
        working_text = re.sub(r'(?:,\s*)?(?:with\s+)?email\s*[:=]?\s*' + re.escape(email), "", working_text, flags=re.IGNORECASE)
        working_text = working_text.replace(email, "")

    # 3. Extract Due Date (Explicit or Relative)
    due_date = None
    today = datetime.date.today()

    # Explicit due date formats: "due on 2026-11-30", "due by 2026-11-30", "due date: 2026-11-30"
    explicit_date_pattern = re.compile(
        r'\b(?:due(?:\s+(?:on|by|date:?|before))?|by)\s*[:=]?\s*(\d{4}-\d{2}-\d{2})\b',
        re.IGNORECASE
    )
    m_exp = explicit_date_pattern.search(working_text)
    if m_exp:
        due_date = m_exp.group(1)
        working_text = working_text[:m_exp.start()] + " " + working_text[m_exp.end():]
    else:
        # Explicit format DD/MM/YYYY or DD-MM-YYYY
        explicit_dmy_pattern = re.compile(
            r'\b(?:due(?:\s+(?:on|by|date:?|before))?|by)\s*[:=]?\s*(\d{2})[/-](\d{2})[/-](\d{4})\b',
            re.IGNORECASE
        )
        m_dmy = explicit_dmy_pattern.search(working_text)
        if m_dmy:
            d, m_val, y = m_dmy.groups()
            due_date = f"{y}-{m_val}-{d}"
            working_text = working_text[:m_dmy.start()] + " " + working_text[m_dmy.end():]

    # Relative due date formats: "due in 15 days", "net 30", "due in 2 weeks"
    if not due_date:
        rel_days_pattern = re.compile(
            r'\b(?:due\s+in\s+(\d+)\s+days?|net\s*(\d+))\b',
            re.IGNORECASE
        )
        m_rel = rel_days_pattern.search(working_text)
        if m_rel:
            days = int(m_rel.group(1) or m_rel.group(2))
            due_date = (today + datetime.timedelta(days=days)).isoformat()
            working_text = working_text[:m_rel.start()] + " " + working_text[m_rel.end():]

    if not due_date:
        rel_weeks_pattern = re.compile(
            r'\b(?:due\s+in\s+(\d+)\s+weeks?|due\s+in\s+a\s+week)\b',
            re.IGNORECASE
        )
        m_w = rel_weeks_pattern.search(working_text)
        if m_w:
            weeks = int(m_w.group(1)) if m_w.group(1) else 1
            due_date = (today + datetime.timedelta(days=weeks * 7)).isoformat()
            working_text = working_text[:m_w.start()] + " " + working_text[m_w.end():]

    if not due_date:
        rel_months_pattern = re.compile(
            r'\b(?:due\s+in\s+(\d+)\s+months?|due\s+in\s+a\s+month)\b',
            re.IGNORECASE
        )
        m_m = rel_months_pattern.search(working_text)
        if m_m:
            months = int(m_m.group(1)) if m_m.group(1) else 1
            due_date = (today + datetime.timedelta(days=months * 30)).isoformat()
            working_text = working_text[:m_m.start()] + " " + working_text[m_m.end():]

    # 4. Extract Global/Single Amount if present (e.g. "amount $500 USD", "total $750 USD", "amount EUR 300")
    global_amount = None
    m_amt = re.search(
        r'\b(?:amount|total|sum)\s*(?:is|of|:)?\s*(?:[$€£₹]\s*(\d+(?:\.\d{1,2})?)|(?:USD|EUR|GBP|INR|CAD|AUD)\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:USD|EUR|GBP|INR|CAD|AUD)?)\b',
        working_text,
        re.IGNORECASE
    )
    if m_amt:
        val_str = m_amt.group(1) or m_amt.group(2) or m_amt.group(3)
        if val_str:
            try:
                global_amount = float(Decimal(val_str).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
            except Exception:
                global_amount = None

    # Check for standalone price like ", $500 USD," or ", 500 USD,"
    if global_amount is None:
        m_std = re.search(r'(?:,\s*|\b)(?:[$€£₹]\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:USD|EUR|GBP|INR|CAD|AUD))\b', working_text, re.IGNORECASE)
        if m_std:
            val_str = m_std.group(1) or m_std.group(2)
            if val_str:
                try:
                    global_amount = float(Decimal(val_str).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
                except Exception:
                    global_amount = None

    # 5. Customer & Description Separation
    customer = ""
    service_description = ""

    # Check for two "for" clauses: e.g. "invoice for ABC Technologies for Web Development Services"
    double_for_pattern = re.compile(
        r'(?:invoice\s+(?:for|to)|bill(?:\s+(?:to|for))?|customer\s*:?)\s+([a-zA-Z0-9_\s&.,-]+?)\s+\bfor\b\s+([a-zA-Z0-9_\s&.,-]+?)(?=\s*,\s*|\s+amount|\s+total|\s+due|\.|\:|\n|$)',
        re.IGNORECASE
    )
    m_df = double_for_pattern.search(working_text)
    if m_df:
        cand_cust = m_df.group(1).strip()
        cand_desc = m_df.group(2).strip()
        cand_cust = re.sub(r'^(?:an|a|the)\s+', '', cand_cust, flags=re.IGNORECASE).strip()
        if len(cand_cust) > 1 and cand_cust.lower() not in ["an", "a", "the", "invoice", "email"]:
            customer = cand_cust
            service_description = cand_desc
    else:
        # Check for comma-separated customer and description: "invoice for ABC Technologies, website development, $500"
        comma_sep_pattern = re.compile(
            r'(?:invoice\s+(?:for|to)|bill(?:\s+(?:to|for))?|customer\s*:?)\s+([a-zA-Z0-9_\s&.-]+?)\s*,\s*([a-zA-Z0-9_\s&.-]+?)(?=\s*,\s*|\s+amount|\s+total|\s+due|\$|€|£|₹|\d|\.|\:|\n|$)',
            re.IGNORECASE
        )
        m_cs = comma_sep_pattern.search(working_text)
        if m_cs:
            cand_cust = m_cs.group(1).strip()
            cand_desc = m_cs.group(2).strip()
            if not re.match(r'^(?:\d+|amount|total|email|due)', cand_desc, re.IGNORECASE):
                cand_cust = re.sub(r'^(?:an|a|the)\s+', '', cand_cust, flags=re.IGNORECASE).strip()
                if len(cand_cust) > 1 and cand_cust.lower() not in ["an", "a", "the", "invoice"]:
                    customer = cand_cust
                    service_description = cand_desc

    # If customer still not found, standard customer pattern
    if not customer:
        cust_pattern = re.compile(
            r'(?:invoice\s+(?:for|to)|bill(?:\s+(?:to|for))?|customer\s*:?|client\s*:?)\s+([a-zA-Z0-9_\s&.-]+?)(?=\s*,\s*|\s+email|\s+with\s+email|\s+for\s+\d|\s+total|\s+amount|\.|\:|\n|$)',
            re.IGNORECASE
        )
        m_c = cust_pattern.search(working_text)
        if m_c:
            cand_cust = m_c.group(1).strip()
            cand_cust = re.sub(r'^(?:an|a|the)\s+', '', cand_cust, flags=re.IGNORECASE).strip()
            cand_cust = re.sub(r'\s+(?:with|email|for|at|amount|total)$', '', cand_cust, flags=re.IGNORECASE).strip()
            if len(cand_cust) > 1 and cand_cust.lower() not in ["an", "a", "the", "invoice", "email", "usd", "eur", "gbp", "inr"]:
                customer = cand_cust

    # Clean customer name casing and punctuation
    if customer:
        customer = re.sub(r'[,:\s]+$', '', customer).strip()
        if customer.islower():
            customer = customer.title()

    # 6. Extract Line Items
    proc_text = working_text
    for word, val in NUMBER_WORDS.items():
        proc_text = re.sub(r'\b' + word + r'\s+([a-zA-Z])', f'{val} \\1', proc_text, flags=re.IGNORECASE)

    items = []

    # Pattern A: Quantity with explicit price: "2 website designs at $100 each", "2 keyboards at $25"
    pat_with_qty = re.compile(
        r'(?<![$€£₹])\b(\d+)\s*(?:x\s*)?\b\s+([a-zA-Z0-9\s\-_/]+?)\s+(?:at|@|costing|priced\s+at|(?:for\s*(?:[$€£₹]|USD|EUR|GBP|INR|CAD|AUD)))\s*(?:[$€£₹]|USD|EUR|GBP|INR|CAD|AUD)?\s*(\d+(?:\.\d{1,2})?)(?:\s*(?:each|\/hr|\/unit|\/item|per\s+[a-zA-Z]+))?',
        re.IGNORECASE
    )
    for match in pat_with_qty.finditer(proc_text):
        qty_str, desc, price_str = match.groups()
        try:
            qty = max(1, int(qty_str))
        except ValueError:
            qty = 1

        clean_desc = desc.strip()
        clean_desc = re.sub(r'^(?:and|for|with|,|\.)\s+', '', clean_desc, flags=re.IGNORECASE).strip()

        if "@" in clean_desc or clean_desc.lower() in ["days", "day", "weeks", "week", "months", "month"]:
            continue

        try:
            price_dec = Decimal(price_str).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            price = float(price_dec)
        except Exception:
            price = 0.0

        line_total_dec = (Decimal(str(qty)) * Decimal(str(price))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        items.append({
            "description": clean_desc,
            "quantity": qty,
            "price": price,
            "total": float(line_total_dec)
        })

    # Pattern B: Clause with description at price (no explicit quantity, default qty=1)
    if not items:
        clauses = re.split(r'\band\b|,|;|\n', proc_text)
        pat_no_qty = re.compile(
            r'([a-zA-Z0-9\s\-_/]+?)\s+(?:at|@|costing|priced\s+at|(?:for\s*(?:[$€£₹]|USD|EUR|GBP|INR|CAD|AUD)))\s*(?:[$€£₹]|USD|EUR|GBP|INR|CAD|AUD)?\s*(\d+(?:\.\d{1,2})?)',
            re.IGNORECASE
        )
        for clause in clauses:
            if "@" in clause:
                continue
            m = pat_no_qty.search(clause)
            if m:
                desc, price_str = m.groups()
                clean_desc = re.sub(r'^(?:and|for|with|,|\.|invoice|bill|create)\s+', '', desc.strip(), flags=re.IGNORECASE).strip()
                if clean_desc and clean_desc.lower() not in ["email", "usd", "eur", "gbp", "inr", "invoice", "days", "day"] and "@" not in clean_desc:
                    try:
                        price_dec = Decimal(price_str).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                        price = float(price_dec)
                    except Exception:
                        price = 0.0
                    items.append({
                        "description": clean_desc,
                        "quantity": 1,
                        "price": price,
                        "total": price
                    })

    # Pattern C: If we have an extracted service_description or global_amount
    if not items and (service_description or global_amount is not None):
        desc = service_description if service_description else "Services"
        desc = re.sub(r'\b(?:amount|total|sum|for|due)\b.*', '', desc, flags=re.IGNORECASE).strip()
        desc = re.sub(r'^(?:and|for|with|,|\.)\s+', '', desc, flags=re.IGNORECASE).strip()
        if not desc:
            desc = "Services"

        price = global_amount if global_amount is not None else None
        tot = global_amount if global_amount is not None else 0.0
        items.append({
            "description": desc,
            "quantity": 1,
            "price": price,
            "total": tot
        })

    # Pattern D: Fallback for items with quantity but missing price (e.g. "for 2 monitors")
    if not items:
        no_price_pattern = re.compile(r'(?<![$€£₹])\b(\d+)\b\s+([a-zA-Z0-9\s\-_/]+?)(?:and|,|\.|$)', re.IGNORECASE)
        sub_text = proc_text
        if email:
            sub_text = sub_text.replace(email, "")
        if customer:
            sub_text = re.sub(re.escape(customer), "", sub_text, flags=re.IGNORECASE)

        for match in no_price_pattern.finditer(sub_text):
            qty_str, desc = match.groups()
            clean_desc = re.sub(r'^(?:and|for|with|,|\.|invoice|bill|create)\s+', '', desc.strip(), flags=re.IGNORECASE).strip()
            # Exclude time units from being interpreted as line items
            if (len(clean_desc) > 1 and 
                clean_desc.lower() not in ["email", "usd", "eur", "gbp", "inr", "at", "each", "invoice", "details", "days", "day", "weeks", "week", "months", "month"] and 
                "@" not in clean_desc):
                items.append({
                    "description": clean_desc,
                    "quantity": max(1, int(qty_str)),
                    "price": None,
                    "total": 0.0
                })

    # Pattern E: If still no items, check for "for <description>" missing price
    if not items and service_description:
        items.append({
            "description": service_description,
            "quantity": 1,
            "price": None,
            "total": 0.0
        })

    # 7. Missing fields checklist
    missing_fields = []
    if not customer:
        missing_fields.append("Customer name is missing.")
    if not email:
        missing_fields.append("Customer email is missing.")
    if not items:
        missing_fields.append("No line items could be extracted.")
    else:
        for idx, it in enumerate(items, 1):
            if it["price"] is None:
                missing_fields.append(f"Price is missing for item {idx} ('{it['description']}').")
            elif it["price"] <= 0:
                missing_fields.append(f"Price must be greater than zero for item {idx} ('{it['description']}').")

    # 8. Grand total calculation using Decimal
    grand_total = Decimal("0.00")
    for it in items:
        if it.get("total"):
            grand_total += Decimal(str(it["total"]))
    grand_total_float = float(grand_total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))

    return {
        "customer": customer or "",
        "email": email or "",
        "currency": currency,
        "due_date": due_date,
        "items": items,
        "total": grand_total_float,
        "missing_fields": missing_fields,
        "is_complete": len(missing_fields) == 0,
        "engine": engine_used,
        "engine_type": "deterministic",
        "engine_badge": engine_badge
    }
