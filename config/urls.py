from django.contrib import admin
from django.urls import include, path

from events import views

urlpatterns = [
    path("admin/", admin.site.urls),
    path("akun/", include("django.contrib.auth.urls")),
    path("akun/daftar/", views.register, name="register"),
    path("akun/tiket/", views.my_tickets, name="my_tickets"),
    path("akun/tiket/<uuid:code>/", views.ticket_detail, name="ticket_detail"),
    path("", views.home, name="home"),
    path("acara/", views.event_list, name="event_list"),
    path("near/", views.near, name="near"),
    path("section/<int:pk>/acara/", views.section_events, name="section_events"),
    path("e/<slug:slug>/", views.event_detail, name="event_detail"),
    path("e/<slug:slug>/beli/", views.buy, name="buy"),
    path("order/<uuid:code>/", views.order_detail, name="order"),
    path("order/<uuid:code>/bayar/", views.order_pay, name="order_pay"),
    path("payment/midtrans/notify/", views.midtrans_notify, name="midtrans_notify"),
]
