from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from events.models import Category, Event, HomeSection, Order, PromoCode, TicketType, apply_promo, issue_tickets

CATS = [("Musik", "musik", "concert"), ("Festival", "festival", "festival"),
        ("Stand-up Comedy", "standup", "standup"), ("Seminar", "seminar", "seminar"), ("Pameran", "pameran", "exhibition")]

# (judul, kategori, venue, alamat, kota, lat, lng, hari dari sekarang, published, [(tiket, harga, kuota, terjual)])
EVENTS = [
    ("Jakarta Music Fest 2026", "musik", "GBK Senayan", "Jl. Pintu Satu Senayan, Gelora, Tanah Abang, Jakarta Pusat", "Jakarta", -6.2183, 106.8023, 14, True,
     [("Festival", 350000, 500, 120), ("VIP", 1200000, 50, 50)]),
    ("Synchronize Night", "musik", "JIExpo Kemayoran", "Jl. Benyamin Sueb, Pademangan, Jakarta Utara", "Jakarta", -6.1460, 106.8460, 21, True,
     [("Presale", 250000, 200, 200), ("Regular", 400000, 300, 45)]),
    ("Bandung Jazz Weekend", "musik", "Sabuga ITB", "Jl. Tamansari No.73, Lb. Siliwangi, Coblong, Bandung", "Bandung", -6.8862, 107.6113, 30, True,
     [("Daily Pass", 300000, 400, 10), ("2-Day Pass", 550000, 200, 0)]),
    ("Stand Up Comedy Tour", "standup", "Teater Jakarta TIM", "Jl. Cikini Raya No.73, Menteng, Jakarta Pusat", "Jakarta", -6.1903, 106.8388, 9, True,
     [("Tribun", 150000, 300, 280), ("Front Row", 450000, 40, 38)]),
    ("Tech Summit Indonesia", "seminar", "ICE BSD", "Jl. BSD Grand Boulevard No.1, Pagedangan, Tangerang", "Tangerang", -6.3013, 106.6533, 45, True,
     [("Student", 75000, 150, 30), ("Professional", 500000, 300, 90)]),
    ("Bali Sunset Festival", "festival", "Garuda Wisnu Kencana", "Jl. Raya Uluwatu, Ungasan, Kuta Selatan, Badung", "Bali", -8.8104, 115.1676, 60, True,
     [("GA", 600000, 1000, 400), ("VVIP", 3500000, 20, 5)]),
    ("Yogyakarta Art Expo", "pameran", "Jogja Expo Center", "Jl. Raya Janti, Banguntapan, Bantul", "Yogyakarta", -7.7984, 110.4110, 7, True,
     [("Masuk", 50000, 1000, 120)]),
    ("Surabaya Rock Night", "musik", "Grand City", "Jl. Walikota Mustajab No.1, Ketabang, Surabaya", "Surabaya", -7.2620, 112.7486, 33, True,
     [("Regular", 200000, 250, 250)]),
    ("Seminar Investasi Pemula", "seminar", "Online (Zoom)", "Link Zoom dikirim ke email H-1", "", None, None, 5, True,
     [("Gratis", 0, 500, 320)]),
    ("Comedy Night Bandung", "standup", "Bandung Creative Hub", "Jl. Laswi No.7, Kacapiring, Batununggal, Bandung", "Bandung", -6.9131, 107.6290, 12, True,
     [("Reguler", 100000, 120, 60)]),
    ("Open Mic Kemang", "standup", "Kemang Comedy Club", "Jl. Kemang Raya No.8, Bangka, Mampang Prapatan, Jakarta Selatan", "Jakarta", -6.2603, 106.8135, 3, True,
     [("Reguler", 75000, 80, 25)]),
    ("Indie Fest Yogyakarta", "festival", "Jogja National Museum", "Jl. Prof. Ki Amri Yogyakarta No.1, Wirobrajan, Yogyakarta", "Yogyakarta", -7.8003, 110.3529, 25, True,
     [("Early Bird", 120000, 300, 300), ("Reguler", 180000, 500, 140)]),
    ("Konser Rahasia (DRAFT)", "musik", "TBA", "", "", None, None, 90, False,  # gak boleh muncul
     [("Regular", 300000, 100, 0)]),
    ("Festival Tahun Lalu", "festival", "Ancol", "Jl. Lodan Timur No.7, Ancol, Jakarta Utara", "Jakarta", -6.1225, 106.8335, -30, True,  # sudah lewat
     [("Regular", 200000, 100, 100)]),
]

