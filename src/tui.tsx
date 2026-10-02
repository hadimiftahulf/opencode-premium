import type { TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack, type Accessor, type JSX } from "solid-js"
import { activityDetail, avatarFrame, avatarState, compact, sidebarActivity, sessionMetrics } from "./model"
import { prayerFrame } from "./prayer"
import { createPrayerReminder, prayerReminders } from "./prayer-reminder"
import { prayerDesktopNotification } from "./prayer-audio"
import { duaEmoji } from "./duas"
import { inspectWorkspace } from "./workspace"
import { elapsedLabel, fetchSubagent } from "./subagent"

export function retainActivity<T>(source: Accessor<T[]>, key: (item: T) => string, session: Accessor<string>, delay = 4000) {
  const [rows, setRows] = createSignal<{ item: T; ended?: number }[]>([])
  let scope = session()
  createEffect(() => {
    const id = session()
    const items = source()
    const now = Date.now()
    const previous = id === scope ? untrack(rows) : []
    scope = id
    const keys = new Set(items.map(key))
    setRows([
      ...items.map((item) => ({ item })),
      ...previous.filter((row) => !keys.has(key(row.item)))
        .map((row) => ({ ...row, ended: row.ended ?? now }))
        .filter((row) => now - row.ended < delay),
    ])
  })
  createEffect(() => {
    const deadlines = rows().flatMap((row) => row.ended === undefined ? [] : [row.ended + delay])
    if (!deadlines.length) return
    const timer = setTimeout(() => setRows((previous) => previous.filter((row) => row.ended === undefined || Date.now() < row.ended + delay)), Math.max(0, Math.min(...deadlines) - Date.now()))
    onCleanup(() => clearTimeout(timer))
  })
  return rows
}

export async function desktopNotification(input: { title: string; message: string }) {
  const { default: notifier } = await import("node-notifier")
  await new Promise<void>((resolve, reject) => {
    notifier.notify({ ...input, sound: false, timeout: 10 }, (error) => error ? reject(error) : resolve())
  })
}

export function visualFeedback(api: TuiPluginApi, send = desktopNotification) {
  let disposed = false
  let warned = false
  const desktop = async (title: string, message: string, test = false) => {
    try {
      await send({ title, message })
      if (test && !disposed) api.ui.toast({ variant: "info", message: "Permintaan notifikasi dikirim ke OS. Periksa banner dan izin notifikasi desktop." })
    } catch {
      if (!disposed && (!warned || test)) api.ui.toast({ variant: "warning", message: "Notifikasi desktop gagal dikirim. Periksa izin OS; Linux memerlukan notify-send dan sesi desktop." })
      warned = true
    }
  }
  const seen = new Set<string>()
  const busy = new Set<string>()
  const show = (key: string, title: string, message: string, variant: "info" | "success" | "warning" | "error", duration = 6000) => {
    if (seen.has(key)) return
    seen.add(key)
    if (seen.size > 128) seen.delete(seen.values().next().value!)
    api.ui.toast({ title, message, variant, duration })
    void desktop(title, message)
  }
  const off = [
    api.event.on("permission.asked", ({ properties }) => show(`permission:${properties.sessionID}:${properties.id}`, "Studio · Izin diperlukan", "Tinjau permintaan di dialog izin sesi terkait. Belum ada izin diberikan.", "warning", 10000)),
    api.event.on("question.asked", ({ properties }) => show(`question:${properties.sessionID}:${properties.id}`, "Studio · Ada pertanyaan", "AI menunggu pilihan atau jawaban kamu. Buka dialog pertanyaan sesi terkait.", "info", 10000)),
    api.event.on("permission.replied", ({ properties }) => show(`permission-reply:${properties.sessionID}:${properties.requestID}`, "Studio · Keputusan izin", properties.reply === "reject" ? "Permintaan izin ditolak." : "Izin diberikan sesuai pilihan kamu.", properties.reply === "reject" ? "warning" : "success")),
    api.event.on("question.replied", ({ properties }) => show(`question-reply:${properties.sessionID}:${properties.requestID}`, "Studio · Jawaban diterima", "Pilihan kamu sudah dikirim ke AI.", "success")),
    api.event.on("question.rejected", ({ properties }) => show(`question-reply:${properties.sessionID}:${properties.requestID}`, "Studio · Pertanyaan dibatalkan", "Dialog pertanyaan telah ditutup tanpa jawaban.", "info")),
    api.event.on("session.status", ({ properties }) => {
      if (properties.status.type !== "idle") {
        busy.add(properties.sessionID)
        return
      }
      if (!busy.delete(properties.sessionID)) return
      api.ui.toast({ title: "Studio · Respons siap", message: "AI selesai merespons. Periksa hasil atau saran di percakapan.", variant: "info", duration: 6000 })
      void desktop("Studio · Respons siap", "AI selesai merespons. Periksa hasil atau saran di percakapan.")
    }),
    api.event.on("session.error", ({ properties }) => {
      if (properties.sessionID) busy.delete(properties.sessionID)
      api.ui.toast({ title: "Studio · Ada kendala", message: "Periksa pesan error di percakapan untuk langkah berikutnya.", variant: "error", duration: 10000 })
      void desktop("Studio · Ada kendala", "Periksa pesan error di percakapan untuk langkah berikutnya.")
    }),
  ]
  const command = api.command?.register(() => [{
    title: "Studio: tes popup notifikasi", value: "studio.popup.test", category: "Studio", slash: { name: "studio-popup-test" },
    onSelect: (dialog) => {
      dialog?.clear()
      api.ui.toast({ title: "Studio · Popup aktif", message: "Notifikasi visual tetap terlihat meski suara tidak terdengar.", variant: "info", duration: 10000 })
    },
  }, {
    title: "Studio: tes notifikasi desktop", value: "studio.desktop.test", category: "Studio", slash: { name: "studio-desktop-test" },
    onSelect: async (dialog) => { dialog?.clear(); await desktop("Studio · Tes desktop", "Notifikasi ini dikirim ke desktop, bukan hanya terminal.", true) },
  }])
  api.lifecycle.onDispose(() => { disposed = true; off.forEach((dispose) => dispose()); command?.(); seen.clear(); busy.clear() })
}

