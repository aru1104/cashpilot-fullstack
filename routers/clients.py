import uuid
from datetime import datetime
from fastapi import APIRouter, HTTPException
from database import get_connection
from schemas import ClientInput
from services import list_enriched_invoices, round2

router = APIRouter(prefix="/api/clients", tags=["Clients"])


def format_client(row, invoices_by_client: dict) -> dict:
    c = dict(row)
    client_invs = invoices_by_client.get(c["id"], [])
    outstanding = round2(sum(i["remaining"] for i in client_invs if i["displayStatus"] != "paid"))
    return {
        "id": c["id"],
        "fullName": c["full_name"],
        "businessName": c["business_name"],
        "email": c["email"],
        "phone": c["phone"],
        "notes": c["notes"],
        "outstandingBalance": outstanding,
        "invoiceCount": len(client_invs),
        "createdAt": c["created_at"],
        "updatedAt": c["updated_at"],
        "isSample": bool(c["is_sample"]),
    }


@router.get("")
def get_clients(q: str = ""):
    conn = get_connection()
    cur = conn.cursor()
    invoices = list_enriched_invoices(cur)
    by_client = {}
    for inv in invoices:
        by_client.setdefault(inv["clientId"], []).append(inv)

    cur.execute("SELECT * FROM clients ORDER BY LOWER(full_name) ASC")
    rows = cur.fetchall()
    conn.close()

    results = [format_client(r, by_client) for r in rows]
    query = q.strip().lower()
    if query:
        results = [
            c for c in results
            if query in c["fullName"].lower() or query in c["businessName"].lower()
        ]
    return results


@router.get("/{client_id}")
def get_client(client_id: str):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM clients WHERE id = ?", (client_id,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Client not found")

    invoices = [i for i in list_enriched_invoices(cur) if i["clientId"] == client_id]
    conn.close()

    data = format_client(row, {client_id: invoices})
    data["invoices"] = invoices
    return data


@router.post("", status_code=201)
def create_client(payload: ClientInput):
    conn = get_connection()
    cur = conn.cursor()
    cid = str(uuid.uuid4())
    now = datetime.utcnow().isoformat() + "Z"

    cur.execute(
        """
        INSERT INTO clients (id, full_name, business_name, email, phone, notes, created_at, updated_at, is_sample)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
        """,
        (cid, payload.fullName, payload.businessName, payload.email, payload.phone, payload.notes, now, now),
    )
    conn.commit()
    cur.execute("SELECT * FROM clients WHERE id = ?", (cid,))
    row = cur.fetchone()
    conn.close()
    return format_client(row, {})


@router.put("/{client_id}")
def update_client(client_id: str, payload: ClientInput):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM clients WHERE id = ?", (client_id,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Client not found")

    now = datetime.utcnow().isoformat() + "Z"
    cur.execute(
        """
        UPDATE clients
        SET full_name = ?, business_name = ?, email = ?, phone = ?, notes = ?, updated_at = ?
        WHERE id = ?
        """,
        (payload.fullName, payload.businessName, payload.email, payload.phone, payload.notes, now, client_id),
    )
    conn.commit()
    cur.execute("SELECT * FROM clients WHERE id = ?", (client_id,))
    row = cur.fetchone()
    invoices = [i for i in list_enriched_invoices(cur) if i["clientId"] == client_id]
    conn.close()
    return format_client(row, {client_id: invoices})


@router.delete("/{client_id}")
def delete_client(client_id: str):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM clients WHERE id = ?", (client_id,))
    deleted = cur.rowcount > 0
    conn.commit()
    conn.close()
    if not deleted:
        raise HTTPException(status_code=404, detail="Client not found")
    return {"deleted": True}
