import { Audio } from "@opentui/core"
import { fileURLToPath } from "node:url"

export function createPrayerAudio(factory = () => Audio.create({ autoStart: false })) {
  let engine: Audio | undefined
  let generation = 0
  let disposed = false
  const stop = () => {
    generation++
    engine?.dispose()
    engine = undefined
  }
  return {
    stop,
    async play() {
      stop()
      if (disposed) return
      const token = generation
      const current = factory()
      engine = current
      try {
        const sound = await current.loadSoundFile(fileURLToPath(new URL("../assets/Adzan.mp3", import.meta.url)))
        if (disposed || token !== generation) return
        if (!sound || !current.start() || !current.play(sound, { volume: 0.8 })) throw new Error("Pemutar azan tidak tersedia")
      } catch (error) {
        if (token !== generation) return
        stop()
        throw error
      }
    },
    dispose() { disposed = true; stop() },
  }
}

export async function prayerDesktopNotification(input: { title: string; message: string; onStop?: () => void }) {
  const { default: notifier } = await import("node-notifier")
  await new Promise<void>((resolve, reject) => {
    notifier.notify({ title: input.title, message: `${input.message} Klik notifikasi untuk hentikan azan; atau /studio-prayer-stop.`, sound: false, timeout: 240,
      ...(process.platform === "darwin" ? { actions: ["Hentikan azan"], closeLabel: "Tutup" } : {}),
    }, (error, response, metadata) => {
      const action = String(metadata?.activationValue ?? response ?? "").toLowerCase()
      if (action === "hentikan azan" || action === "activate" || action === "contentsclicked" || action === "clicked") input.onStop?.()
      if (error) reject(error)
      else resolve()
    })
  })
}
