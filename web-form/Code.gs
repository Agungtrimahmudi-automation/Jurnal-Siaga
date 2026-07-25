/**
 * Jurnal Siaga — Backend Form Input Shift Bulanan (Google Apps Script Web App)
 * Pengganti Google Form (lihat workflows/jurnal-siaga-generator.md, poin 6.5 & 3).
 *
 * Arsitektur: HTML form di-host TERPISAH di VPS/domain sendiri (lihat web-form/index.html).
 * Browser mengirim POST (fetch) ke URL deployment Web App ini, yang menulis baris
 * baru ke sheet respons. Header sheet dibuat PERSIS SAMA dengan yang dibaca node
 * "Normalisasi Data Form" di n8n, supaya Google Sheets Trigger (polling) tetap jalan.
 *
 * SETUP:
 * 1. Buka https://script.google.com -> New Project -> tempel isi file ini ke Code.gs.
 * 2. Project Settings > Script Properties -> tambah:
 *      RESPONSE_SPREADSHEET_ID = ID spreadsheet respons (lihat secrets/Link Form & Response.txt)
 *      RESPONSE_SHEET_GID      = gid tab respons yang SUDAH ADA (dipantau n8n).
 *        Ambil dari URL: .../edit?...&gid=203217433#gid=203217433 -> gid-nya "203217433".
 *        WAJIB pakai gid tab yang sudah ada, bukan nama — karena nama tab bawaan
 *        Google Form ("Form Responses 1") tidak selalu persis "Form Responses",
 *        dan kalau salah cocok, kode akan bikin tab BARU yang kosong alih-alih
 *        menulis ke tab lama yang dipantau n8n.
 * 3. Deploy > New deployment > Web app.
 *      Execute as   : Me
 *      Who has access: Anyone   (wajib "Anyone", bukan "Anyone with Google account",
 *                       karena request datang dari fetch() publik di VPS, tanpa login Google)
 * 4. Salin URL deployment (diakhiri /exec) ke konstanta APPS_SCRIPT_URL di web-form/index.html.
 * 5. Setiap kali Code.gs diedit: buka Manage deployments > edit deployment yang sama >
 *    Version: New version > Deploy. Ini menjaga URL /exec tetap sama (tidak perlu update
 *    index.html lagi). Membuat "New deployment" baru akan menghasilkan URL berbeda.
 * 6. Baris ditulis berdasarkan NAMA header kolom yang sudah ada di baris 1 sheet
 *    (bukan asumsi urutan tetap), jadi aman walau urutan kolom asli dari Google Form
 *    berbeda dari urutan di HEADERS di bawah. Kolom "WAKTU DIMULAI SHIFT BULAN INI"
 *    dicocokkan dengan .trim() supaya tetap ketemu walau header lama punya bug
 *    trailing newline ("...INI\n"). Setelah form ini live, update juga node
 *    "Normalisasi Data Form" di n8n: ganti key "WAKTU DIMULAI SHIFT BULAN INI\n"
 *    -> "WAKTU DIMULAI SHIFT BULAN INI".
 */

const TIMEZONE = 'Asia/Jakarta';

const HEADERS = [
  'Timestamp',
  'Email Address',
  'BULAN',
  'TAHUN',
  'INPUT TANGGAL APA SAJA SHIFT ANDA',
  'WAKTU DIMULAI SHIFT BULAN INI'
];

const BULAN_VALID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

/** Ping sederhana untuk cek deployment hidup — buka URL /exec langsung di browser. */
function doGet() {
  return jsonResponse_({ ok: true, message: 'Jurnal Siaga form backend aktif.' });
}

/**
 * Endpoint yang dipanggil oleh fetch() dari index.html di VPS.
 * Body dikirim sebagai text/plain berisi JSON (menghindari CORS preflight,
 * yang tidak didukung Apps Script Web App untuk request application/json).
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Body request kosong.');
    }
    const data = JSON.parse(e.postData.contents);
    const errors = validate_(data);
    if (errors.length > 0) {
      return jsonResponse_({ ok: false, message: errors.join(' ') });
    }

    const sheet = getResponseSheet_();
    appendResponseRow_(sheet, data);

    return jsonResponse_({ ok: true, message: 'Jadwal berhasil dikirim.' });
  } catch (err) {
    return jsonResponse_({ ok: false, message: err.message || 'Terjadi kesalahan pada server.' });
  }
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getResponseSheet_() {
  const props = PropertiesService.getScriptProperties();
  const ssId = props.getProperty('RESPONSE_SPREADSHEET_ID');
  const gid = props.getProperty('RESPONSE_SHEET_GID');
  if (!ssId) {
    throw new Error('RESPONSE_SPREADSHEET_ID belum diset di Script Properties.');
  }
  if (!gid) {
    throw new Error('RESPONSE_SHEET_GID belum diset di Script Properties.');
  }

  const ss = SpreadsheetApp.openById(ssId);
  const sheet = ss.getSheets().filter(function (s) {
    return String(s.getSheetId()) === String(gid);
  })[0];

  if (!sheet) {
    throw new Error('Sheet dengan gid ' + gid + ' tidak ditemukan di spreadsheet ini.');
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Menulis baris baru sesuai posisi kolom asli (dicocokkan lewat nama header), bukan urutan tetap. */
function appendResponseRow_(sheet, data) {
  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });

  const daftarTanggalStr = data.daftarTanggal
    .map(Number)
    .sort((a, b) => a - b)
    .join(', ');

  const valuesByHeader = {
    'Timestamp': Utilities.formatDate(new Date(), TIMEZONE, 'dd/MM/yyyy HH:mm:ss'),
    'Email Address': data.email.trim(),
    'BULAN': data.bulan,
    'TAHUN': data.tahun,
    'INPUT TANGGAL APA SAJA SHIFT ANDA': daftarTanggalStr,
    'WAKTU DIMULAI SHIFT BULAN INI': data.shiftAwal
  };

  const row = headerRow.map(function (h) {
    return Object.prototype.hasOwnProperty.call(valuesByHeader, h) ? valuesByHeader[h] : '';
  });
  sheet.appendRow(row);
}

function validate_(data) {
  const errors = [];
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!data || typeof data !== 'object') {
    return ['Data form tidak valid.'];
  }
  if (!data.email || !emailRegex.test(data.email.trim())) {
    errors.push('Email pengaju tidak valid.');
  }
  if (BULAN_VALID.indexOf(data.bulan) === -1) {
    errors.push('Bulan tidak valid.');
  }
  const tahun = Number(data.tahun);
  if (!Number.isInteger(tahun) || tahun < 2020 || tahun > 2100) {
    errors.push('Tahun tidak valid.');
  }
  if (data.shiftAwal !== 'S1' && data.shiftAwal !== 'S2') {
    errors.push('Shift awal harus S1 atau S2.');
  }
  if (!Array.isArray(data.daftarTanggal) || data.daftarTanggal.length === 0) {
    errors.push('Pilih minimal satu tanggal shift.');
  } else {
    const invalid = data.daftarTanggal.some(function (t) {
      const n = Number(t);
      return !Number.isInteger(n) || n < 1 || n > 31;
    });
    if (invalid) {
      errors.push('Ada tanggal yang tidak valid.');
    }
  }
  return errors;
}
