from datetime import date, timedelta
from typing import Optional
from fastapi import APIRouter
from database import get_connection
from schemas import SettingsInput
from services import build_forecast, list_enriched_invoices, round2, OPEN_INVOICE_STATUSES

router = APIRouter(prefix="/api", tags=["Analytics & Settings"])


@router.get("/overview")
def get_overview(days: int = 30):
    today = date.today()
    today_str = today.isoformat()
    month_end = (today + timedelta(days=30)).isoformat()

    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT * FROM settings WHERE id = 1")
    settings = dict(cur.fetchone())

    invoices = list_enriched_invoices(cur, today_str)
    open_invoices = [i for i in invoices if i["displayStatus"] in OPEN_INVOICE_STATUSES]

    total_outstanding = round2(sum(i["remaining"] for i in open_invoices))
    overdue_amount = round2(sum(i["remaining"] for i in open_invoices if i["displayStatus"] == "overdue"))
    expected_this_month = round2(
        sum(i["remaining"] for i in open_invoices if i["dueDate"] <= month_end)
    )

    forecast = build_forecast(cur, today)
    bucket_count = {30: 5, 60: 9, 90: 13}.get(days, 5)
    labels, incoming, outgoing = [], [], []

    for idx in range(bucket_count):
        start_day = idx * 7
        end_day = start_day + 6
        bucket_date = today + timedelta(days=start_day)
        labels.append(bucket_date.strftime("%d %b"))
        in_sum = sum(
            e["amount"] for e in forecast["events"]
            if e["kind"] == "in" and start_day <= e["offset"] <= end_day
        )
        out_sum = sum(
            e["amount"] for e in forecast["events"]
            if e["kind"] == "out" and start_day <= e["offset"] <= end_day
        )
        incoming.append(round2(in_sum))
        outgoing.append(round2(out_sum))

    cur.execute(
        "SELECT title, due_date, amount FROM expenses WHERE payment_status = 'unpaid' AND due_date != '' ORDER BY due_date ASC LIMIT 5"
    )
    upcoming_expenses = [
        {"name": r["title"], "dueDate": r["due_date"], "amount": r["amount"]}
        for r in cur.fetchall()
    ]
    conn.close()

    return {
        "businessName": settings["business_name"],
        "ownerFirstName": settings["owner_first_name"],
        "availableCash": settings["opening_cash"],
        "totalOutstanding": total_outstanding,
        "overdueAmount": overdue_amount,
        "expectedIncomeThisMonth": expected_this_month,
        "cashFlow": {"labels": labels, "incoming": incoming, "outgoing": outgoing},
        "invoices": invoices,
        "upcomingExpenses": upcoming_expenses,
    }


@router.get("/forecast")
def get_forecast(openingCash: Optional[float] = None, minimumCash: Optional[float] = None):
    conn = get_connection()
    cur = conn.cursor()
    result = build_forecast(cur, opening_cash=openingCash, minimum_cash=minimumCash)
    conn.close()
    return result


@router.get("/simulator")
def get_simulation(delayDays: int = 15):
    conn = get_connection()
    cur = conn.cursor()
    today = date.today()

    invoices = list_enriched_invoices(cur, today.isoformat())
    eligible = [
        i for i in invoices
        if i["displayStatus"] in OPEN_INVOICE_STATUSES and i["remaining"] > 0
    ]

    if not eligible:
        conn.close()
        return {"hasInvoice": False, "delayDays": delayDays}

    eligible.sort(key=lambda i: (-i["remaining"], i["dueDate"], i["number"]))
    target = eligible[0]

    baseline = build_forecast(cur, today)
    scenario = build_forecast(cur, today, delay_invoice_id=target["id"], delay_days=delayDays)
    conn.close()

    comparison = []
    for base_h, scen_h in zip(baseline["horizons"], scenario["horizons"]):
        comparison.append({
            "days": base_h["days"],
            "baselineClosing": base_h["closing"],
            "scenarioClosing": scen_h["closing"],
            "difference": round2(scen_h["closing"] - base_h["closing"]),
            "baselineBreach": base_h["breach"],
            "scenarioBreach": scen_h["breach"],
        })

    return {
        "hasInvoice": True,
        "delayDays": delayDays,
        "targetInvoice": target,
        "baseline": baseline,
        "scenario": scenario,
        "comparison": comparison,
    }


@router.get("/settings")
def get_settings():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM settings WHERE id = 1")
    row = dict(cur.fetchone())
    conn.close()
    return {
        "businessName": row["business_name"],
        "ownerFirstName": row["owner_first_name"],
        "openingCash": row["opening_cash"],
        "minimumCash": row["minimum_cash"],
    }


@router.put("/settings")
def update_settings(payload: SettingsInput):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM settings WHERE id = 1")
    current = dict(cur.fetchone())

    business_name = payload.businessName or current["business_name"]
    owner_name = payload.ownerFirstName or current["owner_first_name"]

    cur.execute(
        """
        UPDATE settings
        SET business_name = ?, owner_first_name = ?, opening_cash = ?, minimum_cash = ?
        WHERE id = 1
        """,
        (business_name.strip(), owner_name.strip(), round2(payload.openingCash), round2(payload.minimumCash)),
    )
    conn.commit()
    conn.close()

    return {
        "businessName": business_name.strip(),
        "ownerFirstName": owner_name.strip(),
        "openingCash": round2(payload.openingCash),
        "minimumCash": round2(payload.minimumCash),
    }