export function attentionFeedback(api: TuiPluginApi) {
  const seen = new Set<string>()
  let warned = false
  const play = async (name: "default" | "error" | "permission" | "question", message: string, test = false) => {
    try {
      const result = await api.attention.notify({ message, notification: false, sound: { name, when: "always" } })
      if (test || (!result.sound && !warned)) {
        warned = !result.sound
        api.ui.toast({ variant: result.sound ? "info" : "warning", message: result.sound ? "Pemutar menerima suara. Pastikan terdengar di perangkat keluaran kamu." : `Suara tidak diputar (${result.skipped ?? "periksa pengaturan audio"}).` })
      }
    } catch {
      if (!warned) api.ui.toast({ variant: "warning", message: "Pemutar suara gagal. Periksa pengaturan audio." })
      warned = true
    }
  }
  const reply = (key: string, rejected: boolean, message: string) => {
    if (seen.has(key)) return
    seen.add(key)
    if (seen.size > 128) seen.delete(seen.values().next().value!)
    void play(rejected ? "error" : "default", message)
  }
  const off = [
    api.event.on("permission.replied", (event) => reply(`permission:${event.properties.sessionID}:${event.properties.requestID}`, event.properties.reply === "reject", event.properties.reply === "reject" ? "Izin ditolak" : "Izin diberikan")),
    api.event.on("question.replied", (event) => reply(`question:${event.properties.sessionID}:${event.properties.requestID}`, false, "Jawaban diterima")),
    api.event.on("question.rejected", (event) => reply(`question:${event.properties.sessionID}:${event.properties.requestID}`, true, "Pertanyaan dibatalkan")),
  ]
  const command = api.command?.register(() => [{
    title: "Studio: tes suara perhatian", value: "studio.sound.test", category: "Studio", slash: { name: "studio-sound-test" },
    onSelect: async (dialog) => { dialog?.clear(); await play("question", "Tes suara pertanyaan", true) },
  }])
  api.lifecycle.onDispose(() => { off.forEach((dispose) => dispose()); command?.(); seen.clear() })
}

export function compactionMonitor(api: TuiPluginApi) {
  const [tools, setTools] = createSignal<Record<string, string>>({})
  const [sessions, setSessions] = createSignal<Record<string, string>>({})
  const clearTools = (id: string) => setTools((previous) => Object.fromEntries(Object.entries(previous).filter(([, session]) => session !== id)))
  const clear = (id: string, message?: string) => setSessions((previous) => {
    if (message && previous[id] !== message) return previous
    const next = { ...previous }
    delete next[id]
    return next
  })
  const off = [
    api.event.on("session.next.compaction.started", (event) => setSessions((previous) => ({ ...previous, [event.properties.sessionID]: event.properties.messageID }))),
    api.event.on("session.next.compaction.ended", (event) => clear(event.properties.sessionID, event.properties.messageID)),
    api.event.on("session.compacted", (event) => clear(event.properties.sessionID)),
    api.event.on("message.part.updated", ({ properties }) => {
      const part = properties.part
      if (part.type !== "tool" || !/(^|[._-])(compress|compact|prune)$/.test(part.tool)) return
      const key = `${part.sessionID}:${part.callID}`
      setTools((previous) => {
        const next = { ...previous }
        if (part.state.status === "pending" || part.state.status === "running") next[key] = part.sessionID
        else delete next[key]
        return next
      })
    }),
    api.event.on("session.status", (event) => {
      if (event.properties.status.type === "idle") { clear(event.properties.sessionID); clearTools(event.properties.sessionID) }
    }),
    api.event.on("session.error", (event) => {
      if (event.properties.sessionID) { clear(event.properties.sessionID); clearTools(event.properties.sessionID) }
    }),
  ]
  api.lifecycle.onDispose(() => { off.forEach((dispose) => dispose()); setTools({}); setSessions({}) })
  return (id: string) => Boolean(sessions()[id]) || Object.values(tools()).includes(id)
}