SECTIONS = [  # (judul, subjudul, jenis, slug kategori, limit) — urutan = urutan tampil
    ("Trending minggu ini", "Paling banyak dibeli 7 hari terakhir", "trending", None, 8),
    ("Dalam waktu dekat", "Jangan sampai kelewatan", "upcoming", None, 8),
    ("Dekat kamu", "Diurutkan dari lokasimu", "near_you", None, 8),
    ("Semua acara", "", "all_events", None, 10),
    ("Berdasarkan daerah", "Pilih kota tujuanmu", "by_region", None, 8),
    ("Panggung musik", "Putar panggungnya, klik untuk bikin penonton loncat", "stage", "musik", 8),
    ("Malam stand-up", "Kursi depan, mic menyala", "stage", "standup", 8),
]


class Command(BaseCommand):
    help = "Hapus semua data event lalu isi data dummy (DEBUG only). Panggung 3D TIDAK digenerate otomatis."

    def handle(self, *args, **opts):
        if not settings.DEBUG:
            raise CommandError("seed cuma boleh jalan saat DEBUG=1")
        for model in (HomeSection, Order, PromoCode, TicketType, Event, Category):
            model.objects.all().delete()

        admin, _ = User.objects.get_or_create(username="admin", defaults={"is_staff": True, "is_superuser": True})
        admin.email = "admin@ticketweb.test"
        admin.set_password("admin123")
        admin.save()
        buyer, _ = User.objects.get_or_create(username="pembeli")
        buyer.first_name, buyer.email = "Rani Pembeli", "pembeli@ticketweb.test"
        buyer.set_password("pembeli123")
        buyer.save()
        offline, _ = User.objects.get_or_create(username="penjualan-offline")  # penampung angka penjualan dummy

        cats = {slug: Category.objects.create(name=n, slug=slug, stage_type=st) for n, slug, st in CATS}
        now = timezone.now()
        tts = {}
        for i, (title, cat, venue, addr, city, lat, lng, days, pub, tickets) in enumerate(EVENTS):
            slug = f"event-{i + 1}"
            ev = Event.objects.create(
                title=title, slug=slug, category=cats[cat], venue=venue, address=addr, city=city, lat=lat, lng=lng,
                is_published=pub, image_url=f"https://picsum.photos/seed/{slug}/800/450",
                starts_at=timezone.localtime(now + timedelta(days=days)).replace(hour=19, minute=0, second=0, microsecond=0),
                description=f"{title} di {venue}.\n\nGerbang dibuka 2 jam sebelum acara. Tunjukkan e-ticket QR di pintu masuk; satu QR untuk satu orang.",
            )
            for name, price, quota, sold in tickets:
                tt = TicketType.objects.create(event=ev, name=name, price=price, quota=quota)
                tts[(title, name)] = tt
                if sold:
                    Order.objects.create(user=offline, ticket_type=tt, quantity=sold, status=Order.PAID,
                                         paid_at=now - timedelta(days=i % 9), expires_at=now)

        jmf = Event.objects.get(title="Jakarta Music Fest 2026")
        PromoCode.objects.create(code="HEMAT10", kind=PromoCode.PERCENT, value=10, max_uses=100)
        PromoCode.objects.create(code="TIKET50K", kind=PromoCode.FIXED, value=50000, max_uses=50)
        PromoCode.objects.create(code="JMF20", kind=PromoCode.PERCENT, value=20, max_uses=2, event=jmf)
        PromoCode.objects.create(code="KADALUARSA", kind=PromoCode.PERCENT, value=50, valid_until=now - timedelta(days=1))

        # Akun pembeli: 2 order lunas (tiket QR terbit) + 1 menunggu bayar.
        # Order ini memakai kuota → sisa Festival JMF = 500 - 120 - 2 = 378.
        o = Order.objects.create(user=buyer, ticket_type=tts[("Jakarta Music Fest 2026", "Festival")], quantity=2, expires_at=now + timedelta(minutes=15))
        apply_promo(o, "HEMAT10")
        issue_tickets(o)
        issue_tickets(Order.objects.create(user=buyer, ticket_type=tts[("Seminar Investasi Pemula", "Gratis")], quantity=1, expires_at=now))
        Order.objects.create(user=buyer, ticket_type=tts[("Open Mic Kemang", "Reguler")], quantity=2, expires_at=now + timedelta(minutes=15))

        for i, (title, sub, kind, cat, limit) in enumerate(SECTIONS):
            HomeSection.objects.create(title=title, subtitle=sub, kind=kind, category=cats.get(cat), order=(i + 1) * 10, limit=limit)

        self.stdout.write(self.style.SUCCESS(
            f"{Event.objects.count()} event, {HomeSection.objects.count()} section, {PromoCode.objects.count()} promo. "
            "Login admin: admin/admin123 · pembeli: pembeli/pembeli123. "
            "Panggung 3D belum digenerate: klik tombolnya di Admin → Home sections."
        ))
