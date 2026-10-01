import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import type { TuiPluginApi, TuiCommand } from "@opencode-ai/plugin/tui"
import { bandung, duePrayer, prayerConfig, prayerDate, prayerFrame, prayerSchedule, prayerSequence, prayers } from "./prayer"
import { createPrayerReminder } from "./prayer-reminder"

describe("prayer reminders", () => {
  test("Bandung date follows WIB rather than host timezone; five ordered daily times", () => {
    expect(prayerDate(Date.parse("2026-10-01T18:00:00Z"), bandung.timezone)).toBe("2026-10-02")
    const schedule = prayerSchedule("2026-10-02")
    expect(schedule.map((p) => p.rakaat)).toEqual([2, 4, 4, 3, 4])
    expect(schedule.every((p) => Number.isFinite(p.at) && prayerDate(p.at, bandung.timezone) === "2026-10-02")).toBe(true)
    expect(schedule.map((p) => p.at)).toEqual(schedule.map((p) => p.at).sort((a, b) => a - b))
  })
  test("one-minute reminder window avoids replay after sleep and honors persisted dedupe", () => {
    const schedule = prayerSchedule("2026-10-02")
    const at = schedule[0].at
    expect(duePrayer(schedule, at - 1, () => false)).toBeUndefined()
    expect(duePrayer(schedule, at, () => false)?.name).toBe("Subuh")
    expect(duePrayer(schedule, at + 59999, () => false)?.name).toBe("Subuh")
    expect(duePrayer(schedule, at + 60000, () => false)).toBeUndefined()
    expect(duePrayer(schedule, at, () => true)).toBeUndefined()
  })
  test("each rakaat has two prostrations with sitting between, ends with salam", () => {
    for (const prayer of prayers) {
      const sequence = prayerSequence(prayer.rakaat)
      expect(sequence.filter((s) => s.pose === "fold")).toHaveLength(prayer.rakaat)
      expect(sequence.filter((s) => s.pose === "takbir")).toHaveLength(1)
      expect(sequence.filter((s) => s.pose === "prostrate")).toHaveLength(prayer.rakaat * 2)
      expect(sequence.slice(-2)).toEqual([{ pose: "salam-right", rakaat: prayer.rakaat }, { pose: "salam-left", rakaat: prayer.rakaat }])
      expect(sequence.filter((s) => s.pose === "tahiyat-early")).toEqual(prayer.rakaat > 2 ? [{ pose: "tahiyat-early", rakaat: 2 }] : [])
      expect(sequence.filter((s) => s.pose === "tahiyat-final")).toEqual([{ pose: "tahiyat-final", rakaat: prayer.rakaat }])
      for (let r = 1; r <= prayer.rakaat; r++) expect(sequence.filter((s) => s.rakaat === r && s.pose !== "stand" && s.pose !== "takbir").slice(0, 6).map((s) => s.pose)).toEqual(["fold", "bow", "rise", "prostrate", "sit", "prostrate"])
    }
    const frames = ["takbir", "fold", "bow", "prostrate", "tahiyat-early", "tahiyat-final", "salam-right", "salam-left"].map((pose) => prayerFrame(pose as Parameters<typeof prayerFrame>[0]))
    expect(frames.every((f) => f.length === 28 && f.every((r) => r.length === 28))).toBe(true)
    expect(new Set(frames.map((frame) => JSON.stringify(frame))).size).toBe(8)
  })
  test("invalid domicile rejected and disabled setting retained", () => {
    expect(() => prayerConfig({ latitude: 100 })).toThrow()
    expect(() => prayerConfig({ timezone: "invalid" })).toThrow()
    expect(prayerConfig({ enabled: false }).enabled).toBe(false)
  })
  test("preview sends desktop notification and cleanup unregisters commands", async () => {
    let commands: TuiCommand[] = []
    let cleanup = () => {}
    let unregistered = false
    const notices: string[] = []
    const api = {
      kv: { get: (_key: string, fallback: unknown) => fallback, set: () => {} },
      ui: { toast: () => {} },
      command: { register: (factory: () => TuiCommand[]) => { commands = factory(); return () => { unregistered = true } } },
      lifecycle: { onDispose: (fn: () => void) => { cleanup = fn } },
    } as unknown as TuiPluginApi
    let playing = false
    let stopFromNotification: (() => void) | undefined
    const instance = createRoot((dispose) => ({ dispose, reminder: createPrayerReminder(api, { enabled: false }, async (input) => { notices.push(input.message); stopFromNotification = input.onStop }, { play: async () => { playing = true }, stop: () => { playing = false }, dispose: () => { playing = false } }) }))
    await commands.find((c) => c.value === "studio.prayer.test.maghrib")!.onSelect?.()
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain("Magrib 3 rakaat")
    expect(notices[0]).toContain("hanya tes")
    expect(instance.reminder.view()?.prayer.rakaat).toBe(3)
    expect(playing).toBe(true)
    stopFromNotification?.()
    expect(playing).toBe(false)
    await commands.find((c) => c.value === "studio.prayer.test.fajr")!.onSelect?.()
    await commands.find((c) => c.value === "studio.prayer.stop")!.onSelect?.()
    expect(playing).toBe(false)
    await commands.find((c) => c.value === "studio.prayer.sound")!.onSelect?.()
    await commands.find((c) => c.value === "studio.prayer.test.fajr")!.onSelect?.()
    expect(playing).toBe(false)
    cleanup(); instance.dispose()
    expect(unregistered).toBe(true)
    expect(instance.reminder.view()).toBeUndefined()
  })
})