export function waitingReason(api: TuiPluginApi, id: string, activity: ReturnType<typeof sidebarActivity>, compacting = false) {
  if (api.state.session.permission(id).length) return "Menunggu izin kamu"
  if (api.state.session.question(id).length) return "Menunggu pilihan / jawaban kamu"
  if (compacting) return "Meringkas konteks percakapan"
  if (activity.status?.type === "retry") return "Menunggu percobaan ulang model"
  if (activity.current?.tool === "task" || activity.current?.tool === "subagent" || (!activity.current && activity.agents.length)) return "Menunggu hasil subagent"
  if (activity.current) return `${activity.current.state.status === "pending" ? "Mengantre" : "Menunggu hasil"} · ${activityDetail(activity.current).action}`
  if (activity.status?.type === "busy") return "Menunggu respons model"
  return ""
}

export function ObservedWait(props: { reason: string; session: string }) {
  const [seconds, setSeconds] = createSignal(0)
  createEffect(() => {
    const reason = props.reason
    const session = props.session
    setSeconds(0)
    if (!reason || !session) return
    const start = Date.now()
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000)
    onCleanup(() => clearInterval(timer))
  })
  return <Show when={props.reason}><text wrapMode="word">{props.reason} · {seconds()} dtk teramati</text></Show>
}

export function holdKeyboardPose(source: Accessor<ReturnType<typeof avatarState>>, duration = 5000, compactDuration = 7200, session: Accessor<string> = () => "") {
  const [pose, setPose] = createSignal(source().pose)
  let scope = session()
  let started = Date.now()
  createEffect(() => {
    const next = source().pose
    const id = session()
    const previous = untrack(pose)
    if (id !== scope) {
      scope = id
      started = Date.now()
      setPose(next)
      return
    }
    const remaining = (previous === "compact" ? compactDuration : duration) - (Date.now() - started)
    const urgent = next === "error" || (next === "wait" && source().label === "Menunggu jawaban")
    const interrupt = urgent || (previous !== "compact" && next === "wait")
    if ((previous === "write" || previous === "compact") && next !== previous && remaining > 0 && !interrupt && next !== "compact") {
      const timer = setTimeout(() => { started = Date.now(); setPose(source().pose) }, remaining)
      onCleanup(() => clearTimeout(timer))
      return
    }
    if (next !== previous) started = Date.now()
    setPose(next)
  })
  return pose
}

export function DuaBubble(props: { api: TuiPluginApi; text: string; compact?: boolean }) {
  const theme = () => props.api.theme.current
  return <box flexShrink={0} minWidth={0} width="100%">
    <box backgroundColor={theme().backgroundElement} paddingLeft={1} paddingRight={1} paddingTop={props.compact ? 0 : 1} paddingBottom={props.compact ? 0 : 1} minWidth={0}>
      <text fg={theme().text} wrapMode="word" height={props.compact ? 2 : undefined}>{duaEmoji(props.text)} {props.text}</text>
    </box>
    <text height={1} fg={theme().primary}>  ▾</text>
  </box>
}

export function Companion(props: { api: TuiPluginApi; activity: ReturnType<typeof sidebarActivity>; motion?: boolean; compacting?: boolean; mini?: boolean; portraitOnly?: boolean; hideActivity?: boolean }) {
  const prayer = () => props.activity.attention || props.activity.latest?.state.status === "error" ? undefined : prayerReminders.get(props.api)?.view()
  const state = createMemo(() => avatarState(props.activity, props.compacting), undefined, {
    equals: (previous, next) => previous.pose === next.pose && previous.label === next.label && previous.moving === next.moving,
  })
  const pose = holdKeyboardPose(state, 5000, 7200, () => {
    const route = props.api.route?.current
    return route?.name === "session" ? String(route.params?.sessionID ?? "home") : "home"
  })
  const [frame, setFrame] = createSignal(0)
  const size = useTerminalDimensions()
  createEffect(() => {
    const current = pose()
    setFrame(0)
    if (props.motion === false) return
    const timer = setInterval(() => setFrame((value) => (value + 1) % 24), ["idle", "done", "wait", "error"].includes(current) ? 900 : 300)
    onCleanup(() => clearInterval(timer))
  })
  const theme = () => props.api.theme.current
  const pixels = createMemo(() => {
    const current = prayer()
    return current ? prayerFrame(props.motion === false ? (current.dua ? "dua" : "stand") : current.step.pose, props.motion === false ? 0 : frame()) : avatarFrame(pose(), frame())
  })
  const mini = () => props.mini || size().height < 28
  const rows = createMemo(() => Array.from({ length: mini() ? 7 : 14 }, (_, index) => index))
  const columns = createMemo(() => Array.from({ length: mini() ? 14 : 28 }, (_, index) => index))
  const pixel = (row: number, col: number) => {
    if (!mini()) return pixels()[row][col]
    const block = [pixels()[row * 2][col * 2], pixels()[row * 2][col * 2 + 1], pixels()[row * 2 + 1][col * 2], pixels()[row * 2 + 1][col * 2 + 1]]
    return block.find((color) => color !== undefined)
  }
  return <box gap={0} flexShrink={0}>
    <Show when={!props.portraitOnly && prayer()?.dua}>{(dua) => <DuaBubble api={props.api} text={dua()} />}</Show>
      <box alignItems="center" height={mini() ? 7 : 14} flexShrink={0}>
        <For each={rows()}>{(row) => <text height={1} flexShrink={0}>
          <For each={columns()}>{(col) => <span style={{
            fg: pixel(row * 2, col) ?? theme().backgroundPanel,
            bg: pixel(row * 2 + 1, col) ?? theme().backgroundPanel,
          }}>▀</span>}</For>
        </text>}</For>
      </box>
    <Show when={!props.portraitOnly}>
    <text fg={theme().text}><b>{prayer()?.label ?? state().label}</b></text>
    <Show when={!props.hideActivity && props.activity.latest}>{(latest) => <box>
      <text fg={theme().textMuted}>Aktivitas terakhir · {activityDetail(latest()).status}</text>
      <text fg={theme().text} wrapMode="word"><b>{activityDetail(latest()).action}</b></text>
      <Show when={activityDetail(latest()).target}><text fg={theme().text} wrapMode="char">{activityDetail(latest()).target}</text></Show>
      <Show when={activityDetail(latest()).result}><text fg={theme().textMuted} wrapMode="word">{activityDetail(latest()).result}</text></Show>
    </box>}</Show>
    </Show>
  </box>
}

