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

## Perintah

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
