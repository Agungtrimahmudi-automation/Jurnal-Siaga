# Spesifikasi Teknis: Workflow Generator Jurnal Siaga Bulanan

## 1. Tujuan Proyek
Menggantikan proses pengisian manual Jurnal Siaga bulanan (laporan dinas rutin) dengan alur otomatis penuh. Alur yang dibangun mencakup: input data form → pembuatan *spreadsheet* jurnal per tanggal → konversi ke PDF → pengiriman email ke pengaju → pengarsipan otomatis ke Google Drive.

## 2. Status Proyek
Sistem ini pernah berjalan di lingkungan produksi (dibangun secara mandiri oleh pemilik proyek, tanpa bantuan AI). Karena *instance* n8n sebelumnya sempat hilang, workflow ini akan dibangun ulang. Dokumen ini berfungsi sebagai **acuan utama** agar proses *rebuild* tidak kehilangan konteks atau logika bisnis yang sudah disepakati.

## 3. Arsitektur Sistem

- **Mesin Eksekusi (`Backbone`)**: n8n, di-*host* secara mandiri (*self-hosted*) di VPS pribadi.  
  *Alasan*: Menjaga privasi data klien, tanpa biaya per-eksekusi, dan sangat cocok untuk logika deterministik (tidak memerlukan kecerdasan buatan pada saat *runtime*).

- **Lapisan Input**: Saat ini menggunakan Google Form, namun akan diganti dengan *custom web form* yang di-*host* di VPS + domain sendiri. Tujuannya untuk kontrol penuh atas tampilan dan data.

- **Lapisan Data**: Google Sheets (terdiri dari lembar respons form dan *spreadsheet master* yang berisi 4 tab template: A, B, C, D).

- **Peran Kecerdasan Buatan (AI)**: Hanya digunakan pada tahap *development* dan pemeliharaan (seperti desain awal, *debugging*, dan pembuatan dokumentasi). AI **tidak** dilibatkan dalam jalur eksekusi bulanan; klasifikasi template tetap murni menggunakan kode deterministik.

### Pemilihan Teknologi Form
1. **Google Apps Script Web App**: Gratis, terintegrasi native dengan Sheets, namun URL tetap mengarah ke domain Google (bisa disamarkan dengan *reverse proxy*, tetapi kuota eksekusi tetaplah milik Google).
2. **Custom Web Form** (HTML/JS + *backend* kecil): 100% di-*host* di VPS + domain sendiri, menulis langsung ke Sheets via Sheets API (menggunakan *service account* yang sama dengan n8n).

## 4. Alur Data End-to-End

1. **Trigger**: Pengguna mengisi form (data: bulan, tahun, daftar tanggal shift, shift awal S1/S2, dan email pengaju) → data tersimpan di *sheet* respons.
2. **Deteksi Data Baru**: *Google Sheets Trigger* (dengan metode *polling* setiap 1 menit) mendeteksi dan menangkap baris baru.
3. **Normalisasi Data**: Data form diekstrak dan dipetakan menjadi variabel kerja yang terstruktur.
4. **Klasifikasi Template (Code Node - JavaScript)**:
   Untuk setiap tanggal dalam daftar:
   - Shift dihitung bergantian berdasarkan urutan tanggal (indeks genap = shift_awal, indeks ganjil = kebalikannya).
   - **S2 (Malam)** → selalu **Template D**.
   - **S1 (Pagi) + Selasa/Kamis** → **Template A**.
   - **S1 (Pagi) + Senin/Jumat** → **Template B**.
   - **S1 (Pagi) + Sabtu/Minggu/Rabu** → **Template C**.
5. **Generasi Spreadsheet**: Buat *spreadsheet* baru per bulan, salin tab template sesuai hasil klasifikasi, ganti nama tab, dan isi sel otomatis untuk kolom Hari & Tanggal.
6. **Finalisasi**: Konversi ke PDF → Kirim Email ke pengaju → Arsipkan PDF ke Folder Drive.

## 5. Struktur Baku Jurnal (Tidak Berubah)
Setiap template (A/B/C/D) memiliki 7 baris kegiatan dengan jam yang telah ditetapkan (misal untuk shift siang: 08.00, 09.15, 10.00, 11.00, 12.00, 17.57, 20.00; pola serupa berlaku untuk shift malam). **Jumlah baris bersifat tetap dan tidak boleh bertambah/berkurang**—ini merupakan keputusan desain yang disadari, karena format resmi dari instansi klien memang bersifat baku.

## 6. Poin-Poin Perbaikan pada Proses Rebuild