export function Welcome(props: { api: TuiPluginApi; motion?: boolean; speechInterval?: number }) {
  const size = useTerminalDimensions()
  const theme = () => props.api.theme.current
  const narrow = () => size().width < 70
  const [phrase, setPhrase] = createSignal(0)
  const phrases = ["Mau ngerjain apa hari ini gan? Sini gua bantu beresin.", "Ada bug bandel? Ceritain, kita telusuri bareng.", "Mau bikin fitur baru? Kasih idenya, kita mulai.", "Bawa kodenya, gan. Kita rapihin satu per satu."]
  createEffect(() => {
    if (props.motion === false) return
    const timer = setInterval(() => setPhrase((value) => (value + 1) % phrases.length), props.speechInterval ?? 6500)
    onCleanup(() => clearInterval(timer))
  })
  const idle: ReturnType<typeof sidebarActivity> = { mcp: [], agents: [], tools: [], todos: [], completed: 0, total: 0, attention: 0, status: { type: "idle" }, latest: undefined, current: undefined }
  return (
    <box width="100%" maxWidth={96} paddingLeft={2} paddingRight={2} gap={1} flexShrink={0}>
      <text fg={theme().primary}><b>{narrow() ? "S / STUDIO" : "S A F F T E E N   /   S T U D I O"}</b></text>
      <Show when={prayerReminders.get(props.api)?.view()?.dua}>{(dua) => <DuaBubble api={props.api} text={dua()} compact={size().height < 32} />}</Show>
      <box flexDirection={narrow() && size().height >= 40 ? "column" : "row"} alignItems="center" gap={1}>
        <box width={narrow() || size().height < 32 ? 14 : 28} flexShrink={0}>
          <Companion api={props.api} activity={idle} motion={props.motion} mini={narrow() || size().height < 32} portraitOnly />
        </box>
        <box flexGrow={1} flexShrink={1} minWidth={0}>
          <text fg={theme().textMuted}>{prayerReminders.get(props.api)?.view()?.label ?? "Santai · siap bantu"}</text>
          <Show when={!prayerReminders.get(props.api)?.view()?.dua}><text fg={theme().text} wrapMode="word">{phrases[phrase()]}</text></Show>
        </box>
      </box>
      <Show when={!narrow()}>
        <text fg={theme().textMuted}>Bangun, telusuri, dan perbaiki kode. Mulai dari satu instruksi.</text>
      </Show>
    </box>
  )
}

export function InfoCard(props: { api: TuiPluginApi; name: string; title: string; summary: string; children: JSX.Element; initialOpen?: boolean; onOpen?: (open: boolean) => void }) {
  const [open, setOpen] = createSignal(props.api.kv.get<boolean>(`studio.card.${props.name}`, props.initialOpen ?? false))
  const theme = () => props.api.theme.current
  createEffect(() => props.onOpen?.(open()))
  const toggle = () => {
    const next = !open()
    setOpen(next)
    props.api.kv.set(`studio.card.${props.name}`, next)
  }
  const unregister = props.api.command?.register(() => [{
    title: `Studio: ${open() ? "tutup" : "buka"} ${props.title}`,
    value: `studio.card.${props.name}`,
    category: "Studio",
    slash: { name: `studio-${props.name}` },
    onSelect: (dialog) => { toggle(); dialog?.clear() },
  }])
  if (unregister) onCleanup(unregister)
  return <box backgroundColor={theme().backgroundElement} paddingLeft={1} paddingRight={1}>
    <box onMouseDown={(event) => { if (event.button === 0) { event.stopPropagation(); toggle() } }}>
      <text fg={theme().primary}><b>{open() ? "▾" : "▸"} {props.title}</b></text>
      <text fg={theme().textMuted} wrapMode="word">{props.summary}</text>
    </box>
    <Show when={open()}><box paddingTop={1} paddingBottom={1}>{props.children}</box></Show>
  </box>
}

