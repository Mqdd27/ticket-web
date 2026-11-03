from django.contrib import admin
from django.urls import include, path

from events import views

urlpatterns = [
    path("admin/", admin.site.urls),
    path("akun/", include("django.contrib.auth.urls")),
    path("akun/daftar/", views.register, name="register"),
    path("akun/tiket/", views.my_tickets, name="my_tickets"),
    path("", views.home, name="home"),
    path("acara/", views.event_list, name="event_list"),
    path("near/", views.near, name="near"),
    path("e/<slug:slug>/", views.event_detail, name="event_detail"),
    path("e/<slug:slug>/beli/", views.buy, name="buy"),
    path("order/<uuid:code>/", views.order_detail, name="order"),
]
