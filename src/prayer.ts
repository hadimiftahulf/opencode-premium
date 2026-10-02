import { CalculationMethod, Coordinates, PrayerTimes } from "adhan"
import { avatarFrame, avatarPalette } from "./model"

export const prayers = [
  { key: "fajr", name: "Subuh", rakaat: 2 },
  { key: "dhuhr", name: "Zuhur", rakaat: 4 },
  { key: "asr", name: "Asar", rakaat: 4 },
  { key: "maghrib", name: "Magrib", rakaat: 3 },
  { key: "isha", name: "Isya", rakaat: 4 },
] as const
export type Prayer = typeof prayers[number]
export const bandung = { city: "Bandung", latitude: -6.9175, longitude: 107.6191, timezone: "Asia/Jakarta", enabled: true }
export function prayerConfig(value: unknown) {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const config = { ...bandung, ...raw } as typeof bandung
  if (typeof config.enabled !== "boolean" || typeof config.city !== "string" || !config.city.trim() || config.city.length > 80
    || !Number.isFinite(config.latitude) || Math.abs(config.latitude) > 90
    || !Number.isFinite(config.longitude) || Math.abs(config.longitude) > 180 || typeof config.timezone !== "string") throw new Error("Konfigurasi domisili salat tidak valid")
  new Intl.DateTimeFormat("en", { timeZone: config.timezone }).format()
  return config
}
export function prayerDate(now: number, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}
export function prayerSchedule(date: string, config = bandung) {
  const [year, month, day] = date.split("-").map(Number)
  const times = new PrayerTimes(new Coordinates(config.latitude, config.longitude), new Date(year, month - 1, day), CalculationMethod.Singapore())
  return prayers.map((prayer) => ({ ...prayer, at: times[prayer.key].getTime(), date }))
}
export type PrayerTime = ReturnType<typeof prayerSchedule>[number]
export function duePrayer(schedule: PrayerTime[], now: number, seen: (key: string) => boolean) {
  return schedule.find((item) => Number.isFinite(item.at) && now >= item.at && now - item.at < 60000 && !seen(`${item.date}:${item.key}`))
}
export function prayerSequence(rakaat: number) {
  if (![2, 3, 4].includes(rakaat)) throw new Error("Jumlah rakaat harus 2, 3, atau 4")
  const result: { pose: "stand" | "takbir" | "fold" | "bow" | "rise" | "prostrate" | "sit" | "tahiyat-early" | "tahiyat-final" | "salam-right" | "salam-left"; rakaat: number }[] = [{ pose: "stand", rakaat: 1 }, { pose: "takbir", rakaat: 1 }]
  for (let index = 1; index <= rakaat; index++) {
    for (const pose of ["fold", "bow", "rise", "prostrate", "sit", "prostrate"] as const) result.push({ pose, rakaat: index })
    if (index === rakaat) result.push({ pose: "tahiyat-final", rakaat: index })
    else if (index === 2) result.push({ pose: "tahiyat-early", rakaat: index })
  }
  result.push({ pose: "salam-right", rakaat }, { pose: "salam-left", rakaat })
  return result
}
export const prayerStepMs = 1600
export function prayerFrame(pose: ReturnType<typeof prayerSequence>[number]["pose"] | "dua", frame = 0) {
  const pixels: (string | undefined)[][] = Array.from({ length: 28 }, () => Array(28).fill(undefined))
  const p = (x: number, y: number, w: number, h: number, color: keyof typeof avatarPalette) => {
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) if (row >= 0 && row < 28 && col >= 0 && col < 28) pixels[row][col] = avatarPalette[color]
  }
  const backdrop = (x: number, y: number, w: number, h: number, color: string) => {
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) if (pixels[row] && col >= 0 && col < 28) pixels[row][col] = color
  }
  backdrop(0, 0, 28, 28, "#172425")
  backdrop(1, 0, 2, 24, "#293d3d"); backdrop(25, 0, 2, 24, "#293d3d")
  // Quiet mihrab arch, side lamps and tiled floor behind the foreground rug.
  for (const [x, y, w] of [[10, 0, 8], [7, 1, 14], [5, 2, 18]] as const) backdrop(x, y, w, 1, "#405450")
  backdrop(5, 3, 1, 20, "#354c48"); backdrop(22, 3, 1, 20, "#354c48")
  backdrop(2, 5, 2, 1, "#8b8965"); backdrop(24, 5, 2, 1, "#8b8965")
  backdrop(2, 6, 2, 3, "#575c46"); backdrop(24, 6, 2, 3, "#575c46")
  backdrop(0, 23, 28, 5, "#243536"); backdrop(0, 24, 28, 1, "#304343")
  backdrop(2, 25, 24, 3, "#426760"); backdrop(3, 25, 22, 1, "#8bb9a6")
  backdrop(3, 27, 22, 1, "#688e7f")
  const original = avatarFrame("wait", 0)
  const head = (x: number, y: number, size = 10, turn: "front" | "left" | "down" = "front") => {
    for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
      const sx = Math.floor(col * 12 / size), sy = Math.floor(row * 12 / size)
      const color = turn === "down" ? original[12 - sx]?.[8 + sy] : original[1 + sy]?.[8 + (turn === "left" ? 11 - sx : sx)]
      if (color && pixels[y + row] && x + col >= 0 && x + col < 28) pixels[y + row][x + col] = color
    }
  }
  const arm = (points: [number, number][], light = false) => {
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1], [bx, by] = points[i]
      const count = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1)
      for (let step = 0; step <= count; step++) {
        const x = Math.round(ax + (bx - ax) * step / count), y = Math.round(ay + (by - ay) * step / count)
        p(x - 1, y - 1, 3, 3, "shirtShade"); p(x - 1, y - 1, 2, 2, light ? "shirtLight" : "shirt")
      }
    }
    const [x, y] = points[points.length - 1]
    p(x - 1, y, 3, 2, "skin"); p(x - 1, y, 2, 1, "skinLight")
  }
  if (pose === "prostrate") {
    p(5, 20, 4, 5, "chair"); p(3, 24, 3, 1, "skinShade")
    p(7, 17, 4, 7, "chairEdge"); p(8, 15, 7, 6, "shirt")
    p(9, 14, 5, 2, "shirtLight"); p(13, 16, 5, 4, "shirt")
    p(14, 16, 3, 2, "shirtShade")
    head(17, 17, 9, "down")
    arm([[15, 18], [14, 21], [18, 23]], true)
  } else if (["sit", "tahiyat-early", "tahiyat-final", "salam-right", "salam-left", "dua"].includes(pose)) {
    p(9, 22, 11, 3, "chair"); p(11, 22, 9, 1, "chairEdge")
    p(9, 15, 9, 7, "shirt"); p(9, 16, 2, 5, "shirtLight")
    p(16, 16, 2, 6, "shirtShade"); p(9, 15, 9, 2, "shirtLight")
    p(11, 16, 5, 1, "shirtShade"); p(11, 18, 1, 2, "accent"); p(15, 18, 1, 2, "accent")
    head(8, 5, 10, pose === "salam-left" ? "left" : "front")
    if (pose !== "dua") {
      arm([[10, 18], [10, 21], [13, 22]], true); arm([[17, 18], [18, 20], [19, 22]])
      if (pose !== "sit") p(20, 21, 1, 1, "skinLight")
    }
    if (["tahiyat-final", "salam-right", "salam-left"].includes(pose)) { p(7, 23, 8, 2, "chairEdge"); p(20, 23, 2, 2, "skinShade") }
    if (pose === "salam-right") p(17, 12, 1, 2, "skinLight")
    if (pose === "dua") {
      const lift = Math.floor(frame / 4) % 2
      arm([[10, 18], [7, 20], [9, 16 - lift]], true)
      arm([[17, 18], [20, 20], [18, 16 - lift]])
      p(8, 15 - lift, 3, 2, "skinLight"); p(17, 15 - lift, 3, 2, "skinLight")
    }
  } else if (pose === "bow") {
    p(7, 16, 3, 9, "chair"); p(12, 16, 3, 9, "chairEdge")
    p(7, 24, 4, 1, "skinShade"); p(12, 24, 4, 1, "skin")
    p(7, 11, 12, 6, "shirt"); p(8, 11, 10, 1, "shirtLight")
    p(8, 16, 10, 1, "shirtShade"); p(16, 12, 3, 2, "shirtShade")
    head(18, 10, 9, "down")
    arm([[17, 15], [16, 18], [13, 19]], true)
  } else {
    p(9, 18, 3, 7, "chair"); p(15, 18, 3, 7, "chairEdge")
    p(9, 24, 4, 1, "skinShade"); p(15, 24, 4, 1, "skin")
    p(8, 12, 11, 7, "shirt"); p(8, 13, 2, 5, "shirtLight"); p(18, 13, 1, 6, "shirtShade")
    p(8, 12, 11, 2, "shirtLight"); p(11, 13, 5, 1, "shirtShade")
    p(11, 14, 1, 3, "accent"); p(16, 14, 1, 3, "accent"); p(11, 18, 5, 1, "shirtShade")
    head(8, 2)
    if (pose === "takbir") {
      arm([[9, 14], [5, 13], [5, 7]], true); arm([[18, 14], [22, 13], [22, 7]])
    } else if (pose === "fold") {
      arm([[9, 14], [9, 17], [15, 16]], true); arm([[18, 14], [18, 17], [12, 16]])
    } else {
      arm([[9, 15], [7, 18], [7, 20]], true); arm([[18, 15], [20, 18], [20, 20]])
    }
  }
  return pixels
}