export function SubagentCard(props: { api: TuiPluginApi; agent: ReturnType<typeof sidebarActivity>["agents"][number]; ended?: number }) {
  const [data, setData] = createSignal<Awaited<ReturnType<typeof fetchSubagent>>>()
  const [error, setError] = createSignal("")
  const [now, setNow] = createSignal(Date.now())
  const theme = () => props.api.theme.current
  createEffect(() => {
    const id = props.agent.id
    const ended = props.ended
    const controller = new AbortController()
    let pending = false
    setData(undefined); setError("")
    const refresh = async () => {
      if (pending) return
      pending = true
      try { const next = await fetchSubagent(props.api, id, controller.signal); if (!controller.signal.aborted) { setData(next); setError("") } }
      catch { if (!controller.signal.aborted) setError("Detail belum tersedia; mencoba lagi.") }
      finally { pending = false }
    }
    void refresh()
    const poll = ended ? undefined : setInterval(() => void refresh(), 5000)
    const clock = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => { controller.abort(); clearInterval(poll); clearInterval(clock) })
  })
  return <InfoCard api={props.api} name={`agent-${props.agent.id}`} title={`${props.agent.name} · ${props.ended ? "Baru berakhir" : props.agent.label}`} summary={`${data()?.model ?? "Memuat model…"}\n${elapsedLabel(data()?.started, props.ended ?? now())} sejak sesi dibuat`}>
    <Show when={props.agent.target}><text fg={theme().text} wrapMode="word">{props.agent.target}</text></Show>
    <Show when={error()}><text fg={theme().warning}>{error()}</text></Show>
    <Show when={data()}>{(detail) => <box gap={1}>
      <text fg={theme().text} wrapMode="word">{detail().activity ? `${detail().current ? "Sekarang" : "Terakhir"} · ${detail().activity!.action} · ${detail().activity!.status}` : "Aktivitas tool belum dilaporkan."}</text>
      <Show when={detail().activity?.target}><text fg={theme().textMuted} wrapMode="char">{detail().activity?.target}</text></Show>
      <text fg={theme().textMuted}>{detail().todos.length ? `${detail().completed}/${detail().todos.length} tugas selesai` : "Progres tugas belum dilaporkan."}</text>
      <For each={detail().todos}>{(todo) => <text fg={todo.status === "in_progress" ? theme().text : theme().textMuted} wrapMode="word">{todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "›" : "·"} {todo.content}</text>}</For>
    </box>}</Show>
  </InfoCard>
}

export function WorkspaceCard(props: { api: TuiPluginApi; id: string }) {
  const [open, setOpen] = createSignal(false)
  const [data, setData] = createSignal<Awaited<ReturnType<typeof inspectWorkspace>>>()
  const [error, setError] = createSignal("")
  const theme = () => props.api.theme.current
  createEffect(() => {
    const root = props.api.state.path.directory
    setData(undefined); setError("")
    if (!open()) return
    const controller = new AbortController()
    let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try { const next = await inspectWorkspace(root, controller.signal); if (!controller.signal.aborted) { setData(next); setError("") } }
      catch { if (!controller.signal.aborted) setError("Pemindaian Git gagal. Periksa akses folder dan instalasi Git.") }
      finally { pending = false }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 15000)
    onCleanup(() => { controller.abort(); clearInterval(timer) })
  })
  return <InfoCard api={props.api} name="files" title="Ruang kerja & berkas" onOpen={setOpen} summary={error() || (data() ? `${data()!.repos.length} repo Git · ${data()!.repos.reduce((n, repo) => n + repo.files.length, 0)} entri berubah` : open() ? "Memindai repositori…" : "Buka untuk memindai repo root dan subfolder")}>
    <text fg={theme().textMuted} wrapMode="char">{props.api.state.path.directory}</text>
    <text fg={theme().textMuted}>Git lokal, bukan hanya perubahan sesi · refresh 15 dtk</text>
    <Show when={data()}>{(scan) => <box gap={1}>
      <For each={scan().repos} fallback={<text fg={theme().textMuted}>Tidak ditemukan repo Git dalam cakupan pemindaian.</text>}>{(repo) => <box>
        <text fg={theme().primary} wrapMode="char"><b>{repo.path}</b> · {repo.branch}</text>
        <Show when={repo.error} fallback={<text fg={theme().textMuted}>{repo.files.length ? `${repo.files.length} entri berubah` : "Working tree bersih"}</text>}><text fg={theme().warning}>{repo.error}</text></Show>
        <For each={repo.files}>{(file) => <text fg={theme().text} wrapMode="char">{file.status} {file.path}</text>}</For>
      </box>}</For>
      <For each={scan().errors}>{(message) => <text fg={theme().warning}>{message}</text>}</For>
      <Show when={scan().limited}><text fg={theme().warning}>Cakupan dibatasi 4 tingkat / 300 folder.</text></Show>
    </box>}</Show>
    <text fg={theme().textMuted}>{props.api.state.session.diff(props.id).length} berkas tercatat terpisah oleh sesi OpenCode.</text>
  </InfoCard>
}

