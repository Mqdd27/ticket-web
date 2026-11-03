// Logika prototipe bersama. Tiap dir-N.html mendefinisikan window.VIEWS sebelum memuat file ini.
// Data = sama persis dengan `manage.py seed` (tanggal relatif ke 3 Nov 2026).
const D = (d) => new Date(Date.UTC(2026, 10, 3 + d, 12)).toISOString();
const EVENTS = [
  { id: 1, title: "Jakarta Music Fest 2026", venue: "GBK Senayan", city: "Jakarta", date: D(14), cat: "Musik",
    tickets: [{ id: 11, name: "Festival", price: 350000, left: 380, quota: 500 }, { id: 12, name: "VIP", price: 1200000, left: 0, quota: 50 }] },
  { id: 2, title: "Synchronize Night", venue: "JIExpo Kemayoran", city: "Jakarta", date: D(21), cat: "Musik",
    tickets: [{ id: 21, name: "Presale", price: 250000, left: 0, quota: 200 }, { id: 22, name: "Regular", price: 400000, left: 255, quota: 300 }] },
  { id: 3, title: "Bandung Jazz Weekend", venue: "Sabuga ITB", city: "Bandung", date: D(30), cat: "Musik",
    tickets: [{ id: 31, name: "Daily Pass", price: 300000, left: 390, quota: 400 }, { id: 32, name: "2-Day Pass", price: 550000, left: 200, quota: 200 }] },
  { id: 4, title: "Stand Up Comedy Tour", venue: "Teater Jakarta TIM", city: "Jakarta", date: D(9), cat: "Komedi",
    tickets: [{ id: 41, name: "Tribun", price: 150000, left: 20, quota: 300 }, { id: 42, name: "Front Row", price: 450000, left: 2, quota: 40 }] },
  { id: 5, title: "Tech Summit Indonesia", venue: "ICE BSD", city: "Tangerang", date: D(45), cat: "Seminar",
    tickets: [{ id: 51, name: "Student", price: 75000, left: 120, quota: 150 }, { id: 52, name: "Professional", price: 500000, left: 210, quota: 300 }] },
  { id: 6, title: "Bali Sunset Festival", venue: "Garuda Wisnu Kencana", city: "Bali", date: D(60), cat: "Festival",
    tickets: [{ id: 61, name: "GA", price: 600000, left: 600, quota: 1000 }, { id: 62, name: "VVIP", price: 3500000, left: 15, quota: 20 }] },
  { id: 7, title: "Yogyakarta Art Expo", venue: "Jogja Expo Center", city: "Yogyakarta", date: D(7), cat: "Pameran",
    tickets: [{ id: 71, name: "Masuk", price: 50000, left: 880, quota: 1000 }] },
  { id: 8, title: "Surabaya Rock Night", venue: "Grand City", city: "Surabaya", date: D(33), cat: "Musik",
    tickets: [{ id: 81, name: "Regular", price: 200000, left: 0, quota: 250 }] },
  { id: 9, title: "Seminar Investasi Pemula", venue: "Online (Zoom)", city: "Online", date: D(5), cat: "Seminar",
    tickets: [{ id: 91, name: "Gratis", price: 0, left: 180, quota: 500 }] },
].map((e) => ({ ...e, img: `https://picsum.photos/seed/event-${e.id}/900/600`,
  from: Math.min(...e.tickets.map((t) => t.price)), soldOut: e.tickets.every((t) => !t.left) }))
  .sort((a, b) => a.date.localeCompare(b.date));

const CATS = ["Semua", "Musik", "Festival", "Komedi", "Seminar", "Pameran"];
const rp = (n) => (n === 0 ? "Gratis" : "Rp" + n.toLocaleString("id-ID"));
const dt = (iso, o = { weekday: "short", day: "numeric", month: "short" }) =>
  new Date(iso).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", ...o });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const KEY = "karcis-proto-" + location.pathname;

const S = { cat: "Semua", q: "", qty: {}, errors: {}, values: {}, next: null, order: null,
  user: JSON.parse(localStorage.getItem(KEY) || "null") };

