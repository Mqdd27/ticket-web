import uuid
from datetime import timedelta

from django.conf import settings
from django.db import models, transaction
from django.db.models import Q, Sum
from django.utils import timezone

HOLD_MINUTES = 15  # waktu bayar sebelum reservasi hangus


def active_orders():
    """Order yang 'memakan' kuota: sudah dibayar, atau pending dan belum expired."""
    return Q(status=Order.PAID) | Q(status=Order.PENDING, expires_at__gt=timezone.now())


class Category(models.Model):
    STAGES = [
        ("concert", "Panggung konser"),
        ("festival", "Panggung festival"),
        ("standup", "Panggung stand-up"),
        ("seminar", "Ruang seminar"),
        ("exhibition", "Galeri pameran"),
    ]
    name = models.CharField(max_length=50)
    slug = models.SlugField(unique=True)
    stage_type = models.CharField(max_length=20, choices=STAGES, default="concert")

    class Meta:
        verbose_name_plural = "categories"

    def __str__(self):
        return self.name


class Event(models.Model):
    title = models.CharField(max_length=200)
    slug = models.SlugField(unique=True)
    category = models.ForeignKey(Category, on_delete=models.PROTECT, null=True, related_name="events")
    description = models.TextField(blank=True)
    venue = models.CharField(max_length=200)
    city = models.CharField(max_length=80, blank=True, default="")
    address = models.CharField(max_length=300, blank=True, default="")
    lat = models.FloatField(null=True, blank=True)
    lng = models.FloatField(null=True, blank=True)
    starts_at = models.DateTimeField()
    image_url = models.URLField(blank=True)
    is_published = models.BooleanField(default=False)

    class Meta:
        ordering = ["starts_at"]

    def __str__(self):
        return self.title


class TicketType(models.Model):
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="ticket_types")
    name = models.CharField(max_length=100)
    price = models.PositiveIntegerField(help_text="Rupiah")
    quota = models.PositiveIntegerField()

    def __str__(self):
        return f"{self.event} - {self.name}"

    def held(self):
        return self.orders.filter(active_orders()).aggregate(n=Sum("quantity"))["n"] or 0

    def available(self):
        return self.quota - self.held()


class PromoCode(models.Model):
    PERCENT, FIXED = "percent", "fixed"
    code = models.CharField(max_length=30, unique=True, help_text="Huruf besar, tanpa spasi")
    kind = models.CharField(max_length=10, choices=[(PERCENT, "Persen"), (FIXED, "Potongan Rupiah")], default=PERCENT)
    value = models.PositiveIntegerField(help_text="Persen (1-100) atau Rupiah")
    max_uses = models.PositiveIntegerField(default=100)
    event = models.ForeignKey(Event, null=True, blank=True, on_delete=models.CASCADE, help_text="Kosongkan = berlaku semua event")
    valid_until = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.code

    def save(self, *args, **kwargs):
        self.code = self.code.upper().strip()
        super().save(*args, **kwargs)

    def uses(self, exclude=None):
        return self.order_set.filter(active_orders()).exclude(pk=getattr(exclude, "pk", None)).count()

    def discount_for(self, subtotal):
        d = subtotal * self.value // 100 if self.kind == self.PERCENT else self.value
        return min(d, subtotal)


class Order(models.Model):
    PENDING, PAID, CANCELLED = "pending", "paid", "cancelled"
    STATUS = [(PENDING, "Pending"), (PAID, "Paid"), (CANCELLED, "Cancelled")]

    code = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    ticket_type = models.ForeignKey(TicketType, on_delete=models.PROTECT, related_name="orders")
    quantity = models.PositiveSmallIntegerField()
    promo = models.ForeignKey(PromoCode, null=True, blank=True, on_delete=models.PROTECT)
    discount = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=10, choices=STATUS, default=PENDING)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    snap_token = models.CharField(max_length=100, blank=True, editable=False)
    payment_type = models.CharField(max_length=30, blank=True, help_text="Diisi Midtrans: qris, bank_transfer, gopay, dll")

    class Meta:
        ordering = ["-created_at"]

    @property
    def subtotal(self):
        return self.quantity * self.ticket_type.price

    @property
    def total(self):
        return self.subtotal - self.discount

    @property
    def is_expired(self):
        return self.status == self.PENDING and self.expires_at <= timezone.now()


class Ticket(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="tickets")
    code = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    checked_in_at = models.DateTimeField(null=True, blank=True)

    def qr_svg(self):
        import segno
        return segno.make(str(self.code), error="m").svg_inline(border=2, omitsize=True)


class HomeSection(models.Model):
    KINDS = [
        ("trending", "Trending (paling laris 7 hari)"),
        ("upcoming", "Dalam waktu dekat"),
        ("near_you", "Dekat kamu (lokasi browser)"),
        ("all_events", "Daftar semua acara"),
        ("by_region", "Berdasarkan daerah"),
        ("stage", "Panggung 3D per kategori"),
    ]
    title = models.CharField(max_length=100)
    subtitle = models.CharField(max_length=200, blank=True)
    kind = models.CharField(max_length=20, choices=KINDS)
    category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.SET_NULL,
                                 help_text="Wajib untuk 'Panggung 3D'; opsional untuk filter section lain")
    order = models.PositiveIntegerField(default=0, help_text="Urutan tampil, kecil = di atas")
    limit = models.PositiveSmallIntegerField(default=8)
    is_active = models.BooleanField(default=True)
    stage_scene = models.JSONField(null=True, blank=True, editable=False,
                                   help_text="Diisi lewat tombol 'Generate panggung 3D'")

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.title


class SoldOut(Exception):
    pass


class PromoError(Exception):
    pass


def reserve(ticket_type_id, user, quantity):
    """Kunci baris TicketType biar 2 pembeli barengan gak bisa oversell."""
    if not 1 <= quantity <= 10:
        raise ValueError("Jumlah tiket 1-10")
    with transaction.atomic():
        tt = TicketType.objects.select_for_update().get(pk=ticket_type_id)
        if tt.available() < quantity:
            raise SoldOut(tt.name)
        return Order.objects.create(
            user=user, ticket_type=tt, quantity=quantity,
            expires_at=timezone.now() + timedelta(minutes=HOLD_MINUTES),
        )


def apply_promo(order, code):
    """Pasang promo ke order pending. Kunci baris promo biar max_uses gak jebol."""
    with transaction.atomic():
        promo = PromoCode.objects.select_for_update().filter(code=code.upper().strip(), is_active=True).first()
        if not promo:
            raise PromoError("Kode promo tidak ditemukan")
        if promo.valid_until and promo.valid_until < timezone.now():
            raise PromoError("Kode promo sudah kedaluwarsa")
        if promo.event_id and promo.event_id != order.ticket_type.event_id:
            raise PromoError("Kode promo tidak berlaku untuk event ini")
        if promo.uses(exclude=order) >= promo.max_uses:
            raise PromoError("Kuota kode promo sudah habis")
        order.promo = promo
        order.discount = promo.discount_for(order.subtotal)
        order.save(update_fields=["promo", "discount"])
        return order


def issue_tickets(order):
    """Tandai lunas + buat 1 tiket QR per kursi. Aman dipanggil ulang (idempotent)."""
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order.pk)
        if order.status != Order.PAID:
            order.status, order.paid_at = Order.PAID, timezone.now()
            order.save(update_fields=["status", "paid_at"])
        missing = order.quantity - order.tickets.count()
        Ticket.objects.bulk_create([Ticket(order=order) for _ in range(missing)])
        return order