export function Overview(props: { api: TuiPluginApi; id: string; motion?: boolean; compacting?: boolean; mini?: boolean }) {
  const theme = () => props.api.theme.current
  const data = createMemo(() => sessionMetrics(props.api, props.id))
  const activity = createMemo(() => sidebarActivity(props.api, props.id))
  const calls = createMemo(() => new Map(props.api.state.session.messages(props.id).flatMap((message) => props.api.state.part(message.id).filter((part) => part.type === "tool")).map((part) => [part.callID, part])))
  const detail = (tool: Parameters<typeof activityDetail>[0]) => activityDetail(calls().get(tool.callID) ?? tool)
  const mcp = retainActivity(() => activity().mcp, (server) => server.name, () => props.id)
  const agents = retainActivity(() => activity().agents, (agent) => agent.id, () => props.id)
  const tools = retainActivity(() => activity().tools, (tool) => tool.callID, () => props.id)
  const size = useTerminalDimensions()
  const limit = () => size().height < 35 ? 2 : 4
  return (
    <box gap={1} flexShrink={0}>
      <box>
        <text fg={theme().text} wrapMode="char"><b>{data().model}</b></text>
        <text fg={theme().textMuted}>{data().agent ?? "Sesi baru"} · {activity().status?.type === "busy" ? "Bekerja" : activity().status?.type === "retry" ? "Mencoba ulang" : "Siap"}</text>
      </box>
      <ObservedWait reason={waitingReason(props.api, props.id, activity(), props.compacting)} session={props.id} />
      <Companion api={props.api} activity={activity()} motion={props.motion} compacting={props.compacting} mini={props.mini} hideActivity />
      <Show when={activity().attention > 0}>
        <box>
          <text fg={theme().warning}><b>Butuh jawaban · {activity().attention}</b></text>
          <text fg={theme().textMuted}>Periksa permintaan di percakapan.</text>
        </box>
      </Show>
      <InfoCard api={props.api} name="connections" title="Koneksi MCP" initialOpen summary={`${props.api.state.mcp().filter((server) => server.status === "connected").length}/${props.api.state.mcp().length} terhubung · ${activity().mcp.length} sedang dipakai`}>
      <Show when={mcp().length > 0}>
        <box>
          <text fg={theme().primary}><b>MCP sedang dipakai / terakhir</b></text>
          <For each={mcp().slice(0, limit())}>{(row) => <box>
            <text fg={theme().text} wrapMode="char">{row.item.name} · {row.ended === undefined ? `${row.item.calls.length} panggilan` : "Baru berakhir"}</text>
            <For each={row.item.calls.slice(0, 2)}>{(call) => <text fg={theme().textMuted} wrapMode="word">{detail(call).status} · {detail(call).action}{detail(call).target ? ` · ${detail(call).target}` : ""}</text>}</For>
          </box>}</For>
          <Show when={mcp().length > limit()}><text fg={theme().textMuted}>+{mcp().length - limit()} MCP lainnya</text></Show>
        </box>
      </Show>
        <For each={props.api.state.mcp().filter((server) => !mcp().some((row) => row.item.name === server.name))}>{(server) =>
          <text fg={server.status === "connected" ? theme().textMuted : theme().warning} wrapMode="char">{server.name} · {server.status === "connected" ? "Terhubung · tidak sedang dipakai" : server.status}</text>
        }</For>
        <Show when={!props.api.state.mcp().length}><text fg={theme().textMuted}>Tidak ada server MCP.</text></Show>
      </InfoCard>
      <Show when={agents().length > 0}>
        <box>
          <text fg={theme().primary}><b>Subagent · {agents().length}</b></text>
          <For each={agents().slice(0, limit())}>{(row) =>
            <SubagentCard api={props.api} agent={row.item} ended={row.ended} />
          }</For>
          <Show when={agents().length > limit()}><text fg={theme().textMuted}>+{agents().length - limit()} agent lainnya</text></Show>
        </box>
      </Show>
      <InfoCard api={props.api} name="result" title="Aktivitas & hasil" initialOpen summary={activity().current ? `${activityDetail(activity().current!).action} · ${activityDetail(activity().current!).status}` : activity().latest ? `${activityDetail(activity().latest!).action} · ${activityDetail(activity().latest!).status}` : "Belum ada aktivitas tool"}>
      <Show when={tools().length > 0}>
        <box>
          <For each={tools().slice(0, limit())}>{(row) =>
            <box><text fg={theme().text} wrapMode="word">{detail(row.item).action} · {detail(row.item).status}{detail(row.item).target ? ` · ${detail(row.item).target}` : ""}</text><Show when={detail(row.item).result}><text fg={theme().textMuted} wrapMode="word">{detail(row.item).result}</text></Show></box>
          }</For>
          <Show when={tools().length > limit()}><text fg={theme().textMuted}>+{tools().length - limit()} tool lainnya</text></Show>
        </box>
      </Show>
        <Show when={activity().latest && !tools().slice(0, limit()).some((row) => row.item.callID === activity().latest?.callID) && !mcp().some((row) => row.item.calls.some((call) => call.callID === activity().latest?.callID)) && !["task", "subagent"].includes(activity().latest!.tool) ? activity().latest : undefined}>{(latest) => <box>
          <text fg={theme().text} wrapMode="word">{activityDetail(latest()).target || activityDetail(latest()).action}</text>
          <text fg={theme().textMuted} wrapMode="word">{activityDetail(latest()).result || "Masih diproses; belum ada hasil akhir."}</text>
        </box>}</Show>
        <text fg={theme().textMuted} wrapMode="word">Hasil tes: lihat keluaran pengujian di percakapan; status tool bukan bukti tes lulus.</text>
      </InfoCard>
      <InfoCard api={props.api} name="context" title="Laporan token provider" summary={data().used === undefined ? "Token belum dilaporkan" : `${compact(data().used ?? NaN)} token · laporan terakhir`}>
        <text fg={theme().textMuted} wrapMode="char">Provider · {data().provider}</text>
        <text fg={theme().textMuted}>Konteks aktif DCP · belum diukur</text>
        <text fg={theme().textMuted} wrapMode="word">Laporan ini menjumlahkan input, output, reasoning, dan cache dari pesan model terakhir yang melaporkan penggunaan.</text>
        <text fg={theme().textMuted} wrapMode="word">Periksa /dcp untuk statistik kompresi. Angka provider bukan ukuran pesan yang akan dikirim sesudah DCP.</text>
        <text fg={theme().textMuted}>Biaya tercatat · ${data().cost.toFixed(4)}</text>
      </InfoCard>
      <InfoCard api={props.api} name="progress" title="Progres tugas" initialOpen summary={`${activity().completed}/${activity().total} selesai · ${activity().todos.length} tersisa`}>
        <Show when={activity().total > 0} fallback={<text fg={theme().textMuted}>Belum ada daftar tugas di sesi ini.</text>}>
          <text fg={theme().textMuted}>{activity().todos.filter((todo) => todo.status === "in_progress").length} berjalan · {activity().todos.filter((todo) => todo.status === "pending").length} antre</text>
          <For each={[...props.api.state.session.todo(props.id)].sort((a, b) => ({ in_progress: 0, pending: 1, completed: 2 }[a.status] ?? 3) - ({ in_progress: 0, pending: 1, completed: 2 }[b.status] ?? 3))}>{(todo) =>
            <box marginTop={1}><text fg={todo.status === "in_progress" ? theme().primary : theme().textMuted}>{todo.status === "completed" ? "✓ Selesai" : todo.status === "in_progress" ? "› Sedang dikerjakan" : "· Menunggu"}</text><text fg={todo.status === "completed" ? theme().textMuted : theme().text} wrapMode="word">{todo.content}</text></box>
          }</For>
        </Show>
      </InfoCard>
      <WorkspaceCard api={props.api} id={props.id} />
    </box>
  )
}

