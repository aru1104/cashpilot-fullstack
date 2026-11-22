from typing import List, Optional
from pydantic import BaseModel, Field, field_validator

EXPENSE_CATEGORIES = [
    "Software & Subscriptions",
    "Internet & Utilities",
    "Rent & Workspace",
    "Equipment",
    "Marketing",
    "Travel",
    "Salaries & Freelancers",
    "Other",
]

PAYMENT_METHODS = ["upi", "bank_transfer", "cash", "card", "other"]


class ClientInput(BaseModel):
    fullName: str = Field(..., min_length=1, max_length=100)
    businessName: str = Field(default="", max_length=120)
    email: str = Field(..., min_length=3, max_length=254)
    phone: str = Field(default="", max_length=20)
    notes: str = Field(default="", max_length=1000)

    @field_validator("fullName", "businessName", "email", "phone", "notes")
    @classmethod
    def clean_text(cls, v: str) -> str:
        return v.strip()


class LineItemInput(BaseModel):
    id: Optional[str] = None
    name: str = Field(..., min_length=1, max_length=200)
    quantity: float = Field(..., gt=0, le=100000)
    unitPrice: float = Field(..., ge=0, le=100000000)

    @field_validator("name")
    @classmethod
    def clean_name(cls, v: str) -> str:
        return v.strip()


class InvoiceInput(BaseModel):
    clientId: str = Field(..., min_length=1)
    issueDate: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    dueDate: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    description: str = Field(default="", max_length=500)
    status: str = Field(default="draft")
    lineItems: List[LineItemInput] = Field(..., min_length=1)

    @field_validator("status")
    @classmethod
    def check_status(cls, v: str) -> str:
        if v not in ("draft", "sent"):
            raise ValueError("Status must be 'draft' or 'sent'")
        return v


class PaymentInput(BaseModel):
    invoiceId: str = Field(..., min_length=1)
    amount: float = Field(..., gt=0)
    paymentDate: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    method: str
    notes: str = Field(default="", max_length=500)

    @field_validator("method")
    @classmethod
    def check_method(cls, v: str) -> str:
        if v not in PAYMENT_METHODS:
            raise ValueError(f"Method must be one of {PAYMENT_METHODS}")
        return v


class ExpenseInput(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    category: str
    vendor: str = Field(default="", max_length=120)
    amount: float = Field(..., gt=0, le=100000000)
    expenseDate: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    dueDate: str = Field(default="")
    paymentStatus: str = Field(default="unpaid")
    notes: str = Field(default="", max_length=500)

    @field_validator("category")
    @classmethod
    def check_category(cls, v: str) -> str:
        if v not in EXPENSE_CATEGORIES:
            raise ValueError("Invalid expense category")
        return v

    @field_validator("paymentStatus")
    @classmethod
    def check_payment_status(cls, v: str) -> str:
        if v not in ("paid", "unpaid"):
            raise ValueError("Payment status must be 'paid' or 'unpaid'")
        return v


class SettingsInput(BaseModel):
    businessName: Optional[str] = Field(default=None, min_length=1, max_length=120)
    ownerFirstName: Optional[str] = Field(default=None, min_length=1, max_length=80)
    openingCash: float = Field(..., ge=-1e10, le=1e10)
    minimumCash: float = Field(..., ge=0, le=1e10)
