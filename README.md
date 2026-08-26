# DP / WD / SCB Live Validator

Chrome Extension Manifest V3 untuk mengambil snapshot tabel DP, WD, dan SCB, memvalidasi kandidat BNS, lalu membantu pengisian bonus secara semi-auto di browser.

Tidak ada backend, analytics, telemetry, atau pembacaan cookie/token. Scanner history bersifat read-only. Mode bot hanya menyiapkan form Deposit Manual; final Submit transaksi selalu memerlukan klik admin.

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

## Auto Refresh

Auto Refresh bersifat opsional dan menggunakan scheduler `chrome.alarms`, sehingga jadwal tetap bekerja walaupun popup extension ditutup. Pilihan interval yang tersedia adalah 5, 10, 15, 30, atau 60 menit.

Cara menggunakan:

1. aktifkan toggle **Auto Refresh**;
2. pilih interval;
3. klik **Apply**;
4. lihat status terakhir dan perkiraan jadwal berikutnya di bawah kontrol.

Setiap jadwal menjalankan proses yang sama dengan **Scan All + Validate**: reload ketiga halaman history ke page 1, scan seluruh pagination, membuat snapshot baru, lalu memperbarui validation, Bonus Queue, dan Payment Audit secara atomik. Jika salah satu scan gagal, snapshot lama tetap dipertahankan dan error ditampilkan.

Auto Refresh tidak mengganggu Bonus Input Bot:

- ketika bot aktif, refresh ditunda tanpa membuka atau memindahkan tab history;
- setelah bot berhenti, refresh yang tertunda dijadwalkan ulang sekitar 30 detik kemudian;
- ketika refresh sedang berjalan, tombol BOT ON dan aksi yang dapat mengubah queue dinonaktifkan;
- Auto Refresh tidak pernah menyentuh tab `AddCreditRequest2.aspx` milik bot.

Chrome dapat menjalankan alarm sedikit lebih lambat dari jadwal. Alarm juga tidak membangunkan komputer yang sedang sleep; setelah komputer aktif kembali, jadwal akan dilanjutkan.
8. Untuk pembagian, pilih urutan Bonus Queue lalu klik **BOT ON**. Periksa form yang disorot dan klik final **Submit**.

URL panel yang digunakan oleh mode satu klik:

```text
WD  https://bfj.porta-assist.com/_SubAg_Sub/WashCreditHistory.aspx
SCB https://bfj.porta-assist.com/_SubAg_Sub/AddCreditHistory2.aspx
DP  https://bfj.porta-assist.com/_SubAg_Sub/AddCreditHistory2.aspx?IsABD=1
```

Host permission dibatasi ke `https://bfj.porta-assist.com/_SubAg_Sub/*`. Scanner satu klik hanya membuka/membaca halaman history. Mode bot bekerja khusus pada `AddCreditRequest2.aspx` dan tidak pernah menekan final Submit sendiri.

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

## Bonus Queue semi-auto

Transaction View tetap mempertahankan audit per transaksi. Bonus Queue adalah lapisan terpisah yang membuat satu pekerjaan pembagian per username untuk laporan hari ini:

```text
seluruh DP hari ini
→ kelompokkan berdasarkan username
→ ambil transaksi DP terbesar setiap username
→ wajib 50.000 <= DP terbesar < 500.000
→ cek WD, SCB/history hari ini, dan Stop BNS
→ hitung 10%
→ bulatkan ke bawah ke kelipatan 1.000
→ READY
```

Contoh:

```text
userA  50.000
userA 300.000

DP terbesar 300.000 → bonus 30.000 → satu pekerjaan READY
```

Jika DP terbesar berada di luar range, seluruh ID tidak masuk antrean meskipun mempunyai transaksi lain yang berada di dalam range:

```text
userA  75.000
userA 600.000

DP terbesar 600.000 → MAX >= 500K → tidak mendapat bonus
```

Rumus bonus:

```js
Math.floor((maximumDp * 0.10) / 1000) * 1000
```

Bonus Queue menyediakan filter audit, sorting ID/DP, **Copy ID**, **Copy Bonus**, dan **Copy 2 Kolom**. Urutan yang dipilih juga digunakan saat **BOT ON** dijalankan.

## Bonus Input Bot

Bot bersifat semi-auto:

```text
ambil ID READY sesuai urutan queue
→ buka AddCreditRequest2.aspx untuk username tersebut
→ pastikan username form cocok
→ isi Amount sesuai bonus
→ pilih SCB|41466 (SCB A BONUS DEPOSIT HARIAN 01)
→ kosongkan Remark
→ admin memeriksa dan klik final Submit
→ catat ID sebagai sudah diproses pada sesi bot
→ langsung buka ID READY berikutnya
```

Bot tidak mencari atau mengklik final Submit secara otomatis. Ia hanya memasang validasi pada tombol Submit yang berada setelah field Amount. Jika username, amount, To Bank, atau remark berubah, klik diblokir. Bot tidak lagi menunggu verifikasi SCB; admin menjalankan **Scan All + Validate** secara manual setelah pembagian selesai.

Snapshot dari panel SCB dipisah menjadi dua dataset berdasarkan kolom **To Bank**:

- `SCB A BONUS DEPOSIT HARIAN 01` menjadi riwayat/pembayaran bonus aktual;
- To Bank non-SCB menjadi **DP manual** dan digabung dengan DP QRIS dari halaman `IsABD=1` sebagai dasar perhitungan bonus;
- rekening SCB bonus lain tidak dianggap sebagai DP dan tidak dianggap sebagai bonus harian.

Dengan demikian DP terbesar per username dicari dari gabungan **DP QRIS + DP manual**. Jika kolom To Bank tidak ditemukan, scan SCB dihentikan agar tidak menghasilkan validasi yang salah.

