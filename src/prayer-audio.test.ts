import { expect, test } from "bun:test"
import type { Audio } from "@opentui/core"
import { createPrayerAudio } from "./prayer-audio"

test("stop during loading prevents late playback; disposal is final", async () => {
  let finish = () => {}
  let plays = 0
  let disposed = 0
  const engine = {
    loadSoundFile: () => new Promise((resolve) => { finish = () => resolve({}) }),
    start: () => true,
    play: () => { plays++; return {} },
    dispose: () => { disposed++ },
  } as unknown as Audio
  const player = createPrayerAudio(() => engine)
  const pending = player.play()
  player.stop()
  finish()
  await pending
  expect(plays).toBe(0)
  expect(disposed).toBe(1)
  player.dispose()
  await player.play()
  expect(plays).toBe(0)
})

test("restarting audio disposes previous engine and failures surface", async () => {
  let disposals = 0
  const player = createPrayerAudio(() => ({ loadSoundFile: async () => ({}), start: () => true, play: () => ({}), dispose: () => { disposals++ } }) as unknown as Audio)
  await player.play()
  await player.play()
  expect(disposals).toBe(1)
  player.dispose()
  expect(disposals).toBe(2)
  const failed = createPrayerAudio(() => ({ loadSoundFile: async () => null, dispose: () => {} }) as unknown as Audio)
  await expect(failed.play()).rejects.toThrow("Pemutar azan tidak tersedia")
})