### 6.1. Sumber Data Tunggal untuk ID Spreadsheet
- **Masalah**: ID *spreadsheet master* dan *gid* setiap tab di-*hardcode* secara terpisah di 5 node berbeda. Hal ini menyebabkan kerentanan error tinggi; ketika ada perubahan, banyak tempat yang harus diperbarui dan sering terlewat.
- **Solusi**: Simpan `MASTER_SPREADSHEET_ID` dan pemetaan `gid` tab A/B/C/D dalam satu *Set Node* di awal alur. Seluruh node lain akan membaca konfigurasi dari titik pusat ini.

### 6.2. Penentuan Jam Lampu (Dinamis, Bukan Hardcode)
- **Masalah**: Jam 17.57 (nyalakan lampu) dan 05.57 (matikan lampu) sebelumnya di-*hardcode*. Jika sama persis setiap minggu, jurnal terlihat "terlalu template" dan berpotensi menimbulkan kecurigaan saat audit.
- **Solusi**: Jam ini kemungkinan besar mengikuti waktu Maghrib dan Subuh (konvensi umum di lingkungan instansi pemerintah). Perlu dikonfirmasi ke klien. Jika benar, ambil data dari API jadwal sholat untuk lokasi klien melalui *HTTP Request Node*, lalu isi secara dinamis ke sel yang sesuai. Pergeseran alami beberapa menit setiap minggunya akan membuat jurnal terlihat autentik dan dapat dipertanggungjawabkan.  
  > *Catatan: Hanya 2 baris ini yang dibuat dinamis; baris administratif lainnya tetap mengikuti tulisan tetap di template karena bersifat baku.*

### 6.3. Override Manual untuk Kejadian Khusus (Operasi Lapangan)
- **Konteks**: Terkadang terjadi operasi penyelamatan nyata (biasanya diinformasikan oleh admin kantor kepada klien, lalu diteruskan ke pemilik proyek). Kejadian ini jarang terjadi, maksimal 4 shift per minggu.
- **Aturan**:
  - Jumlah baris tetap 7 (tidak bertambah).
  - Yang diubah hanya isi konten (Jam + Uraian Kegiatan) pada baris tertentu, bukan keseluruhan tabel.
  - Input bersifat **manual** (diketik langsung oleh pemilik proyek), karena frekuensinya jarang dan tidak memerlukan otomatisasi klasifikasi.
- **Desain Teknis**: Tambahkan *sheet* baru bernama `Log Operasi Khusus` dengan kolom sebagai berikut:

| Tanggal | Baris ke- (1-7) | Jam Baru | Uraian Pengganti |
|---------|-----------------|----------|-------------------|
|         |                 |          |                   |

Dalam alur n8n, setelah tab tanggal selesai dibuat, tambahkan node pengecekan: apakah tanggal tersebut memiliki entri di `Log Operasi Khusus`? Jika ada, timpa kolom JAM dan URAIAN di baris yang ditunjuk menggunakan `values:batchUpdate`.

### 6.4. Notifikasi Kegagalan Sistem
- **Masalah**: Saat ini, jika satu *step* saja error (misalnya ID salah), workflow berhenti tanpa pemberitahuan, dan baru terdeteksi ketika klien menanyakan laporan yang belum masuk.
- **Solusi**: Tambahkan *Error Trigger Workflow* terpisah yang secara otomatis mengirimkan notifikasi (email/Telegram) ke pemilik proyek jika workflow utama gagal di *step* mana pun.

### 6.5. Penggantian Lapisan Input (Form)
Ganti Google Form dengan *custom web form* (lihat poin 3 untuk opsi hosting). Syarat mutlak: **nama kolom hasil isian harus persis sama** dengan yang dibaca oleh node `Normalisasi Data Form`—termasuk potensi karakter tersembunyi (misalnya *newline* di akhir nama kolom yang sempat menjadi masalah di data lama). Hal ini wajib dicek ulang saat form baru selesai dibuat, sebelum dihubungkan ke n8n.

## 7. Prioritas Pengerjaan (Rekomendasi)

1. **Perbaiki Sumber Data Tunggal** (paling cepat dan langsung mencegah error berulang).
2. **Tambahkan Fitur Override** (`Log Operasi Khusus`)—ini merupakan fitur yang paling diminta dan bernilai tinggi bagi klien.
3. **Implementasikan Notifikasi Error**.
4. **Konfirmasi ke klien** terkait basis waktu Maghrib/Subuh, lalu integrasikan API jadwal sholat.
5. **Bangun Form Pengganti** (setelah arsitektur inti benar-benar stabil).
