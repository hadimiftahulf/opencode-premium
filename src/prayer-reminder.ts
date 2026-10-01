import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"
import { duePrayer, prayerConfig, prayerDate, prayerSchedule, prayerSequence, prayerStepMs, prayers, type Prayer } from "./prayer"
import { createPrayerAudio } from "./prayer-audio"

export function createPrayerReminder(api: TuiPluginApi, options: unknown, send: (input: { title: string; message: string; onStop?: () => void }) => Promise<void>, audio = createPrayerAudio()) {
  const config = prayerConfig(options)
  const [active, setActive] = createSignal<{ prayer: Prayer; started: number; demo: boolean }>()
  const [now, setNow] = createSignal(Date.now())
  const [schedule, setSchedule] = createSignal(prayerSchedule(prayerDate(Date.now(), config.timezone), config))
  let disposed = false
  let announcement = 0
  let soundEnabled = api.kv.get<boolean>("studio.prayer.sound", true)
  const format = (at: number) => new Intl.DateTimeFormat("id-ID", { timeZone: config.timezone, hour: "2-digit", minute: "2-digit" }).format(at)
  const announce = async (prayer: Prayer, demo: boolean) => {
    const token = ++announcement
    if (soundEnabled) void audio.play().catch(() => {
      if (!disposed) api.ui.toast({ variant: "warning", message: "Azan gagal diputar; pengingat visual tetap aktif." })
    })
    else audio.stop()
    setActive({ prayer, started: Date.now(), demo })
    const title = demo ? "Studio · Tes pengingat salat" : `Waktu salat ${prayer.name}`
    const message = `${config.city} · ${prayer.name} ${prayer.rakaat} rakaat. ${demo ? "Ini hanya tes, bukan penanda masuk waktu." : "Mari jeda sejenak untuk salat. Jadwal perhitungan lokal."}`
    api.ui.toast({ title, message, variant: "info", duration: 10000 })
    try { await send({ title, message, onStop: () => { if (!disposed && token === announcement) audio.stop() } }) } catch {
      if (!disposed) api.ui.toast({ variant: "warning", message: "Notifikasi salat gagal dikirim ke desktop. Periksa izin notifikasi OS." })
    }
  }
  const tick = () => {
    const time = Date.now()
    setNow(time)
    const date = prayerDate(time, config.timezone)
    if (schedule()[0].date !== date) setSchedule(prayerSchedule(date, config))
    const current = active()
    if (current && time - current.started >= prayerSequence(current.prayer.rakaat).length * prayerStepMs) setActive(undefined)
    if (!config.enabled) return
    const namespace = `studio.prayer.${config.latitude}.${config.longitude}.${config.timezone}`
    const seen = api.kv.get<string[]>(namespace, [])
    const due = duePrayer(schedule(), time, (key) => seen.includes(key))
    if (due) {
      api.kv.set(namespace, [...seen.slice(-9), `${due.date}:${due.key}`])
      void announce(due, false)
    }
  }
  const timer = setInterval(tick, 1000)
  tick()
  const command = api.command?.register(() => [{
    title: "Studio: jadwal salat domisili", value: "studio.prayer.schedule", category: "Studio", slash: { name: "studio-prayer" },
    onSelect: (dialog) => { dialog?.clear(); api.ui.toast({ title: `Salat · ${config.city}`, message: schedule().map((p) => `${p.name} ${format(p.at)}`).join(" · ") + " · Perhitungan lokal; cocokkan jadwal masjid setempat.", variant: "info", duration: 20000 }) },
  }, ...prayers.map((prayer) => ({
    title: `Studio: tes salat ${prayer.name} (${prayer.rakaat} rakaat)`, value: `studio.prayer.test.${prayer.key}`, category: "Studio",
    slash: { name: `studio-prayer-test-${prayer.key}` },
    onSelect: async (dialog?: { clear: () => void }) => { dialog?.clear(); await announce(prayer, true) },
  })), {
    title: "Studio: hentikan suara azan", value: "studio.prayer.stop", category: "Studio", slash: { name: "studio-prayer-stop" },
    onSelect: (dialog) => { dialog?.clear(); audio.stop(); api.ui.toast({ variant: "info", message: "Suara azan dihentikan." }) },
  }, {
    title: "Studio: aktif/nonaktif suara azan", value: "studio.prayer.sound", category: "Studio", slash: { name: "studio-prayer-sound" },
    onSelect: (dialog) => { dialog?.clear(); soundEnabled = !soundEnabled; api.kv.set("studio.prayer.sound", soundEnabled); if (!soundEnabled) audio.stop(); api.ui.toast({ variant: "info", message: soundEnabled ? "Suara azan aktif." : "Suara azan nonaktif; pengingat visual tetap aktif." }) },
  }, {
    title: "Studio: tutup ilustrasi salat", value: "studio.prayer.dismiss", category: "Studio", slash: { name: "studio-prayer-dismiss" },
    onSelect: (dialog) => { dialog?.clear(); setActive(undefined) },
  }])
  api.lifecycle.onDispose(() => { disposed = true; audio.dispose(); clearInterval(timer); command?.(); setActive(undefined) })
  const view = () => {
    const current = active()
    if (!current) return undefined
    const sequence = prayerSequence(current.prayer.rakaat)
    const step = sequence[Math.min(sequence.length - 1, Math.max(0, Math.floor((now() - current.started) / prayerStepMs)))]
    return { ...current, step, label: `${current.demo ? "Tes · " : ""}${current.prayer.name} · rakaat ${step.rakaat}/${current.prayer.rakaat} · ilustrasi` }
  }
  return { view, config }
}
export const prayerReminders = new WeakMap<TuiPluginApi, ReturnType<typeof createPrayerReminder>>()
