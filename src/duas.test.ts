import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import type { TuiPluginApi, TuiCommand } from "@opencode-ai/plugin/tui"
import { duas, selectDuas, duaDurationMs } from "./duas"
import { prayerFrame, prayerSequence, prayerStepMs } from "./prayer"
import { createPrayerReminder } from "./prayer-reminder"

test("100 distinct everyday prayers include user examples; select ten without replacement", () => {
  expect(duas).toHaveLength(100)
  expect(new Set(duas).size).toBe(100)
  for (const text of ["Ya Allah Ampuni dosaku", "YaAllah abdi Cape", "Ya Allah, cing di bengharkeun"] as const) expect(duas).toContain(text)
  for (const random of [() => 0, () => 0.5, () => 0.9999999, Math.random]) {
    const selected = selectDuas(random)
    expect(selected).toHaveLength(10)
    expect(new Set(selected).size).toBe(10)
    expect(selected.every((text) => (duas as readonly string[]).includes(text))).toBe(true)
  }
  expect(prayerFrame("dua", 0)).not.toEqual(prayerFrame("dua", 4))
  expect(prayerFrame("dua", 0)).not.toEqual(prayerFrame("tahiyat-final"))
})

test("ten stable selections appear only after both salams, then illustration expires", async () => {
  let time = Date.parse("2026-10-02T06:00:00Z")
  const start = time
  let commands: TuiCommand[] = []
  let cleanup = () => {}
  const api = {
    kv: { get: (_key: string, fallback: unknown) => fallback, set: () => {} },
    ui: { toast: () => {} },
    command: { register: (factory: () => TuiCommand[]) => { commands = factory(); return () => {} } },
    lifecycle: { onDispose: (fn: () => void) => { cleanup = fn } },
  } as unknown as TuiPluginApi
  const root = createRoot((dispose) => ({ dispose, reminder: createPrayerReminder(api, { enabled: false }, async () => {}, { play: async () => {}, stop: () => {}, dispose: () => {} }, () => time) }))
  try {
    await commands.find((c) => c.value === "studio.prayer.test.fajr")!.onSelect?.()
    const selected = root.reminder.view()!.duas
    expect(root.reminder.view()?.dua).toBeUndefined()
    const prayerEnd = start + prayerSequence(2).length * prayerStepMs
    time = prayerEnd - 1
    await Bun.sleep(1050)
    expect(root.reminder.view()?.step.pose).toBe("salam-left")
    expect(root.reminder.view()?.dua).toBeUndefined()
    time = prayerEnd
    await Bun.sleep(1050)
    expect(root.reminder.view()?.step.pose).toBe("dua")
    expect(root.reminder.view()?.dua).toBe(selected[0])
    expect(root.reminder.view()?.label).toContain("Berdoa 1/10")
    time = prayerEnd + 9 * duaDurationMs
    await Bun.sleep(1050)
    expect(root.reminder.view()?.dua).toBe(selected[9])
    expect(root.reminder.view()?.label).toContain("Berdoa 10/10")
    expect(root.reminder.view()?.duas).toEqual(selected)
    time = prayerEnd + 10 * duaDurationMs
    await Bun.sleep(1050)
    expect(root.reminder.view()).toBeUndefined()
  } finally { cleanup(); root.dispose() }
}, 10000)
