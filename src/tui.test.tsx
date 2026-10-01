import { describe, expect, test } from "bun:test"
import type { TuiCommand, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { activityDetail, avatarFrame, avatarPalette, avatarState, compact, recentTools, sessionMetrics, sidebarActivity, type AvatarPose } from "./model"
import { ResponsiveDock, SidebarPresence, visualFeedback, attentionFeedback, compactionMonitor, waitingReason, ObservedWait, Companion, holdKeyboardPose, InfoCard, Overview, retainActivity, Welcome } from "./tui"
import { createRoot, createSignal } from "solid-js"
import type { Event, ToolPart, SessionStatus } from "@opencode-ai/sdk/v2"
import { createPrayerReminder, prayerReminders } from "./prayer-reminder"

const api = {
  theme: { current: { primary: RGBA.fromHex("#9cdec5"), text: RGBA.fromHex("#e5efec"), textMuted: RGBA.fromHex("#a2b5b0") } },
  state: { session: { messages: () => [] }, provider: [], part: () => [] },
} as unknown as TuiPluginApi

describe("session data", () => {
  test("prayer appears on normal and mini companion while attention keeps priority", async () => {
    const { fixture } = activityFixture()
    let commands: TuiCommand[] = []
    let cleanup = () => {}
    Object.assign(fixture, {
      command: { register: (factory: () => TuiCommand[]) => { commands = factory(); return () => {} } },
      lifecycle: { onDispose: (fn: () => void) => { cleanup = fn } },
      ui: { toast: () => {} },
    })
    const root = createRoot((dispose) => ({ dispose, reminder: createPrayerReminder(fixture, { enabled: false }, async () => {}, { play: async () => {}, stop: () => {}, dispose: () => {} }) }))
    prayerReminders.set(fixture, root.reminder)
    await commands.find((command) => command.value === "studio.prayer.test.fajr")!.onSelect?.()
    try {
      for (const mini of [false, true]) {
        const [attention, setAttention] = createSignal(0)
        const view = await testRender(() => <Companion api={fixture} activity={{ ...sidebarActivity(fixture, "parent"), attention: attention() }} mini={mini} motion={false} />, { width: 65, height: 25 })
        try {
          await view.renderOnce()
          expect(view.captureCharFrame()).toContain("Subuh · rakaat 1/2")
          expect(view.captureCharFrame()).toContain("▀")
          setAttention(1)
          await view.renderOnce()
          expect(view.captureCharFrame()).toContain("Menunggu jawaban")
          expect(view.captureCharFrame()).not.toContain("rakaat 1/2")
        } finally { view.renderer.destroy() }
      }
    } finally { cleanup(); root.dispose(); prayerReminders.delete(fixture) }
  })
  test("formats tokens without inventing missing values", () => {
    expect(compact(1200)).toBe("1.2K")
    expect(compact(0)).toBe("0")
    expect(compact(NaN)).toBe("—")
    expect(compact(-1)).toBe("—")
  })
  test("keeps last reported usage when the streaming message starts at zero", () => {
    const { fixture } = activityFixture()
    const message = (id: string, input: number) => ({ id, role: "assistant" as const, sessionID: "parent", parentID: "user", time: { created: 1 }, mode: "build", path: { cwd: "/workspace", root: "/workspace" }, modelID: "model", providerID: "provider", agent: "build", cost: 0, tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })
    fixture.state.session.messages = () => [message("reported", 1200), message("streaming", 0)] as ReturnType<TuiPluginApi["state"]["session"]["messages"]>
    expect(sessionMetrics(fixture, "parent").used).toBe(1200)
    fixture.state.session.messages = () => [message("unreported", 0)] as ReturnType<TuiPluginApi["state"]["session"]["messages"]>
    expect(sessionMetrics(fixture, "parent").used).toBeUndefined()
  })
  test("empty session has no fabricated model or usage", () => {
    expect(sessionMetrics(api, "empty")).toMatchObject({ model: "Menunggu respons", used: undefined, percent: undefined, cost: 0 })
    expect(recentTools(api, "empty")).toEqual([])
  })
  test("provider usage above model limit is not presented as DCP context fullness", async () => {
    const { fixture } = activityFixture()
    fixture.kv.set("studio.card.context", true)
    fixture.state.session.messages = () => [{ id: "usage", role: "assistant", sessionID: "parent", parentID: "user", time: { created: 1 }, mode: "build", path: { cwd: "/workspace", root: "/workspace" }, modelID: "Unlimited", providerID: "9router", agent: "build", cost: 0, tokens: { input: 740000, output: 9200, reasoning: 0, cache: { read: 0, write: 0 } } }] as ReturnType<TuiPluginApi["state"]["session"]["messages"]>
    Object.defineProperty(fixture.state, "provider", { value: [{ id: "9router", models: { Unlimited: { limit: { context: 131072 } } } }] })
    const view = await testRender(() => <Overview api={fixture} id="parent" motion={false} />, { width: 70, height: 80 })
    try {
      await view.renderOnce()
      const text = view.captureCharFrame()
      expect(text).not.toContain("% terpakai")
      expect(text).not.toContain("Konteks mendekati batas")
      expect(text).toContain("Konteks aktif DCP · belum diukur")
      expect(text).toContain("749.2K")
    } finally { view.renderer.destroy() }
  })
})

function activityFixture() {
  const [parts, setParts] = createSignal<ToolPart[]>([])
  const [status, setStatus] = createSignal<SessionStatus>({ type: "idle" })
  const saved = new Map<string, unknown>()
  const fixture = {
    ...api,
    kv: { get: (key: string, fallback: unknown) => saved.get(key) ?? fallback, set: (key: string, value: unknown) => saved.set(key, value) },
    state: {
      ...api.state,
      path: { directory: "/workspace" },
      mcp: () => [{ name: "local-memory-mcp", status: "connected" }],
      part: parts,
      session: {
        messages: () => [{ id: "message", role: "user" }],
        status: (id: string) => id === "child" ? status() : { type: "idle" },
        permission: () => [],
        question: () => [],
        todo: () => [],
        diff: () => [],
      },
    },
  } as unknown as TuiPluginApi
  const tool = (name: string, state: ToolPart["state"]): ToolPart => ({
    id: name, callID: name, sessionID: "parent", messageID: "message", type: "tool", tool: name, state,
  })
  return { fixture, setParts, setStatus, tool }
}

function eventFixture() {
  const { fixture } = activityFixture()
  const handlers = new Map<string, Set<(event: Event) => void>>()
  const cleanup: (() => void)[] = []
  const sounds: Parameters<TuiPluginApi["attention"]["notify"]>[0][] = []
  const toasts: string[] = []
  let commands: TuiCommand[] = []
  fixture.event = {
    on: (name: string, handler: (event: Event) => void) => {
      const listeners = handlers.get(name) ?? new Set()
      handlers.set(name, listeners)
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
  } as TuiPluginApi["event"]
  fixture.lifecycle = { signal: new AbortController().signal, onDispose: (callback) => { const dispose = () => { void callback() }; cleanup.push(dispose); return () => { const index = cleanup.indexOf(dispose); if (index >= 0) cleanup.splice(index, 1) } } }
  fixture.attention = { notify: async (input) => { sounds.push(input); return { ok: true, sound: true, notification: false } } } as TuiPluginApi["attention"]
  fixture.ui = { ...fixture.ui, toast: (input) => { toasts.push(input.message) } }
  fixture.command = { register: (items: () => TuiCommand[]) => { commands = items(); return () => { commands = [] } } } as TuiPluginApi["command"]
  return {
    fixture, sounds, toasts, handlers, commands: () => commands,
    emit: (event: Event) => handlers.get(event.type)?.forEach((handler) => handler(event)),
    dispose: () => cleanup.forEach((callback) => callback()),
  }
}

describe("compaction and attention", () => {
  test("pending tools do not cut short disposal, but user attention still interrupts", async () => {
    const { fixture, tool } = activityFixture()
    const activity = sidebarActivity(fixture, "parent")
    const [state, setState] = createSignal(avatarState(activity, true))
    let dispose = () => {}
    const pose = createRoot((cleanup) => { dispose = cleanup; return holdKeyboardPose(state, 50, 100) })
    try {
      setState(avatarState({ ...activity, current: tool("read", { status: "pending", input: {}, raw: "" }) }))
      expect(pose()).toBe("compact")
      expect(state().label).toBe("Menunggu tool")
      await Bun.sleep(120)
      expect(pose()).toBe("wait")
      setState(avatarState(activity, true))
      setState(avatarState({ ...activity, attention: 1 }))
      expect(pose()).toBe("wait")
    } finally { dispose() }
  })
  test("compact pose finishes its dwell while real status changes and resets across sessions", async () => {
    const { fixture } = activityFixture()
    const activity = sidebarActivity(fixture, "parent")
    const [state, setState] = createSignal(avatarState(activity, true))
    const [session, setSession] = createSignal("parent")
    let dispose = () => {}
    const pose = createRoot((cleanup) => { dispose = cleanup; return holdKeyboardPose(state, 50, 100, session) })
    setState(avatarState(activity))
    expect(pose()).toBe("compact")
    expect(state().pose).toBe("idle")
    await Bun.sleep(120)
    expect(pose()).toBe("idle")
    setState(avatarState(activity, true))
    setState(avatarState({ ...activity, attention: 1 }))
    expect(pose()).toBe("wait")
    setState(avatarState(activity, true))
    setSession("other")
    setState(avatarState(activity))
    setSession("third")
    expect(pose()).toBe("idle")
    dispose()
  })
  test("desktop failure remains visible and desktop test is registered", async () => {
    const context = eventFixture()
    visualFeedback(context.fixture, async () => { throw new Error("unavailable") })
    context.emit({ id: "question", type: "question.asked", properties: { id: "one", sessionID: "parent", questions: [] } } as Event)
    await Bun.sleep(0)
    expect(context.toasts.some((text) => text.includes("Notifikasi desktop gagal"))).toBe(true)
    expect(context.commands().some((command) => command.slash?.name === "studio-desktop-test")).toBe(true)
    context.dispose()
    expect(context.commands()).toEqual([])
  })
  test("hood is down in every scene and exhaled smoke forms a larger plume", () => {
    for (const pose of ["idle", "write", "read", "run", "connect", "delegate", "delegate-wait", "wait", "error", "compact"] as AvatarPose[]) {
      const top = avatarFrame(pose, 0).slice(0, 7).flat()
      expect(top).toContain(avatarPalette.hair)
      expect(top).not.toContain(avatarPalette.shirt)
      expect(top).not.toContain(avatarPalette.shirtLight)
    }
    for (const [pose, frame] of [["idle", 2], ["write", 22]] as const) {
      expect(avatarFrame(pose, frame).flat().filter((color) => color === avatarPalette.smoke).length).toBeGreaterThan(35)
    }
  })
  test("DCP compress tool activates compaction and completion clears it", () => {
    const context = eventFixture()
    const { tool } = activityFixture()
    const active = compactionMonitor(context.fixture)
    const part = tool("compress", { status: "running", input: {}, time: { start: 1 } })
    context.emit({ type: "message.part.updated", properties: { part } } as Event)
    expect(active("parent")).toBe(true)
    expect(active("other")).toBe(false)
    context.emit({ type: "message.part.updated", properties: { part: { ...part, state: { status: "completed", input: {}, output: "", title: "", metadata: {}, time: { start: 1, end: 2 } } } } } as Event)
    expect(active("parent")).toBe(false)
    context.dispose()
  })
  test("visual alerts work independently of sound and deduplicate requests", () => {
    const context = eventFixture()
    const desktop: { title: string; message: string }[] = []
    visualFeedback(context.fixture, async (input) => { desktop.push(input) })
    const event = { id: "question-event", type: "question.asked", properties: { id: "one", sessionID: "parent", questions: [] } } as Event
    context.emit(event)
    context.emit(event)
    expect(context.toasts).toHaveLength(1)
    expect(context.toasts[0]).toContain("menunggu pilihan")
    expect(context.sounds).toHaveLength(0)
    context.emit({ type: "session.status", properties: { sessionID: "parent", status: { type: "idle" } } } as Event)
    expect(context.toasts).toHaveLength(1)
    context.emit({ type: "session.status", properties: { sessionID: "parent", status: { type: "busy" } } } as Event)
    context.emit({ type: "session.status", properties: { sessionID: "parent", status: { type: "idle" } } } as Event)
    expect(context.toasts).toHaveLength(2)
    expect(desktop).toHaveLength(2)
    expect(desktop[0].title).toContain("Ada pertanyaan")
    context.dispose()
    context.emit({ ...event, properties: { id: "two", sessionID: "parent", questions: [] } } as Event)
    expect(context.toasts).toHaveLength(2)
  })
  test("tracks compaction by session and ignores outdated completion", () => {
    const context = eventFixture()
    const active = compactionMonitor(context.fixture)
    const start = (sessionID: string, messageID: string): Event => ({ id: messageID, type: "session.next.compaction.started", properties: { timestamp: 1, sessionID, messageID, reason: "auto" } })
    context.emit(start("parent", "first"))
    context.emit(start("child", "child-message"))
    context.emit(start("parent", "second"))
    context.emit({ id: "end", type: "session.next.compaction.ended", properties: { timestamp: 2, sessionID: "parent", messageID: "first", reason: "auto", text: "", recent: "" } } as Event)
    expect(active("parent")).toBe(true)
    expect(active("child")).toBe(true)
    context.emit({ type: "session.compacted", properties: { sessionID: "parent" } } as Event)
    expect(active("parent")).toBe(false)
    expect(active("child")).toBe(true)
    context.emit({ type: "session.status", properties: { sessionID: "child", status: { type: "idle" } } } as Event)
    expect(active("child")).toBe(false)
    context.dispose()
    context.emit(start("parent", "third"))
    expect(active("parent")).toBe(false)
    expect([...context.handlers.values()].every((set) => set.size === 0)).toBe(true)
  })
  test("compact animation has bounded moving paper and yields to attention", () => {
    const { fixture } = activityFixture()
    const activity = sidebarActivity(fixture, "parent")
    expect(avatarState(activity, true).pose).toBe("compact")
    expect(avatarState({ ...activity, attention: 1 }, true).pose).toBe("wait")
    const frames = Array.from({ length: 12 }, (_, index) => avatarFrame("compact", index))
    expect(frames.every((frame) => frame.length === 28 && frame.every((row) => row.length === 28))).toBe(true)
    expect(new Set(frames.map((frame) => JSON.stringify(frame))).size).toBeGreaterThan(6)
    for (const frame of frames) {
      expect(frame[24].slice(8, 10).every((pixel) => pixel === undefined)).toBe(true)
      expect(frame[24][6]).toBe(avatarPalette.chairEdge)
      expect(frame[24][12]).toBe(avatarPalette.chair)
      expect(frame[26][5]).toBe(avatarPalette.trimLight)
      expect(frame[26][12]).toBe(avatarPalette.trimLight)
    }
  })
  test("reply sounds deduplicate without duplicating native question notifications", async () => {
    const context = eventFixture()
    attentionFeedback(context.fixture)
    const reply = { type: "permission.replied", properties: { sessionID: "parent", requestID: "one", reply: "once" } } as Event
    context.emit(reply)
    context.emit(reply)
    context.emit({ type: "question.rejected", properties: { sessionID: "parent", requestID: "two" } } as Event)
    await Promise.resolve()
    expect(context.sounds).toHaveLength(2)
    expect(context.sounds[0]).toMatchObject({ notification: false, sound: { name: "default", when: "always" } })
    expect(context.sounds[1]).toMatchObject({ sound: { name: "error" } })
    expect(context.handlers.has("question.asked")).toBe(false)
    expect(context.commands()[0].slash?.name).toBe("studio-sound-test")
    context.dispose()
    expect(context.commands()).toEqual([])
    expect([...context.handlers.values()].every((set) => set.size === 0)).toBe(true)
  })
  test("reports playback failure instead of silently swallowing it", async () => {
    const context = eventFixture()
    context.fixture.attention.notify = async () => ({ ok: false, sound: false, notification: false })
    attentionFeedback(context.fixture)
    context.emit({ id: "reply", type: "question.replied", properties: { sessionID: "parent", requestID: "one", answers: [] } } as Event)
    await Promise.resolve()
    expect(context.toasts[0]).toContain("Suara tidak diputar")
    context.dispose()
  })
  test("waiting reason distinguishes model, compaction, tool, and user input", () => {
    const { fixture, tool } = activityFixture()
    const activity = sidebarActivity(fixture, "parent")
    expect(waitingReason(fixture, "parent", activity)).toBe("")
    expect(waitingReason(fixture, "parent", { ...activity, status: { type: "busy" } })).toBe("Menunggu respons model")
    expect(waitingReason(fixture, "parent", activity, true)).toContain("Meringkas")
    expect(waitingReason(fixture, "parent", { ...activity, current: tool("task", { status: "running", input: {}, time: { start: 1 } }) })).toContain("subagent")
    fixture.state.session.question = () => [{ id: "question", sessionID: "parent", questions: [] }]
    expect(waitingReason(fixture, "parent", activity, true)).toContain("jawaban kamu")
  })
  test("observed wait counter resets on session changes", async () => {
    const [session, setSession] = createSignal("parent")
    const view = await testRender(() => <ObservedWait reason="Menunggu respons model" session={session()} />, { width: 70, height: 5 })
    try {
      await view.renderOnce()
      expect(view.captureCharFrame()).toContain("0 dtk teramati")
      await Bun.sleep(1100)
      await view.renderOnce()
      expect(view.captureCharFrame()).toContain("1 dtk teramati")
      setSession("child")
      await view.renderOnce()
      expect(view.captureCharFrame()).toContain("0 dtk teramati")
    } finally { view.renderer.destroy() }
  })
})

describe("contextual sidebar", () => {
  test("connected but unused MCP stays hidden; calls disappear after completion", () => {
    const { fixture, setParts, tool } = activityFixture()
    expect(sidebarActivity(fixture, "parent").mcp).toEqual([])
    setParts([tool("local-memory-mcp_memory-read", { status: "running", input: {}, time: { start: 1 } })])
    expect(sidebarActivity(fixture, "parent").mcp[0]?.name).toBe("local-memory-mcp")
    expect(sidebarActivity(fixture, "parent").tools).toEqual([])
    setParts([tool("local-memory-mcp_memory-read", { status: "completed", input: {}, output: "", title: "", metadata: {}, time: { start: 1, end: 2 } })])
    expect(sidebarActivity(fixture, "parent").mcp).toEqual([])
  })
  test("background child remains visible after task call returns, then hides on idle", () => {
    const { fixture, setParts, setStatus, tool } = activityFixture()
    setParts([tool("task", { status: "completed", input: { subagent_type: "explore" }, output: "", title: "", metadata: { sessionId: "child", background: true }, time: { start: 1, end: 2 } })])
    setStatus({ type: "busy" })
    expect(sidebarActivity(fixture, "parent").agents).toEqual([{ id: "child", name: "explore", label: "Bekerja", target: "" }])
    setStatus({ type: "idle" })
    expect(sidebarActivity(fixture, "parent").agents).toEqual([])
  })
  test("pending tools are visible and failed tools leave the active list", () => {
    const { fixture, setParts, tool } = activityFixture()
    setParts([tool("bash", { status: "pending", input: {}, raw: "" })])
    expect(sidebarActivity(fixture, "parent").tools).toHaveLength(1)
    setParts([tool("bash", { status: "error", input: {}, error: "failed", time: { start: 1, end: 2 } })])
    expect(sidebarActivity(fixture, "parent").tools).toEqual([])
  })
  test("unknown child state does not fabricate background activity", () => {
    const { fixture, setParts, tool } = activityFixture()
    fixture.state.session.status = () => undefined
    setParts([tool("task", { status: "completed", input: {}, output: "", title: "", metadata: { sessionId: "unknown", background: true }, time: { start: 1, end: 2 } })])
    expect(sidebarActivity(fixture, "parent").agents).toEqual([])
  })
  test("unfinished plan prioritizes current work and hides completed items", () => {
    const { fixture } = activityFixture()
    fixture.state.session.todo = () => [
      { content: "Next", status: "pending", priority: "medium" },
      { content: "Done", status: "completed", priority: "medium" },
      { content: "Current", status: "in_progress", priority: "high" },
    ]
    const result = sidebarActivity(fixture, "parent")
    expect(result.todos.map((todo) => todo.content)).toEqual(["Current", "Next"])
    expect(result.completed).toBe(1)
    expect(result.total).toBe(3)
    fixture.state.session.todo = () => [{ content: "Done", status: "completed", priority: "medium" }]
    expect(sidebarActivity(fixture, "parent").todos).toEqual([])
  })
  test("retrying child is labeled rather than duplicated", () => {
    const { fixture, setParts, setStatus, tool } = activityFixture()
    const part = tool("task", { status: "completed", input: {}, output: "", title: "", metadata: { sessionId: "child" }, time: { start: 1, end: 2 } })
    setParts([part, { ...part, id: "second", callID: "second" }])
    setStatus({ type: "retry", attempt: 1, message: "retry", next: 2 })
    expect(sidebarActivity(fixture, "parent").agents).toEqual([{ id: "child", name: "subagent", label: "Mencoba ulang", target: "" }])
  })
  test("idle sidebar contains no empty activity sections", async () => {
    const { fixture } = activityFixture()
    const view = await testRender(() => <Overview api={fixture} id="parent" />, { width: 38, height: 30 })
    try {
      await view.renderOnce()
      const frame = view.captureCharFrame()
      expect(frame).toContain("Siap")
      for (const title of ["MCP sedang dipakai", "Subagent", "Rencana", "MEMORI", "AKTIVITAS TERKINI"])
        expect(frame).not.toContain(title)
    } finally { view.renderer.destroy() }
  })
  test("MCP section reacts live without remounting", async () => {
    const { fixture, setParts, tool } = activityFixture()
    const view = await testRender(() => <Overview api={fixture} id="parent" />, { width: 38, height: 30 })
    try {
      await view.renderOnce()
      expect(view.captureCharFrame()).not.toContain("MCP sedang dipakai")
      setParts([tool("local-memory-mcp_memory-read", { status: "running", input: {}, time: { start: 1 } })])
      await view.renderOnce()
      expect(view.captureCharFrame()).toContain("MCP sedang dipakai")
      setParts([])
      await view.renderOnce()
      expect(view.captureCharFrame()).toContain("Baru berakhir")
      await Bun.sleep(4100)
      await view.renderOnce()
      expect(view.captureCharFrame()).not.toContain("MCP sedang dipakai")
    } finally { view.renderer.destroy() }
  })
})

describe("companion and retained activity", () => {
  test("latest activity survives completion and is replaced by new work", () => {
    const { fixture, setParts, tool } = activityFixture()
    const done = tool("read", { status: "completed", input: {}, output: "", title: "", metadata: {}, time: { start: 1, end: 2 } })
    setParts([done])
    expect(sidebarActivity(fixture, "parent").latest?.tool).toBe("read")
    expect(avatarState(sidebarActivity(fixture, "parent")).pose).toBe("done")
    setParts([done, tool("edit", { status: "running", input: {}, time: { start: 3 } })])
    expect(sidebarActivity(fixture, "parent").latest?.tool).toBe("edit")
    expect(avatarState(sidebarActivity(fixture, "parent")).pose).toBe("write")
  })
  test("idle smokes without coffee; workstation modes retain a visible keyboard", () => {
    for (const pose of ["idle", "done"] as const) {
      for (const phase of [0, 1, 2, 3]) {
        const pixels = avatarFrame(pose, phase).flat()
        expect(pixels).not.toContain(avatarPalette.coffee)
        expect(pixels.includes(avatarPalette.smoke)).toBe(phase >= 2)
        if (phase >= 2) expect(avatarFrame(pose, phase)[11][15]).toBe(avatarPalette.smoke)
        expect(pixels).not.toContain(avatarPalette.keyboard)
      }
    }
    expect(avatarFrame("write", 0).flat()).toContain(avatarPalette.keyboard)
    expect(avatarFrame("read", 0).flat()).toContain(avatarPalette.lens)
    for (const pose of ["read", "run", "connect", "delegate", "delegate-wait"] as const)
      expect(avatarFrame(pose, 0).flat()).toContain(avatarPalette.keyboard)
    for (const pose of ["wait", "error"] as const)
      expect(avatarFrame(pose, 0).flat()).not.toContain(avatarPalette.keyboard)
    expect(new Set((["read", "write", "run", "connect", "delegate", "wait", "error"] as const).map((pose) => JSON.stringify(avatarFrame(pose, 0)))).size).toBe(7)
  })
  test("workstation preserves idle hair identity and leaves keys exposed during typing", () => {
    const hairColors: string[] = [avatarPalette.hair, avatarPalette.hairLight, avatarPalette.hairEdge]
    const hairPixels = (pose: AvatarPose, dx: number, dy: number) => avatarFrame(pose, 0)
      .flatMap((row, y) => row.flatMap((color, x) => color && hairColors.includes(color) ? [`${x + dx},${y + dy}:${color}`] : []))
    expect(hairPixels("write", 6, -1)).toEqual(hairPixels("idle", 0, 0))
    for (const frame of [0, 1, 2, 3]) {
      const pixels = avatarFrame("write", frame)
      expect(pixels[21].filter((color) => color === avatarPalette.keys).length).toBeGreaterThanOrEqual(5)
      expect(pixels.slice(18, 21).flat()).toContain(avatarPalette.skinLight)
      expect(pixels.slice(18, 21).flat()).toContain(avatarPalette.skin)
    }
    expect(avatarFrame("write", 0).slice(18, 21)).not.toEqual(avatarFrame("write", 1).slice(18, 21))
  })
  test("parent waits for delegated exploration without pretending to explore itself", () => {
    const { fixture, setParts, setStatus, tool } = activityFixture()
    setParts([tool("task", { status: "running", input: { subagent_type: "explore" }, time: { start: 1 } })])
    expect(avatarState(sidebarActivity(fixture, "parent")).pose).toBe("delegate-wait")
    setParts([tool("task", { status: "completed", input: { subagent_type: "explore" }, output: "", title: "", metadata: { sessionId: "child" }, time: { start: 1, end: 2 } })])
    setStatus({ type: "busy" })
    expect(avatarState(sidebarActivity(fixture, "parent")).pose).toBe("delegate-wait")
    setStatus({ type: "idle" })
    expect(avatarState(sidebarActivity(fixture, "parent")).pose).toBe("done")
    expect(sidebarActivity(fixture, "parent").latest?.tool).toBe("task")
  })
  test("working poses alternate with side-facing smoking without changing activity", () => {
    for (const pose of ["read", "write", "run", "connect", "delegate", "delegate-wait"] as const) {
      expect(avatarFrame(pose, 0).flat()).not.toContain(avatarPalette.smoke)
      expect(avatarFrame(pose, 20)[12][9]).toBe(avatarPalette.smoke)
      expect(avatarFrame(pose, 20).slice(3, 10).flat()).toContain(avatarPalette.hairEdge)
      expect(avatarFrame(pose, 16)).not.toEqual(avatarFrame(pose, 0))
    }
  })
  test("keyboard minimum dwell does not delay real status and releases the next pose", async () => {
    const scope = createRoot((dispose) => {
      const [state, setState] = createSignal({ pose: "idle" as AvatarPose, label: "Idle", moving: false })
      const pose = holdKeyboardPose(state, 80)
      return { dispose, state, setState, pose }
    })
    try {
      scope.setState({ pose: "write", label: "Menulis", moving: true })
      scope.setState({ pose: "done", label: "Selesai", moving: false })
      expect(scope.pose()).toBe("write")
      expect(scope.state().label).toBe("Selesai")
      await Bun.sleep(100)
      expect(scope.pose()).toBe("done")
      scope.setState({ pose: "write", label: "Menulis", moving: true })
      scope.setState({ pose: "error", label: "Gagal", moving: false })
      expect(scope.pose()).toBe("error")
    } finally { scope.dispose() }
  })
  test("every pose has fixed geometry and actual motion", () => {
    const poses: AvatarPose[] = ["idle", "read", "write", "run", "connect", "delegate", "wait", "done", "error"]
    for (const pose of poses) {
      const frames = [0, 1, 2, 3].map((frame) => avatarFrame(pose, frame))
      expect(new Set(frames.map((frame) => JSON.stringify(frame))).size).toBeGreaterThan(1)
      for (const frame of frames) {
        expect(frame).toHaveLength(28)
        expect(frame.every((line) => line.length === 28)).toBe(true)
        expect(new Set(frame.flat().filter(Boolean)).size).toBeGreaterThan(10)
      }
    }
  })
  test("retention expires, reactivation cancels expiry and sessions do not leak", async () => {
    const scope = createRoot((dispose) => {
      const [items, setItems] = createSignal(["read"])
      const [session, setSession] = createSignal("one")
      const rows = retainActivity(items, (item) => item, session, 60)
      return { dispose, rows, setItems, setSession }
    })
    try {
      scope.setItems([])
      expect(scope.rows()[0]?.ended).toBeNumber()
      await Bun.sleep(20)
      scope.setItems(["read"])
      await Bun.sleep(80)
      expect(scope.rows()[0]?.ended).toBeUndefined()
      expect(scope.rows()).toHaveLength(1)
      scope.setItems([])
      scope.setSession("two")
      expect(scope.rows()).toEqual([])
      scope.setItems(["edit"])
      scope.setItems([])
      await Bun.sleep(80)
      expect(scope.rows()).toEqual([])
    } finally { scope.dispose() }
  })
  test("idle avatar animates, motion switch freezes it", async () => {
    const { fixture } = activityFixture()
    const [motion, setMotion] = createSignal(true)
    const view = await testRender(() => <Companion api={fixture} activity={sidebarActivity(fixture, "parent")} motion={motion()} />, { width: 38, height: 30 })
    try {
      await view.renderOnce()
      const initial = JSON.stringify(view.captureSpans())
      await Bun.sleep(1850)
      await view.renderOnce()
      expect(JSON.stringify(view.captureSpans())).not.toBe(initial)
      setMotion(false)
      await view.renderOnce()
      const frozen = JSON.stringify(view.captureSpans())
      await Bun.sleep(1000)
      await view.renderOnce()
      expect(JSON.stringify(view.captureSpans())).toBe(frozen)
    } finally { view.renderer.destroy() }
  })
})

describe("collapsible information cards", () => {
  test("mouse toggles details and saves preference without hiding the summary", async () => {
    const { fixture } = activityFixture()
    const view = await testRender(() => <InfoCard api={fixture} name="context" title="Konteks sesi" summary="120 token"><text>Detail provider</text></InfoCard>, { width: 38, height: 12 })
    try {
      await view.renderOnce()
      expect(view.captureCharFrame()).toContain("120 token")
      expect(view.captureCharFrame()).not.toContain("Detail provider")
      await view.mockMouse.click(3, 0)
      await view.renderOnce()
      expect(view.captureCharFrame()).toContain("Detail provider")
      expect(fixture.kv.get<boolean>("studio.card.context")).toBe(true)
      await view.mockMouse.click(3, 0)
      await view.renderOnce()
      expect(view.captureCharFrame()).not.toContain("Detail provider")
      expect(fixture.kv.get<boolean>("studio.card.context")).toBe(false)
    } finally { view.renderer.destroy() }
  })
  test("command palette toggles cards and unregisters on disposal", async () => {
    const { fixture } = activityFixture()
    let commands: (() => TuiCommand[]) | undefined
    let disposed = false
    fixture.command = { register: (callback) => { commands = callback; return () => { disposed = true } }, show() {}, trigger() {} }
    const view = await testRender(() => <InfoCard api={fixture} name="connections" title="Koneksi MCP" summary="1 terhubung"><text>Server detail</text></InfoCard>, { width: 38, height: 12 })
    try {
      await view.renderOnce()
      expect(commands?.()[0]?.slash?.name).toBe("studio-connections")
      await commands?.()[0]?.onSelect?.()
      await view.renderOnce()
      expect(view.captureCharFrame()).toContain("Server detail")
      expect(commands?.()[0]?.title).toContain("tutup")
    } finally { view.renderer.destroy() }
    expect(disposed).toBe(true)
  })
  test("saved open preference survives mounting and shows empty-state guidance", async () => {
    const { fixture } = activityFixture()
    fixture.kv.set("studio.card.files", true)
    const view = await testRender(() => <Overview api={fixture} id="parent" motion={false} />, { width: 38, height: 60 })
    try {
      await view.renderOnce()
      const frame = view.captureCharFrame()
      for (const title of ["Laporan token provider", "Progres tugas", "Koneksi MCP", "Ruang kerja & berkas", "/workspace", "Belum ada perubahan"])
        expect(frame).toContain(title)
      expect(frame).not.toContain("Terhubung bukan berarti")
    } finally { view.renderer.destroy() }
  })
})

describe("activity descriptions and welcome speech", () => {
  test("describes target, completion and background launch without raw output", () => {
    const { tool } = activityFixture()
    const done = tool("read", { status: "completed", input: { filePath: "src/model.ts" }, title: "", metadata: {}, output: "private output", time: { start: 1000, end: 2500 } })
    expect(activityDetail(done)).toEqual({ action: "Membaca berkas", target: "src/model.ts", status: "Selesai", result: "Tool selesai · 1.5 dtk." })
    const launch = tool("task", { ...done.state, status: "completed", input: { description: "Telusuri alur login" }, title: "", metadata: { background: true }, output: "", time: { start: 1, end: 2 } })
    expect(activityDetail(launch).status).toBe("Diluncurkan")
    expect(activityDetail(launch).target).toBe("Telusuri alur login")
    const failed = tool("bash", { status: "error", input: { description: "Jalankan tes", command: "private command" }, error: "private error", time: { start: 1, end: 2 } })
    expect(activityDetail(failed).status).toBe("Gagal")
    expect(JSON.stringify(activityDetail(failed))).not.toContain("private")
    expect(activityDetail(tool("bash", { status: "running", input: { description: "token=example-secret-value" }, time: { start: 1 } })).target).toBe("[disamarkan]")
  })
  for (const width of [40, 140]) test(`fresh welcome has idle avatar and changing speech at ${width} columns`, async () => {
    const { fixture } = activityFixture()
    const [motion, setMotion] = createSignal(true)
    const view = await testRender(() => <Welcome api={fixture} motion={motion()} speechInterval={100} />, { width, height: 40 })
    try {
      await view.renderOnce()
      expect(view.captureCharFrame()).toContain("▀")
      expect(view.captureCharFrame()).toContain("Santai")
      expect(view.captureCharFrame()).toContain("Mau ngerjain apa")
      expect(view.captureCharFrame()).not.toContain("Aktivitas terakhir")
      await Bun.sleep(120)
      await view.renderOnce()
      expect(view.captureCharFrame()).toContain("Ada bug bandel?")
      setMotion(false)
      await view.renderOnce()
      const frozen = view.captureCharFrame()
      await Bun.sleep(120)
      await view.renderOnce()
      expect(view.captureCharFrame()).toBe(frozen)
    } finally { view.renderer.destroy() }
  })
})

describe("responsive Studio", () => {
  for (const width of [40, 60, 80, 120]) test(`dock keeps avatar and input visible at ${width} columns`, async () => {
    const { fixture, setParts, tool } = activityFixture()
    const [visible, setVisible] = createSignal(false)
    const view = await testRender(() => <box>
      <ResponsiveDock api={fixture} id="parent" sidebarVisible={visible()} motion={false} />
      <text>INPUT TETAP TERLIHAT</text>
    </box>, { width, height: 20 })
    try {
      await view.renderOnce()
      expect(view.captureCharFrame()).toContain("▀")
      expect(view.captureCharFrame()).toContain("/studio-panel")
      expect(view.captureCharFrame()).toContain("INPUT TETAP TERLIHAT")
      setParts([tool("read", { status: "running", input: { filePath: "src/index.ts" }, time: { start: 1 } })])
      await view.renderOnce()
      expect(view.captureCharFrame()).toContain("src/index.ts")
      setVisible(true)
      await view.renderOnce()
      expect(view.captureCharFrame()).not.toContain("▀")
      setVisible(false)
      view.resize(40, 20)
      await view.renderOnce()
      expect(view.captureCharFrame()).toContain("▀")
      expect(view.captureCharFrame()).toContain("INPUT TETAP TERLIHAT")
    } finally { view.renderer.destroy() }
  })
  test("dock opens all details by mouse and command and cleans registration", async () => {
    const { fixture } = activityFixture()
    let commands: TuiCommand[] = []
    let render: (() => import("solid-js").JSX.Element) | undefined
    let opened = 0
    fixture.command = { register: (items) => { commands = items(); return () => { commands = [] } }, show() {}, trigger() {} }
    fixture.ui = {
      ...fixture.ui,
      Dialog: (props) => <box>{props.children}</box>,
      dialog: { replace: (next) => { render = next; opened++ }, clear() {}, setSize() {}, size: "medium", depth: 0, open: false },
    }
    const view = await testRender(() => <ResponsiveDock api={fixture} id="parent" sidebarVisible={false} motion={false} />, { width: 60, height: 24 })
    try {
      await view.renderOnce()
      await view.mockMouse.click(18, 6)
      expect(opened).toBe(1)
      await commands[0].onSelect?.()
      expect(opened).toBe(2)
      view.resize(60, 60)
      await view.renderOnce()
      const details = await testRender(() => render?.(), { width: 60, height: 60 })
      try {
        await details.renderOnce()
        expect(details.captureCharFrame()).toContain("Detail sesi")
        expect(details.captureCharFrame()).toContain("Hasil terakhir")
        expect(details.captureCharFrame()).toContain("Koneksi MCP")
      } finally { details.renderer.destroy() }
    } finally { view.renderer.destroy() }
    expect(commands).toEqual([])
  })
  test("sidebar presence follows mounting and disposal", async () => {
    const states: boolean[] = []
    const view = await testRender(() => <SidebarPresence visible={(value) => states.push(value)}><text>Sidebar</text></SidebarPresence>, { width: 40, height: 20 })
    await view.renderOnce()
    expect(states).toEqual([true])
    view.renderer.destroy()
    expect(states).toEqual([true, false])
  })
  test("short welcome still has a mini avatar", async () => {
    const view = await testRender(() => <Welcome api={api} motion={false} />, { width: 40, height: 20 })
    try {
      await view.renderOnce()
      expect(view.captureCharFrame()).toContain("▀")
      expect(view.captureCharFrame()).toContain("Mau ngerjain apa")
    } finally { view.renderer.destroy() }
  })
})

for (const width of [40, 80, 140]) {
  test(`welcome renders at ${width} columns`, async () => {
    const view = await testRender(() => <Welcome api={api} />, { width, height: 20 })
    try {
      await view.renderOnce()
      const frame = view.captureCharFrame()
      expect(frame).toContain(width < 70 ? "S / STUDIO" : "S A F F T E E N")
      expect(frame.includes("Mulai dari satu instruksi.")).toBe(width >= 70)
    } finally {
      view.renderer.destroy()
    }
  })
}
