"""Integrasi Midtrans Snap.

Alur:
1. Pembeli klik Bayar -> snap_token() membuat transaksi Snap (order_id = Order.code).
2. Snap popup -> pembeli bayar.
3. Midtrans kirim notifikasi ke /payment/midtrans/notify/ -> apply_status().
   Halaman order juga cek status ke API Midtrans (sync()), jadi tetap jalan di localhost tanpa webhook.
"""
import base64
import hashlib
import hmac
import json
import urllib.error
import urllib.request
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import Order, issue_tickets


class PaymentError(Exception):
    pass


def enabled():
    return bool(settings.MIDTRANS_SERVER_KEY and settings.MIDTRANS_CLIENT_KEY)


def snap_js_url():
    host = "app.midtrans.com" if settings.MIDTRANS_PRODUCTION else "app.sandbox.midtrans.com"
    return f"https://{host}/snap/snap.js"


def _call(method, url, body=None):
    auth = base64.b64encode(f"{settings.MIDTRANS_SERVER_KEY}:".encode()).decode()
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body else None, headers={
        "Authorization": f"Basic {auth}", "Accept": "application/json", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise PaymentError(e.read().decode(errors="replace")[:300]) from e
    except urllib.error.URLError as e:
        raise PaymentError(str(e.reason)) from e


def snap_token(order, finish_url):
    """Token Snap untuk order pending. Dipakai ulang kalau sudah pernah dibuat (order_id Midtrans harus unik)."""
    if order.snap_token:
        return order.snap_token
    remaining = int((order.expires_at - timezone.now()).total_seconds() // 60)
    if remaining < 1:
        raise PaymentError("Waktu pembayaran habis")
    items = [{"id": str(order.ticket_type_id), "price": order.ticket_type.price, "quantity": order.quantity,
              "name": f"{order.ticket_type.event.title} - {order.ticket_type.name}"[:50]}]
    if order.discount:
        items.append({"id": "PROMO", "price": -order.discount, "quantity": 1, "name": f"Promo {order.promo.code}"[:50]})
    host = "app.midtrans.com" if settings.MIDTRANS_PRODUCTION else "app.sandbox.midtrans.com"
    data = _call("POST", f"https://{host}/snap/v1/transactions", {
        "transaction_details": {"order_id": str(order.code), "gross_amount": order.total},
        "item_details": items,
        "customer_details": {"first_name": order.user.first_name or order.user.username, "email": order.user.email},
        # Pembayaran ditutup bersamaan dengan habisnya waktu tahan kursi
        "expiry": {"start_time": timezone.localtime().strftime("%Y-%m-%d %H:%M:%S %z"), "unit": "minute", "duration": remaining},
        "callbacks": {"finish": finish_url},
    })
    order.snap_token = data["token"]
    order.save(update_fields=["snap_token"])
    return order.snap_token


def valid_signature(data):
    raw = f"{data.get('order_id', '')}{data.get('status_code', '')}{data.get('gross_amount', '')}{settings.MIDTRANS_SERVER_KEY}"
    return hmac.compare_digest(hashlib.sha512(raw.encode()).hexdigest(), str(data.get("signature_key", "")))


def apply_status(data):
    """Terapkan status transaksi Midtrans (dari webhook atau API status). Return order, atau None kalau ditolak."""
    if not valid_signature(data):
        return None
    order = Order.objects.filter(code=data.get("order_id")).first()
    if not order or Decimal(str(data.get("gross_amount", "0"))) != order.total:
        return None
    status, fraud = data.get("transaction_status"), data.get("fraud_status", "accept")
    if status == "settlement" or (status == "capture" and fraud == "accept"):
        # ponytail: pembayaran yang masuk telat tetap diterbitkan (uang sudah diterima); expiry Snap = waktu tahan, jadi jarang terjadi
        order = issue_tickets(order)
        Order.objects.filter(pk=order.pk).update(payment_type=data.get("payment_type", "")[:30])
    elif status in ("deny", "cancel", "expire", "failure"):
        with transaction.atomic():
            Order.objects.filter(pk=order.pk, status=Order.PENDING).update(status=Order.CANCELLED)
    order.refresh_from_db()
    return order


def sync(order):
    """Tanya status ke Midtrans. Dipakai saat pembeli kembali ke halaman order (tanpa menunggu webhook)."""
    host = "api.midtrans.com" if settings.MIDTRANS_PRODUCTION else "api.sandbox.midtrans.com"
    try:
        data = _call("GET", f"https://{host}/v2/{order.code}/status")
    except PaymentError:
        return order
    if str(data.get("status_code")) == "404":  # transaksi belum dibuat di sisi Midtrans
        return order
    return apply_status(data) or order
