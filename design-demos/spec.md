# Spec · Karcis (website pembelian tiket event)

- **Apa**: marketplace tiket event Indonesia (konser, festival, komedi, seminar, pameran), ala loket.com.
- **Nama**: "Karcis" (asumsi, placeholder; ganti kapan saja).
- **Audiens**: 18–35 th, mayoritas buka dari HP saat war tiket; EO di desktop.
- **Pesan inti**: (1) temukan event dekat & segera, (2) lihat sisa kuota jujur, (3) checkout cepat dengan batas waktu 15 menit, (4) e-ticket QR langsung.
- **Nada**: semangat, terpercaya, cepat. Bukan korporat.
- **Format**: web responsive, diverifikasi di 1440×900 dan 375×812. Satu HTML per arah + `proto.js` bersama.
- **Alur yang harus bisa diklik**: Beranda (cari + filter kategori) → Detail event (pilih jumlah per jenis tiket) → Login/Daftar (validasi) → Checkout (timer 15:00, metode bayar) → E-ticket.
- **Konten**: 9 event dari `manage.py seed` (data identik dengan DB lokal). Foto: picsum.photos (placeholder jujur, ganti dengan poster asli EO).
- **Batasan**: Tailwind/Django templates nanti; prototipe pakai CSS biasa. Tidak ada testimoni/logo partner palsu.
