import sqlite3
import uuid
from datetime import date, datetime, timedelta

DB_FILE = "cashpilot.db"


def get_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_connection()
    cur = conn.cursor()

    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS clients (
            id TEXT PRIMARY KEY,
            full_name TEXT NOT NULL,
            business_name TEXT NOT NULL DEFAULT '',
            email TEXT NOT NULL,
            phone TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            is_sample INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS invoices (
            id TEXT PRIMARY KEY,
            number TEXT NOT NULL UNIQUE,
            client_id TEXT,
            issue_date TEXT NOT NULL,
            due_date TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'draft',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            is_sample INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS invoice_items (
            id TEXT PRIMARY KEY,
            invoice_id TEXT NOT NULL,
            name TEXT NOT NULL,
            quantity REAL NOT NULL,
            unit_price REAL NOT NULL,
            FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS payments (
            id TEXT PRIMARY KEY,
            reference TEXT NOT NULL UNIQUE,
            invoice_id TEXT NOT NULL,
            client_id TEXT,
            amount_received REAL NOT NULL,
            payment_date TEXT NOT NULL,
            method TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT
        );

        CREATE TABLE IF NOT EXISTS expenses (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            vendor TEXT NOT NULL DEFAULT '',
            amount REAL NOT NULL,
            expense_date TEXT NOT NULL,
            due_date TEXT NOT NULL DEFAULT '',
            payment_status TEXT NOT NULL DEFAULT 'unpaid',
            notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            is_sample INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            business_name TEXT NOT NULL DEFAULT 'PixelCraft Studio',
            owner_first_name TEXT NOT NULL DEFAULT 'Aarav',
            opening_cash REAL NOT NULL DEFAULT 485200.0,
            minimum_cash REAL NOT NULL DEFAULT 50000.0
        );
        """
    )

    cur.execute("SELECT COUNT(*) FROM settings")
    if cur.fetchone()[0] == 0:
        cur.execute(
            "INSERT INTO settings (id, business_name, owner_first_name, opening_cash, minimum_cash) VALUES (1, ?, ?, ?, ?)",
            ("PixelCraft Studio", "Aarav", 485200.0, 50000.0),
        )

    cur.execute("SELECT COUNT(*) FROM clients")
    if cur.fetchone()[0] == 0:
        seed_sample_data(cur)

    conn.commit()
    conn.close()


def seed_sample_data(cur):
    now = datetime.utcnow().isoformat() + "Z"
    today = date.today()

    sample_clients = [
        ("Ananya Rao", "Northwind Interiors", "accounts@northwind-interiors.example", "+91 90000 00001"),
        ("Rohan Mehta", "Lotus Hospitality", "accounts@lotus-hospitality.example", "+91 90000 00002"),
        ("Kavya Iyer", "Greenleaf Organics", "accounts@greenleaf-organics.example", "+91 90000 00003"),
        ("Arjun Desai", "Sahyadri Textiles", "accounts@sahyadri-textiles.example", "+91 90000 00004"),
        ("Meera Kapoor", "Mira & Co. Boutique", "accounts@mira-co-boutique.example", "+91 90000 00005"),
        ("Vikram Shah", "Bluepeak Logistics", "accounts@bluepeak-logistics.example", "+91 90000 00006"),
    ]

    client_map = {}
    for full_name, business_name, email, phone in sample_clients:
        cid = str(uuid.uuid4())
        client_map[business_name] = cid
        cur.execute(
            """
            INSERT INTO clients (id, full_name, business_name, email, phone, notes, created_at, updated_at, is_sample)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
            """,
            (cid, full_name, business_name, email, phone, "Sample client record", now, now),
        )

    sample_invoices = [
        ("INV-2025-014", "Northwind Interiors", 84000, 5, "sent"),
        ("INV-2025-015", "Lotus Hospitality", 62500, -9, "sent"),
        ("INV-2025-016", "Greenleaf Organics", 38750, 12, "sent"),
        ("INV-2025-017", "Sahyadri Textiles", 45200, 20, "draft"),
        ("INV-2025-018", "Mira & Co. Boutique", 23900, -3, "sent"),
        ("INV-2025-019", "Bluepeak Logistics", 58400, 14, "sent"),
    ]

    for number, business_name, amount, due_offset, status in sample_invoices:
        inv_id = str(uuid.uuid4())
        due_dt = today + timedelta(days=due_offset)
        issue_dt = due_dt - timedelta(days=14)
        cur.execute(
            """
            INSERT INTO invoices (id, number, client_id, issue_date, due_date, description, status, created_at, updated_at, is_sample)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            """,
            (inv_id, number, client_map[business_name], issue_dt.isoformat(), due_dt.isoformat(), "Sample invoice", status, now, now),
        )
        cur.execute(
            """
            INSERT INTO invoice_items (id, invoice_id, name, quantity, unit_price)
            VALUES (?, ?, ?, ?, ?)
            """,
            (str(uuid.uuid4()), inv_id, "Design services (sample)", 1, float(amount)),
        )

    sample_expenses = [
        ("Adobe Creative Cloud", "Software & Subscriptions", "Adobe", 4830, -40, -30, "paid", ""),
        ("Studio rent", "Rent & Workspace", "Sunrise Estates Pvt Ltd", 42000, -5, 3, "unpaid", "Quarterly rent, synthetic sample."),
        ("Fibre internet", "Internet & Utilities", "ACT Fibernet", 1499, -12, 6, "unpaid", ""),
        ("Wacom tablet", "Equipment", "Wacom India", 18500, -60, -60, "paid", ""),
        ("Print run for client mailers", "Marketing", "Sunrise Print Works", 7200, -20, -2, "unpaid", ""),
        ("Train travel to client site", "Travel", "Indian Railways", 2350, -9, None, "paid", ""),
        ("Freelance editor retainer", "Salaries & Freelancers", "Rahul Nair (freelance)", 18000, -2, 15, "unpaid", ""),
        ("Accounting software", "Software & Subscriptions", "Zoho Books", 2400, -25, 20, "unpaid", ""),
    ]

    for title, category, vendor, amount, exp_offset, due_offset, status, notes in sample_expenses:
        exp_date = (today + timedelta(days=exp_offset)).isoformat()
        due_date = "" if due_offset is None else (today + timedelta(days=due_offset)).isoformat()
        cur.execute(
            """
            INSERT INTO expenses (id, title, category, vendor, amount, expense_date, due_date, payment_status, notes, created_at, updated_at, is_sample)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            """,
            (str(uuid.uuid4()), title, category, vendor, float(amount), exp_date, due_date, status, notes, now, now),
        )
