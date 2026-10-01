# Saffteen Studio for OpenCode

Plugin TUI personal: tema graphite/mint, sidebar aktivitas kontekstual, avatar pixel-art bergerak, panel responsif, notifikasi desktop, dan suara kustom.

## Fitur

- Aktivitas tool/MCP, subagent, alasan menunggu, laporan token terakhir, todo dan perubahan file.
- Kartu informasi yang bisa dilipat; aktivitas yang berakhir bertahan 4 detik.
- Avatar platinum comma hair, hoodie, workstation dengan kursi gaming, mengetik, merokok, dan animasi kompres kertas.
- Pose mengetik minimal 5 detik dan kompres minimal 7,2 detik; label status tetap mengikuti aktivitas sebenarnya.
- Dock dengan avatar mini ketika sidebar tidak tersedia; detail melalui `/studio-panel`.
- Notifikasi desktop melalui `node-notifier` dan suara melalui attention API OpenCode.

## Persyaratan dan pemasangan

Diuji dengan OpenCode 1.18.34, Bun 1.4.2 dan macOS. Backend notifikasi mendukung Windows/Linux, tetapi belum diuji langsung di kedua OS tersebut. Linux memerlukan `notify-send` dan layanan notifikasi desktop. macOS perlu izin notifikasi untuk pengirim notifikasi; Focus/Do Not Disturb dapat menahan banner.

1. Clone repository ini ke direktori pilihanmu.
2. Jalankan `bun install --frozen-lockfile` lalu `bun run build` di direktori plugin.
3. Salin `saffteen-studio.json` ke `~/.config/opencode/themes/`.
4. Gabungkan `tui.example.json` ke `~/.config/opencode/tui.json`. Ganti **semua** `/ABSOLUTE/PATH/TO/PLUGIN` dengan path absolut clone. Jangan menimpa pengaturan lain yang sudah ada.
5. Tutup lalu buka kembali OpenCode. Plugin TUI didaftarkan di `tui.json`, bukan konfigurasi server `opencode.json`.

## Routing skill pada setiap request

Untuk mengaktifkan router, tambahkan path direktori plugin ini ke array `plugin` di `~/.config/opencode/opencode.json` juga. Entry server terpisah dari TUI. Pasang empat skill global: `premium-fullstack-build`, `emil-design-eng`, `design-taste-frontend`, dan `redesign-existing-projects`, di `~/.agents/skills/` atau `~/.config/opencode/skills/`.

`src/skill-router.ts` menyisipkan pengingat ringkas setiap request. Untuk scope UI, isi asli empat `SKILL.md` dibaca dan disisipkan secara sementara ke system prompt; tidak ditulis sebagai pesan riwayat. Karena itu kompresi riwayat tidak menghilangkan paket ini dan tidak membuat salinan permanen baru. Paket tetap memakai token input pada request aktif. File yang berubah dibaca kembali, bukan dianggap pernah dimuat selamanya.

Scope awal berasal dari pesan pengguna. Tool AI `studio_skill_route` menerima `ui`, `general`, atau `status` untuk koreksi/diagnostik. Edit pada ekstensi frontend atau direktori komponen yang dikenali ditunda bila paket belum ada pada request terakhir; request berikutnya memasukkannya otomatis. Shell saat scope UI aktif juga melewati pemeriksaan paket. Setelah restart, router membaca maksimal 20 pesan terakhir untuk memulihkan intent; pemeriksaan path tetap menjadi fallback.

Router adalah bantuan kepatuhan, bukan sandbox atau bukti bahwa model memahami instruksi. Klasifikasi bahasa dan path bersifat heuristik; shell pada scope non-UI, tool MCP dengan nama/argumen yang tidak dikenali, serta frontend dalam file generik dapat lolos deteksi. Skill non-UI dan referensi lanjutan tetap mengikuti aturan proyek. Paket dibatasi 160K karakter dan gagal secara eksplisit jika skill wajib hilang/kosong. Untuk rollback, hapus entry server plugin dari `opencode.json`, lalu restart; entry TUI dapat tetap aktif.

## Perintah

### Pengingat salat

Aktif secara default untuk Bandung (-6.9175, 107.6191), zona `Asia/Jakarta`. Jadwal dihitung offline dengan Adhan metode Singapore (Subuh 20°, Isya 18°, Asar Shafi). Ini hasil perhitungan, **bukan jadwal resmi Kemenag**; cocokkan dengan masjid setempat. Lima pengingat harian mengirim toast dan notifikasi desktop melalui `node-notifier` saat OpenCode terbuka. Izin OS dan Focus/DND tetap berlaku; tidak ada layanan pengingat saat OpenCode ditutup.

