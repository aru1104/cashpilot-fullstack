import uuid
from datetime import date, datetime, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException
from database import get_connection
from schemas import ExpenseInput, EXPENSE_CATEGORIES
from services import round2

router = APIRouter(prefix="/api/expenses", tags=["Expenses"])


def format_expense(row) -> dict:
    e = dict(row)
    return {
        "id": e["id"],
        "title": e["title"],
        "category": e["category"],
        "vendor": e["vendor"],
        "amount": e["amount"],
        "expenseDate": e["expense_date"],
        "dueDate": e["due_date"],
        "paymentStatus": e["payment_status"],
        "notes": e["notes"],
        "createdAt": e["created_at"],
        "updatedAt": e["updated_at"],
        "isSample": bool(e["is_sample"]),
    }


@router.get("")
def get_expenses(status: Optional[str] = None, category: Optional[str] = None):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM expenses ORDER BY expense_date DESC, LOWER(title) ASC")
    items = [format_expense(r) for r in cur.fetchall()]
    conn.close()

    if status:
        items = [e for e in items if e["paymentStatus"] == status]
    if category:
        items = [e for e in items if e["category"] == category]
    return items


@router.get("/summary")
def get_expense_summary():
    today = date.today()
    today_str = today.isoformat()
    soon_str = (today + timedelta(days=7)).isoformat()
    month_prefix = today_str[:7]

    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM expenses")
    all_items = [format_expense(r) for r in cur.fetchall()]
    conn.close()

    month_total = round2(sum(e["amount"] for e in all_items if e["expenseDate"].startswith(month_prefix)))
    paid_total = round2(sum(e["amount"] for e in all_items if e["paymentStatus"] == "paid"))
    unpaid_total = round2(sum(e["amount"] for e in all_items if e["paymentStatus"] == "unpaid"))

    upcoming_bills = []
    for e in all_items:
        if e["paymentStatus"] == "unpaid" and e["dueDate"]:
            if e["dueDate"] < today_str:
                state = "overdue"
            elif e["dueDate"] <= soon_str:
                state = "due_soon"
            else:
                state = "open"
            upcoming_bills.append({**e, "billState": state})
    upcoming_bills.sort(key=lambda x: (x["dueDate"], x["title"].lower()))

    breakdown = []
    for cat in EXPENSE_CATEGORIES:
        cat_items = [e for e in all_items if e["expenseDate"].startswith(month_prefix) and e["category"] == cat]
        total = round2(sum(e["amount"] for e in cat_items))
        share = round(total / month_total, 4) if month_total > 0 else 0
        breakdown.append({
            "category": cat,
            "total": total,
            "count": len(cat_items),
            "share": share,
        })

    return {
        "monthPrefix": month_prefix,
        "monthTotal": month_total,
        "paidTotal": paid_total,
        "unpaidTotal": unpaid_total,
        "upcomingBills": upcoming_bills,
        "categoryBreakdown": breakdown,
    }


@router.post("", status_code=201)
def create_expense(payload: ExpenseInput):
    if payload.dueDate and payload.dueDate < payload.expenseDate:
        raise HTTPException(status_code=400, detail="Due date cannot be before expense date")

    conn = get_connection()
    cur = conn.cursor()
    exp_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat() + "Z"

    cur.execute(
        """
        INSERT INTO expenses (id, title, category, vendor, amount, expense_date, due_date, payment_status, notes, created_at, updated_at, is_sample)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        """,
        (exp_id, payload.title.strip(), payload.category, payload.vendor.strip(), round2(payload.amount), payload.expenseDate, payload.dueDate.strip(), payload.paymentStatus, payload.notes.strip(), now, now),
    )
    conn.commit()
    cur.execute("SELECT * FROM expenses WHERE id = ?", (exp_id,))
    created = format_expense(cur.fetchone())
    conn.close()
    return created


@router.put("/{expense_id}")
def update_expense(expense_id: str, payload: ExpenseInput):
    if payload.dueDate and payload.dueDate < payload.expenseDate:
        raise HTTPException(status_code=400, detail="Due date cannot be before expense date")

    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM expenses WHERE id = ?", (expense_id,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Expense not found")

    now = datetime.utcnow().isoformat() + "Z"
    cur.execute(
        """
        UPDATE expenses
        SET title = ?, category = ?, vendor = ?, amount = ?, expense_date = ?, due_date = ?, payment_status = ?, notes = ?, updated_at = ?
        WHERE id = ?
        """,
        (payload.title.strip(), payload.category, payload.vendor.strip(), round2(payload.amount), payload.expenseDate, payload.dueDate.strip(), payload.paymentStatus, payload.notes.strip(), now, expense_id),
    )
    conn.commit()
    cur.execute("SELECT * FROM expenses WHERE id = ?", (expense_id,))
    updated = format_expense(cur.fetchone())
    conn.close()
    return updated


@router.delete("/{expense_id}")
def delete_expense(expense_id: str):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM expenses WHERE id = ?", (expense_id,))
    deleted = cur.rowcount > 0
    conn.commit()
    conn.close()
    if not deleted:
        raise HTTPException(status_code=404, detail="Expense not found")
    return {"deleted": True}