export function SidebarPresence(props: { visible: (value: boolean) => void; children: JSX.Element }) {
  onMount(() => props.visible(true))
  onCleanup(() => props.visible(false))
  return props.children
}

export function ResponsiveDock(props: { api: TuiPluginApi; id: string; sidebarVisible: boolean; motion?: boolean; compacting?: boolean }) {
  const size = useTerminalDimensions()
  const activity = createMemo(() => sidebarActivity(props.api, props.id))
  const data = createMemo(() => sessionMetrics(props.api, props.id))
  const theme = () => props.api.theme.current
  const open = () => props.api.ui.dialog.replace(() => <props.api.ui.Dialog onClose={() => props.api.ui.dialog.clear()}>
    <box padding={1}>
      <text fg={theme().primary}><b>Studio · Detail sesi</b> · Esc tutup</text>
      <scrollbox height={Math.max(5, size().height - 10)}>
        <Overview api={props.api} id={props.id} motion={props.motion} compacting={props.compacting} mini />
      </scrollbox>
    </box>
  </props.api.ui.Dialog>)
  const unregister = props.api.command?.register(() => [{
    title: "Studio: buka seluruh informasi sesi", value: "studio.panel", category: "Studio", slash: { name: "studio-panel" },
    onSelect: () => open(),
  }])
  if (unregister) onCleanup(unregister)
  return <Show when={!props.sidebarVisible}>
    <Show when={!activity().attention && prayerReminders.get(props.api)?.view()?.dua}>{(dua) => <DuaBubble api={props.api} text={dua()} compact />}</Show>
    <box backgroundColor={theme().backgroundPanel} flexDirection="row" width="100%" height={8} flexShrink={0} gap={1} paddingLeft={1} paddingRight={1}>
      <box width={14} flexShrink={0}><Companion api={props.api} activity={activity()} motion={props.motion} compacting={props.compacting} mini portraitOnly /></box>
      <box flexGrow={1} minWidth={0} flexShrink={1}>
        <text height={1} fg={theme().primary}><b>STUDIO · {data().agent ?? "Sesi"}</b></text>
        <text height={1} fg={theme().text}>{activity().attention ? avatarState(activity(), props.compacting).label : prayerReminders.get(props.api)?.view()?.label ?? avatarState(activity(), props.compacting).label}</text>
        <text height={1} fg={theme().textMuted}>{data().model}{data().used === undefined ? "" : ` · ${compact(data().used ?? NaN)} token (laporan)`}</text>
        <text height={1} fg={activity().attention ? theme().warning : theme().textMuted}>{activity().attention ? `${activity().attention} permintaan menunggu jawaban` : `MCP ${activity().mcp.length} aktif · Agent ${activity().agents.length} · Tugas ${activity().completed}/${activity().total}`}</text>
        <text height={1} fg={theme().text}>{activity().latest ? `${activityDetail(activity().latest!).status} · ${activityDetail(activity().latest!).action}` : "Belum ada aktivitas tool"}</text>
        <text height={1} fg={theme().textMuted}>{activity().latest ? activityDetail(activity().latest!).target : ""}</text>
        <box onMouseDown={(event) => { if (event.button === 0) { event.stopPropagation(); open() } }}>
          <text height={1} fg={theme().primary}>/studio-panel · detail</text>
        </box>
      </box>
    </box>
  </Show>
}