## Bonus Audit

Setiap **Scan All + Validate** membandingkan bonus yang seharusnya dengan pembayaran aktual pada SCB bonus harian. Audit bekerja per username per laporan hari ini dan dapat memberi lebih dari satu temuan pada ID yang sama:

Range Bonus Audit sengaja berbeda dari Validation dan Bonus Queue. Audit menerima DP terbesar mulai **50.000 tanpa batas atas**. Bonus dihitung 10%, dibulatkan turun ke ribuan, minimal **5.000**, dan maksimal **100.000**. Karena itu DP **1.000.000 atau lebih** tetap memiliki bonus audit sebesar 100.000. Validation dan Bonus Queue tetap memakai range 50.000 sampai kurang dari 500.000.

- `DOUBLE`: terdapat lebih dari satu transaksi bonus harian;
- `NOMINAL LEBIH` / `NOMINAL KURANG`: total aktual tidak sama dengan 10% dari DP terbesar yang dibulatkan ke bawah ribuan;
- `TANPA DP`: ada bonus aktual tetapi username tidak ditemukan pada DP;
- `MAX < 50K`: bonus dibayar untuk DP di bawah batas minimal audit;
- `ADA WD`: WD terjadi lebih dulu (atau pada waktu yang sama) sebelum bonus. Jika bonus diterima lebih dulu lalu baru WD, audit tidak menganggapnya pelanggaran;
- `STOP BNS`: bonus dibayar kepada ID pengecualian;
- `BELUM DIBAGI`: username memenuhi rule tetapi belum ditemukan pada SCB bonus harian;
- `BENAR`: tepat satu transaksi dan nominalnya sesuai.

Ringkasan menampilkan total seharusnya, aktual SCB, selisih, dan jumlah setiap jenis masalah. Tabel dapat difilter/disort serta disalin dengan **Copy Masalah** untuk pemeriksaan admin.

Semua aksi copy yang berisi lebih dari satu informasi menggunakan format TSV (pemisah TAB). Contoh `username` dan `bonus` akan langsung masuk ke dua cell berbeda ketika ditempel ke Google Sheets atau Excel. Nominal dicopy sebagai integer tanpa pemisah ribuan agar dikenali sebagai angka.

Saat bot aktif, aksi yang dapat membuat snapshot/queue berubah dinonaktifkan. Tombol **STOP BOT** dapat digunakan kapan saja; form yang sudah terbuka tidak akan diteruskan oleh extension.

## Sorting dan copy

Transaction view menyediakan urutan asli, ID terbesar/terkecil dengan natural numeric sort, dan nominal DP terbesar/terkecil. Pilihan sorting juga dipakai oleh hasil copy BNS.

Copy username menghasilkan daftar username BNS unik; `STOP_BNS` tidak ikut dicopy. Copy full detail tetap mempertahankan seluruh transaksi BNS.

## Menguji dengan panel asli

Pada setiap halaman panel:

1. pastikan session panel masih login dan laporan hari ini dapat dibuka;
2. klik **Scan Current Page**;
3. pastikan tipe halaman dan jumlah row pada pesan sukses sesuai;
4. cek timestamp card untuk memastikan ketiga snapshot masih baru;
5. jalankan validation dan audit total `DP raw`, `Eligible`, `< 50k`, `>= 500k`, serta nominal invalid;
6. bandingkan beberapa row boundary (49.999, 50.000, 499.999, 500.000) secara manual.

**Scan All + Validate** mendeteksi pager ASP.NET `Page x of y`, memindai page 1, berpindah melalui kontrol page resmi, menunggu setiap postback selesai, lalu menggabungkan seluruh page. `RRN`, `Reference`, atau nomor row digunakan sebagai transaction identity agar row tidak terduplikasi. Pesan sukses menampilkan jumlah page, misalnya `DP 1009 (2 pages)`. Tombol **Scan Active Page** tetap hanya memindai page yang sedang terlihat dan disediakan sebagai alat diagnosis/fallback.

## Automated tests

Node.js diperlukan hanya untuk development test:

```text
npm test
```

Test mencakup normalisasi nominal, seluruh sembilan case dari brief, transaksi duplikat, status gabungan WD+SCB, deteksi/extraction DP/WD/SCB, shared snapshot pipeline, konfigurasi Auto Refresh, refresh yang ditunda saat bot aktif, unique-ID bonus queue, DP terbesar, pembulatan bonus ke bawah, dan pengecualian history/WD/SB.

## Struktur file

```text
manifest.json          Manifest V3 dan permission minimal
icons/                 Logo master dan icon Chrome 16/32/48/128 px
popup.html             Dashboard dan transaction view
popup.css              Tampilan popup
popup.js               One-click scan, queue, kontrol bot, Stop BNS, copy
bot/background.js      Controller antrean sesi dan perpindahan ID setelah Submit
bot/deposit-assistant.js  Prefill form dan guard final Submit
bot/auto-refresh.js    Scheduler alarm, refresh lock, dan proteksi bot
content/scanner.js     Table finder, page detector, header-driven extractor
core/normalize.js      Normalisasi username dan nominal
core/validator.js      Rule eligibility dan presence validation
core/bonus.js          Unique-ID queue, maximum DP, dan bonus calculation
core/audit.js          Audit expected-vs-actual, double, nominal, dan rule
core/sort.js           Natural ID sort dan nominal DP sort
core/panels.js         URL dan mapping tab untuk mode satu klik
core/pagination.js     Penggabungan multi-page dengan identitas RRN/Reference
core/panel-scan.js     Orkestrasi scan multi-page yang dipakai popup/background
core/pipeline.js       Snapshot filtering dan derived validation bersama
core/storage.js        Wrapper chrome.storage.local
tests/                 Test normalization, validator, dan scanner
```
