import re
import uuid
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException
from database import get_connection
from schemas import InvoiceInput
from services import enrich_invoice, list_enriched_invoices, round2

router = APIRouter(prefix="/api/invoices", tags=["Invoices"])
NUMBER_RE = re.compile(r"^INV-(\d{4})-(\d+)$")


def generate_invoice_number(cur, issue_date: str) -> str:
    year = issue_date[:4]
    cur.execute("SELECT number FROM invoices")
    max_seq = 0
    for row in cur.fetchall():
        match = NUMBER_RE.match(row["number"])
        if match and match.group(1) == year:
            max_seq = max(max_seq, int(match.group(2)))
    return f"INV-{year}-{max_seq + 1:03d}"


@router.get("")
def get_invoices(status: Optional[str] = None, clientId: Optional[str] = None):
    conn = get_connection()
    cur = conn.cursor()
    invoices = list_enriched_invoices(cur)
    conn.close()

    if status:
        invoices = [i for i in invoices if i["displayStatus"] == status]
    if clientId:
        invoices = [i for i in invoices if i["clientId"] == clientId]
    return invoices


@router.get("/{invoice_id}")
def get_invoice(invoice_id: str):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Invoice not found")

    invoice = enrich_invoice(cur, row)
    cur.execute(
        "SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC, reference DESC",
        (invoice_id,),
    )
    invoice["payments"] = [
        {
            "id": p["id"],
            "reference": p["reference"],
            "amountReceived": p["amount_received"],
            "paymentDate": p["payment_date"],
            "method": p["method"],
            "notes": p["notes"],
        }
        for p in cur.fetchall()
    ]
    conn.close()
    return invoice


@router.post("", status_code=201)
def create_invoice(payload: InvoiceInput):
    if payload.dueDate < payload.issueDate:
        raise HTTPException(status_code=400, detail="Due date cannot be before invoice date")

    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT id FROM clients WHERE id = ?", (payload.clientId,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="Selected client does not exist")

    inv_id = str(uuid.uuid4())
    inv_number = generate_invoice_number(cur, payload.issueDate)
    now = datetime.utcnow().isoformat() + "Z"

    cur.execute(
        """
        INSERT INTO invoices (id, number, client_id, issue_date, due_date, description, status, created_at, updated_at, is_sample)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        """,
        (inv_id, inv_number, payload.clientId, payload.issueDate, payload.dueDate, payload.description.strip(), payload.status, now, now),
    )

    for item in payload.lineItems:
        cur.execute(
            "INSERT INTO invoice_items (id, invoice_id, name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), inv_id, item.name, item.quantity, round2(item.unitPrice)),
        )

    conn.commit()
    cur.execute("SELECT * FROM invoices WHERE id = ?", (inv_id,))
    created = enrich_invoice(cur, cur.fetchone())
    conn.close()
    return created


@router.put("/{invoice_id}")
def update_invoice(invoice_id: str, payload: InvoiceInput):
    if payload.dueDate < payload.issueDate:
        raise HTTPException(status_code=400, detail="Due date cannot be before invoice date")

    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Invoice not found")

    cur.execute("SELECT id FROM clients WHERE id = ?", (payload.clientId,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="Selected client does not exist")

    cur.execute("SELECT COALESCE(SUM(amount_received), 0) AS paid FROM payments WHERE invoice_id = ?", (invoice_id,))
    already_paid = round2(cur.fetchone()["paid"])
    new_total = round2(sum(item.quantity * item.unitPrice for item in payload.lineItems))
    if already_paid > 0 and new_total < already_paid:
        conn.close()
        raise HTTPException(
            status_code=400,
            detail=f"Invoice total cannot be below the {already_paid} already paid.",
        )

    now = datetime.utcnow().isoformat() + "Z"
    cur.execute(
        """
        UPDATE invoices
        SET client_id = ?, issue_date = ?, due_date = ?, description = ?, status = ?, updated_at = ?
        WHERE id = ?
        """,
        (payload.clientId, payload.issueDate, payload.dueDate, payload.description.strip(), payload.status, now, invoice_id),
    )

    cur.execute("DELETE FROM invoice_items WHERE invoice_id = ?", (invoice_id,))
    for item in payload.lineItems:
        cur.execute(
            "INSERT INTO invoice_items (id, invoice_id, name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)",
            (item.id or str(uuid.uuid4()), invoice_id, item.name, item.quantity, round2(item.unitPrice)),
        )

    conn.commit()
    cur.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,))
    updated = enrich_invoice(cur, cur.fetchone())
    conn.close()
    return updated


@router.delete("/{invoice_id}")
def delete_invoice(invoice_id: str):
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM payments WHERE invoice_id = ?", (invoice_id,))
    if cur.fetchone()[0] > 0:
        conn.close()
        raise HTTPException(
            status_code=400,
            detail="Cannot delete an invoice that already has recorded payments.",
        )

    cur.execute("DELETE FROM invoices WHERE id = ?", (invoice_id,))
    deleted = cur.rowcount > 0
    conn.commit()
    conn.close()

    if not deleted:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return {"deleted": True}
