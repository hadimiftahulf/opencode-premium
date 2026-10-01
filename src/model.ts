import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { ToolPart } from "@opencode-ai/sdk/v2"

export function activityDetail(tool: ToolPart) {
  const input = tool.state.input
  const clean = (value: unknown) => typeof value === "string"
    ? value.split("").map((char) => char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159) ? " " : char).join("").replace(/(?:Bearer\s+\S+|(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+)/gi, "[disamarkan]").replace(/\s+/g, " ").trim().slice(0, 120)
    : ""
  const labels: Record<string, string> = { read: "Membaca berkas", edit: "Mengubah berkas", write: "Menulis berkas", glob: "Mencari berkas", grep: "Menelusuri kode", search: "Mencari informasi", bash: "Menjalankan perintah", task: "Delegasi agent", subagent: "Delegasi agent" }
  const action = labels[tool.tool] ?? clean(tool.tool)
  const target = clean(input.description) || clean(input.filePath ?? input.file_path ?? input.path) || clean(input.title)
  const status = { pending: "Antre", running: "Berjalan", completed: "Selesai", error: "Gagal" }[tool.state.status]
  const background = tool.state.status === "completed" && tool.state.metadata.background === true
  const duration = tool.state.status === "completed" || tool.state.status === "error"
    ? ` · ${Math.max(0, (tool.state.time.end - tool.state.time.start) / 1000).toFixed(1)} dtk` : ""
  const result = tool.state.status === "error" ? "Periksa detail kegagalan di percakapan."
    : background ? "Peluncuran selesai; status anak dipantau terpisah."
    : tool.state.status === "completed" ? `Tool selesai${duration}.` : ""
  return { action, target, status: background ? "Diluncurkan" : status, result }
}