function StatusBar(props: { api: TuiPluginApi }) {
  const size = useTerminalDimensions()
  const theme = () => props.api.theme.current
  const mcp = () => props.api.state.mcp()
  const plugins = () => props.api.plugins.list().filter((item) => item.source !== "internal")
  return (
    <box flexDirection="row" justifyContent="space-between" backgroundColor={theme().backgroundPanel} paddingLeft={1} paddingRight={1} width="100%">
      <text fg={theme().primary}><b>STUDIO</b></text>
      <Show when={size().width >= 65}>
        <text fg={theme().textMuted}>{mcp().filter((item) => item.status === "connected").length}/{mcp().length} MCP · {plugins().filter((item) => item.active).length}/{plugins().length} plugin TUI aktif</text>
      </Show>
      <text fg={theme().textMuted}>{props.api.state.vcs?.branch ?? "lokal"}</text>
    </box>
  )
}

const plugin: TuiPluginModule = {
  id: "saffteen-studio",
  tui: async (api, options) => {
    prayerReminders.set(api, createPrayerReminder(api, options?.prayer, prayerDesktopNotification))
    api.lifecycle.onDispose(() => { prayerReminders.delete(api) })
    attentionFeedback(api)
    visualFeedback(api)
    const compacting = compactionMonitor(api)
    const [sidebarVisible, setSidebarVisible] = createSignal(false)
    const sessionID = () => {
      const route = api.route.current
      return route.name === "session" && typeof route.params?.sessionID === "string" ? route.params.sessionID : undefined
    }
    const [motion, setMotion] = createSignal(options?.motion !== false)
    const unregister = api.command?.register(() => [{
      title: motion() ? "Studio: matikan animasi avatar" : "Studio: aktifkan animasi avatar",
      value: "studio.avatar.motion",
      category: "Studio",
      slash: { name: "studio-motion" },
      onSelect: (dialog) => { setMotion((value) => !value); dialog?.clear() },
    }])
    if (unregister) api.lifecycle.onDispose(unregister)
    api.slots.register({
      order: 10,
      slots: {
        home_logo() { return <Welcome api={api} motion={motion()} /> },
        home_bottom() {
          return <box width="100%" maxWidth={96} paddingLeft={2} paddingRight={2} marginTop={1}>
            <text fg={api.theme.current.textMuted}>/ perintah  ·  @ berkas & agent  ·  ! shell</text>
          </box>
        },
        home_footer() { return <text fg={api.theme.current.textMuted}>SAFFTEEN STUDIO  /  OpenCode {api.app.version}</text> },
        sidebar_title(_ctx, props) {
          return <box gap={1} paddingBottom={1}>
            <text fg={api.theme.current.primary}><b>STUDIO / SESI</b></text>
            <text fg={api.theme.current.text} wrapMode="word"><b>{props.title}</b></text>
            <Show when={props.share_url}><text fg={api.theme.current.textMuted} wrapMode="char">{props.share_url}</text></Show>
          </box>
        },
        sidebar_content(_ctx, props) { return <SidebarPresence visible={setSidebarVisible}><Overview api={api} id={props.session_id} motion={motion()} compacting={compacting(props.session_id)} /></SidebarPresence> },
        sidebar_footer() { return <text fg={api.theme.current.textMuted}>SAFFTEEN STUDIO · 0.1</text> },
        app_bottom() { return <box flexShrink={0}>
          <Show when={sessionID()}>{(id) => <ResponsiveDock api={api} id={id()} sidebarVisible={sidebarVisible()} motion={motion()} compacting={compacting(id())} />}</Show>
          <StatusBar api={api} />
        </box> },
      },
    })
  },
}

export default plugin