function ctx() {
  const q = S.q.toLowerCase();
  const list = EVENTS.filter((e) => (S.cat === "Semua" || e.cat === S.cat) &&
    (!q || (e.title + e.city + e.venue).toLowerCase().includes(q)));
  const [, route, id] = location.hash.split("/");
  const ev = EVENTS.find((e) => e.id === +id);
  const lines = ev ? ev.tickets.filter((t) => S.qty[t.id]).map((t) => ({ ...t, n: S.qty[t.id] })) : [];
  return { ...S, list, ev, lines, total: lines.reduce((s, l) => s + l.n * l.price, 0),
    count: lines.reduce((s, l) => s + l.n, 0), route: route || "home", EVENTS, CATS, rp, dt, esc };
}

function render() {
  let c = ctx();
  if ((c.route === "checkout" || c.route === "done") && !S.order) return go("#/");
  if (c.route === "event" && !c.ev) return go("#/");
  const view = window.VIEWS[c.route] || window.VIEWS.home;
  document.getElementById("app").innerHTML = view(c);
  window.VIEWS.after?.(c);
  tick();
}
const go = (h) => { if (location.hash === h) render(); else location.hash = h; scrollTo(0, 0); };

function tick() {
  document.querySelectorAll("[data-countdown]").forEach((el) => {
    const s = Math.max(0, Math.round((S.order.expires - Date.now()) / 1000));
    el.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  });
}
setInterval(tick, 1000);

function validate(kind, v) {
  const e = {};
  if (kind === "register" && v.name.trim().length < 2) e.name = "Isi nama lengkap";
  if (!/^\S+@\S+\.\S+$/.test(v.email)) e.email = "Format email belum benar";
  if (v.password.length < 8) e.password = "Minimal 8 karakter";
  if (kind === "register" && v.password !== v.password2) e.password2 = "Password tidak sama";
  return e;
}

document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-act]");
  if (!a) return;
  const { act, v } = a.dataset;
  if (act === "cat") { S.cat = v; renderList(); }
  if (act === "qty") {
    const t = ctx().ev.tickets.find((t) => t.id === +a.dataset.t);
    S.qty[t.id] = Math.max(0, Math.min((S.qty[t.id] || 0) + +v, t.left, 10));
    render();
  }
  if (act === "buy") {
    const c = ctx();
    if (!c.count) return;
    if (!S.user) { S.next = location.hash; return go("#/login"); }
    S.order = { ev: c.ev, lines: c.lines, total: c.total, count: c.count, pay: "qris",
      expires: Date.now() + 15 * 60 * 1000, code: Math.random().toString(36).slice(2, 10).toUpperCase() };
    go("#/checkout");
  }
  if (act === "pay-method") { S.order.pay = v; render(); }
  if (act === "pay") { S.order.paid = true; S.qty = {}; go("#/done"); }
  if (act === "logout") { S.user = null; localStorage.removeItem(KEY); render(); }
});

document.addEventListener("input", (e) => {
  if (e.target.id === "q") { S.q = e.target.value; renderList(); }
});

function renderList() {
  const c = ctx();
  const el = document.getElementById("list");
  if (!el) return render();
  el.innerHTML = window.VIEWS.list(c);
  document.querySelectorAll("[data-act=cat]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === S.cat));
}

document.addEventListener("submit", (e) => {
  const f = e.target.closest("[data-form]");
  if (!f) return;
  e.preventDefault();
  const kind = f.dataset.form;
  const v = Object.fromEntries(new FormData(f));
  S.values = v;
  S.errors = validate(kind, v);
  if (Object.keys(S.errors).length) return render();
  S.user = { name: v.name || v.email.split("@")[0], email: v.email };
  localStorage.setItem(KEY, JSON.stringify(S.user));
  S.values = {};
  const n = S.next; S.next = null;
  go(n || "#/");
});

addEventListener("hashchange", () => { S.errors = {}; render(); });
render();