export function compact(value: number) {
  if (!Number.isFinite(value) || value < 0) return "—"
  return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

export function sessionMetrics(api: TuiPluginApi, id: string) {
  const messages = api.state.session.messages(id)
  const latest = [...messages].reverse().find((message) => message.role === "assistant")
  const model = latest?.role === "assistant" ? latest.modelID : undefined
  const provider = latest?.role === "assistant" ? latest.providerID : undefined
  const reported = [...messages].reverse().find((message) => message.role === "assistant" && message.modelID === model && message.providerID === provider && [message.tokens.input, message.tokens.output, message.tokens.reasoning, message.tokens.cache.read, message.tokens.cache.write].some((value) => Number.isFinite(value) && value > 0))
  const tokens = reported?.role === "assistant" ? reported.tokens : undefined
  const used = tokens ? [tokens.input, tokens.output, tokens.reasoning, tokens.cache.read, tokens.cache.write].reduce((sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0), 0) : undefined
  const limit = api.state.provider.find((item) => item.id === provider)?.models[model ?? ""]?.limit.context
  return {
    model: model ?? "Menunggu respons",
    provider: provider ?? "Belum ada penggunaan",
    agent: latest?.role === "assistant" ? latest.agent : undefined,
    used,
    percent: used !== undefined && limit && limit > 0 ? Math.round(used / limit * 100) : undefined,
    cost: messages.reduce((total, message) => total + (message.role === "assistant" ? message.cost : 0), 0),
  }
}

export function sidebarActivity(api: TuiPluginApi, id: string) {
  const tools = api.state.session.messages(id).flatMap((message) =>
    api.state.part(message.id).filter((part) => part.type === "tool")
  )
  const servers = [...api.state.mcp()].sort((a, b) => b.name.length - a.name.length)
  const active = tools.filter((tool) => tool.state.status === "running" || tool.state.status === "pending")
  const mcpName = (name: string) => servers.find((server) => {
    const key = server.name.replace(/[^a-zA-Z0-9_-]/g, "_")
    return [server.name, key].some((prefix) => name.startsWith(`${prefix}_`) || name.startsWith(`${prefix}-`))
  })?.name
  const mcp = servers.flatMap((server) => {
    const calls = active.filter((tool) => mcpName(tool.tool) === server.name)
    return calls.length ? [{ name: server.name, calls }] : []
  })
  const agents = tools.filter((tool) => tool.tool === "task" || tool.tool === "subagent").flatMap((tool) => {
    const metadata = tool.state.status === "pending" ? undefined : tool.state.metadata
    const child = typeof metadata?.sessionId === "string" ? metadata.sessionId : undefined
    const status = child ? api.state.session.status(child) : undefined
    const waiting = child ? api.state.session.permission(child).length + api.state.session.question(child).length : 0
    const running = status ? status.type !== "idle" : tool.state.status === "running" || tool.state.status === "pending"
    if (!running && !waiting) return []
    return [{
      id: child ?? tool.callID,
      name: typeof tool.state.input.subagent_type === "string" ? tool.state.input.subagent_type : "subagent",
      label: waiting ? "Menunggu jawaban" : status?.type === "retry" ? "Mencoba ulang" : "Bekerja",
      target: activityDetail(tool).target,
    }]
  }).filter((agent, index, list) => list.findIndex((item) => item.id === agent.id) === index)
  const todos = api.state.session.todo(id)
  return {
    mcp,
    latest: tools.at(-1),
    current: active.at(-1),
    agents,
    tools: active.filter((tool) => !mcpName(tool.tool) && tool.tool !== "task" && tool.tool !== "subagent"),
    todos: todos.filter((todo) => todo.status === "in_progress" || todo.status === "pending")
      .sort((a, b) => Number(b.status === "in_progress") - Number(a.status === "in_progress")),
    completed: todos.filter((todo) => todo.status === "completed").length,
    total: todos.length,
    attention: api.state.session.permission(id).length + api.state.session.question(id).length,
    status: api.state.session.status(id),
  }
}

export type AvatarPose = "compact" | "idle" | "read" | "write" | "run" | "connect" | "delegate" | "delegate-wait" | "wait" | "done" | "error"

export function avatarState(activity: ReturnType<typeof sidebarActivity>, compacting = false) {
  const state = (pose: AvatarPose, label: string, moving = false) => ({ pose, label, moving })
  if (activity.attention) return state("wait", "Menunggu jawaban")
  if (compacting) return state("compact", "Meringkas konteks", true)
  if (activity.status?.type === "retry") return state("wait", "Mencoba ulang")
  if (activity.current?.state.status === "pending") return state("wait", "Menunggu tool")
  if (activity.current) {
    if (activity.mcp.some((server) => server.calls.some((call) => call.callID === activity.current?.callID)))
      return state("connect", "Mengakses MCP", true)
    const name = activity.current.tool.toLowerCase()
    if (/^(read|glob|grep|search|list|webfetch)$/.test(name)) return state("read", "Menelusuri", true)
    if (/^(edit|write|apply_patch|multiedit)$/.test(name)) return state("write", "Menyusun kode", true)
    if (/^(task|subagent)$/.test(name)) return state("delegate-wait", "Menunggu hasil subagent", true)
    return state("run", "Menjalankan tool", true)
  }
  if (activity.agents.length) return state("delegate-wait", `Menunggu ${activity.agents.length} subagent`, true)
  if (activity.status?.type === "busy") return state("run", "Memproses respons", true)
  if (activity.latest?.state.status === "error") return state("error", "Tool terakhir gagal")
  if (activity.latest) return state("done", "Selesai · istirahat dulu")
  return state("idle", "Santai · rehat dulu")
}

export const avatarPalette = {
  hair: "#c8d3df", hairLight: "#edf3fa", hairEdge: "#93a5ba",
  trim: "#20272b", trimLight: "#374347",
  skin: "#d6a17d", skinLight: "#efc49b", skinShade: "#aa735e",
  ink: "#20292d", shirt: "#526b6c", shirtLight: "#78918d", shirtShade: "#455c60",
  chair: "#243246", chairEdge: "#456078",
  accent: "#9cdec5",
  keyboard: "#a6b8c2", keys: "#e2e9e4", keyShade: "#536773", shadow: "#25363b",
  metal: "#869ca5", paperShade: "#bbc7cb",
  amber: "#edcd96", red: "#f29b9b", coffee: "#69442e", smoke: "#b8c6c4", lens: "#7ebbc6",
} as const

export function avatarFrame(pose: AvatarPose, frame: number) {
  const cycle = Number.isFinite(frame) ? Math.abs(Math.floor(frame)) % 24 : 0
  const phase = cycle % 4
  const smoking = cycle >= 16
  const pixels: (string | undefined)[][] = Array.from({ length: 28 }, () => Array<string | undefined>(28).fill(undefined))
  const paint = (x: number, y: number, width: number, height: number, color: keyof typeof avatarPalette) => {
    for (let row = y; row < y + height; row++)
      for (let col = x; col < x + width; col++)
        if (pixels[row] && col >= 0 && col < 28) pixels[row][col] = avatarPalette[color]
  }
  const hair = (x: number, y: number, profile: boolean) => {
    const rows = profile ? [
      "  hhhh   ",
      " hlllhhh ",
      "hhhhhlhhh",
      "shhhhh hh",
      "sshhhh h ",
      " sshss   ",
      "  sss    ",
    ] : [
      "   hhhhhh   ",
      " hhhllllhhh ",
      "hhhhhhhlhhhh",
      "shhhh  hhhhs",
      "shh     hhss",
      " s     hh s ",
      " s        s ",
    ]
    rows.forEach((row, dy) => [...row].forEach((pixel, dx) => {
      if (pixel !== " ") paint(x + dx, y + dy, 1, 1, pixel === "l" ? "hairLight" : pixel === "s" ? "hairEdge" : "hair")
    }))
  }
  // Idle and desk scenes share the same head proportions, fringe and face planes.
  const head = (dx: number, dy: number, working = false) => {
    const p = (x: number, y: number, w: number, h: number, color: keyof typeof avatarPalette) => paint(x + dx, y + dy, w, h, color)
    p(9, 4, 10, 8, "skinShade")
    p(12, 4, 4, 2, "skinLight")
    p(10, 5, 8, 7, "skin")
    p(10, 6, 6, 4, "skinLight")
    p(17, 6, 1, 6, "skinShade")
    p(10, 11, 8, 2, "skinShade")
    p(11, 12, 6, 1, "trimLight")
    p(12, 12, 4, 1, "trim")
    hair(8 + dx, 1 + dy, false)
    p(10, 7, 3, 1, "trim")
    p(15, 7, 3, 1, "trim")
    const gaze = working ? 1 : 0
    p(10 + gaze, 8, 2, phase === 2 ? 1 : 2, "ink")
    p(15 + gaze, 8, 2, phase === 2 ? 1 : 2, "ink")
    if (phase !== 2) {
      p(10 + gaze, 8, 1, 1, "keys")
      p(15 + gaze, 8, 1, 1, "keys")
    }
    p(13, 10, 1, 1, "skinShade")
    p(13, 11, pose === "done" ? 3 : 2, 1, "trimLight")
  }
  if (pose === "compact") {
    paint(2, 25, 24, 2, "shadow")
    paint(4, 13, 10, 12, "shirtShade")
    paint(5, 13, 7, 10, "shirt")
    paint(4, 12, 8, 3, "shirtLight")
    paint(5, 13, 5, 3, "shirtShade")
    paint(4, 15, 4, 1, "shirtLight")
    head(-6, 1, true)
    paint(8, 14, 1, 5, "accent")
    paint(6, 18, 1, 5, "shirtLight")
    paint(8, 21, 4, 1, "trim")
    paint(8, 22, 3, 1, "shirtLight")
    paint(5, 24, 7, 1, "trimLight")
    paint(20, 19, 6, 7, "keyShade")
    paint(20, 18, 6, 2, "ink")
    paint(19, 18, 8, 1, "shirtLight")
    paint(21, 19, 4, 1, "trim")
    paint(21, 20, 1, 5, "shirtLight")
    paint(24, 20, 1, 5, "shirtShade")
    const step = cycle % 12
    const lifting = step >= 3 && step < 6
    paint(10, lifting ? 12 : 16, 3, 3, "shirtLight")
    paint(12, lifting ? 11 : 15, 3, 2, "shirt")
    paint(14, lifting ? 10 : 14, 2, 2, "skinLight")
    if (cycle >= 12) {
      paint(21, 20, 3, 2, "keys")
      paint(23, 21, 2, 1, "paperShade")
    }
    if (step < 3) {
      paint(15, 13, 4 - step, 4 - step, "keys")
      paint(16, 14, 1, 1, "keyShade")
    } else if (step < 10) {
      const path = [[16, 11], [18, 8], [20, 7], [22, 8], [23, 11], [23, 14], [23, 17]]
      const [x, y] = path[step - 3]
      paint(x, y, 2, 2, "keys")
      paint(x + 1, y + 1, 1, 1, "keyShade")
    } else {
      paint(22, 19 + (step === 10 ? 0 : 1), 3, 1, "keys")
      paint(23, 20, 1, 1, "paperShade")
    }
    return pixels
  }
  if (["read", "write", "run", "connect", "delegate", "delegate-wait"].includes(pose)) {
    paint(2, 25, 24, 2, "shadow")
    paint(16, 4, 11, 11, "trimLight")
    paint(17, 5, 9, 9, "ink")
    paint(26, 5, 1, 10, "trim")
    paint(17, 14, 9, 1, "trimLight")
    paint(24, 14, 1, 1, "accent")
    paint(20, 15, 2, 3, "keyShade")
    paint(18, 18, 7, 1, "metal")
    paint(20, 15, 1, 3, "metal")
    if (pose === "read") {
      paint(17, 5, 6, 1, "lens")
      for (let row = 0; row < 3; row++) {
        paint(17, 7 + row * 2, 1, 1, row === phase % 3 ? "accent" : "keyShade")
        paint(19, 7 + row * 2, row === phase % 3 ? 4 : 3, 1, row === phase % 3 ? "keys" : "lens")
      }
      paint(23, 8 + phase, 1, 1, "keys")
    } else if (pose === "write") {
      for (let row = 0; row < 3; row++) {
        paint(17, 6 + row * 2, 1, 1, "accent")
        paint(19, 6 + row * 2, row === 2 ? 1 + phase : 4, 1, row === 1 ? "lens" : "keys")
      }
      paint(20 + phase, 11, 1, 1, "accent")
    } else if (pose === "run") {
      paint(17, 6, 1, 1, "accent")
      paint(18, 7, 1, 1, "accent")
      paint(17, 8, 1, 1, "accent")
      paint(20, 8, 1 + phase, 1, "keys")
      paint(17, 11, 6, 1, "keyShade")
      paint(17, 11, 1 + phase, 1, "accent")
    } else if (pose === "connect") {
      paint(17, 6, 2, 2, "lens")
      paint(22, 10, 2, 2, "accent")
      paint(18, 8, 1, 3, "keyShade")
      paint(18, 10, 4, 1, "keyShade")
      paint(18 + phase, 10, 1, 1, "keys")
    } else if (pose === "delegate-wait") {
      paint(18, 6, 5, 1, "amber")
      paint(19, 7, 3, 1, "lens")
      paint(20, 8, 1, 2, "amber")
      paint(19, 10, 3, 1, "lens")
      paint(18, 11, 5, 1, "amber")
      paint(19 + phase % 3, 12, 1, 1, "keys")
    } else {
      paint(20, 5, 2, 2, "accent")
      paint(20, 7, 1, 3, "lens")
      paint(17, 9, 7, 1, "lens")
      for (let node = 0; node < 3; node++) paint(17 + node * 3, 11, 1, 2, node === phase % 3 ? "keys" : "accent")
    }
    // Chair, torso, arms and desk occupy separate bands instead of overlapping strips.
    // Exposed racing-seat wings stay outside the lighter hoodie silhouette.
    paint(0, 12, 4, 10, "chair")
    paint(1, 10, 3, 3, "chair")
    paint(1, 11, 2, 1, "chairEdge")
    paint(0, 13, 1, 8, "accent")
    paint(1, 14, 1, 6, "chairEdge")
    paint(0, 21, 3, 2, "chairEdge")
    paint(2, 23, 10, 1, "chair")
    paint(2, 24, 3, 1, "accent")
    paint(5, 24, 1, 3, "keyShade")
    paint(2, 27, 8, 1, "chairEdge")
    paint(7, 22, 3, 4, "ink")
    paint(11, 22, 3, 4, "trimLight")
    paint(7, 26, 4, 1, "trim")
    paint(11, 26, 4, 1, "trim")
    paint(3, 15, 11, 8, "shirt")
    paint(13, 16, 1, 6, "shirtShade")
    paint(3, 16, 1, 5, "shirtLight")
    paint(6, 13, 5, 2, "skinShade")
    paint(4, 14, 9, 1, "shirtLight")
    paint(5, 15, 7, 1, "keyShade")
    paint(6, 16, 1, 2, "shirtLight")
    paint(10, 16, 1, 2, "shirtLight")
    head(-6, 1, true)
    // Persistent keyboard: the lower key row stays visible even during a keystroke.
    paint(13, 20, 11, 2, "keyboard")
    for (let key = 0; key < 5; key++) paint(14 + key * 2, 20, 1, 1, "keys")
    paint(16, 21, 5, 1, "keys")
    // Rounded mouse silhouette, separated from the keyboard by a dark gap.
    paint(25, 19, 3, 3, "trim")
    paint(26, 18, 1, 1, "keyboard")
    paint(25, 19, 3, 2, "keyboard")
    paint(26, 19, 1, 1, "ink")
    paint(26, 21, 1, 1, "keyShade")
    paint(12, 22, 16, 1, "metal")
    paint(12, 23, 16, 1, "trimLight")
    paint(16, 24, 1, 3, "trimLight")
    paint(26, 24, 1, 3, "trimLight")
    const leftTap = pose === "write" ? phase % 2 : 0
    const rightTap = pose === "write" ? (phase + 1) % 2 : 0
    paint(11, 16, 3, 3, "shirt")
    paint(13, 17, 6, 2, "shirt")
    paint(18, 18, 1, 1, "shirtLight")
    if (!smoking) {
      const handX = pose === "write" ? 19 : 23
      if (pose !== "write") paint(18, 18, 5, 1, "shirt")
      paint(handX, 18 + rightTap, 3, 2, "skin")
      paint(handX, 18 + rightTap, 2, 1, "skinLight")
      paint(handX + 1, 19 + rightTap, 1, 1, "skinShade")
    }
    paint(5, 18, 3, 3, "shirt")
    paint(7, 19, 7, 2, "shirt")
    paint(12, 19, 2, 1, "shirtLight")
    paint(14, 18 + leftTap, 3, 2, "skin")
    paint(14, 18 + leftTap, 2, 1, "skinLight")
    paint(15, 19 + leftTap, 1, 1, "skinShade")
    if (smoking) {
      if (cycle < 20) {
        paint(11, 15, 3, 4, "shirt")
        paint(12, 13, 2, 4, "shirt")
        paint(10, 12, 3, 2, "skinLight")
        paint(9, 12, 4, 1, "keys")
        paint(13, 12, 1, 1, "amber")
      } else {
        paint(13, 17, 3, 1, "skin")
        paint(16, 17, 2, 1, "keys")
        paint(18, 17, 1, 1, "amber")
        paint(9, 12, 4, 2, "smoke")
        paint(12, 10 - phase % 2, 4, 3, "smoke")
        paint(15, 7 - phase % 2, 5, 4, "smoke")
        paint(18, 4 - phase % 2, 4, 3, "smoke")
      }
    }
    return pixels
  }
  paint(5, 25, 20, 2, "shadow")
  paint(6, 14, 16, 10, "shirtShade")
  paint(5, 16, 16, 7, "shirt")
  paint(6, 16, 3, 5, "shirtLight")
  paint(18, 15, 4, 8, "shirtShade")
  paint(11, 12, 6, 4, "skinShade")
  paint(11, 13, 5, 2, "skin")
  paint(8, 13, 12, 3, "shirtLight")
  paint(9, 14, 10, 3, "shirtShade")
  paint(8, 15, 2, 2, "shirtLight")
  paint(18, 15, 2, 2, "shirtLight")
  head(0, 0)
  paint(9, 14, 3, 2, "shirtLight")
  paint(16, 14, 3, 2, "shirt")
  paint(11, 16, 1, 4, "accent")
  paint(17, 16, 1, 4, "accent")
  paint(14, 16, 1, 4, "shirtShade")
  paint(19, 17, 2, 1, "accent")
  paint(7, 18, 1, 4, "shirtShade")
  paint(10, 20, 7, 1, "trim")
  paint(10, 21, 1, 2, "shirtLight")
  paint(16, 21, 1, 2, "shirtShade")
  paint(7, 23, 12, 1, "trimLight")
  if (pose === "error") { paint(10, 7, 2, 1, "trim"); paint(15, 7, 2, 1, "trim") }
  if (pose === "idle" || pose === "done") {
    const inhale = phase < 2
    paint(5, 18, 5, 4, "shirtLight")
    paint(8, 21, 4, 2, "skin")
    paint(18, inhale ? 13 : 17, 4, 5, "shirt")
    paint(inhale ? 16 : 20, inhale ? 12 : 17, 3, 2, "skinLight")
    paint(inhale ? 15 : 22, inhale ? 11 : 16, 4, 1, "keys")
    paint(inhale ? 19 : 26, inhale ? 11 : 16, 1, 1, phase === 1 ? "red" : "amber")
    if (!inhale) {
      paint(15, 11, 4, 2, "smoke")
      paint(18, 9, 4, 3, "smoke")
      paint(21, 6 - (phase - 2), 5, 4, "smoke")
      paint(23, 3 - (phase - 2), 4, 4, "smoke")
    }
    paint(10, 22, 9, 2, "shirtShade")
    return pixels
  }
  if (pose === "wait" || pose === "error") {
    paint(6, 19, 13, 3, "shirtLight")
    paint(16, 15, 3, 6, "shirt")
    paint(14, 13, 4, 3, "skinLight")
    paint(8, 20, 4, 2, "skin")
    paint(23, 7, 1, 4, pose === "error" ? "red" : "amber")
    paint(23, 12 + phase % 2, 1, 1, pose === "error" ? "red" : "amber")
    return pixels
  }
  return pixels
}

export function recentTools(api: TuiPluginApi, id: string) {
  return api.state.session.messages(id).slice(-30).flatMap((message) =>
    api.state.part(message.id).filter((part) => part.type === "tool")
  ).slice(-6).reverse()
}
