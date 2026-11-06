import re
import json
import urllib.request
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

    # 1. Extract email
    email_match = re.search(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', text)
    email = email_match.group(0) if email_match else None

    # 2. Detect Currency and check for conflicts
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

    # 3. Extract Customer Name
    customer = None
    clean_for_name = text
    if email:
        clean_for_name = clean_for_name.replace(email, "")

    customer_patterns = [
        # "Invoice for Rahul Sharma", "bill to John Doe", "customer: Acme Corp", "bill Priya Verma"
        r'(?:invoice\s+(?:for|to)|bill(?:\s+(?:to|for))?|customer\s*:?|client\s*:?)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)',
        # Case insensitive pattern stopping before delimiter or keyword
        r'(?:invoice\s+(?:for|to)|bill(?:\s+(?:to|for))?|customer\s*:?|client\s*:?)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)*?)(?=\s*,\s*|\s+email|\s+with\s+email|\s+for\s+\d|\.|\:|\n|$)'
    ]

    for pat in customer_patterns:
        m = re.search(pat, clean_for_name, re.IGNORECASE)
        if m:
            cand = m.group(1).strip()
            cand = re.sub(r'\s+(?:with|email|for|at)$', '', cand, flags=re.IGNORECASE).strip()
            if cand.lower() not in ["an", "a", "the", "invoice", "email", "usd", "eur", "gbp", "inr"]:
                customer = cand.title() if cand.islower() else cand
                break

    # 4. Extract Line Items
    proc_text = text
    for word, val in NUMBER_WORDS.items():
        proc_text = re.sub(r'\b' + word + r'\s+([a-zA-Z])', f'{val} \\1', proc_text, flags=re.IGNORECASE)

    # Patterns with quantity: "2 keyboards at $25 each", "2x keyboards for $25"
    pat_with_qty = re.compile(
        r'(?<![$€£₹])\b(\d+)\s*(?:x\s*)?\b\s+([a-zA-Z0-9\s\-_/]+?)\s+(?:at|@|costing|priced\s+at|(?:for\s*(?:[$€£₹]|USD|EUR|GBP|INR|CAD|AUD)))\s*(?:[$€£₹]|USD|EUR|GBP|INR|CAD|AUD)?\s*(\d+(?:\.\d{1,2})?)(?:\s*(?:each|\/hr|\/unit|\/item|per\s+[a-zA-Z]+))?',
        re.IGNORECASE
    )

    items = []
    for match in pat_with_qty.finditer(proc_text):
        qty_str, desc, price_str = match.groups()
        try:
            qty = max(1, int(qty_str))
        except ValueError:
            qty = 1

        clean_desc = desc.strip()
        clean_desc = re.sub(r'^(?:and|for|with|,|\.)\s+', '', clean_desc, flags=re.IGNORECASE).strip()

        if "@" in clean_desc:
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

    # If no items found with explicit quantity, attempt clause splitting (<description> at <price>)
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
                if clean_desc and clean_desc.lower() not in ["email", "usd", "eur", "gbp", "inr", "invoice"] and "@" not in clean_desc:
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

    # If still no items found, look for items that have quantities but missing prices (e.g. "for 2 monitors")
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
            if len(clean_desc) > 1 and clean_desc.lower() not in ["email", "usd", "eur", "gbp", "inr", "at", "each", "invoice", "details"] and "@" not in clean_desc:
                items.append({
                    "description": clean_desc,
                    "quantity": max(1, int(qty_str)),
                    "price": None,
                    "total": 0.0
                })

    # 5. Missing fields checklist
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

    # 6. Grand total calculation using Decimal
    grand_total = Decimal("0.00")
    for it in items:
        if it.get("total"):
            grand_total += Decimal(str(it["total"]))
    grand_total_float = float(grand_total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))

    return {
        "customer": customer or "",
        "email": email or "",
        "currency": currency,
        "items": items,
        "total": grand_total_float,
        "missing_fields": missing_fields,
        "is_complete": len(missing_fields) == 0,
        "engine": engine_used,
        "engine_type": "deterministic",
        "engine_badge": engine_badge
    }
