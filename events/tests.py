from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone

from .models import Category, Event, HomeSection, Order, PromoCode, PromoError, SoldOut, TicketType, apply_promo, issue_tickets, reserve


class FlowTest(TestCase):
    def setUp(self):
        self.u = User.objects.create_user("a", password="x" * 10)
        self.cat = Category.objects.create(name="Musik", slug="musik", stage_type="concert")
        self.ev = Event.objects.create(title="X", slug="x", venue="V", category=self.cat, is_published=True,
                                       starts_at=timezone.now() + timedelta(days=3), lat=-6.2, lng=106.8)
        self.tt = TicketType.objects.create(event=self.ev, name="Reg", price=100000, quota=3)

    def test_quota_and_expiry(self):
        o = reserve(self.tt.id, self.u, 2)
        self.assertEqual(self.tt.available(), 1)
        with self.assertRaises(SoldOut):
            reserve(self.tt.id, self.u, 2)
        Order.objects.filter(pk=o.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.tt.available(), 3)

    def test_promo_limits(self):
        p = PromoCode.objects.create(code="hemat10", value=10, max_uses=1)
        self.assertEqual(p.code, "HEMAT10")
        o1 = apply_promo(reserve(self.tt.id, self.u, 2), "hemat10")
        self.assertEqual((o1.discount, o1.total), (20000, 180000))
        with self.assertRaises(PromoError):  # max_uses = 1
            apply_promo(reserve(self.tt.id, self.u, 1), "HEMAT10")
        PromoCode.objects.create(code="BIG", kind="fixed", value=999999)
        self.assertEqual(apply_promo(o1, "BIG").total, 0)  # diskon tidak boleh bikin total minus

    def test_issue_tickets_idempotent(self):
        o = reserve(self.tt.id, self.u, 2)
        issue_tickets(o)
        issue_tickets(o)
        o.refresh_from_db()
        self.assertEqual((o.status, o.tickets.count()), (Order.PAID, 2))
        self.assertIn("<svg", o.tickets.first().qr_svg())

    @override_settings(DEBUG=True)
    def test_pages_and_flow(self):
        HomeSection.objects.create(title="Panggung", kind="stage", category=self.cat)
        HomeSection.objects.create(title="Trend", kind="trending")
        HomeSection.objects.create(title="Daerah", kind="by_region")
        self.assertEqual(self.client.get("/").status_code, 200)
        self.assertNotContains(self.client.get("/"), "data-stage ")  # belum digenerate = tidak tampil
        self.client.force_login(self.u)
        r = self.client.post("/e/x/beli/", {"ticket_type": self.tt.id, "quantity": 1})
        order = Order.objects.get()
        self.assertRedirects(r, f"/order/{order.code}/")
        self.client.post(r.url, {"pay": 1})
        self.assertContains(self.client.get("/akun/tiket/"), "<svg")
        detail = self.client.get(f"/akun/tiket/{order.code}/")
        self.assertContains(detail, 'id="map"')
        self.client.force_login(User.objects.create_user("b", password="x" * 10))
        self.assertEqual(self.client.get(f"/akun/tiket/{order.code}/").status_code, 404)  # tiket orang lain
        self.assertContains(self.client.get("/near/?lat=-6.2&lng=106.8"), "km")

    def test_all_events_category_filter(self):
        s = HomeSection.objects.create(title="Semua", kind="all_events")
        other = Category.objects.create(name="Seminar", slug="seminar", stage_type="seminar")
        Event.objects.create(title="Talk Y", slug="y", venue="V", category=other, is_published=True,
                             starts_at=timezone.now() + timedelta(days=2))
        r = self.client.get(f"/section/{s.pk}/acara/?cat=musik")
        self.assertContains(r, "/e/x/")
        self.assertNotContains(r, "Talk Y")
        self.assertContains(self.client.get(f"/section/{s.pk}/acara/"), "Talk Y")

    def test_admin_generate_button(self):
        s = HomeSection.objects.create(title="Panggung", kind="stage", category=self.cat)
        admin = User.objects.create_superuser("adm", "a@a.test", "x" * 10)
        self.client.force_login(admin)
        self.client.post(f"/admin/events/homesection/{s.pk}/generate-stage/")
        s.refresh_from_db()
        self.assertEqual(s.stage_scene["type"], "concert")
        self.assertContains(self.client.get("/"), "data-stage")


@override_settings(MIDTRANS_SERVER_KEY="SB-Mid-server-test", MIDTRANS_CLIENT_KEY="SB-Mid-client-test")
class MidtransTest(TestCase):
    def setUp(self):
        self.u = User.objects.create_user("m", email="m@x.test", password="x" * 10)
        ev = Event.objects.create(title="Konser", slug="k", venue="V", is_published=True, starts_at=timezone.now() + timedelta(days=3))
        self.tt = TicketType.objects.create(event=ev, name="Reg", price=100000, quota=5)
        self.order = reserve(self.tt.id, self.u, 2)

    def notif(self, status, amount="200000.00", key="SB-Mid-server-test", **extra):
        import hashlib
        d = {"order_id": str(self.order.code), "status_code": "200", "gross_amount": amount, "transaction_status": status,
             "payment_type": "qris", **extra}
        d["signature_key"] = hashlib.sha512(f"{d['order_id']}200{amount}{key}".encode()).hexdigest()
        return self.client.post("/payment/midtrans/notify/", d, content_type="application/json")

    def test_webhook_settlement_issues_tickets(self):
        self.assertEqual(self.notif("settlement").status_code, 200)
        self.order.refresh_from_db()
        self.assertEqual((self.order.status, self.order.tickets.count(), self.order.payment_type), (Order.PAID, 2, "qris"))

    def test_webhook_rejects_forged_or_wrong_amount(self):
        self.assertEqual(self.notif("settlement", key="tebakan").status_code, 403)
        self.assertEqual(self.notif("settlement", amount="1.00").status_code, 403)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.PENDING)

    def test_webhook_expire_releases_quota(self):
        self.notif("expire")
        self.order.refresh_from_db()
        self.assertEqual((self.order.status, self.tt.available()), (Order.CANCELLED, 5))

    def test_pay_creates_snap_token_once(self):
        import io, json
        from unittest import mock
        sent = []
        def fake(req, timeout):
            sent.append(json.loads(req.data))
            return io.BytesIO(b'{"token": "tok-123", "redirect_url": "x"}')
        self.client.force_login(self.u)
        with mock.patch("urllib.request.urlopen", fake):
            r1 = self.client.post(f"/order/{self.order.code}/bayar/")
            r2 = self.client.post(f"/order/{self.order.code}/bayar/")
        self.assertEqual((r1.json(), r2.json()), ({"token": "tok-123"}, {"token": "tok-123"}))
        self.assertEqual(len(sent), 1)  # token dipakai ulang
        self.assertEqual(sent[0]["transaction_details"], {"order_id": str(self.order.code), "gross_amount": 200000})
