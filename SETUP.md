# Izud Finance Hub — setup (±20 menit, sekali saja)

App ini menggantikan webapp Apps Script (Finance Hub v29) + 3 spreadsheet terpisah.

- **Cara kerja:** app statis (PWA) yang menyimpan semua data di HP/laptop (IndexedDB), jadi dibuka instan dan tetap jalan offline.
- **Sinkron:** ke **satu** Google Sheet ("Izud Finance Hub") lewat Google Sheets API. Tidak ada Apps Script dan tidak ada server.

```
HP / laptop (app + data lokal)  ⇄  Google Sheets API  ⇄  1 spreadsheet: satu tab per tabel, semua tahun
```

## 1. Taruh app di GitHub Pages

1. Buat akun GitHub (kalau belum) → **New repository** → nama mis. `finance-hub` → **Public**. Kode app tidak berisi data pribadi apa pun.
2. **Add file → Upload files** → seret **isi** folder `hub/` (index.html, css/, js/, icons/, sw.js, manifest.webmanifest, SETUP.md) → **Commit**.
3. **Settings → Pages** → Source: *Deploy from a branch* → Branch `main` / `(root)` → **Save**.
4. Tunggu ±1 menit. Alamat app: `https://<username>.github.io/finance-hub/`.

> Jangan upload folder `migration/` atau file `.json` hasil ekspor. Itu data keuanganmu, dan repo publik bisa dilihat siapa saja.

## 2. Buat Google OAuth Client ID (supaya app boleh menulis ke Google Sheet-mu)

1. Buka <https://console.cloud.google.com/> → pilih/buat project **Finance Hub**.
2. **APIs & Services → Library**: aktifkan **Google Sheets API** dan **Google Drive API**.
3. **APIs & Services → OAuth consent screen**:
   - User type **External**, nama app "Izud Finance Hub", email kamu.
   - Scopes: tambahkan `.../auth/drive.file`. App hanya bisa melihat file yang ia buat sendiri, bukan seluruh Drive-mu.
   - Test users: tambahkan `izzuddd@gmail.com`.
   - **Publishing status:** tetap *Testing* sudah cukup. Kalau mau, klik *Publish app* supaya layar peringatan "app belum diverifikasi" tidak muncul setiap login ulang. Scope `drive.file` tidak butuh verifikasi Google.
4. **Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized JavaScript origins: `https://<username>.github.io`. Tambahkan juga `http://localhost:8124` kalau mau mencoba lokal.
   - Salin **Client ID** (`xxxx.apps.googleusercontent.com`).
5. Tempel Client ID di salah satu tempat ini:
   - `js/config.js` → `GOOGLE_CLIENT_ID: '…'`, lalu upload ulang file itu ke GitHub, **atau**
   - langsung di app: **⚙︎ Pengaturan → Google OAuth Client ID** (tersimpan per perangkat).

## 3. Pindahkan data lama (dilakukan DI DALAM APP, bukan di GitHub / Google Cloud)

Tiga tempat, tiga tugas:

| Tempat | Untuk apa | Kapan dibuka |
|---|---|---|
| github.com | menyimpan file kode app | sekali (dan saat update) |
| console.cloud.google.com | membuat Client ID (izin ke Google Sheets) | sekali |
| **`https://<username>.github.io/finance-hub/`** | **app-nya: dipakai sehari-hari, tempat import** | setiap hari |

Langkah import (cukup sekali, di laptop):

1. File import sudah ada di laptop: `BUDGETING_SPREADSHEETS\migration\hub-import-2026-09-27.json`. **Jangan upload ke GitHub.**
2. Buka **alamat app** `https://<username>.github.io/finance-hub/` di Chrome. App yang masih kosong langsung membuka **Pengaturan** (atau ketuk **⚙︎** kanan atas).
3. Di kartu **"Cadangan & impor"** klik **⬆ Impor JSON**, lalu pilih file dari langkah 1. Tunggu sampai muncul "Impor selesai ✓".
4. Masih di Pengaturan:
   - tempel **Client ID** (dari langkah 2) di kolom *Google OAuth Client ID*
   - klik **Hubungkan Google Sheets** dan login
   - app membuat spreadsheet "Izud Finance Hub" di Drive-mu dan mengirim semua data (±30 detik)
5. **Di HP:** buka alamat app yang sama → ⚙︎ Pengaturan → tempel Client ID → **Hubungkan Google Sheets**. Data ditarik otomatis; **tidak perlu import lagi.**

Untuk data yang lebih baru dari 27 Sep 2026:

1. Unduh ketiga spreadsheet sebagai .xlsx.
2. Jalankan:
   ```
   python tools/migrate_to_hub.py diary.xlsx budget.xlsx holiday.xlsx migration/hub-import.json <folder RAB>
   ```
3. Import ulang file hasilnya (langkah 3).

## 4. Pasang di HP

- **Android (Chrome):** menu ⋮ → *Add to Home screen / Install app*.
- **iPhone (Safari):** Share → *Add to Home Screen*.

App terbuka tanpa jaringan dan langsung menampilkan data terakhir.

## Pemakaian sehari-hari

- **Catat, edit, hapus:** langsung tersimpan di perangkat (0 detik), lalu dikirim ke Google Sheet ±2,5 detik kemudian. Sinkron juga terjadi saat app dibuka dan setiap 5 menit.
- **Titik di header (status sinkron):**
  - hijau = tersinkron
  - biru = sedang sinkron
  - oranye = perlu login ulang, ketuk titiknya. Sesi Google berlaku ±1 jam, dan browser melarang popup login tanpa ketukan.
  - merah = error, detailnya ada di Pengaturan
- **Tahun baru:** tidak perlu file baru. Buka Budget → siklus Jan → **Salin dari Des**. Semua tahun ada di satu database.
- **Google Sheet:**
  - Boleh dilihat, difilter, dibuat pivot atau grafik. Tab **RINGKASAN** berisi ringkasan per siklus dan ditulis ulang setiap sinkron.
  - Edit sel biasa boleh; app menarik perubahannya.
  - **Jangan** mengganti nama tab, mengubah baris 1, menghapus baris, atau sort. App mengingat nomor baris; hapus data dari app saja.

## Opsional: harga emas otomatis

Browser tidak bisa membaca galeri24.co.id secara langsung. Kalau mau tombol "⟳ Ambil harga buyback" berfungsi, deploy `tools/gold-endpoint.gs` (petunjuk ada di dalam filenya) lalu isi URL-nya di Pengaturan → Ubah parameter. Tanpa itu, harga dicatat manual. Emas tetap tidak dijual; ini hanya pencatatan nilai.

## Cadangan

Pengaturan → **⬇ Ekspor cadangan (JSON)**. Google Sheet sendiri juga menjadi cadangan kedua, lengkap dengan riwayat versi Google.

## Update app

Upload ulang file yang berubah ke GitHub, lalu naikkan `VERSION` di `sw.js`. HP akan mengambil versi baru pada pembukaan berikutnya.