Avatar menampilkan ilustrasi singkat berdiri, takbir pembuka, bersedekap pada setiap rakaat, rukuk, iktidal, dua sujud dengan duduk di antaranya, tahiyat, lalu salam kanan dan kiri. Subuh 2, Zuhur 4, Asar 4, Magrib 3, Isya 4 rakaat. Tahiyat awal hanya pada rakaat kedua salat 3/4 rakaat; tahiyat akhir hanya pada rakaat terakhir. Ini pengingat visual, bukan panduan durasi salat atau indikator bahwa pengguna sudah salat; jadwal Jumat tetap ditampilkan sebagai Zuhur. `/studio-motion` membekukan gambar tanpa mematikan notifikasi. Permintaan jawaban AI tetap diprioritaskan.

- `/studio-prayer`: jadwal hari ini.
- `/studio-prayer-test-fajr`, `-dhuhr`, `-asr`, `-maghrib`, `-isha`: tes notifikasi desktop dan ilustrasi sesuai salat (awalan lengkap `studio-prayer-test-`).
- `/studio-prayer-dismiss`: tutup ilustrasi.
- `/studio-prayer-stop`: hentikan azan yang sedang diputar.
- `/studio-prayer-sound`: aktif/nonaktif suara azan; pilihan tersimpan, pengingat visual tetap aktif.

Pengingat dan tes salat memutar `assets/Adzan.mp3` melalui pemutar terpisah. Memulai salat lain menghentikan pemutaran sebelumnya; menutup plugin menghentikan audio. Menutup ilustrasi saja tidak menghentikan audio. Pada macOS notifikasi menyediakan aksi **Hentikan azan**; klik isi notifikasi juga diproses bila backend OS melaporkannya. Dukungan klik/aksi berbeda antar-OS, sehingga perintah stop di atas selalu menjadi kontrol cadangan. Tombol desktop belum diuji lewat klik langsung; API pemutaran dan stop sudah diuji di macOS. Volume pemutar 80%, tanpa mengubah volume sistem. Berkas MP3 adalah salinan pilihan pengguna, bukan audio berlisensi redistribusi dari proyek ini.

Domisili dapat diatur melalui opsi entry plugin **TUI** di `tui.json`:

```json
"plugin": [["/ABSOLUTE/PATH/TO/PLUGIN", {
  "prayer": {
    "enabled": true,
    "city": "Bandung",
    "latitude": -6.9175,
    "longitude": 107.6191,
    "timezone": "Asia/Jakarta"
  }
}]]
```

Ubah nama, koordinat, dan zona bersama-sama jika pindah kota. `enabled: false` menonaktifkan pengingat otomatis. Waktu yang lewat lebih dari satu menit tidak diputar ulang setelah laptop tidur; penanda notifikasi tersimpan untuk mencegah pengulangan saat restart. Beberapa proses OpenCode yang berjalan bersamaan masih dapat mengirim notifikasi ganda karena penyimpanan KV bukan kunci lintas proses.

| Perintah | Fungsi |
| --- | --- |
| `/studio-panel` | Detail sidebar saat mode kecil |
| `/studio-motion` | Aktif/nonaktif animasi |
| `/studio-context` | Lipat konteks sesi |
| `/studio-progress` | Lipat progres tugas |
| `/studio-connections` | Lipat koneksi MCP |
| `/studio-files` | Lipat perubahan file |
| `/studio-result` | Lipat hasil terakhir |
| `/studio-desktop-test` | Kirim notifikasi desktop percobaan |
| `/studio-popup-test` | Toast di dalam terminal |
| `/studio-sound-test` | Uji pemutar suara |

## Pengembangan

```sh
bun run typecheck
bun run lint
bun run test
bun run build
```

`src/model.ts` berisi model aktivitas dan sprite, `src/tui.tsx` integrasi OpenCode serta komponen, `src/tui.test.tsx` pengujian. `dist/tui.js` disertakan agar hasil build tersimpan bersama source; dependency tetap harus dipasang.

## Batasan

Avatar menggunakan grid 28×28 (mini 14×14), bukan render 3D. Detail mini lebih terbatas. Data aktivitas bergantung pada event yang disediakan host; kompres yang tidak mengirim event tidak bisa dideteksi. Status tool selesai bukan bukti seluruh test aplikasi lulus. Font terminal diatur oleh aplikasi terminal.

`assets/notification.mp3` adalah salinan audio pilihan pengguna untuk instalasi personal. Repository ini tidak memberikan lisensi redistribusi atas audio pihak ketiga tersebut. Konfigurasi contoh hanya berisi pengaturan plugin, bukan kredensial atau konfigurasi provider personal.
