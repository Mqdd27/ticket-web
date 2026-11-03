from django.contrib import admin, messages
from django.shortcuts import get_object_or_404, redirect
from django.urls import path, reverse

from .models import Category, Event, HomeSection, Order, PromoCode, Ticket, TicketType, issue_tickets
from .stage import generate_scene


class TicketTypeInline(admin.TabularInline):
    model = TicketType
    extra = 1


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ["name", "slug", "stage_type"]
    prepopulated_fields = {"slug": ["name"]}


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ["title", "category", "city", "starts_at", "is_published"]
    list_filter = ["category", "city", "is_published"]
    search_fields = ["title", "venue", "city"]
    prepopulated_fields = {"slug": ["title"]}
    inlines = [TicketTypeInline]
    fieldsets = [
        (None, {"fields": ["title", "slug", "category", "description", "starts_at", "image_url", "is_published"]}),
        ("Lokasi", {"fields": ["venue", "address", "city", ("lat", "lng")],
                    "description": "Lat/Lng: klik kanan lokasi di Google Maps → salin koordinat."}),
    ]


@admin.register(PromoCode)
class PromoCodeAdmin(admin.ModelAdmin):
    list_display = ["code", "kind", "value", "event", "used", "max_uses", "valid_until", "is_active"]
    list_editable = ["is_active"]

    @admin.display(description="Terpakai")
    def used(self, obj):
        return obj.uses()


class TicketInline(admin.TabularInline):
    model = Ticket
    extra = 0
    readonly_fields = ["code", "checked_in_at"]
    can_delete = False


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ["code", "user", "ticket_type", "quantity", "promo", "total_rp", "status", "payment_type", "created_at"]
    list_filter = ["status"]
    inlines = [TicketInline]
    actions = ["generate_tickets"]

    @admin.display(description="Total")
    def total_rp(self, obj):
        return f"Rp{obj.total:,}".replace(",", ".")

    @admin.action(description="Tandai lunas & generate tiket QR")
    def generate_tickets(self, request, queryset):
        for o in queryset:
            issue_tickets(o)
        self.message_user(request, f"Tiket diterbitkan untuk {queryset.count()} order.")


@admin.register(HomeSection)
class HomeSectionAdmin(admin.ModelAdmin):
    list_display = ["title", "kind", "category", "order", "limit", "is_active", "stage_status"]
    list_editable = ["order", "limit", "is_active"]
    list_display_links = ["title"]
    change_form_template = "admin/events/homesection/change_form.html"

    @admin.display(description="Panggung 3D")
    def stage_status(self, obj):
        if obj.kind != "stage":
            return "-"
        return "✓ siap" if obj.stage_scene else "Belum digenerate"

    def get_urls(self):
        return [path("<int:pk>/generate-stage/", self.admin_site.admin_view(self.generate_stage),
                     name="events_homesection_generate")] + super().get_urls()

    def generate_stage(self, request, pk):
        s = get_object_or_404(HomeSection, pk=pk)
        back = reverse("admin:events_homesection_change", args=[pk])
        if request.method != "POST":
            return redirect(back)
        if s.kind != "stage" or not s.category:
            self.message_user(request, "Hanya section 'Panggung 3D' dengan kategori yang bisa digenerate.", messages.ERROR)
            return redirect(back)
        s.stage_scene = generate_scene(s.category.stage_type)
        s.save(update_fields=["stage_scene"])
        self.message_user(request, f"Panggung '{s.category.get_stage_type_display()}' digenerate (seed {s.stage_scene['seed']}).")
        return redirect(back)
