# DP / WD / SCB Live Validator

Chrome Extension Manifest V3 untuk mengambil snapshot tabel DP, WD, dan SCB dari halaman panel yang sedang aktif, lalu memvalidasi kandidat BNS sepenuhnya di browser.

Extension ini bersifat **read-only**. Tidak ada backend, request API, analytics, telemetry, pembacaan cookie/token, perubahan transaksi, atau auto-click.

## Cara memasang

1. Buka `chrome://extensions`.
2. Aktifkan **Developer mode**.
3. Klik **Load unpacked**.
4. Pilih folder project ini (`extension-b`).
5. Pin **DP / WD / SCB Live Validator** agar mudah dibuka.

Tidak ada dependency atau build step untuk menjalankan extension.

## Workflow

1. Pastikan sudah login ke `bfj.porta-assist.com`.
2. Buka popup extension dan klik **Scan All + Validate** satu kali.
3. Extension mencari tab DP, WD, dan SCB yang sudah terbuka. Halaman yang belum terbuka dibuat sebagai background tab.
4. Setelah tabel siap, ketiga snapshot diambil dan validation langsung dijalankan.
5. Gunakan sort/filter, **View BNS**, **Copy BNS Usernames**, atau **Copy BNS Full Detail**.
6. **Scan Active Page** dan **Run Validation** tetap tersedia sebagai fallback manual.
7. Gunakan **Clear All Snapshot** untuk menghapus snapshot tanpa menghapus daftar Stop BNS.

URL panel yang digunakan oleh mode satu klik:

```text
WD  https://bfj.porta-assist.com/_SubAg_Sub/WashCreditHistory.aspx
SCB https://bfj.porta-assist.com/_SubAg_Sub/AddCreditHistory2.aspx
DP  https://bfj.porta-assist.com/_SubAg_Sub/AddCreditHistory2.aspx?IsABD=1
```

Host permission dibatasi ke `https://bfj.porta-assist.com/_SubAg_Sub/*`. Mode satu klik hanya membuka/membaca halaman history tersebut; tidak menekan tombol transaksi atau mengubah data panel.

Snapshot kosong yang berhasil diambil disimpan sebagai `0 rows` dan berbeda dari snapshot yang belum pernah diambil. Popup tetap menampilkan pesan `No transaction rows found.`; validation hanya dapat berjalan setelah ketiga jenis snapshot tersedia.

## Selector dan page detection

Scanner memeriksa seluruh elemen `table`, dengan prioritas ekstra untuk:

```css
table#AddCreditHistory_cm1_g
```

Scanner tidak memakai indeks kolom tetap. Setiap tabel dicari baris header yang berisi:

- `User Name` atau `Username`;
- `Deposit` untuk DP/SCB, atau `Withdraw Amount`/`Withdrawal Amount` untuk WD;
- `Date/Time`, `Date Time`, atau `Datetime` bila tersedia.

Setelah header ditemukan, page detector memakai kombinasi berikut:

- **WD:** header `Withdraw Amount` atau form/URL berisi `WashCreditHistory`;
- **DP:** query/form action `IsABD=1`, atau adanya header `RRN`/`Reference`;
- **SCB:** header `Edited By`, atau `AddCreditHistory2.aspx` tanpa indikator DP.

Ini sengaja memakai kombinasi DOM dan URL/form action agar tidak bergantung pada satu selector saja.

## Extraction dan storage

Untuk setiap row, scanner membaca cell berdasarkan mapping header dan menghasilkan username, nominal mentah, serta date/time. Popup kemudian:

1. trim dan lowercase key username dengan locale Indonesia;
2. mengubah `50000`, `50,000`, `50.000`, dan `Rp50.000` menjadi angka `50000`;
3. melewati nominal invalid tanpa menghentikan scan;
4. menyimpan row valid beserta timestamp dan metadata sumber.

Data disimpan di `chrome.storage.local` pada key `dp`, `wd`, `scb`, dan `validation`. Mengambil snapshot baru menghapus hasil validation lama agar hasil stale tidak tampil.

## Validation engine

Eligibility selalu dihitung **per transaksi DP**:

```js
amount >= 50000 && amount < 500000
```

Transaksi username yang sama tidak dijumlah atau dihapus. Untuk setiap transaksi eligible, username key diperiksa pada `Set` WD dan SCB, lalu diberi salah satu status:

- `BNS`
- `FOUND_WD`
- `FOUND_SCB`
- `FOUND_WD_AND_SCB`
- `STOP_BNS`

## Stop BNS / SB

Masukkan satu ID per baris pada input **Stop BNS / SB**, lalu klik **Save Stop BNS**. Daftar dinormalisasi case-insensitively, duplicate dibuang, dan disimpan lokal.

Stop BNS hanya diterapkan ketika transaksi eligible tidak ditemukan di WD maupun SCB. Dengan demikian status presence tetap mempunyai prioritas:

```text
FOUND_WD / FOUND_SCB / FOUND_WD_AND_SCB
→ STOP_BNS jika ID ada dalam daftar SB
→ BNS jika tidak ada dalam daftar SB
```

Daftar SB tidak ikut terhapus oleh **Clear All Snapshot**. Gunakan **Clear List** pada bagian Stop BNS untuk mengosongkannya.

## Sorting dan copy

Transaction view menyediakan urutan asli, ID terbesar/terkecil dengan natural numeric sort, dan nominal DP terbesar/terkecil. Pilihan sorting juga dipakai oleh hasil copy BNS.

Copy username menghasilkan daftar username BNS unik; `STOP_BNS` tidak ikut dicopy. Copy full detail tetap mempertahankan seluruh transaksi BNS.

## Menguji dengan panel asli

Pada setiap halaman panel:

1. pastikan tabel sudah selesai tampil (termasuk filter/page size yang diinginkan);
2. klik **Scan Current Page**;
3. pastikan tipe halaman dan jumlah row pada pesan sukses sesuai;
4. cek timestamp card untuk memastikan ketiga snapshot masih baru;
5. jalankan validation dan audit total `DP raw`, `Eligible`, `< 50k`, `>= 500k`, serta nominal invalid;
6. bandingkan beberapa row boundary (49.999, 50.000, 499.999, 500.000) secara manual.

Extension hanya membaca row yang saat itu ada di DOM. Jika panel memakai pagination server-side, tampilkan page size yang mencakup data yang hendak divalidasi sebelum scan. Sample HTML lengkap tidak disertakan pada brief, jadi bila struktur panel asli memiliki label header berbeda, tambahkan alias di `content/scanner.js` berdasarkan HTML aktual.

## Automated tests

Node.js diperlukan hanya untuk development test:

```text
npm test
```

Test mencakup normalisasi nominal, seluruh sembilan case dari brief, transaksi duplikat, status gabungan WD+SCB, serta deteksi/extraction DP, WD, dan SCB dengan posisi kolom yang berbeda-beda.

## Struktur file

```text
manifest.json          Manifest V3 dan permission minimal
icons/                 Logo master dan icon Chrome 16/32/48/128 px
popup.html             Dashboard dan transaction view
popup.css              Tampilan popup
popup.js               One-click scan, render, filter, Stop BNS, copy, clear
content/scanner.js     Table finder, page detector, header-driven extractor
core/normalize.js      Normalisasi username dan nominal
core/validator.js      Rule eligibility dan presence validation
core/sort.js           Natural ID sort dan nominal DP sort
core/panels.js         URL dan mapping tab untuk mode satu klik
core/storage.js        Wrapper chrome.storage.local
tests/                 Test normalization, validator, dan scanner
```
