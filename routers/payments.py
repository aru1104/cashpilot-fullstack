import re
import uuid
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException
from database import get_connection
from schemas import PaymentInput
from services import enrich_invoice, round2

router = APIRouter(prefix="/api/payments", tags=["Payments"])
REF_RE = re.compile(r"^PAY-(\d{4})-(\d+)$")


def generate_payment_ref(cur, payment_date: str) -> str:
    year = payment_date[:4]
    cur.execute("SELECT reference FROM payments")
    max_seq = 0
    for row in cur.fetchall():
        match = REF_RE.match(row["reference"])
        if match and match.group(1) == year:
            max_seq = max(max_seq, int(match.group(2)))
    return f"PAY-{year}-{max_seq + 1:03d}"


@router.get("")
def get_payments(invoiceId: Optional[str] = None):
    conn = get_connection()
    cur = conn.cursor()
    if invoiceId:
        cur.execute(
            "SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC, reference DESC",
            (invoiceId,),
        )
    else:
        cur.execute("SELECT * FROM payments ORDER BY payment_date DESC, reference DESC")

    rows = cur.fetchall()
    conn.close()

    return [
        {
            "id": r["id"],
            "reference": r["reference"],
            "invoiceId": r["invoice_id"],
            "clientId": r["client_id"],
            "amountReceived": r["amount_received"],
            "paymentDate": r["payment_date"],
            "method": r["method"],
            "notes": r["notes"],
            "createdAt": r["created_at"],
        }
        for r in rows
    ]


@router.post("", status_code=201)
def record_payment(payload: PaymentInput):
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT * FROM invoices WHERE id = ?", (payload.invoiceId,))
    inv_row = cur.fetchone()
    if not inv_row:
        conn.close()
        raise HTTPException(status_code=404, detail="Invoice not found")

    invoice = enrich_invoice(cur, inv_row)
    if invoice["displayStatus"] == "draft":
        conn.close()
        raise HTTPException(status_code=400, detail="Send this invoice before recording a payment.")
    if invoice["displayStatus"] == "paid" or invoice["remaining"] <= 0:
        conn.close()
        raise HTTPException(status_code=400, detail="This invoice is already fully paid.")

    amount = round2(payload.amount)
    if amount > invoice["remaining"]:
        conn.close()
        raise HTTPException(
            status_code=400,
            detail=f"Payment exceeds remaining balance of {invoice['remaining']}.",
        )

    pay_id = str(uuid.uuid4())
    reference = generate_payment_ref(cur, payload.paymentDate)
    now = datetime.utcnow().isoformat() + "Z"

    cur.execute(
        """
        INSERT INTO payments (id, reference, invoice_id, client_id, amount_received, payment_date, method, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (pay_id, reference, invoice["id"], invoice["clientId"], amount, payload.paymentDate, payload.method, payload.notes.strip(), now),
    )
    conn.commit()
    conn.close()

    return {
        "id": pay_id,
        "reference": reference,
        "invoiceId": invoice["id"],
        "clientId": invoice["clientId"],
        "amountReceived": amount,
        "paymentDate": payload.paymentDate,
        "method": payload.method,
        "notes": payload.notes.strip(),
        "createdAt": now,
    }
