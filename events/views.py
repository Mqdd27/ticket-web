import json

from django import forms
from django.conf import settings
from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import User
from django.db.models import Q
from django.shortcuts import get_object_or_404, redirect, render
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from . import payments, sections
from .models import Category, Event, HomeSection, Order, PromoError, SoldOut, apply_promo, issue_tickets, reserve


def home(request):
    blocks = [sections.build(s) for s in HomeSection.objects.filter(is_active=True).select_related("category")]
    return render(request, "events/home.html", {"blocks": blocks})


def event_list(request):
    qs = sections.upcoming_events()
    q, cat, city = request.GET.get("q", ""), request.GET.get("cat", ""), request.GET.get("city", "")
    if q:
        qs = qs.filter(Q(title__icontains=q) | Q(venue__icontains=q) | Q(city__icontains=q))
    if cat:
        qs = qs.filter(category__slug=cat)
    if city:
        qs = qs.filter(city=city)
    return render(request, "events/list.html", {
        "events": qs, "q": q, "cat": cat, "city": city, "categories": Category.objects.all(),
    })


def near(request):
    try:
        lat, lng = float(request.GET["lat"]), float(request.GET["lng"])
    except (KeyError, ValueError):
        return render(request, "sections/_cards.html", {"events": []})
    return render(request, "sections/_cards.html", {"events": sections.nearest(lat, lng), "show_distance": True})


def section_events(request, pk):
    """Daftar acara section 'Semua acara' yang difilter kategori (dipanggil chip filter di beranda)."""
    s = get_object_or_404(HomeSection, pk=pk, kind="all_events", is_active=True)
    return render(request, "sections/_list.html", {"b": {"s": s, **sections.all_events(s, request.GET.get("cat", ""))}})


def event_detail(request, slug):
    event = get_object_or_404(Event.objects.select_related("category"), slug=slug, is_published=True)
    return render(request, "events/detail.html", {"event": event, "ticket_types": event.ticket_types.all()})


@require_POST
@login_required
def buy(request, slug):
    event = get_object_or_404(Event, slug=slug, is_published=True)
    try:
        tt = event.ticket_types.get(pk=int(request.POST["ticket_type"]))
        order = reserve(tt.id, request.user, int(request.POST.get("quantity", 1)))
    except (KeyError, ValueError, event.ticket_types.model.DoesNotExist):
        messages.error(request, "Pilih jenis tiket dan jumlah 1-10.")
    except SoldOut:
        messages.error(request, "Maaf, sisa tiket tidak cukup.")
    else:
        return redirect("order", code=order.code)
    return redirect("event_detail", slug=slug)


@login_required
def order_detail(request, code):
    order = get_object_or_404(Order.objects.select_related("ticket_type__event", "promo"), code=code, user=request.user)
    if request.method == "GET" and order.status == Order.PENDING and order.snap_token and payments.enabled():
        order = payments.sync(order)  # pembeli balik dari Snap: cek status langsung ke Midtrans
        if order.status == Order.PAID:
            messages.success(request, "Pembayaran berhasil. E-ticket sudah terbit.")
            return redirect("ticket_detail", code=order.code)
    if request.method == "POST" and order.status == Order.PENDING and not order.is_expired:
        if "promo" in request.POST and order.snap_token:
            messages.error(request, "Promo tidak bisa diubah setelah pembayaran dimulai.")
        elif "promo" in request.POST:
            try:
                apply_promo(order, request.POST["promo"])
                messages.success(request, f"Promo {order.promo.code} terpasang: hemat Rp{order.discount:,}".replace(",", "."))
            except PromoError as e:
                messages.error(request, str(e))
        elif "pay" in request.POST:
            # Tiket gratis langsung terbit; berbayar lewat Midtrans (order_pay). Simulasi hanya saat DEBUG tanpa key Midtrans.
            if order.total > 0 and (payments.enabled() or not settings.DEBUG):
                messages.error(request, "Pembayaran online belum aktif.")
            else:
                issue_tickets(order)
                messages.success(request, "Pembayaran berhasil. E-ticket sudah terbit.")
                return redirect("my_tickets")
        return redirect("order", code=code)
    return render(request, "events/order.html", {
        "order": order, "debug": settings.DEBUG, "midtrans": payments.enabled(),
        "snap_js": payments.snap_js_url(), "client_key": settings.MIDTRANS_CLIENT_KEY,
    })


@require_POST
@login_required
def order_pay(request, code):
    """Buat/ambil token Snap Midtrans untuk popup pembayaran."""
    order = get_object_or_404(Order.objects.select_related("ticket_type__event", "promo", "user"), code=code, user=request.user)
    if order.status != Order.PENDING or order.is_expired or order.total <= 0 or not payments.enabled():
        return JsonResponse({"error": "Order tidak bisa dibayar"}, status=400)
    try:
        token = payments.snap_token(order, request.build_absolute_uri(f"/order/{order.code}/"))
    except payments.PaymentError:
        return JsonResponse({"error": "Gagal menghubungi Midtrans, coba lagi"}, status=502)
    return JsonResponse({"token": token})


@csrf_exempt
@require_POST
def midtrans_notify(request):
    """Webhook Midtrans. Isi URL ini di dashboard: Settings → Payment → Notification URL."""
    try:
        data = json.loads(request.body)
    except ValueError:
        return HttpResponse(status=400)
    return HttpResponse(status=200 if payments.apply_status(data) else 403)


@login_required
def my_tickets(request):
    orders = (Order.objects.filter(user=request.user)
              .select_related("ticket_type__event", "promo").prefetch_related("tickets"))
    return render(request, "account/tickets.html", {
        "paid": [o for o in orders if o.status == Order.PAID],
        "pending": [o for o in orders if o.status == Order.PENDING and not o.is_expired],
    })


@login_required
def ticket_detail(request, code):
    order = get_object_or_404(Order.objects.select_related("ticket_type__event", "promo").prefetch_related("tickets"),
                              code=code, user=request.user, status=Order.PAID)
    return render(request, "account/ticket_detail.html", {"o": order, "event": order.ticket_type.event})


class RegisterForm(UserCreationForm):
    email = forms.EmailField(label="Email")
    first_name = forms.CharField(label="Nama lengkap", max_length=150)

    class Meta(UserCreationForm.Meta):
        model = User
        fields = ["first_name", "username", "email"]

    def clean_email(self):
        email = self.cleaned_data["email"].lower()
        if User.objects.filter(email__iexact=email).exists():
            raise forms.ValidationError("Email sudah terdaftar.")
        return email


def register(request):
    form = RegisterForm(request.POST or None)
    if form.is_valid():
        user = form.save()
        login(request, user)
        messages.success(request, f"Selamat datang, {user.first_name}!")
        nxt = request.GET.get("next", "")
        return redirect(nxt if nxt.startswith("/") and not nxt.startswith("//") else "home")
    return render(request, "registration/register.html", {"form": form})
