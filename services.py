from datetime import date, timedelta
from typing import Optional

OVERDUE_COLLECTION_DAYS = 14
MAX_HORIZON_DAYS = 90
FORECAST_HORIZONS = [30, 60, 90]
OPEN_INVOICE_STATUSES = {"sent", "partially_paid", "overdue"}


def round2(val: float) -> float:
    return round(float(val), 2)


def parse_iso(date_str: str) -> Optional[date]:
    try:
        return date.fromisoformat(date_str)
    except (TypeError, ValueError):
        return None


def enrich_invoice(cur, inv_row, today_str: Optional[str] = None) -> dict:
    today_str = today_str or date.today().isoformat()
    inv = dict(inv_row)

    cur.execute(
        "SELECT id, name, quantity, unit_price FROM invoice_items WHERE invoice_id = ?",
        (inv["id"],),
    )
    items = [
        {
            "id": r["id"],
            "name": r["name"],
            "quantity": r["quantity"],
            "unitPrice": r["unit_price"],
            "lineTotal": round2(r["quantity"] * r["unit_price"]),
        }
        for r in cur.fetchall()
    ]

    cur.execute(
        "SELECT COALESCE(SUM(amount_received), 0) AS paid FROM payments WHERE invoice_id = ?",
        (inv["id"],),
    )
    amount_paid = round2(cur.fetchone()["paid"])

    subtotal = round2(sum(i["lineTotal"] for i in items))
    total = subtotal
    remaining = max(0.0, round2(total - amount_paid))

    if total > 0 and remaining <= 0:
        display_status = "paid"
    elif inv["status"] != "draft" and inv["due_date"] < today_str:
        display_status = "overdue"
    elif amount_paid > 0:
        display_status = "partially_paid"
    else:
        display_status = inv["status"]

    return {
        "id": inv["id"],
        "number": inv["number"],
        "clientId": inv["client_id"],
        "issueDate": inv["issue_date"],
        "dueDate": inv["due_date"],
        "description": inv["description"],
        "status": inv["status"],
        "displayStatus": display_status,
        "lineItems": items,
        "subtotal": subtotal,
        "total": total,
        "amountPaid": amount_paid,
        "remaining": remaining,
        "createdAt": inv["created_at"],
        "updatedAt": inv["updated_at"],
        "isSample": bool(inv["is_sample"]),
    }


def list_enriched_invoices(cur, today_str: Optional[str] = None) -> list:
    today_str = today_str or date.today().isoformat()
    cur.execute("SELECT * FROM invoices ORDER BY issue_date DESC, number DESC")
    return [enrich_invoice(cur, row, today_str) for row in cur.fetchall()]


def build_forecast(
    cur,
    as_of_date: Optional[date] = None,
    opening_cash: Optional[float] = None,
    minimum_cash: Optional[float] = None,
    delay_invoice_id: Optional[str] = None,
    delay_days: int = 0,
) -> dict:
    as_of = as_of_date or date.today()
    as_of_str = as_of.isoformat()

    cur.execute("SELECT * FROM settings WHERE id = 1")
    settings = dict(cur.fetchone())

    open_cash = round2(opening_cash if opening_cash is not None else settings["opening_cash"])
    min_cash = round2(minimum_cash if minimum_cash is not None else settings["minimum_cash"])

    events = []
    draft_count = 0

    for inv in list_enriched_invoices(cur, as_of_str):
        if inv["displayStatus"] == "draft":
            draft_count += 1
            continue
        if inv["displayStatus"] not in OPEN_INVOICE_STATUSES or inv["remaining"] <= 0:
            continue

        base_due = parse_iso(inv["dueDate"])
        if base_due and delay_invoice_id == inv["id"]:
            due_dt = base_due + timedelta(days=max(0, delay_days))
        else:
            due_dt = base_due

        if not due_dt:
            offset, flag = 0, "no_due_date"
        elif due_dt < as_of:
            offset, flag = OVERDUE_COLLECTION_DAYS, "overdue"
        else:
            offset, flag = (due_dt - as_of).days, ""

        events.append({
            "kind": "in",
            "source": "invoice",
            "sourceId": inv["id"],
            "reference": inv["number"],
            "description": f"Invoice {inv['number']}",
            "amount": round2(inv["remaining"]),
            "offset": offset,
            "flag": flag,
        })

    cur.execute("SELECT * FROM expenses WHERE payment_status = 'unpaid'")
    for row in cur.fetchall():
        exp = dict(row)
        due_dt = parse_iso(exp["due_date"])
        if not due_dt:
            offset, flag = 0, "no_due_date"
        elif due_dt < as_of:
            offset, flag = 0, "overdue"
        else:
            offset, flag = (due_dt - as_of).days, ""

        desc = exp["title"] + (f" · {exp['vendor']}" if exp["vendor"] else "")
        events.append({
            "kind": "out",
            "source": "expense",
            "sourceId": exp["id"],
            "reference": exp["title"],
            "description": desc,
            "amount": round2(exp["amount"]),
            "offset": offset,
            "flag": flag,
        })

    kept = [e for e in events if e["offset"] <= MAX_HORIZON_DAYS]
    beyond_count = len(events) - len(kept)

    for e in kept:
        e["date"] = (as_of + timedelta(days=e["offset"])).isoformat()

    kept.sort(key=lambda e: (e["offset"], 0 if e["kind"] == "out" else 1, e["description"]))

    running = open_cash
    for e in kept:
        delta = e["amount"] if e["kind"] == "in" else -e["amount"]
        running = round2(running + delta)
        e["runningBalance"] = running

    horizons = []
    for h_days in FORECAST_HORIZONS:
        within = [e for e in kept if e["offset"] <= h_days]
        income = round2(sum(e["amount"] for e in within if e["kind"] == "in"))
        outflow = round2(sum(e["amount"] for e in within if e["kind"] == "out"))
        closing = round2(open_cash + income - outflow)

        bal = open_cash
        min_bal = open_cash
        min_date = as_of_str
        for e in within:
            bal = round2(bal + (e["amount"] if e["kind"] == "in" else -e["amount"]))
            if bal < min_bal:
                min_bal = bal
                min_date = e["date"]

        breach = "negative" if min_bal < 0 else ("below_minimum" if min_bal < min_cash else "")
        horizons.append({
            "days": h_days,
            "endDate": (as_of + timedelta(days=h_days)).isoformat(),
            "income": income,
            "outflow": outflow,
            "closing": closing,
            "minRunning": min_bal,
            "minRunningDate": min_date,
            "lowCash": breach != "",
            "breach": breach,
        })

    return {
        "today": as_of_str,
        "settings": {"openingCash": open_cash, "minimumCash": min_cash},
        "horizons": horizons,
        "events": kept,
        "assumptions": [
            f"{draft_count} draft invoice(s) excluded.",
            "Invoice amounts are the remaining balance after recorded payments.",
            "Overdue invoices are assumed collected 14 days from today.",
            "Unpaid expenses without a due date or overdue are treated as due today.",
            f"{beyond_count} event(s) beyond {MAX_HORIZON_DAYS} days excluded.",
            "Same-day outflows are applied before inflows.",
        ],
    }
