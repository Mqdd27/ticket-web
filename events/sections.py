"""Isi data tiap HomeSection. Satu fungsi per jenis section."""
import math
from datetime import timedelta

from django.db.models import Count, Min, Q, Sum
from django.utils import timezone

from .models import Event, Order


def upcoming_events():
    return (Event.objects.filter(is_published=True, starts_at__gte=timezone.now())
            .select_related("category").annotate(min_price=Min("ticket_types__price")))


def _filtered(section):
    qs = upcoming_events()
    return qs.filter(category=section.category) if section.category_id else qs


def trending(section):
    week = timezone.now() - timedelta(days=7)
    sold = Sum("ticket_types__orders__quantity",
               filter=Q(ticket_types__orders__status=Order.PAID, ticket_types__orders__paid_at__gte=week))
    # ponytail: annotate sold + min_price bareng bikin JOIN dobel; hitung harga terpisah
    ids = list(_filtered(section).annotate(sold=sold).filter(sold__gt=0).order_by("-sold")
               .values_list("id", flat=True)[: section.limit])
    by_id = {e.id: e for e in upcoming_events().filter(id__in=ids)}
    return {"events": [by_id[i] for i in ids]}


def upcoming(section):
    return {"events": _filtered(section)[: section.limit]}


def near_you(section):
    return {}  # diisi via JS (geolocation) -> /near/?lat=&lng=


def all_events(section, cat=""):
    from .models import Category
    qs = _filtered(section)
    if cat:
        qs = qs.filter(category__slug=cat)
    return {"events": qs[: section.limit], "categories": Category.objects.all(), "cat": cat}


def by_region(section):
    cities = (_filtered(section).exclude(city="").values("city")
              .annotate(n=Count("id"), img=Min("image_url")).order_by("-n", "city")[: section.limit])
    return {"cities": cities}


def stage(section):
    return {"events": _filtered(section)[: section.limit]}


BUILDERS = {k: globals()[k] for k in ["trending", "upcoming", "near_you", "all_events", "by_region", "stage"]}


def build(section):
    return {"s": section, **BUILDERS[section.kind](section)}


def km(lat1, lng1, lat2, lng2):
    p = math.pi / 180
    a = (math.sin((lat2 - lat1) * p / 2) ** 2
         + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lng2 - lng1) * p / 2) ** 2)
    return 12742 * math.asin(math.sqrt(a))


def nearest(lat, lng, limit=8):
    # ponytail: urut jarak di Python, cukup sampai ribuan event; pakai PostGIS kalau lebih
    evs = [e for e in upcoming_events() if e.lat is not None]
    for e in evs:
        e.distance = km(lat, lng, e.lat, e.lng)
    return sorted(evs, key=lambda e: e.distance)[:limit]
