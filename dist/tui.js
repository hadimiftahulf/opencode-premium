// @bun
// src/tui.tsx
import { memo as _$memo } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal as createSignal2, For, onCleanup, onMount, Show, untrack } from "solid-js";

// src/model.ts
function activityDetail(tool) {
  const input = tool.state.input;
  const clean = (value) => typeof value === "string" ? value.split("").map((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159 ? " " : char).join("").replace(/(?:Bearer\s+\S+|(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+)/gi, "[disamarkan]").replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const labels = { read: "Membaca berkas", edit: "Mengubah berkas", write: "Menulis berkas", glob: "Mencari berkas", grep: "Menelusuri kode", search: "Mencari informasi", bash: "Menjalankan perintah", task: "Delegasi agent", subagent: "Delegasi agent" };
  const action = labels[tool.tool] ?? clean(tool.tool);
  const target = clean(input.description) || clean(input.filePath ?? input.file_path ?? input.path) || clean(input.title);
  const status = { pending: "Antre", running: "Berjalan", completed: "Selesai", error: "Gagal" }[tool.state.status];
  const background = tool.state.status === "completed" && tool.state.metadata.background === true;
  const duration = tool.state.status === "completed" || tool.state.status === "error" ? ` \xB7 ${Math.max(0, (tool.state.time.end - tool.state.time.start) / 1000).toFixed(1)} dtk` : "";
  const result = tool.state.status === "error" ? "Periksa detail kegagalan di percakapan." : background ? "Peluncuran selesai; status anak dipantau terpisah." : tool.state.status === "completed" ? `Tool selesai${duration}.` : "";
  return { action, target, status: background ? "Diluncurkan" : status, result };
}
function compact(value) {
  if (!Number.isFinite(value) || value < 0)
    return "\u2014";
  return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
function sessionMetrics(api, id) {
  const messages = api.state.session.messages(id);
  const latest = [...messages].reverse().find((message) => message.role === "assistant");
  const model = latest?.role === "assistant" ? latest.modelID : undefined;
  const provider = latest?.role === "assistant" ? latest.providerID : undefined;
  const reported = [...messages].reverse().find((message) => message.role === "assistant" && message.modelID === model && message.providerID === provider && [message.tokens.input, message.tokens.output, message.tokens.reasoning, message.tokens.cache.read, message.tokens.cache.write].some((value) => Number.isFinite(value) && value > 0));
  const tokens = reported?.role === "assistant" ? reported.tokens : undefined;
  const used = tokens ? [tokens.input, tokens.output, tokens.reasoning, tokens.cache.read, tokens.cache.write].reduce((sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0), 0) : undefined;
  const limit = api.state.provider.find((item) => item.id === provider)?.models[model ?? ""]?.limit.context;
  return {
    model: model ?? "Menunggu respons",
    provider: provider ?? "Belum ada penggunaan",
    agent: latest?.role === "assistant" ? latest.agent : undefined,
    used,
    percent: used !== undefined && limit && limit > 0 ? Math.round(used / limit * 100) : undefined,
    cost: messages.reduce((total, message) => total + (message.role === "assistant" ? message.cost : 0), 0)
  };
}
function sidebarActivity(api, id) {
  const tools = api.state.session.messages(id).flatMap((message) => api.state.part(message.id).filter((part) => part.type === "tool"));
  const servers = [...api.state.mcp()].sort((a, b) => b.name.length - a.name.length);
  const active = tools.filter((tool) => tool.state.status === "running" || tool.state.status === "pending");
  const mcpName = (name) => servers.find((server) => {
    const key = server.name.replace(/[^a-zA-Z0-9_-]/g, "_");
    return [server.name, key].some((prefix) => name.startsWith(`${prefix}_`) || name.startsWith(`${prefix}-`));
  })?.name;
  const mcp = servers.flatMap((server) => {
    const calls = active.filter((tool) => mcpName(tool.tool) === server.name);
    return calls.length ? [{ name: server.name, calls }] : [];
  });
  const agents = tools.filter((tool) => tool.tool === "task" || tool.tool === "subagent").flatMap((tool) => {
    const metadata = tool.state.status === "pending" ? undefined : tool.state.metadata;
    const child = typeof metadata?.sessionId === "string" ? metadata.sessionId : undefined;
    const status = child ? api.state.session.status(child) : undefined;
    const waiting = child ? api.state.session.permission(child).length + api.state.session.question(child).length : 0;
    const running = status ? status.type !== "idle" : tool.state.status === "running" || tool.state.status === "pending";
    if (!running && !waiting)
      return [];
    return [{
      id: child ?? tool.callID,
      name: typeof tool.state.input.subagent_type === "string" ? tool.state.input.subagent_type : "subagent",
      label: waiting ? "Menunggu jawaban" : status?.type === "retry" ? "Mencoba ulang" : "Bekerja",
      target: activityDetail(tool).target
    }];
  }).filter((agent, index, list) => list.findIndex((item) => item.id === agent.id) === index);
  const todos = api.state.session.todo(id);
  return {
    mcp,
    latest: tools.at(-1),
    current: active.at(-1),
    agents,
    tools: active.filter((tool) => !mcpName(tool.tool) && tool.tool !== "task" && tool.tool !== "subagent"),
    todos: todos.filter((todo) => todo.status === "in_progress" || todo.status === "pending").sort((a, b) => Number(b.status === "in_progress") - Number(a.status === "in_progress")),
    completed: todos.filter((todo) => todo.status === "completed").length,
    total: todos.length,
    attention: api.state.session.permission(id).length + api.state.session.question(id).length,
    status: api.state.session.status(id)
  };
}
function avatarState(activity, compacting = false) {
  const state = (pose, label, moving = false) => ({ pose, label, moving });
  if (activity.attention)
    return state("wait", "Menunggu jawaban");
  if (compacting)
    return state("compact", "Meringkas konteks", true);
  if (activity.status?.type === "retry")
    return state("wait", "Mencoba ulang");
  if (activity.current?.state.status === "pending")
    return state("wait", "Menunggu tool");
  if (activity.current) {
    if (activity.mcp.some((server) => server.calls.some((call) => call.callID === activity.current?.callID)))
      return state("connect", "Mengakses MCP", true);
    const name = activity.current.tool.toLowerCase();
    if (/^(read|glob|grep|search|list|webfetch)$/.test(name))
      return state("read", "Menelusuri", true);
    if (/^(edit|write|apply_patch|multiedit)$/.test(name))
      return state("write", "Menyusun kode", true);
    if (/^(task|subagent)$/.test(name))
      return state("delegate-wait", "Menunggu hasil subagent", true);
    return state("run", "Menjalankan tool", true);
  }
  if (activity.agents.length)
    return state("delegate-wait", `Menunggu ${activity.agents.length} subagent`, true);
  if (activity.status?.type === "busy")
    return state("run", "Memproses respons", true);
  if (activity.latest?.state.status === "error")
    return state("error", "Tool terakhir gagal");
  if (activity.latest)
    return state("done", "Selesai \xB7 istirahat dulu");
  return state("idle", "Santai \xB7 rehat dulu");
}
var avatarPalette = {
  hair: "#c8d3df",
  hairLight: "#edf3fa",
  hairEdge: "#93a5ba",
  trim: "#20272b",
  trimLight: "#374347",
  skin: "#d6a17d",
  skinLight: "#efc49b",
  skinShade: "#aa735e",
  ink: "#20292d",
  shirt: "#526b6c",
  shirtLight: "#78918d",
  shirtShade: "#455c60",
  chair: "#243246",
  chairEdge: "#456078",
  accent: "#9cdec5",
  keyboard: "#a6b8c2",
  keys: "#e2e9e4",
  keyShade: "#536773",
  shadow: "#25363b",
  metal: "#869ca5",
  paperShade: "#bbc7cb",
  amber: "#edcd96",
  red: "#f29b9b",
  coffee: "#69442e",
  smoke: "#b8c6c4",
  lens: "#7ebbc6"
};
function avatarFrame(pose, frame) {
  const cycle = Number.isFinite(frame) ? Math.abs(Math.floor(frame)) % 24 : 0;
  const phase = cycle % 4;
  const smoking = cycle >= 16;
  const pixels = Array.from({ length: 28 }, () => Array(28).fill(undefined));
  const paint = (x, y, width, height, color) => {
    for (let row = y;row < y + height; row++)
      for (let col = x;col < x + width; col++)
        if (pixels[row] && col >= 0 && col < 28)
          pixels[row][col] = avatarPalette[color];
  };
  const hair = (x, y, profile) => {
    const rows = profile ? [
      "  hhhh   ",
      " hlllhhh ",
      "hhhhhlhhh",
      "shhhhh hh",
      "sshhhh h ",
      " sshss   ",
      "  sss    "
    ] : [
      "   hhhhhh   ",
      " hhhllllhhh ",
      "hhhhhhhlhhhh",
      "shhhh  hhhhs",
      "shh     hhss",
      " s     hh s ",
      " s        s "
    ];
    rows.forEach((row, dy) => [...row].forEach((pixel, dx) => {
      if (pixel !== " ")
        paint(x + dx, y + dy, 1, 1, pixel === "l" ? "hairLight" : pixel === "s" ? "hairEdge" : "hair");
    }));
  };
  const head = (dx, dy, working = false) => {
    const p = (x, y, w, h, color) => paint(x + dx, y + dy, w, h, color);
    p(9, 4, 10, 8, "skinShade");
    p(12, 4, 4, 2, "skinLight");
    p(10, 5, 8, 7, "skin");
    p(10, 6, 6, 4, "skinLight");
    p(17, 6, 1, 6, "skinShade");
    p(10, 11, 8, 2, "skinShade");
    p(11, 12, 6, 1, "trimLight");
    p(12, 12, 4, 1, "trim");
    hair(8 + dx, 1 + dy, false);
    p(10, 7, 3, 1, "trim");
    p(15, 7, 3, 1, "trim");
    const gaze = working ? 1 : 0;
    p(10 + gaze, 8, 2, phase === 2 ? 1 : 2, "ink");
    p(15 + gaze, 8, 2, phase === 2 ? 1 : 2, "ink");
    if (phase !== 2) {
      p(10 + gaze, 8, 1, 1, "keys");
      p(15 + gaze, 8, 1, 1, "keys");
    }
    p(13, 10, 1, 1, "skinShade");
    p(13, 11, pose === "done" ? 3 : 2, 1, "trimLight");
  };
  if (pose === "compact") {
    paint(2, 27, 25, 1, "shadow");
    paint(5, 20, 3, 6, "chairEdge");
    paint(10, 20, 3, 6, "chair");
    paint(5, 21, 1, 4, "metal");
    paint(10, 21, 1, 4, "keyShade");
    paint(4, 26, 4, 1, "trimLight");
    paint(10, 26, 5, 1, "trimLight");
    paint(5, 14, 8, 6, "shirt");
    paint(5, 15, 1, 4, "shirtLight");
    paint(12, 15, 1, 5, "shirtShade");
    paint(5, 20, 8, 1, "shirtShade");
    paint(5, 13, 8, 2, "shirtLight");
    paint(7, 14, 4, 1, "shirtShade");
    head(-6, 0, true);
    paint(7, 15, 1, 3, "accent");
    paint(10, 15, 1, 3, "accent");
    paint(20, 19, 6, 7, "keyShade");
    paint(20, 18, 6, 2, "ink");
    paint(19, 18, 8, 1, "shirtLight");
    paint(21, 19, 4, 1, "trim");
    paint(21, 20, 1, 5, "shirtLight");
    paint(24, 20, 1, 5, "shirtShade");
    const step = cycle % 12;
    const arm = (joints, light) => {
      for (let i = 1;i < joints.length; i++) {
        const [ax, ay] = joints[i - 1];
        const [bx, by] = joints[i];
        const distance = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
        for (let t = 0;t <= distance; t++) {
          const x = Math.round(ax + (bx - ax) * t / distance);
          const y = Math.round(ay + (by - ay) * t / distance);
          paint(x, y, 2, 2, "shirtShade");
          paint(x, y, 2, 1, light ? "shirtLight" : "shirt");
        }
      }
    };
    const wrist = step < 3 ? [14, 16] : step < 5 ? [14, 12] : step < 8 ? [16, 13] : [14, 17];
    arm([[12, 14], [14, 15], wrist], false);
    paint(wrist[0] + 1, wrist[1], 2, 2, "skinLight");
    if (step < 3) {
      arm([[3, 14], [3, 19], [11, 18]], true);
      paint(12, 18, 2, 2, "skin");
    } else {
      arm([[3, 14], [2, 17], [3, 20]], true);
      paint(3, 21, 2, 2, "skinLight");
    }
    if (cycle >= 12) {
      paint(21, 20, 3, 2, "keys");
      paint(23, 21, 2, 1, "paperShade");
    }
    if (step < 3) {
      paint(14, 17, 4 - step, 3 - Math.floor(step / 2), "keys");
      paint(15, 18, 1, 1, "paperShade");
    } else if (step < 5) {
      paint(16, 11, 2, 2, "keys");
      paint(17, 12, 1, 1, "paperShade");
    } else if (step < 10) {
      const path = [[18, 10], [21, 8], [23, 10], [23, 13], [23, 16]];
      const [x, y] = path[step - 5];
      paint(x, y, 2, 2, "keys");
      paint(x + 1, y + 1, 1, 1, "keyShade");
    } else {
      paint(22, 19 + (step === 10 ? 0 : 1), 3, 1, "keys");
      paint(23, 20, 1, 1, "paperShade");
    }
    return pixels;
  }
  if (["read", "write", "run", "connect", "delegate", "delegate-wait"].includes(pose)) {
    paint(2, 25, 24, 2, "shadow");
    paint(16, 4, 11, 11, "trimLight");
    paint(17, 5, 9, 9, "ink");
    paint(26, 5, 1, 10, "trim");
    paint(17, 14, 9, 1, "trimLight");
    paint(24, 14, 1, 1, "accent");
    paint(20, 15, 2, 3, "keyShade");
    paint(18, 18, 7, 1, "metal");
    paint(20, 15, 1, 3, "metal");
    if (pose === "read") {
      paint(17, 5, 6, 1, "lens");
      for (let row = 0;row < 3; row++) {
        paint(17, 7 + row * 2, 1, 1, row === phase % 3 ? "accent" : "keyShade");
        paint(19, 7 + row * 2, row === phase % 3 ? 4 : 3, 1, row === phase % 3 ? "keys" : "lens");
      }
      paint(23, 8 + phase, 1, 1, "keys");
    } else if (pose === "write") {
      for (let row = 0;row < 3; row++) {
        paint(17, 6 + row * 2, 1, 1, "accent");
        paint(19, 6 + row * 2, row === 2 ? 1 + phase : 4, 1, row === 1 ? "lens" : "keys");
      }
      paint(20 + phase, 11, 1, 1, "accent");
    } else if (pose === "run") {
      paint(17, 6, 1, 1, "accent");
      paint(18, 7, 1, 1, "accent");
      paint(17, 8, 1, 1, "accent");
      paint(20, 8, 1 + phase, 1, "keys");
      paint(17, 11, 6, 1, "keyShade");
      paint(17, 11, 1 + phase, 1, "accent");
    } else if (pose === "connect") {
      paint(17, 6, 2, 2, "lens");
      paint(22, 10, 2, 2, "accent");
      paint(18, 8, 1, 3, "keyShade");
      paint(18, 10, 4, 1, "keyShade");
      paint(18 + phase, 10, 1, 1, "keys");
    } else if (pose === "delegate-wait") {
      paint(18, 6, 5, 1, "amber");
      paint(19, 7, 3, 1, "lens");
      paint(20, 8, 1, 2, "amber");
      paint(19, 10, 3, 1, "lens");
      paint(18, 11, 5, 1, "amber");
      paint(19 + phase % 3, 12, 1, 1, "keys");
    } else {
      paint(20, 5, 2, 2, "accent");
      paint(20, 7, 1, 3, "lens");
      paint(17, 9, 7, 1, "lens");
      for (let node = 0;node < 3; node++)
        paint(17 + node * 3, 11, 1, 2, node === phase % 3 ? "keys" : "accent");
    }
    paint(0, 12, 4, 10, "chair");
    paint(1, 10, 3, 3, "chair");
    paint(1, 11, 2, 1, "chairEdge");
    paint(0, 13, 1, 8, "chairEdge");
    paint(1, 14, 1, 3, "accent");
    paint(0, 21, 3, 2, "chairEdge");
    paint(2, 23, 10, 1, "chair");
    paint(2, 24, 3, 1, "chairEdge");
    paint(5, 24, 1, 3, "keyShade");
    paint(2, 27, 8, 1, "chairEdge");
    paint(7, 22, 3, 4, "ink");
    paint(11, 22, 3, 4, "trimLight");
    paint(7, 26, 4, 1, "trim");
    paint(11, 26, 4, 1, "trim");
    paint(5, 15, 7, 8, "shirt");
    paint(4, 16, 1, 6, "shirtLight");
    paint(11, 17, 1, 5, "shirtShade");
    paint(6, 13, 5, 2, "skinShade");
    paint(4, 14, 9, 1, "shirtLight");
    paint(5, 15, 7, 1, "keyShade");
    paint(6, 16, 1, 2, "shirtLight");
    paint(10, 16, 1, 2, "shirtLight");
    head(-6, 1, true);
    paint(13, 20, 11, 2, "keyboard");
    for (let key = 0;key < 5; key++)
      paint(14 + key * 2, 20, 1, 1, "keys");
    paint(16, 21, 5, 1, "keys");
    paint(25, 19, 3, 3, "trim");
    paint(26, 18, 1, 1, "keyboard");
    paint(25, 19, 3, 2, "keyboard");
    paint(26, 19, 1, 1, "ink");
    paint(26, 21, 1, 1, "keyShade");
    paint(12, 22, 16, 1, "metal");
    paint(12, 23, 16, 1, "trimLight");
    paint(16, 24, 1, 3, "trimLight");
    paint(26, 24, 1, 3, "trimLight");
    const leftTap = pose === "write" && !smoking ? phase % 2 : 0;
    const rightTap = pose === "write" && !smoking ? (phase + 1) % 2 : 0;
    const sleeve = (joints, near) => {
      const path = [];
      for (let i = 1;i < joints.length; i++) {
        const [ax, ay] = joints[i - 1];
        const [bx, by] = joints[i];
        const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
        for (let t = 0;t <= steps; t++)
          path.push([
            Math.round(ax + (bx - ax) * t / Math.max(1, steps)),
            Math.round(ay + (by - ay) * t / Math.max(1, steps))
          ]);
      }
      for (const [x, y] of path)
        paint(x - 1, y - 1, 3, 3, "shirtShade");
      for (const [x, y] of path)
        paint(x - 1, y - 1, 3, 2, "shirt");
      if (near)
        for (const [x, y] of path)
          paint(x - 1, y - 1, 1, 1, "shirtLight");
      const [x, y] = joints[joints.length - 1];
      paint(x, y - 1, 1, 2, "shirtLight");
    };
    const palm = (x, y) => {
      paint(x, y - 1, 3, 2, "skin");
      paint(x, y - 1, 2, 1, "skinLight");
      paint(x + 2, y, 1, 1, "skinShade");
    };
    const rightX = pose === "write" ? 19 : 23;
    if (!smoking) {
      sleeve([[11, 16], [14, 18], [rightX - 1, 19 + rightTap]], false);
      palm(rightX, 19 + rightTap);
    } else if (cycle < 20) {
      sleeve([[11, 16], [14, 17], [12, 14]], false);
      palm(11, 13);
    } else {
      sleeve([[11, 16], [14, 18], [16, 18]], false);
      palm(17, 18);
    }
    sleeve([[5, 16], [6, 20], [13, 19 + leftTap]], true);
    palm(14, 19 + leftTap);
    paint(14, 21, 10, 1, "keyboard");
    paint(16, 21, 5, 1, "keys");
    if (smoking) {
      if (cycle < 20) {
        paint(9, 12, 4, 1, "keys");
        paint(13, 12, 1, 1, "amber");
      } else {
        paint(19, 17, 2, 1, "keys");
        paint(21, 17, 1, 1, "amber");
        paint(9, 12, 4, 2, "smoke");
        paint(12, 10 - phase % 2, 4, 3, "smoke");
        paint(15, 7 - phase % 2, 5, 4, "smoke");
        paint(18, 4 - phase % 2, 4, 3, "smoke");
      }
    }
    return pixels;
  }
  paint(5, 25, 20, 2, "shadow");
  paint(6, 14, 16, 10, "shirtShade");
  paint(5, 16, 16, 7, "shirt");
  paint(6, 16, 3, 5, "shirtLight");
  paint(18, 15, 4, 8, "shirtShade");
  paint(11, 12, 6, 4, "skinShade");
  paint(11, 13, 5, 2, "skin");
  paint(8, 13, 12, 3, "shirtLight");
  paint(9, 14, 10, 3, "shirtShade");
  paint(8, 15, 2, 2, "shirtLight");
  paint(18, 15, 2, 2, "shirtLight");
  head(0, 0);
  paint(9, 14, 3, 2, "shirtLight");
  paint(16, 14, 3, 2, "shirt");
  paint(11, 16, 1, 4, "accent");
  paint(17, 16, 1, 4, "accent");
  paint(14, 16, 1, 4, "shirtShade");
  paint(19, 17, 2, 1, "accent");
  paint(7, 18, 1, 4, "shirtShade");
  paint(10, 20, 7, 1, "trim");
  paint(10, 21, 1, 2, "shirtLight");
  paint(16, 21, 1, 2, "shirtShade");
  paint(7, 23, 12, 1, "trimLight");
  if (pose === "error") {
    paint(10, 7, 2, 1, "trim");
    paint(15, 7, 2, 1, "trim");
  }
  if (pose === "idle" || pose === "done") {
    const inhale = phase < 2;
    paint(5, 18, 5, 4, "shirtLight");
    paint(8, 21, 4, 2, "skin");
    paint(18, inhale ? 13 : 17, 4, 5, "shirt");
    paint(inhale ? 16 : 20, inhale ? 12 : 17, 3, 2, "skinLight");
    paint(inhale ? 15 : 22, inhale ? 11 : 16, 4, 1, "keys");
    paint(inhale ? 19 : 26, inhale ? 11 : 16, 1, 1, phase === 1 ? "red" : "amber");
    if (!inhale) {
      paint(15, 11, 4, 2, "smoke");
      paint(18, 9, 4, 3, "smoke");
      paint(21, 6 - (phase - 2), 5, 4, "smoke");
      paint(23, 3 - (phase - 2), 4, 4, "smoke");
    }
    paint(10, 22, 9, 2, "shirtShade");
    return pixels;
  }
  if (pose === "wait" || pose === "error") {
    paint(6, 19, 13, 3, "shirtLight");
    paint(16, 15, 3, 6, "shirt");
    paint(14, 13, 4, 3, "skinLight");
    paint(8, 20, 4, 2, "skin");
    paint(23, 7, 1, 4, pose === "error" ? "red" : "amber");
    paint(23, 12 + phase % 2, 1, 1, pose === "error" ? "red" : "amber");
    return pixels;
  }
  return pixels;
}

// src/prayer.ts
import { CalculationMethod, Coordinates, PrayerTimes } from "adhan";
var prayers = [
  { key: "fajr", name: "Subuh", rakaat: 2 },
  { key: "dhuhr", name: "Zuhur", rakaat: 4 },
  { key: "asr", name: "Asar", rakaat: 4 },
  { key: "maghrib", name: "Magrib", rakaat: 3 },
  { key: "isha", name: "Isya", rakaat: 4 }
];
var bandung = { city: "Bandung", latitude: -6.9175, longitude: 107.6191, timezone: "Asia/Jakarta", enabled: true };
function prayerConfig(value) {
  const raw = value && typeof value === "object" ? value : {};
  const config = { ...bandung, ...raw };
  if (typeof config.enabled !== "boolean" || typeof config.city !== "string" || !config.city.trim() || config.city.length > 80 || !Number.isFinite(config.latitude) || Math.abs(config.latitude) > 90 || !Number.isFinite(config.longitude) || Math.abs(config.longitude) > 180 || typeof config.timezone !== "string")
    throw new Error("Konfigurasi domisili salat tidak valid");
  new Intl.DateTimeFormat("en", { timeZone: config.timezone }).format();
  return config;
}
function prayerDate(now, timezone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function prayerSchedule(date, config = bandung) {
  const [year, month, day] = date.split("-").map(Number);
  const times = new PrayerTimes(new Coordinates(config.latitude, config.longitude), new Date(year, month - 1, day), CalculationMethod.Singapore());
  return prayers.map((prayer) => ({ ...prayer, at: times[prayer.key].getTime(), date }));
}
function duePrayer(schedule, now, seen) {
  return schedule.find((item) => Number.isFinite(item.at) && now >= item.at && now - item.at < 60000 && !seen(`${item.date}:${item.key}`));
}
function prayerSequence(rakaat) {
  if (![2, 3, 4].includes(rakaat))
    throw new Error("Jumlah rakaat harus 2, 3, atau 4");
  const result = [{ pose: "stand", rakaat: 1 }, { pose: "takbir", rakaat: 1 }];
  for (let index = 1;index <= rakaat; index++) {
    for (const pose of ["fold", "bow", "rise", "prostrate", "sit", "prostrate"])
      result.push({ pose, rakaat: index });
    if (index === rakaat)
      result.push({ pose: "tahiyat-final", rakaat: index });
    else if (index === 2)
      result.push({ pose: "tahiyat-early", rakaat: index });
  }
  result.push({ pose: "salam-right", rakaat }, { pose: "salam-left", rakaat });
  return result;
}
var prayerStepMs = 1600;
function prayerFrame(pose, frame = 0) {
  const pixels = Array.from({ length: 28 }, () => Array(28).fill(undefined));
  const p = (x, y, w, h, color) => {
    for (let row = y;row < y + h; row++)
      for (let col = x;col < x + w; col++)
        if (row >= 0 && row < 28 && col >= 0 && col < 28)
          pixels[row][col] = avatarPalette[color];
  };
  const backdrop = (x, y, w, h, color) => {
    for (let row = y;row < y + h; row++)
      for (let col = x;col < x + w; col++)
        if (pixels[row] && col >= 0 && col < 28)
          pixels[row][col] = color;
  };
  backdrop(0, 0, 28, 28, "#172425");
  backdrop(1, 0, 2, 24, "#293d3d");
  backdrop(25, 0, 2, 24, "#293d3d");
  for (const [x, y, w] of [[10, 0, 8], [7, 1, 14], [5, 2, 18]])
    backdrop(x, y, w, 1, "#405450");
  backdrop(5, 3, 1, 20, "#354c48");
  backdrop(22, 3, 1, 20, "#354c48");
  backdrop(2, 5, 2, 1, "#8b8965");
  backdrop(24, 5, 2, 1, "#8b8965");
  backdrop(2, 6, 2, 3, "#575c46");
  backdrop(24, 6, 2, 3, "#575c46");
  backdrop(0, 23, 28, 5, "#243536");
  backdrop(0, 24, 28, 1, "#304343");
  backdrop(2, 25, 24, 3, "#426760");
  backdrop(3, 25, 22, 1, "#8bb9a6");
  backdrop(3, 27, 22, 1, "#688e7f");
  const original = avatarFrame("wait", 0);
  const head = (x, y, size = 10, turn = "front") => {
    for (let row = 0;row < size; row++)
      for (let col = 0;col < size; col++) {
        const sx = Math.floor(col * 12 / size), sy = Math.floor(row * 12 / size);
        const color = turn === "down" ? original[12 - sx]?.[8 + sy] : original[1 + sy]?.[8 + (turn === "left" ? 11 - sx : sx)];
        if (color && pixels[y + row] && x + col >= 0 && x + col < 28)
          pixels[y + row][x + col] = color;
      }
  };
  const arm = (points, light = false) => {
    for (let i = 1;i < points.length; i++) {
      const [ax, ay] = points[i - 1], [bx, by] = points[i];
      const count = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
      for (let step = 0;step <= count; step++) {
        const x = Math.round(ax + (bx - ax) * step / count), y = Math.round(ay + (by - ay) * step / count);
        p(x - 1, y - 1, 3, 3, "shirtShade");
        p(x - 1, y - 1, 2, 2, light ? "shirtLight" : "shirt");
      }
    }
    const [x, y] = points[points.length - 1];
    p(x - 1, y, 3, 2, "skin");
    p(x - 1, y, 2, 1, "skinLight");
  };
  if (pose === "prostrate") {
    p(5, 20, 4, 5, "chair");
    p(3, 24, 3, 1, "skinShade");
    p(7, 17, 4, 7, "chairEdge");
    p(8, 15, 7, 6, "shirt");
    p(9, 14, 5, 2, "shirtLight");
    p(13, 16, 5, 4, "shirt");
    p(14, 16, 3, 2, "shirtShade");
    head(17, 17, 9, "down");
    arm([[15, 18], [14, 21], [18, 23]], true);
  } else if (["sit", "tahiyat-early", "tahiyat-final", "salam-right", "salam-left", "dua"].includes(pose)) {
    p(9, 22, 11, 3, "chair");
    p(11, 22, 9, 1, "chairEdge");
    p(9, 15, 9, 7, "shirt");
    p(9, 16, 2, 5, "shirtLight");
    p(16, 16, 2, 6, "shirtShade");
    p(9, 15, 9, 2, "shirtLight");
    p(11, 16, 5, 1, "shirtShade");
    p(11, 18, 1, 2, "accent");
    p(15, 18, 1, 2, "accent");
    head(8, 5, 10, pose === "salam-left" ? "left" : "front");
    if (pose !== "dua") {
      arm([[10, 18], [10, 21], [13, 22]], true);
      arm([[17, 18], [18, 20], [19, 22]]);
      if (pose !== "sit")
        p(20, 21, 1, 1, "skinLight");
    }
    if (["tahiyat-final", "salam-right", "salam-left"].includes(pose)) {
      p(7, 23, 8, 2, "chairEdge");
      p(20, 23, 2, 2, "skinShade");
    }
    if (pose === "salam-right")
      p(17, 12, 1, 2, "skinLight");
    if (pose === "dua") {
      const lift = Math.floor(frame / 4) % 2;
      arm([[10, 18], [7, 20], [9, 16 - lift]], true);
      arm([[17, 18], [20, 20], [18, 16 - lift]]);
      p(8, 15 - lift, 3, 2, "skinLight");
      p(17, 15 - lift, 3, 2, "skinLight");
    }
  } else if (pose === "bow") {
    p(7, 16, 3, 9, "chair");
    p(12, 16, 3, 9, "chairEdge");
    p(7, 24, 4, 1, "skinShade");
    p(12, 24, 4, 1, "skin");
    p(7, 11, 12, 6, "shirt");
    p(8, 11, 10, 1, "shirtLight");
    p(8, 16, 10, 1, "shirtShade");
    p(16, 12, 3, 2, "shirtShade");
    head(18, 10, 9, "down");
    arm([[17, 15], [16, 18], [13, 19]], true);
  } else {
    p(9, 18, 3, 7, "chair");
    p(15, 18, 3, 7, "chairEdge");
    p(9, 24, 4, 1, "skinShade");
    p(15, 24, 4, 1, "skin");
    p(8, 12, 11, 7, "shirt");
    p(8, 13, 2, 5, "shirtLight");
    p(18, 13, 1, 6, "shirtShade");
    p(8, 12, 11, 2, "shirtLight");
    p(11, 13, 5, 1, "shirtShade");
    p(11, 14, 1, 3, "accent");
    p(16, 14, 1, 3, "accent");
    p(11, 18, 5, 1, "shirtShade");
    head(8, 2);
    if (pose === "takbir") {
      arm([[9, 14], [5, 13], [5, 7]], true);
      arm([[18, 14], [22, 13], [22, 7]]);
    } else if (pose === "fold") {
      arm([[9, 14], [9, 17], [15, 16]], true);
      arm([[18, 14], [18, 17], [12, 16]]);
    } else {
      arm([[9, 15], [7, 18], [7, 20]], true);
      arm([[18, 15], [20, 18], [20, 20]]);
    }
  }
  return pixels;
}

// src/prayer-reminder.ts
import { createSignal } from "solid-js";

// src/prayer-audio.ts
import { Audio } from "@opentui/core";
import { fileURLToPath } from "url";
function createPrayerAudio(factory = () => Audio.create({ autoStart: false })) {
  let engine;
  let generation = 0;
  let disposed = false;
  const stop = () => {
    generation++;
    engine?.dispose();
    engine = undefined;
  };
  return {
    stop,
    async play() {
      stop();
      if (disposed)
        return;
      const token = generation;
      const current = factory();
      engine = current;
      try {
        const sound = await current.loadSoundFile(fileURLToPath(new URL("../assets/Adzan.mp3", import.meta.url)));
        if (disposed || token !== generation)
          return;
        if (!sound || !current.start() || !current.play(sound, { volume: 0.8 }))
          throw new Error("Pemutar azan tidak tersedia");
      } catch (error) {
        if (token !== generation)
          return;
        stop();
        throw error;
      }
    },
    dispose() {
      disposed = true;
      stop();
    }
  };
}
async function prayerDesktopNotification(input) {
  const { default: notifier } = await import("node-notifier");
  await new Promise((resolve, reject) => {
    notifier.notify({
      title: input.title,
      message: `${input.message} Klik notifikasi untuk hentikan azan; atau /studio-prayer-stop.`,
      sound: false,
      timeout: 240,
      ...process.platform === "darwin" ? { actions: ["Hentikan azan"], closeLabel: "Tutup" } : {}
    }, (error, response, metadata) => {
      const action = String(metadata?.activationValue ?? response ?? "").toLowerCase();
      if (action === "hentikan azan" || action === "activate" || action === "contentsclicked" || action === "clicked")
        input.onStop?.();
      if (error)
        reject(error);
      else
        resolve();
    });
  });
}

// src/duas.ts
var duas = [
  "Ya Allah Ampuni dosaku",
  "YaAllah abdi Cape",
  "Ya Allah, cing di bengharkeun",
  "Ya Allah, tenangkan hatiku hari ini.",
  "Ya Allah, tuntun langkahku menuju kebaikan.",
  "Ya Allah, kuatkan aku saat ingin menyerah.",
  "Ya Allah, lapangkan dadaku menerima ujian.",
  "Ya Allah, berkahi waktu yang Engkau titipkan.",
  "Ya Allah, jadikan lelahku bernilai ibadah.",
  "Ya Allah, cukupkan aku dengan rezeki yang halal.",
  "Ya Allah, sehatkan tubuh dan pikiranku.",
  "Ya Allah, lindungi kedua orang tuaku.",
  "Ya Allah, bahagiakan keluargaku dengan kebaikan.",
  "Ya Allah, sembuhkan saudara kami yang sakit.",
  "Ya Allah, mudahkan urusan yang terasa berat.",
  "Ya Allah, ajari aku bersyukur dalam kesederhanaan.",
  "Ya Allah, jauhkan aku dari kesombongan.",
  "Ya Allah, lembutkan tutur kataku.",
  "Ya Allah, jaga lisanku dari menyakiti orang lain.",
  "Ya Allah, bersihkan hatiku dari iri.",
  "Ya Allah, pasihan abdi kasabaran.",
  "Ya Allah, mugia dinten ieu pinuh ku berkah.",
  "Ya Allah, abdi hoyong langkung caket ka Anjeun.",
  "Ya Allah, hampura kalepatan abdi.",
  "Ya Allah, kuatkeun hate abdi.",
  "Ya Allah, pasihan kulawarga abdi kasehatan.",
  "Ya Allah, lancarkeun rezeki anu halal.",
  "Ya Allah, mugia abdi tiasa ngabantosan sasama.",
  "Ya Allah, tebihkeun abdi tina sipat sombong.",
  "Ya Allah, mugia abdi henteu hilap bersyukur.",
  "Ya Allah, bimbing aku mengambil keputusan.",
  "Ya Allah, berikan ilmu yang bermanfaat.",
  "Ya Allah, mudahkan aku memahami hal yang sulit.",
  "Ya Allah, jadikan pekerjaanku membawa manfaat.",
  "Ya Allah, jaga amanah yang ada di tanganku.",
  "Ya Allah, tuntun aku bekerja dengan jujur.",
  "Ya Allah, beri aku keberanian mengakui kesalahan.",
  "Ya Allah, bantu aku memperbaiki yang telah rusak.",
  "Ya Allah, jauhkan aku dari menunda kebaikan.",
  "Ya Allah, berkahi setiap usaha kecilku.",
  "Ya Allah, beri aku istirahat yang menenangkan.",
  "Ya Allah, ringankan beban pikiranku.",
  "Ya Allah, dampingi aku melewati rasa takut.",
  "Ya Allah, pulihkan harapanku yang meredup.",
  "Ya Allah, ajari aku menerima yang tak bisa kuubah.",
  "Ya Allah, kuatkan aku memperbaiki yang bisa kuubah.",
  "Ya Allah, jangan biarkan kecewa mengeraskan hatiku.",
  "Ya Allah, bantu aku memaafkan dengan tulus.",
  "Ya Allah, dekatkan aku dengan teman yang baik.",
  "Ya Allah, jadikan aku teman yang bisa dipercaya.",
  "Ya Allah, abdi nuju seueur pikiran.",
  "Ya Allah, tenangkeun pikiran abdi.",
  "Ya Allah, mugia usaha abdi aya mangpaatna.",
  "Ya Allah, pasihan abdi jalan kaluar anu sae.",
  "Ya Allah, jaga indung sareng bapa abdi.",
  "Ya Allah, mugia abdi janten jalmi anu jujur.",
  "Ya Allah, bantos abdi ngabenerkeun kalepatan.",
  "Ya Allah, mugia hate abdi langkung ikhlas.",
  "Ya Allah, pasihan abdi waktos kanggo istirahat.",
  "Ya Allah, ulah ngantep abdi putus asa.",
  "Ya Allah, cukupkan kebutuhan orang yang kekurangan.",
  "Ya Allah, lindungi mereka yang sedang dalam bahaya.",
  "Ya Allah, tenangkan mereka yang sedang berduka.",
  "Ya Allah, beri tempat aman bagi yang kehilangan rumah.",
  "Ya Allah, mudahkan jalan mereka yang mencari nafkah.",
  "Ya Allah, kuatkan para perawat dan penjaga orang sakit.",
  "Ya Allah, bahagiakan anak-anak dengan kasih sayang.",
  "Ya Allah, jaga persaudaraan di antara kami.",
  "Ya Allah, ajari kami saling menolong.",
  "Ya Allah, jadikan rumah kami tempat yang tenteram.",
  "Ya Allah, jauhkan rezekiku dari jalan yang merugikan orang.",
  "Ya Allah, jadikan kelapangan rezeki sarana berbagi.",
  "Ya Allah, bantu aku melunasi kewajibanku.",
  "Ya Allah, ajari aku mengatur titipan-Mu dengan bijak.",
  "Ya Allah, jauhkan aku dari pemborosan.",
  "Ya Allah, berkahi makanan di meja kami.",
  "Ya Allah, tumbuhkan kepedulian kepada tetangga.",
  "Ya Allah, beri aku hati yang dermawan.",
  "Ya Allah, jaga niatku saat berbuat baik.",
  "Ya Allah, terima usaha dan doa kami.",
  "Ya Allah, mugia rezeki abdi berkah, henteu ngan seueur.",
  "Ya Allah, abdi hoyong ngabahagiakeun kolot.",
  "Ya Allah, pasihan abdi tanaga kanggo nuluykeun usaha.",
  "Ya Allah, mugia abdi tiasa langkung sabar ka sasama.",
  "Ya Allah, jaga lisan abdi tina nyeri hatekeun batur.",
  "Ya Allah, bantos abdi diajar kalayan tekun.",
  "Ya Allah, mugia padamelan abdi lancar sareng halal.",
  "Ya Allah, pasihan abdi hate anu daek ngahampura.",
  "Ya Allah, mugia kulawarga abdi salawasna rukun.",
  "Ya Allah, tuntun abdi nalika bingung.",
  "Ya Allah, bantu aku menjaga salatku.",
  "Ya Allah, hadirkan kekhusyukan dalam ibadahku.",
  "Ya Allah, jangan biarkan kesibukan menjauhkanku dari-Mu.",
  "Ya Allah, beri aku kesempatan memperbaiki diri.",
  "Ya Allah, jadikan hari esok lebih baik dari hari ini.",
  "Ya Allah, ampuni kesalahan yang kusadari maupun tidak.",
  "Ya Allah, bimbing aku menepati janji.",
  "Ya Allah, jagalah kami dalam perjalanan.",
  "Ya Allah, karuniakan akhir hidup yang baik.",
  "Ya Allah, limpahkan rahmat-Mu kepada kami semua."
];
var duaDurationMs = 6500;
function duaEmoji(text) {
  if (/ampun|hampura|kalepatan|kesalahan/i.test(text))
    return "\uD83E\uDD32";
  if (/cape|lelah|istirahat|beban|pikiran/i.test(text))
    return "\uD83E\uDD7A";
  if (/rezeki|benghar|nafkah|kebutuhan|kewajiban/i.test(text))
    return "\uD83C\uDF31";
  if (/keluarga|kulawarga|orang tua|kolot|indung|bapa|rumah/i.test(text))
    return "\uD83E\uDD0D";
  if (/sehat|sembuh|sakit|pulih/i.test(text))
    return "\uD83D\uDC9A";
  if (/ilmu|belajar|diajar|memahami/i.test(text))
    return "\uD83D\uDCD6";
  if (/syukur|berkah/i.test(text))
    return "\u2728";
  return "\uD83E\uDD32";
}
function selectDuas(random = Math.random) {
  const pool = [...duas];
  for (let i = pool.length - 1;i > 0; i--) {
    const j = Math.floor(Math.max(0, Math.min(0.999999999, random())) * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 10);
}

// src/prayer-reminder.ts
function createPrayerReminder(api, options, send, audio = createPrayerAudio(), clock = Date.now) {
  const config = prayerConfig(options);
  const [active, setActive] = createSignal();
  const [now, setNow] = createSignal(clock());
  const [schedule, setSchedule] = createSignal(prayerSchedule(prayerDate(clock(), config.timezone), config));
  let disposed = false;
  let announcement = 0;
  let soundEnabled = api.kv.get("studio.prayer.sound", true);
  const format = (at) => new Intl.DateTimeFormat("id-ID", { timeZone: config.timezone, hour: "2-digit", minute: "2-digit" }).format(at);
  const announce = async (prayer, demo) => {
    const token = ++announcement;
    if (soundEnabled)
      audio.play().catch(() => {
        if (!disposed)
          api.ui.toast({ variant: "warning", message: "Azan gagal diputar; pengingat visual tetap aktif." });
      });
    else
      audio.stop();
    setActive({ prayer, started: clock(), demo, duas: selectDuas() });
    const title = demo ? "Studio \xB7 Tes pengingat salat" : `Waktu salat ${prayer.name}`;
    const message = `${config.city} \xB7 ${prayer.name} ${prayer.rakaat} rakaat. ${demo ? "Ini hanya tes, bukan penanda masuk waktu." : "Mari jeda sejenak untuk salat. Jadwal perhitungan lokal."}`;
    api.ui.toast({ title, message, variant: "info", duration: 1e4 });
    try {
      await send({ title, message, onStop: () => {
        if (!disposed && token === announcement)
          audio.stop();
      } });
    } catch {
      if (!disposed)
        api.ui.toast({ variant: "warning", message: "Notifikasi salat gagal dikirim ke desktop. Periksa izin notifikasi OS." });
    }
  };
  const tick = () => {
    const time = clock();
    setNow(time);
    const date = prayerDate(time, config.timezone);
    if (schedule()[0].date !== date)
      setSchedule(prayerSchedule(date, config));
    const current = active();
    if (current && time - current.started >= prayerSequence(current.prayer.rakaat).length * prayerStepMs + current.duas.length * duaDurationMs)
      setActive(undefined);
    if (!config.enabled)
      return;
    const namespace = `studio.prayer.${config.latitude}.${config.longitude}.${config.timezone}`;
    const seen = api.kv.get(namespace, []);
    const due = duePrayer(schedule(), time, (key) => seen.includes(key));
    if (due) {
      api.kv.set(namespace, [...seen.slice(-9), `${due.date}:${due.key}`]);
      announce(due, false);
    }
  };
  const timer = setInterval(tick, 1000);
  tick();
  const command = api.command?.register(() => [{
    title: "Studio: jadwal salat domisili",
    value: "studio.prayer.schedule",
    category: "Studio",
    slash: { name: "studio-prayer" },
    onSelect: (dialog) => {
      dialog?.clear();
      api.ui.toast({ title: `Salat \xB7 ${config.city}`, message: schedule().map((p) => `${p.name} ${format(p.at)}`).join(" \xB7 ") + " \xB7 Perhitungan lokal; cocokkan jadwal masjid setempat.", variant: "info", duration: 20000 });
    }
  }, ...prayers.map((prayer) => ({
    title: `Studio: tes salat ${prayer.name} (${prayer.rakaat} rakaat)`,
    value: `studio.prayer.test.${prayer.key}`,
    category: "Studio",
    slash: { name: `studio-prayer-test-${prayer.key}` },
    onSelect: async (dialog) => {
      dialog?.clear();
      await announce(prayer, true);
    }
  })), {
    title: "Studio: hentikan suara azan",
    value: "studio.prayer.stop",
    category: "Studio",
    slash: { name: "studio-prayer-stop" },
    onSelect: (dialog) => {
      dialog?.clear();
      audio.stop();
      api.ui.toast({ variant: "info", message: "Suara azan dihentikan." });
    }
  }, {
    title: "Studio: aktif/nonaktif suara azan",
    value: "studio.prayer.sound",
    category: "Studio",
    slash: { name: "studio-prayer-sound" },
    onSelect: (dialog) => {
      dialog?.clear();
      soundEnabled = !soundEnabled;
      api.kv.set("studio.prayer.sound", soundEnabled);
      if (!soundEnabled)
        audio.stop();
      api.ui.toast({ variant: "info", message: soundEnabled ? "Suara azan aktif." : "Suara azan nonaktif; pengingat visual tetap aktif." });
    }
  }, {
    title: "Studio: tutup ilustrasi salat",
    value: "studio.prayer.dismiss",
    category: "Studio",
    slash: { name: "studio-prayer-dismiss" },
    onSelect: (dialog) => {
      dialog?.clear();
      setActive(undefined);
    }
  }]);
  api.lifecycle.onDispose(() => {
    disposed = true;
    audio.dispose();
    clearInterval(timer);
    command?.();
    setActive(undefined);
  });
  const view = () => {
    const current = active();
    if (!current)
      return;
    const sequence = prayerSequence(current.prayer.rakaat);
    const elapsed = Math.max(0, now() - current.started);
    const duaIndex = Math.floor((elapsed - sequence.length * prayerStepMs) / duaDurationMs);
    const step = duaIndex >= 0 ? { pose: "dua", rakaat: current.prayer.rakaat } : sequence[Math.min(sequence.length - 1, Math.floor(elapsed / prayerStepMs))];
    const dua = duaIndex >= 0 ? current.duas[Math.min(current.duas.length - 1, duaIndex)] : undefined;
    return { ...current, step, dua, label: `${current.demo ? "Tes \xB7 " : ""}${current.prayer.name} \xB7 ${dua ? `Berdoa ${Math.min(current.duas.length, duaIndex + 1)}/${current.duas.length}` : `rakaat ${step.rakaat}/${current.prayer.rakaat}`} \xB7 ilustrasi` };
  };
  return { view, config };
}
var prayerReminders = new WeakMap;

// src/workspace.ts
import { readdir } from "fs/promises";
import { join, relative } from "path";
var ignored = new Set(["node_modules", ".git", ".next", ".cache", "vendor", "dist", "build", ".venv", "Pods"]);
async function inspectWorkspace(root, signal) {
  const repos = [];
  const queue = [{ path: root, depth: 0 }];
  let visited = 0;
  let depthLimited = false;
  const errors = [];
  while (queue.length && visited < 300) {
    signal?.throwIfAborted();
    const current = queue.shift();
    visited++;
    let entries;
    try {
      entries = await readdir(current.path, { withFileTypes: true });
    } catch {
      errors.push(`Tidak dapat membaca ${relative(root, current.path) || "."}`);
      continue;
    }
    if (entries.some((entry) => entry.name === ".git")) {
      const child = Bun.spawn(["git", "-C", current.path, "status", "--porcelain=v1", "-z", "--branch", "--untracked-files=normal"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
      const abort = () => {
        child.kill();
      };
      signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(() => child.kill(), 5000);
      try {
        const [output, , exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        const records = output.split("\x00");
        const branch = records.shift()?.replace(/^## /, "") ?? "";
        const files = [];
        for (let i = 0;i < records.length; i++) {
          const record = records[i];
          if (!record)
            continue;
          files.push({ status: record.slice(0, 2), path: record.slice(3) });
          if (/[RC]/.test(record.slice(0, 2)))
            i++;
        }
        repos.push({ path: relative(root, current.path) || ".", branch, files, ...exit !== 0 ? { error: "Git tidak tersedia, gagal, atau melewati batas waktu" } : {} });
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
      }
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink() && !ignored.has(entry.name) && !entry.name.startsWith(".")) {
        if (current.depth < 4)
          queue.push({ path: join(current.path, entry.name), depth: current.depth + 1 });
        else
          depthLimited = true;
      }
    }
  }
  return { repos, errors, limited: queue.length > 0 || depthLimited, visited };
}

// src/subagent.ts
function subagentDetails(session, messages, todos) {
  const assistant = [...messages].reverse().find((entry) => entry.info.role === "assistant")?.info;
  const tools = messages.flatMap((entry) => entry.parts.filter((part) => part.type === "tool"));
  const current = [...tools].reverse().find((part) => part.state.status === "running" || part.state.status === "pending");
  const latest = current ?? tools.at(-1);
  return {
    model: assistant?.role === "assistant" ? `${assistant.providerID} / ${assistant.modelID}` : session?.model ? `${session.model.providerID} / ${session.model.id}` : "Model belum dilaporkan",
    started: session?.time.created,
    activity: latest ? activityDetail(latest) : undefined,
    current: Boolean(current),
    todos,
    completed: todos.filter((todo) => todo.status === "completed").length
  };
}
async function fetchSubagent(api, sessionID, signal) {
  const params = { sessionID, directory: api.state.path.directory };
  const [session, messages, todos] = await Promise.all([
    api.client.session.get(params, { signal }),
    api.client.session.messages({ ...params, limit: 30 }, { signal }),
    api.client.session.todo(params, { signal })
  ]);
  if (session.error || messages.error || todos.error)
    throw new Error("Detail subagent belum tersedia dari host");
  return subagentDetails(session.data, messages.data ?? [], todos.data ?? []);
}
function elapsedLabel(start, now) {
  if (start === undefined || !Number.isFinite(start) || start <= 0)
    return "Durasi belum tersedia";
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return hours ? `${hours}j ${minutes}m ${seconds % 60}d` : `${minutes}m ${seconds % 60}d`;
}

// src/tui.tsx
function retainActivity(source, key, session, delay = 4000) {
  const [rows, setRows] = createSignal2([]);
  let scope = session();
  createEffect(() => {
    const id = session();
    const items = source();
    const now = Date.now();
    const previous = id === scope ? untrack(rows) : [];
    scope = id;
    const keys = new Set(items.map(key));
    setRows([...items.map((item) => ({
      item
    })), ...previous.filter((row) => !keys.has(key(row.item))).map((row) => ({
      ...row,
      ended: row.ended ?? now
    })).filter((row) => now - row.ended < delay)]);
  });
  createEffect(() => {
    const deadlines = rows().flatMap((row) => row.ended === undefined ? [] : [row.ended + delay]);
    if (!deadlines.length)
      return;
    const timer = setTimeout(() => setRows((previous) => previous.filter((row) => row.ended === undefined || Date.now() < row.ended + delay)), Math.max(0, Math.min(...deadlines) - Date.now()));
    onCleanup(() => clearTimeout(timer));
  });
  return rows;
}
async function desktopNotification(input) {
  const {
    default: notifier
  } = await import("node-notifier");
  await new Promise((resolve, reject) => {
    notifier.notify({
      ...input,
      sound: false,
      timeout: 10
    }, (error) => error ? reject(error) : resolve());
  });
}
function visualFeedback(api, send = desktopNotification) {
  let disposed = false;
  let warned = false;
  const desktop = async (title, message, test = false) => {
    try {
      await send({
        title,
        message
      });
      if (test && !disposed)
        api.ui.toast({
          variant: "info",
          message: "Permintaan notifikasi dikirim ke OS. Periksa banner dan izin notifikasi desktop."
        });
    } catch {
      if (!disposed && (!warned || test))
        api.ui.toast({
          variant: "warning",
          message: "Notifikasi desktop gagal dikirim. Periksa izin OS; Linux memerlukan notify-send dan sesi desktop."
        });
      warned = true;
    }
  };
  const seen = new Set;
  const busy = new Set;
  const show = (key, title, message, variant, duration = 6000) => {
    if (seen.has(key))
      return;
    seen.add(key);
    if (seen.size > 128)
      seen.delete(seen.values().next().value);
    api.ui.toast({
      title,
      message,
      variant,
      duration
    });
    desktop(title, message);
  };
  const off = [api.event.on("permission.asked", ({
    properties
  }) => show(`permission:${properties.sessionID}:${properties.id}`, "Studio \xB7 Izin diperlukan", "Tinjau permintaan di dialog izin sesi terkait. Belum ada izin diberikan.", "warning", 1e4)), api.event.on("question.asked", ({
    properties
  }) => show(`question:${properties.sessionID}:${properties.id}`, "Studio \xB7 Ada pertanyaan", "AI menunggu pilihan atau jawaban kamu. Buka dialog pertanyaan sesi terkait.", "info", 1e4)), api.event.on("permission.replied", ({
    properties
  }) => show(`permission-reply:${properties.sessionID}:${properties.requestID}`, "Studio \xB7 Keputusan izin", properties.reply === "reject" ? "Permintaan izin ditolak." : "Izin diberikan sesuai pilihan kamu.", properties.reply === "reject" ? "warning" : "success")), api.event.on("question.replied", ({
    properties
  }) => show(`question-reply:${properties.sessionID}:${properties.requestID}`, "Studio \xB7 Jawaban diterima", "Pilihan kamu sudah dikirim ke AI.", "success")), api.event.on("question.rejected", ({
    properties
  }) => show(`question-reply:${properties.sessionID}:${properties.requestID}`, "Studio \xB7 Pertanyaan dibatalkan", "Dialog pertanyaan telah ditutup tanpa jawaban.", "info")), api.event.on("session.status", ({
    properties
  }) => {
    if (properties.status.type !== "idle") {
      busy.add(properties.sessionID);
      return;
    }
    if (!busy.delete(properties.sessionID))
      return;
    api.ui.toast({
      title: "Studio \xB7 Respons siap",
      message: "AI selesai merespons. Periksa hasil atau saran di percakapan.",
      variant: "info",
      duration: 6000
    });
    desktop("Studio \xB7 Respons siap", "AI selesai merespons. Periksa hasil atau saran di percakapan.");
  }), api.event.on("session.error", ({
    properties
  }) => {
    if (properties.sessionID)
      busy.delete(properties.sessionID);
    api.ui.toast({
      title: "Studio \xB7 Ada kendala",
      message: "Periksa pesan error di percakapan untuk langkah berikutnya.",
      variant: "error",
      duration: 1e4
    });
    desktop("Studio \xB7 Ada kendala", "Periksa pesan error di percakapan untuk langkah berikutnya.");
  })];
  const command = api.command?.register(() => [{
    title: "Studio: tes popup notifikasi",
    value: "studio.popup.test",
    category: "Studio",
    slash: {
      name: "studio-popup-test"
    },
    onSelect: (dialog) => {
      dialog?.clear();
      api.ui.toast({
        title: "Studio \xB7 Popup aktif",
        message: "Notifikasi visual tetap terlihat meski suara tidak terdengar.",
        variant: "info",
        duration: 1e4
      });
    }
  }, {
    title: "Studio: tes notifikasi desktop",
    value: "studio.desktop.test",
    category: "Studio",
    slash: {
      name: "studio-desktop-test"
    },
    onSelect: async (dialog) => {
      dialog?.clear();
      await desktop("Studio \xB7 Tes desktop", "Notifikasi ini dikirim ke desktop, bukan hanya terminal.", true);
    }
  }]);
  api.lifecycle.onDispose(() => {
    disposed = true;
    off.forEach((dispose) => dispose());
    command?.();
    seen.clear();
    busy.clear();
  });
}
function attentionFeedback(api) {
  const seen = new Set;
  let warned = false;
  const play = async (name, message, test = false) => {
    try {
      const result = await api.attention.notify({
        message,
        notification: false,
        sound: {
          name,
          when: "always"
        }
      });
      if (test || !result.sound && !warned) {
        warned = !result.sound;
        api.ui.toast({
          variant: result.sound ? "info" : "warning",
          message: result.sound ? "Pemutar menerima suara. Pastikan terdengar di perangkat keluaran kamu." : `Suara tidak diputar (${result.skipped ?? "periksa pengaturan audio"}).`
        });
      }
    } catch {
      if (!warned)
        api.ui.toast({
          variant: "warning",
          message: "Pemutar suara gagal. Periksa pengaturan audio."
        });
      warned = true;
    }
  };
  const reply = (key, rejected, message) => {
    if (seen.has(key))
      return;
    seen.add(key);
    if (seen.size > 128)
      seen.delete(seen.values().next().value);
    play(rejected ? "error" : "default", message);
  };
  const off = [api.event.on("permission.replied", (event) => reply(`permission:${event.properties.sessionID}:${event.properties.requestID}`, event.properties.reply === "reject", event.properties.reply === "reject" ? "Izin ditolak" : "Izin diberikan")), api.event.on("question.replied", (event) => reply(`question:${event.properties.sessionID}:${event.properties.requestID}`, false, "Jawaban diterima")), api.event.on("question.rejected", (event) => reply(`question:${event.properties.sessionID}:${event.properties.requestID}`, true, "Pertanyaan dibatalkan"))];
  const command = api.command?.register(() => [{
    title: "Studio: tes suara perhatian",
    value: "studio.sound.test",
    category: "Studio",
    slash: {
      name: "studio-sound-test"
    },
    onSelect: async (dialog) => {
      dialog?.clear();
      await play("question", "Tes suara pertanyaan", true);
    }
  }]);
  api.lifecycle.onDispose(() => {
    off.forEach((dispose) => dispose());
    command?.();
    seen.clear();
  });
}
function compactionMonitor(api) {
  const [tools, setTools] = createSignal2({});
  const [sessions, setSessions] = createSignal2({});
  const clearTools = (id) => setTools((previous) => Object.fromEntries(Object.entries(previous).filter(([, session]) => session !== id)));
  const clear = (id, message) => setSessions((previous) => {
    if (message && previous[id] !== message)
      return previous;
    const next = {
      ...previous
    };
    delete next[id];
    return next;
  });
  const off = [api.event.on("session.next.compaction.started", (event) => setSessions((previous) => ({
    ...previous,
    [event.properties.sessionID]: event.properties.messageID
  }))), api.event.on("session.next.compaction.ended", (event) => clear(event.properties.sessionID, event.properties.messageID)), api.event.on("session.compacted", (event) => clear(event.properties.sessionID)), api.event.on("message.part.updated", ({
    properties
  }) => {
    const part = properties.part;
    if (part.type !== "tool" || !/(^|[._-])(compress|compact|prune)$/.test(part.tool))
      return;
    const key = `${part.sessionID}:${part.callID}`;
    setTools((previous) => {
      const next = {
        ...previous
      };
      if (part.state.status === "pending" || part.state.status === "running")
        next[key] = part.sessionID;
      else
        delete next[key];
      return next;
    });
  }), api.event.on("session.status", (event) => {
    if (event.properties.status.type === "idle") {
      clear(event.properties.sessionID);
      clearTools(event.properties.sessionID);
    }
  }), api.event.on("session.error", (event) => {
    if (event.properties.sessionID) {
      clear(event.properties.sessionID);
      clearTools(event.properties.sessionID);
    }
  })];
  api.lifecycle.onDispose(() => {
    off.forEach((dispose) => dispose());
    setTools({});
    setSessions({});
  });
  return (id) => Boolean(sessions()[id]) || Object.values(tools()).includes(id);
}
function waitingReason(api, id, activity, compacting = false) {
  if (api.state.session.permission(id).length)
    return "Menunggu izin kamu";
  if (api.state.session.question(id).length)
    return "Menunggu pilihan / jawaban kamu";
  if (compacting)
    return "Meringkas konteks percakapan";
  if (activity.status?.type === "retry")
    return "Menunggu percobaan ulang model";
  if (activity.current?.tool === "task" || activity.current?.tool === "subagent" || !activity.current && activity.agents.length)
    return "Menunggu hasil subagent";
  if (activity.current)
    return `${activity.current.state.status === "pending" ? "Mengantre" : "Menunggu hasil"} \xB7 ${activityDetail(activity.current).action}`;
  if (activity.status?.type === "busy")
    return "Menunggu respons model";
  return "";
}
function ObservedWait(props) {
  const [seconds, setSeconds] = createSignal2(0);
  createEffect(() => {
    const reason = props.reason;
    const session = props.session;
    setSeconds(0);
    if (!reason || !session)
      return;
    const start = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    onCleanup(() => clearInterval(timer));
  });
  return _$createComponent(Show, {
    get when() {
      return props.reason;
    },
    get children() {
      var _el$ = _$createElement("text"), _el$2 = _$createTextNode(` \xB7 `), _el$3 = _$createTextNode(` dtk teramati`);
      _$insertNode(_el$, _el$2);
      _$insertNode(_el$, _el$3);
      _$setProp(_el$, "wrapMode", "word");
      _$insert(_el$, () => props.reason, _el$2);
      _$insert(_el$, seconds, _el$3);
      return _el$;
    }
  });
}
function holdKeyboardPose(source, duration = 5000, compactDuration = 7200, session = () => "") {
  const [pose, setPose] = createSignal2(source().pose);
  let scope = session();
  let started = Date.now();
  createEffect(() => {
    const next = source().pose;
    const id = session();
    const previous = untrack(pose);
    if (id !== scope) {
      scope = id;
      started = Date.now();
      setPose(next);
      return;
    }
    const remaining = (previous === "compact" ? compactDuration : duration) - (Date.now() - started);
    const urgent = next === "error" || next === "wait" && source().label === "Menunggu jawaban";
    const interrupt = urgent || previous !== "compact" && next === "wait";
    if ((previous === "write" || previous === "compact") && next !== previous && remaining > 0 && !interrupt && next !== "compact") {
      const timer = setTimeout(() => {
        started = Date.now();
        setPose(source().pose);
      }, remaining);
      onCleanup(() => clearTimeout(timer));
      return;
    }
    if (next !== previous)
      started = Date.now();
    setPose(next);
  });
  return pose;
}
function DuaBubble(props) {
  const theme = () => props.api.theme.current;
  return (() => {
    var _el$4 = _$createElement("box"), _el$5 = _$createElement("box"), _el$6 = _$createElement("text"), _el$7 = _$createTextNode(` `), _el$8 = _$createElement("text");
    _$insertNode(_el$4, _el$5);
    _$insertNode(_el$4, _el$8);
    _$setProp(_el$4, "flexShrink", 0);
    _$setProp(_el$4, "minWidth", 0);
    _$setProp(_el$4, "width", "100%");
    _$insertNode(_el$5, _el$6);
    _$setProp(_el$5, "paddingLeft", 1);
    _$setProp(_el$5, "paddingRight", 1);
    _$setProp(_el$5, "minWidth", 0);
    _$insertNode(_el$6, _el$7);
    _$setProp(_el$6, "wrapMode", "word");
    _$insert(_el$6, () => duaEmoji(props.text), _el$7);
    _$insert(_el$6, () => props.text, null);
    _$insertNode(_el$8, _$createTextNode(` \u25BE`));
    _$setProp(_el$8, "height", 1);
    _$effect((_p$) => {
      var _v$ = theme().backgroundElement, _v$2 = props.compact ? 0 : 1, _v$3 = props.compact ? 0 : 1, _v$4 = theme().text, _v$5 = props.compact ? 2 : undefined, _v$6 = theme().primary;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$5, "backgroundColor", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$5, "paddingTop", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$5, "paddingBottom", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp(_el$6, "fg", _v$4, _p$.o));
      _v$5 !== _p$.i && (_p$.i = _$setProp(_el$6, "height", _v$5, _p$.i));
      _v$6 !== _p$.n && (_p$.n = _$setProp(_el$8, "fg", _v$6, _p$.n));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined
    });
    return _el$4;
  })();
}
function Companion(props) {
  const prayer = () => props.activity.attention || props.activity.latest?.state.status === "error" ? undefined : prayerReminders.get(props.api)?.view();
  const state = createMemo(() => avatarState(props.activity, props.compacting), undefined, {
    equals: (previous, next) => previous.pose === next.pose && previous.label === next.label && previous.moving === next.moving
  });
  const pose = holdKeyboardPose(state, 5000, 7200, () => {
    const route = props.api.route?.current;
    return route?.name === "session" ? String(route.params?.sessionID ?? "home") : "home";
  });
  const [frame, setFrame] = createSignal2(0);
  const size = useTerminalDimensions();
  createEffect(() => {
    const current = pose();
    setFrame(0);
    if (props.motion === false)
      return;
    const timer = setInterval(() => setFrame((value) => (value + 1) % 24), ["idle", "done", "wait", "error"].includes(current) ? 900 : 300);
    onCleanup(() => clearInterval(timer));
  });
  const theme = () => props.api.theme.current;
  const pixels = createMemo(() => {
    const current = prayer();
    return current ? prayerFrame(props.motion === false ? current.dua ? "dua" : "stand" : current.step.pose, props.motion === false ? 0 : frame()) : avatarFrame(pose(), frame());
  });
  const mini = () => props.mini || size().height < 28;
  const rows = createMemo(() => Array.from({
    length: mini() ? 7 : 14
  }, (_, index) => index));
  const columns = createMemo(() => Array.from({
    length: mini() ? 14 : 28
  }, (_, index) => index));
  const pixel = (row, col) => {
    if (!mini())
      return pixels()[row][col];
    const block = [pixels()[row * 2][col * 2], pixels()[row * 2][col * 2 + 1], pixels()[row * 2 + 1][col * 2], pixels()[row * 2 + 1][col * 2 + 1]];
    return block.find((color) => color !== undefined);
  };
  return (() => {
    var _el$0 = _$createElement("box"), _el$1 = _$createElement("box");
    _$insertNode(_el$0, _el$1);
    _$setProp(_el$0, "gap", 0);
    _$setProp(_el$0, "flexShrink", 0);
    _$insert(_el$0, _$createComponent(Show, {
      get when() {
        return _$memo(() => !!!props.portraitOnly)() && prayer()?.dua;
      },
      children: (dua) => _$createComponent(DuaBubble, {
        get api() {
          return props.api;
        },
        get text() {
          return dua();
        }
      })
    }), _el$1);
    _$setProp(_el$1, "alignItems", "center");
    _$setProp(_el$1, "flexShrink", 0);
    _$insert(_el$1, _$createComponent(For, {
      get each() {
        return rows();
      },
      children: (row) => (() => {
        var _el$12 = _$createElement("text");
        _$setProp(_el$12, "height", 1);
        _$setProp(_el$12, "flexShrink", 0);
        _$insert(_el$12, _$createComponent(For, {
          get each() {
            return columns();
          },
          children: (col) => (() => {
            var _el$13 = _$createElement("span");
            _$insertNode(_el$13, _$createTextNode(`\u2580`));
            _$effect((_$p) => _$setProp(_el$13, "style", {
              fg: pixel(row * 2, col) ?? theme().backgroundPanel,
              bg: pixel(row * 2 + 1, col) ?? theme().backgroundPanel
            }, _$p));
            return _el$13;
          })()
        }));
        return _el$12;
      })()
    }));
    _$insert(_el$0, _$createComponent(Show, {
      get when() {
        return !props.portraitOnly;
      },
      get children() {
        return [(() => {
          var _el$10 = _$createElement("text"), _el$11 = _$createElement("b");
          _$insertNode(_el$10, _el$11);
          _$insert(_el$11, () => prayer()?.label ?? state().label);
          _$effect((_$p) => _$setProp(_el$10, "fg", theme().text, _$p));
          return _el$10;
        })(), _$createComponent(Show, {
          get when() {
            return _$memo(() => !!!props.hideActivity)() && props.activity.latest;
          },
          children: (latest) => (() => {
            var _el$15 = _$createElement("box"), _el$16 = _$createElement("text"), _el$17 = _$createTextNode(`Aktivitas terakhir \xB7 `), _el$18 = _$createElement("text"), _el$19 = _$createElement("b");
            _$insertNode(_el$15, _el$16);
            _$insertNode(_el$15, _el$18);
            _$insertNode(_el$16, _el$17);
            _$insert(_el$16, () => activityDetail(latest()).status, null);
            _$insertNode(_el$18, _el$19);
            _$setProp(_el$18, "wrapMode", "word");
            _$insert(_el$19, () => activityDetail(latest()).action);
            _$insert(_el$15, _$createComponent(Show, {
              get when() {
                return activityDetail(latest()).target;
              },
              get children() {
                var _el$20 = _$createElement("text");
                _$setProp(_el$20, "wrapMode", "char");
                _$insert(_el$20, () => activityDetail(latest()).target);
                _$effect((_$p) => _$setProp(_el$20, "fg", theme().text, _$p));
                return _el$20;
              }
            }), null);
            _$insert(_el$15, _$createComponent(Show, {
              get when() {
                return activityDetail(latest()).result;
              },
              get children() {
                var _el$21 = _$createElement("text");
                _$setProp(_el$21, "wrapMode", "word");
                _$insert(_el$21, () => activityDetail(latest()).result);
                _$effect((_$p) => _$setProp(_el$21, "fg", theme().textMuted, _$p));
                return _el$21;
              }
            }), null);
            _$effect((_p$) => {
              var _v$7 = theme().textMuted, _v$8 = theme().text;
              _v$7 !== _p$.e && (_p$.e = _$setProp(_el$16, "fg", _v$7, _p$.e));
              _v$8 !== _p$.t && (_p$.t = _$setProp(_el$18, "fg", _v$8, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$15;
          })()
        })];
      }
    }), null);
    _$effect((_$p) => _$setProp(_el$1, "height", mini() ? 7 : 14, _$p));
    return _el$0;
  })();
}
function Welcome(props) {
  const size = useTerminalDimensions();
  const theme = () => props.api.theme.current;
  const narrow = () => size().width < 70;
  const [phrase, setPhrase] = createSignal2(0);
  const phrases = ["Mau ngerjain apa hari ini gan? Sini gua bantu beresin.", "Ada bug bandel? Ceritain, kita telusuri bareng.", "Mau bikin fitur baru? Kasih idenya, kita mulai.", "Bawa kodenya, gan. Kita rapihin satu per satu."];
  createEffect(() => {
    if (props.motion === false)
      return;
    const timer = setInterval(() => setPhrase((value) => (value + 1) % phrases.length), props.speechInterval ?? 6500);
    onCleanup(() => clearInterval(timer));
  });
  const idle = {
    mcp: [],
    agents: [],
    tools: [],
    todos: [],
    completed: 0,
    total: 0,
    attention: 0,
    status: {
      type: "idle"
    },
    latest: undefined,
    current: undefined
  };
  return (() => {
    var _el$22 = _$createElement("box"), _el$23 = _$createElement("text"), _el$24 = _$createElement("b"), _el$25 = _$createElement("box"), _el$26 = _$createElement("box"), _el$27 = _$createElement("box"), _el$28 = _$createElement("text");
    _$insertNode(_el$22, _el$23);
    _$insertNode(_el$22, _el$25);
    _$setProp(_el$22, "width", "100%");
    _$setProp(_el$22, "maxWidth", 96);
    _$setProp(_el$22, "paddingLeft", 2);
    _$setProp(_el$22, "paddingRight", 2);
    _$setProp(_el$22, "gap", 1);
    _$setProp(_el$22, "flexShrink", 0);
    _$insertNode(_el$23, _el$24);
    _$insert(_el$24, () => narrow() ? "S / STUDIO" : "S A F F T E E N   /   S T U D I O");
    _$insert(_el$22, _$createComponent(Show, {
      get when() {
        return prayerReminders.get(props.api)?.view()?.dua;
      },
      children: (dua) => _$createComponent(DuaBubble, {
        get api() {
          return props.api;
        },
        get text() {
          return dua();
        },
        get compact() {
          return size().height < 32;
        }
      })
    }), _el$25);
    _$insertNode(_el$25, _el$26);
    _$insertNode(_el$25, _el$27);
    _$setProp(_el$25, "alignItems", "center");
    _$setProp(_el$25, "gap", 1);
    _$setProp(_el$26, "flexShrink", 0);
    _$insert(_el$26, _$createComponent(Companion, {
      get api() {
        return props.api;
      },
      activity: idle,
      get motion() {
        return props.motion;
      },
      get mini() {
        return narrow() || size().height < 32;
      },
      portraitOnly: true
    }));
    _$insertNode(_el$27, _el$28);
    _$setProp(_el$27, "flexGrow", 1);
    _$setProp(_el$27, "flexShrink", 1);
    _$setProp(_el$27, "minWidth", 0);
    _$insert(_el$28, () => prayerReminders.get(props.api)?.view()?.label ?? "Santai \xB7 siap bantu");
    _$insert(_el$27, _$createComponent(Show, {
      get when() {
        return !prayerReminders.get(props.api)?.view()?.dua;
      },
      get children() {
        var _el$29 = _$createElement("text");
        _$setProp(_el$29, "wrapMode", "word");
        _$insert(_el$29, () => phrases[phrase()]);
        _$effect((_$p) => _$setProp(_el$29, "fg", theme().text, _$p));
        return _el$29;
      }
    }), null);
    _$insert(_el$22, _$createComponent(Show, {
      get when() {
        return !narrow();
      },
      get children() {
        var _el$30 = _$createElement("text");
        _$insertNode(_el$30, _$createTextNode(`Bangun, telusuri, dan perbaiki kode. Mulai dari satu instruksi.`));
        _$effect((_$p) => _$setProp(_el$30, "fg", theme().textMuted, _$p));
        return _el$30;
      }
    }), null);
    _$effect((_p$) => {
      var _v$9 = theme().primary, _v$0 = narrow() && size().height >= 40 ? "column" : "row", _v$1 = narrow() || size().height < 32 ? 14 : 28, _v$10 = theme().textMuted;
      _v$9 !== _p$.e && (_p$.e = _$setProp(_el$23, "fg", _v$9, _p$.e));
      _v$0 !== _p$.t && (_p$.t = _$setProp(_el$25, "flexDirection", _v$0, _p$.t));
      _v$1 !== _p$.a && (_p$.a = _$setProp(_el$26, "width", _v$1, _p$.a));
      _v$10 !== _p$.o && (_p$.o = _$setProp(_el$28, "fg", _v$10, _p$.o));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined
    });
    return _el$22;
  })();
}
function InfoCard(props) {
  const [open, setOpen] = createSignal2(props.api.kv.get(`studio.card.${props.name}`, props.initialOpen ?? false));
  const theme = () => props.api.theme.current;
  createEffect(() => props.onOpen?.(open()));
  const toggle = () => {
    const next = !open();
    setOpen(next);
    props.api.kv.set(`studio.card.${props.name}`, next);
  };
  const unregister = props.api.command?.register(() => [{
    title: `Studio: ${open() ? "tutup" : "buka"} ${props.title}`,
    value: `studio.card.${props.name}`,
    category: "Studio",
    slash: {
      name: `studio-${props.name}`
    },
    onSelect: (dialog) => {
      toggle();
      dialog?.clear();
    }
  }]);
  if (unregister)
    onCleanup(unregister);
  return (() => {
    var _el$32 = _$createElement("box"), _el$33 = _$createElement("box"), _el$34 = _$createElement("text"), _el$35 = _$createElement("b"), _el$36 = _$createTextNode(` `), _el$37 = _$createElement("text");
    _$insertNode(_el$32, _el$33);
    _$setProp(_el$32, "paddingLeft", 1);
    _$setProp(_el$32, "paddingRight", 1);
    _$insertNode(_el$33, _el$34);
    _$insertNode(_el$33, _el$37);
    _$setProp(_el$33, "onMouseDown", (event) => {
      if (event.button === 0) {
        event.stopPropagation();
        toggle();
      }
    });
    _$insertNode(_el$34, _el$35);
    _$insertNode(_el$35, _el$36);
    _$insert(_el$35, () => open() ? "\u25BE" : "\u25B8", _el$36);
    _$insert(_el$35, () => props.title, null);
    _$setProp(_el$37, "wrapMode", "word");
    _$insert(_el$37, () => props.summary);
    _$insert(_el$32, _$createComponent(Show, {
      get when() {
        return open();
      },
      get children() {
        var _el$38 = _$createElement("box");
        _$setProp(_el$38, "paddingTop", 1);
        _$setProp(_el$38, "paddingBottom", 1);
        _$insert(_el$38, () => props.children);
        return _el$38;
      }
    }), null);
    _$effect((_p$) => {
      var _v$11 = theme().backgroundElement, _v$12 = theme().primary, _v$13 = theme().textMuted;
      _v$11 !== _p$.e && (_p$.e = _$setProp(_el$32, "backgroundColor", _v$11, _p$.e));
      _v$12 !== _p$.t && (_p$.t = _$setProp(_el$34, "fg", _v$12, _p$.t));
      _v$13 !== _p$.a && (_p$.a = _$setProp(_el$37, "fg", _v$13, _p$.a));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined
    });
    return _el$32;
  })();
}
function SubagentCard(props) {
  const [data, setData] = createSignal2();
  const [error, setError] = createSignal2("");
  const [now, setNow] = createSignal2(Date.now());
  const theme = () => props.api.theme.current;
  createEffect(() => {
    const id = props.agent.id;
    const ended = props.ended;
    const controller = new AbortController;
    let pending = false;
    setData(undefined);
    setError("");
    const refresh = async () => {
      if (pending)
        return;
      pending = true;
      try {
        const next = await fetchSubagent(props.api, id, controller.signal);
        if (!controller.signal.aborted) {
          setData(next);
          setError("");
        }
      } catch {
        if (!controller.signal.aborted)
          setError("Detail belum tersedia; mencoba lagi.");
      } finally {
        pending = false;
      }
    };
    refresh();
    const poll = ended ? undefined : setInterval(() => void refresh(), 5000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => {
      controller.abort();
      clearInterval(poll);
      clearInterval(clock);
    });
  });
  return _$createComponent(InfoCard, {
    get api() {
      return props.api;
    },
    get name() {
      return `agent-${props.agent.id}`;
    },
    get title() {
      return `${props.agent.name} \xB7 ${props.ended ? "Baru berakhir" : props.agent.label}`;
    },
    get summary() {
      return `${data()?.model ?? "Memuat model\u2026"}
${elapsedLabel(data()?.started, props.ended ?? now())} sejak sesi dibuat`;
    },
    get children() {
      return [_$createComponent(Show, {
        get when() {
          return props.agent.target;
        },
        get children() {
          var _el$39 = _$createElement("text");
          _$setProp(_el$39, "wrapMode", "word");
          _$insert(_el$39, () => props.agent.target);
          _$effect((_$p) => _$setProp(_el$39, "fg", theme().text, _$p));
          return _el$39;
        }
      }), _$createComponent(Show, {
        get when() {
          return error();
        },
        get children() {
          var _el$40 = _$createElement("text");
          _$insert(_el$40, error);
          _$effect((_$p) => _$setProp(_el$40, "fg", theme().warning, _$p));
          return _el$40;
        }
      }), _$createComponent(Show, {
        get when() {
          return data();
        },
        children: (detail) => (() => {
          var _el$41 = _$createElement("box"), _el$42 = _$createElement("text"), _el$44 = _$createElement("text");
          _$insertNode(_el$41, _el$42);
          _$insertNode(_el$41, _el$44);
          _$setProp(_el$41, "gap", 1);
          _$setProp(_el$42, "wrapMode", "word");
          _$insert(_el$42, (() => {
            var _c$ = _$memo(() => !!detail().activity);
            return () => _c$() ? `${detail().current ? "Sekarang" : "Terakhir"} \xB7 ${detail().activity.action} \xB7 ${detail().activity.status}` : "Aktivitas tool belum dilaporkan.";
          })());
          _$insert(_el$41, _$createComponent(Show, {
            get when() {
              return detail().activity?.target;
            },
            get children() {
              var _el$43 = _$createElement("text");
              _$setProp(_el$43, "wrapMode", "char");
              _$insert(_el$43, () => detail().activity?.target);
              _$effect((_$p) => _$setProp(_el$43, "fg", theme().textMuted, _$p));
              return _el$43;
            }
          }), _el$44);
          _$insert(_el$44, (() => {
            var _c$2 = _$memo(() => !!detail().todos.length);
            return () => _c$2() ? `${detail().completed}/${detail().todos.length} tugas selesai` : "Progres tugas belum dilaporkan.";
          })());
          _$insert(_el$41, _$createComponent(For, {
            get each() {
              return detail().todos;
            },
            children: (todo) => (() => {
              var _el$45 = _$createElement("text"), _el$46 = _$createTextNode(` `);
              _$insertNode(_el$45, _el$46);
              _$setProp(_el$45, "wrapMode", "word");
              _$insert(_el$45, (() => {
                var _c$3 = _$memo(() => todo.status === "completed");
                return () => _c$3() ? "\u2713" : todo.status === "in_progress" ? "\u203A" : "\xB7";
              })(), _el$46);
              _$insert(_el$45, () => todo.content, null);
              _$effect((_$p) => _$setProp(_el$45, "fg", todo.status === "in_progress" ? theme().text : theme().textMuted, _$p));
              return _el$45;
            })()
          }), null);
          _$effect((_p$) => {
            var _v$14 = theme().text, _v$15 = theme().textMuted;
            _v$14 !== _p$.e && (_p$.e = _$setProp(_el$42, "fg", _v$14, _p$.e));
            _v$15 !== _p$.t && (_p$.t = _$setProp(_el$44, "fg", _v$15, _p$.t));
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
          return _el$41;
        })()
      })];
    }
  });
}
function WorkspaceCard(props) {
  const [open, setOpen] = createSignal2(false);
  const [data, setData] = createSignal2();
  const [error, setError] = createSignal2("");
  const theme = () => props.api.theme.current;
  createEffect(() => {
    const root = props.api.state.path.directory;
    setData(undefined);
    setError("");
    if (!open())
      return;
    const controller = new AbortController;
    let pending = false;
    const refresh = async () => {
      if (pending)
        return;
      pending = true;
      try {
        const next = await inspectWorkspace(root, controller.signal);
        if (!controller.signal.aborted) {
          setData(next);
          setError("");
        }
      } catch {
        if (!controller.signal.aborted)
          setError("Pemindaian Git gagal. Periksa akses folder dan instalasi Git.");
      } finally {
        pending = false;
      }
    };
    refresh();
    const timer = setInterval(() => void refresh(), 15000);
    onCleanup(() => {
      controller.abort();
      clearInterval(timer);
    });
  });
  return _$createComponent(InfoCard, {
    get api() {
      return props.api;
    },
    name: "files",
    title: "Ruang kerja & berkas",
    onOpen: setOpen,
    get summary() {
      return error() || (data() ? `${data().repos.length} repo Git \xB7 ${data().repos.reduce((n, repo) => n + repo.files.length, 0)} entri berubah` : open() ? "Memindai repositori\u2026" : "Buka untuk memindai repo root dan subfolder");
    },
    get children() {
      return [(() => {
        var _el$47 = _$createElement("text");
        _$setProp(_el$47, "wrapMode", "char");
        _$insert(_el$47, () => props.api.state.path.directory);
        _$effect((_$p) => _$setProp(_el$47, "fg", theme().textMuted, _$p));
        return _el$47;
      })(), (() => {
        var _el$48 = _$createElement("text");
        _$insertNode(_el$48, _$createTextNode(`Git lokal, bukan hanya perubahan sesi \xB7 refresh 15 dtk`));
        _$effect((_$p) => _$setProp(_el$48, "fg", theme().textMuted, _$p));
        return _el$48;
      })(), _$createComponent(Show, {
        get when() {
          return data();
        },
        children: (scan) => (() => {
          var _el$52 = _$createElement("box");
          _$setProp(_el$52, "gap", 1);
          _$insert(_el$52, _$createComponent(For, {
            get each() {
              return scan().repos;
            },
            get fallback() {
              return (() => {
                var _el$55 = _$createElement("text");
                _$insertNode(_el$55, _$createTextNode(`Tidak ditemukan repo Git dalam cakupan pemindaian.`));
                _$effect((_$p) => _$setProp(_el$55, "fg", theme().textMuted, _$p));
                return _el$55;
              })();
            },
            children: (repo) => (() => {
              var _el$57 = _$createElement("box"), _el$58 = _$createElement("text"), _el$59 = _$createElement("b"), _el$60 = _$createTextNode(` \xB7 `);
              _$insertNode(_el$57, _el$58);
              _$insertNode(_el$58, _el$59);
              _$insertNode(_el$58, _el$60);
              _$setProp(_el$58, "wrapMode", "char");
              _$insert(_el$59, () => repo.path);
              _$insert(_el$58, () => repo.branch, null);
              _$insert(_el$57, _$createComponent(Show, {
                get when() {
                  return repo.error;
                },
                get fallback() {
                  return (() => {
                    var _el$62 = _$createElement("text");
                    _$insert(_el$62, (() => {
                      var _c$4 = _$memo(() => !!repo.files.length);
                      return () => _c$4() ? `${repo.files.length} entri berubah` : "Working tree bersih";
                    })());
                    _$effect((_$p) => _$setProp(_el$62, "fg", theme().textMuted, _$p));
                    return _el$62;
                  })();
                },
                get children() {
                  var _el$61 = _$createElement("text");
                  _$insert(_el$61, () => repo.error);
                  _$effect((_$p) => _$setProp(_el$61, "fg", theme().warning, _$p));
                  return _el$61;
                }
              }), null);
              _$insert(_el$57, _$createComponent(For, {
                get each() {
                  return repo.files;
                },
                children: (file) => (() => {
                  var _el$63 = _$createElement("text"), _el$64 = _$createTextNode(` `);
                  _$insertNode(_el$63, _el$64);
                  _$setProp(_el$63, "wrapMode", "char");
                  _$insert(_el$63, () => file.status, _el$64);
                  _$insert(_el$63, () => file.path, null);
                  _$effect((_$p) => _$setProp(_el$63, "fg", theme().text, _$p));
                  return _el$63;
                })()
              }), null);
              _$effect((_$p) => _$setProp(_el$58, "fg", theme().primary, _$p));
              return _el$57;
            })()
          }), null);
          _$insert(_el$52, _$createComponent(For, {
            get each() {
              return scan().errors;
            },
            children: (message) => (() => {
              var _el$65 = _$createElement("text");
              _$insert(_el$65, message);
              _$effect((_$p) => _$setProp(_el$65, "fg", theme().warning, _$p));
              return _el$65;
            })()
          }), null);
          _$insert(_el$52, _$createComponent(Show, {
            get when() {
              return scan().limited;
            },
            get children() {
              var _el$53 = _$createElement("text");
              _$insertNode(_el$53, _$createTextNode(`Cakupan dibatasi 4 tingkat / 300 folder.`));
              _$effect((_$p) => _$setProp(_el$53, "fg", theme().warning, _$p));
              return _el$53;
            }
          }), null);
          return _el$52;
        })()
      }), (() => {
        var _el$50 = _$createElement("text"), _el$51 = _$createTextNode(` berkas tercatat terpisah oleh sesi OpenCode.`);
        _$insertNode(_el$50, _el$51);
        _$insert(_el$50, () => props.api.state.session.diff(props.id).length, _el$51);
        _$effect((_$p) => _$setProp(_el$50, "fg", theme().textMuted, _$p));
        return _el$50;
      })()];
    }
  });
}
function Overview(props) {
  const theme = () => props.api.theme.current;
  const data = createMemo(() => sessionMetrics(props.api, props.id));
  const activity = createMemo(() => sidebarActivity(props.api, props.id));
  const calls = createMemo(() => new Map(props.api.state.session.messages(props.id).flatMap((message) => props.api.state.part(message.id).filter((part) => part.type === "tool")).map((part) => [part.callID, part])));
  const detail = (tool) => activityDetail(calls().get(tool.callID) ?? tool);
  const mcp = retainActivity(() => activity().mcp, (server) => server.name, () => props.id);
  const agents = retainActivity(() => activity().agents, (agent) => agent.id, () => props.id);
  const tools = retainActivity(() => activity().tools, (tool) => tool.callID, () => props.id);
  const size = useTerminalDimensions();
  const limit = () => size().height < 35 ? 2 : 4;
  return (() => {
    var _el$66 = _$createElement("box"), _el$67 = _$createElement("box"), _el$68 = _$createElement("text"), _el$69 = _$createElement("b"), _el$70 = _$createElement("text"), _el$71 = _$createTextNode(` \xB7 `);
    _$insertNode(_el$66, _el$67);
    _$setProp(_el$66, "gap", 1);
    _$setProp(_el$66, "flexShrink", 0);
    _$insertNode(_el$67, _el$68);
    _$insertNode(_el$67, _el$70);
    _$insertNode(_el$68, _el$69);
    _$setProp(_el$68, "wrapMode", "char");
    _$insert(_el$69, () => data().model);
    _$insertNode(_el$70, _el$71);
    _$insert(_el$70, () => data().agent ?? "Sesi baru", _el$71);
    _$insert(_el$70, (() => {
      var _c$5 = _$memo(() => activity().status?.type === "busy");
      return () => _c$5() ? "Bekerja" : activity().status?.type === "retry" ? "Mencoba ulang" : "Siap";
    })(), null);
    _$insert(_el$66, _$createComponent(ObservedWait, {
      get reason() {
        return waitingReason(props.api, props.id, activity(), props.compacting);
      },
      get session() {
        return props.id;
      }
    }), null);
    _$insert(_el$66, _$createComponent(Companion, {
      get api() {
        return props.api;
      },
      get activity() {
        return activity();
      },
      get motion() {
        return props.motion;
      },
      get compacting() {
        return props.compacting;
      },
      get mini() {
        return props.mini;
      },
      hideActivity: true
    }), null);
    _$insert(_el$66, _$createComponent(Show, {
      get when() {
        return activity().attention > 0;
      },
      get children() {
        var _el$72 = _$createElement("box"), _el$73 = _$createElement("text"), _el$74 = _$createElement("b"), _el$75 = _$createTextNode(`Butuh jawaban \xB7 `), _el$76 = _$createElement("text");
        _$insertNode(_el$72, _el$73);
        _$insertNode(_el$72, _el$76);
        _$insertNode(_el$73, _el$74);
        _$insertNode(_el$74, _el$75);
        _$insert(_el$74, () => activity().attention, null);
        _$insertNode(_el$76, _$createTextNode(`Periksa permintaan di percakapan.`));
        _$effect((_p$) => {
          var _v$16 = theme().warning, _v$17 = theme().textMuted;
          _v$16 !== _p$.e && (_p$.e = _$setProp(_el$73, "fg", _v$16, _p$.e));
          _v$17 !== _p$.t && (_p$.t = _$setProp(_el$76, "fg", _v$17, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$72;
      }
    }), null);
    _$insert(_el$66, _$createComponent(InfoCard, {
      get api() {
        return props.api;
      },
      name: "connections",
      title: "Koneksi MCP",
      initialOpen: true,
      get summary() {
        return `${props.api.state.mcp().filter((server) => server.status === "connected").length}/${props.api.state.mcp().length} terhubung \xB7 ${activity().mcp.length} sedang dipakai`;
      },
      get children() {
        return [_$createComponent(Show, {
          get when() {
            return mcp().length > 0;
          },
          get children() {
            var _el$78 = _$createElement("box"), _el$79 = _$createElement("text"), _el$80 = _$createElement("b");
            _$insertNode(_el$78, _el$79);
            _$insertNode(_el$79, _el$80);
            _$insertNode(_el$80, _$createTextNode(`MCP sedang dipakai / terakhir`));
            _$insert(_el$78, _$createComponent(For, {
              get each() {
                return mcp().slice(0, limit());
              },
              children: (row) => (() => {
                var _el$113 = _$createElement("box"), _el$114 = _$createElement("text"), _el$115 = _$createTextNode(` \xB7 `);
                _$insertNode(_el$113, _el$114);
                _$insertNode(_el$114, _el$115);
                _$setProp(_el$114, "wrapMode", "char");
                _$insert(_el$114, () => row.item.name, _el$115);
                _$insert(_el$114, (() => {
                  var _c$6 = _$memo(() => row.ended === undefined);
                  return () => _c$6() ? `${row.item.calls.length} panggilan` : "Baru berakhir";
                })(), null);
                _$insert(_el$113, _$createComponent(For, {
                  get each() {
                    return row.item.calls.slice(0, 2);
                  },
                  children: (call) => (() => {
                    var _el$116 = _$createElement("text"), _el$117 = _$createTextNode(` \xB7 `);
                    _$insertNode(_el$116, _el$117);
                    _$setProp(_el$116, "wrapMode", "word");
                    _$insert(_el$116, () => detail(call).status, _el$117);
                    _$insert(_el$116, () => detail(call).action, null);
                    _$insert(_el$116, (() => {
                      var _c$7 = _$memo(() => !!detail(call).target);
                      return () => _c$7() ? ` \xB7 ${detail(call).target}` : "";
                    })(), null);
                    _$effect((_$p) => _$setProp(_el$116, "fg", theme().textMuted, _$p));
                    return _el$116;
                  })()
                }), null);
                _$effect((_$p) => _$setProp(_el$114, "fg", theme().text, _$p));
                return _el$113;
              })()
            }), null);
            _$insert(_el$78, _$createComponent(Show, {
              get when() {
                return mcp().length > limit();
              },
              get children() {
                var _el$82 = _$createElement("text"), _el$83 = _$createTextNode(`+`), _el$84 = _$createTextNode(` MCP lainnya`);
                _$insertNode(_el$82, _el$83);
                _$insertNode(_el$82, _el$84);
                _$insert(_el$82, () => mcp().length - limit(), _el$84);
                _$effect((_$p) => _$setProp(_el$82, "fg", theme().textMuted, _$p));
                return _el$82;
              }
            }), null);
            _$effect((_$p) => _$setProp(_el$79, "fg", theme().primary, _$p));
            return _el$78;
          }
        }), _$createComponent(For, {
          get each() {
            return props.api.state.mcp().filter((server) => !mcp().some((row) => row.item.name === server.name));
          },
          children: (server) => (() => {
            var _el$118 = _$createElement("text"), _el$119 = _$createTextNode(` \xB7 `);
            _$insertNode(_el$118, _el$119);
            _$setProp(_el$118, "wrapMode", "char");
            _$insert(_el$118, () => server.name, _el$119);
            _$insert(_el$118, (() => {
              var _c$8 = _$memo(() => server.status === "connected");
              return () => _c$8() ? "Terhubung \xB7 tidak sedang dipakai" : server.status;
            })(), null);
            _$effect((_$p) => _$setProp(_el$118, "fg", server.status === "connected" ? theme().textMuted : theme().warning, _$p));
            return _el$118;
          })()
        }), _$createComponent(Show, {
          get when() {
            return !props.api.state.mcp().length;
          },
          get children() {
            var _el$85 = _$createElement("text");
            _$insertNode(_el$85, _$createTextNode(`Tidak ada server MCP.`));
            _$effect((_$p) => _$setProp(_el$85, "fg", theme().textMuted, _$p));
            return _el$85;
          }
        })];
      }
    }), null);
    _$insert(_el$66, _$createComponent(Show, {
      get when() {
        return agents().length > 0;
      },
      get children() {
        var _el$87 = _$createElement("box"), _el$88 = _$createElement("text"), _el$89 = _$createElement("b"), _el$90 = _$createTextNode(`Subagent \xB7 `);
        _$insertNode(_el$87, _el$88);
        _$insertNode(_el$88, _el$89);
        _$insertNode(_el$89, _el$90);
        _$insert(_el$89, () => agents().length, null);
        _$insert(_el$87, _$createComponent(For, {
          get each() {
            return agents().slice(0, limit());
          },
          children: (row) => _$createComponent(SubagentCard, {
            get api() {
              return props.api;
            },
            get agent() {
              return row.item;
            },
            get ended() {
              return row.ended;
            }
          })
        }), null);
        _$insert(_el$87, _$createComponent(Show, {
          get when() {
            return agents().length > limit();
          },
          get children() {
            var _el$91 = _$createElement("text"), _el$92 = _$createTextNode(`+`), _el$93 = _$createTextNode(` agent lainnya`);
            _$insertNode(_el$91, _el$92);
            _$insertNode(_el$91, _el$93);
            _$insert(_el$91, () => agents().length - limit(), _el$93);
            _$effect((_$p) => _$setProp(_el$91, "fg", theme().textMuted, _$p));
            return _el$91;
          }
        }), null);
        _$effect((_$p) => _$setProp(_el$88, "fg", theme().primary, _$p));
        return _el$87;
      }
    }), null);
    _$insert(_el$66, _$createComponent(InfoCard, {
      get api() {
        return props.api;
      },
      name: "result",
      title: "Aktivitas & hasil",
      initialOpen: true,
      get summary() {
        return _$memo(() => !!activity().current)() ? `${activityDetail(activity().current).action} \xB7 ${activityDetail(activity().current).status}` : _$memo(() => !!activity().latest)() ? `${activityDetail(activity().latest).action} \xB7 ${activityDetail(activity().latest).status}` : "Belum ada aktivitas tool";
      },
      get children() {
        return [_$createComponent(Show, {
          get when() {
            return tools().length > 0;
          },
          get children() {
            var _el$94 = _$createElement("box");
            _$insert(_el$94, _$createComponent(For, {
              get each() {
                return tools().slice(0, limit());
              },
              children: (row) => (() => {
                var _el$120 = _$createElement("box"), _el$121 = _$createElement("text"), _el$122 = _$createTextNode(` \xB7 `);
                _$insertNode(_el$120, _el$121);
                _$insertNode(_el$121, _el$122);
                _$setProp(_el$121, "wrapMode", "word");
                _$insert(_el$121, () => detail(row.item).action, _el$122);
                _$insert(_el$121, () => detail(row.item).status, null);
                _$insert(_el$121, (() => {
                  var _c$9 = _$memo(() => !!detail(row.item).target);
                  return () => _c$9() ? ` \xB7 ${detail(row.item).target}` : "";
                })(), null);
                _$insert(_el$120, _$createComponent(Show, {
                  get when() {
                    return detail(row.item).result;
                  },
                  get children() {
                    var _el$123 = _$createElement("text");
                    _$setProp(_el$123, "wrapMode", "word");
                    _$insert(_el$123, () => detail(row.item).result);
                    _$effect((_$p) => _$setProp(_el$123, "fg", theme().textMuted, _$p));
                    return _el$123;
                  }
                }), null);
                _$effect((_$p) => _$setProp(_el$121, "fg", theme().text, _$p));
                return _el$120;
              })()
            }), null);
            _$insert(_el$94, _$createComponent(Show, {
              get when() {
                return tools().length > limit();
              },
              get children() {
                var _el$95 = _$createElement("text"), _el$96 = _$createTextNode(`+`), _el$97 = _$createTextNode(` tool lainnya`);
                _$insertNode(_el$95, _el$96);
                _$insertNode(_el$95, _el$97);
                _$insert(_el$95, () => tools().length - limit(), _el$97);
                _$effect((_$p) => _$setProp(_el$95, "fg", theme().textMuted, _$p));
                return _el$95;
              }
            }), null);
            return _el$94;
          }
        }), _$createComponent(Show, {
          get when() {
            return _$memo(() => !!(activity().latest && !tools().slice(0, limit()).some((row) => row.item.callID === activity().latest?.callID) && !mcp().some((row) => row.item.calls.some((call) => call.callID === activity().latest?.callID)) && !["task", "subagent"].includes(activity().latest.tool)))() ? activity().latest : undefined;
          },
          children: (latest) => (() => {
            var _el$124 = _$createElement("box"), _el$125 = _$createElement("text"), _el$126 = _$createElement("text");
            _$insertNode(_el$124, _el$125);
            _$insertNode(_el$124, _el$126);
            _$setProp(_el$125, "wrapMode", "word");
            _$insert(_el$125, () => activityDetail(latest()).target || activityDetail(latest()).action);
            _$setProp(_el$126, "wrapMode", "word");
            _$insert(_el$126, () => activityDetail(latest()).result || "Masih diproses; belum ada hasil akhir.");
            _$effect((_p$) => {
              var _v$20 = theme().text, _v$21 = theme().textMuted;
              _v$20 !== _p$.e && (_p$.e = _$setProp(_el$125, "fg", _v$20, _p$.e));
              _v$21 !== _p$.t && (_p$.t = _$setProp(_el$126, "fg", _v$21, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$124;
          })()
        }), (() => {
          var _el$98 = _$createElement("text");
          _$insertNode(_el$98, _$createTextNode(`Hasil tes: lihat keluaran pengujian di percakapan; status tool bukan bukti tes lulus.`));
          _$setProp(_el$98, "wrapMode", "word");
          _$effect((_$p) => _$setProp(_el$98, "fg", theme().textMuted, _$p));
          return _el$98;
        })()];
      }
    }), null);
    _$insert(_el$66, _$createComponent(InfoCard, {
      get api() {
        return props.api;
      },
      name: "context",
      title: "Laporan token provider",
      get summary() {
        return _$memo(() => data().used === undefined)() ? "Token belum dilaporkan" : `${compact(data().used ?? NaN)} token \xB7 laporan terakhir`;
      },
      get children() {
        return [(() => {
          var _el$100 = _$createElement("text"), _el$101 = _$createTextNode(`Provider \xB7 `);
          _$insertNode(_el$100, _el$101);
          _$setProp(_el$100, "wrapMode", "char");
          _$insert(_el$100, () => data().provider, null);
          _$effect((_$p) => _$setProp(_el$100, "fg", theme().textMuted, _$p));
          return _el$100;
        })(), (() => {
          var _el$102 = _$createElement("text");
          _$insertNode(_el$102, _$createTextNode(`Konteks aktif DCP \xB7 belum diukur`));
          _$effect((_$p) => _$setProp(_el$102, "fg", theme().textMuted, _$p));
          return _el$102;
        })(), (() => {
          var _el$104 = _$createElement("text");
          _$insertNode(_el$104, _$createTextNode(`Laporan ini menjumlahkan input, output, reasoning, dan cache dari pesan model terakhir yang melaporkan penggunaan.`));
          _$setProp(_el$104, "wrapMode", "word");
          _$effect((_$p) => _$setProp(_el$104, "fg", theme().textMuted, _$p));
          return _el$104;
        })(), (() => {
          var _el$106 = _$createElement("text");
          _$insertNode(_el$106, _$createTextNode(`Periksa /dcp untuk statistik kompresi. Angka provider bukan ukuran pesan yang akan dikirim sesudah DCP.`));
          _$setProp(_el$106, "wrapMode", "word");
          _$effect((_$p) => _$setProp(_el$106, "fg", theme().textMuted, _$p));
          return _el$106;
        })(), (() => {
          var _el$108 = _$createElement("text"), _el$109 = _$createTextNode(`Biaya tercatat \xB7 $`);
          _$insertNode(_el$108, _el$109);
          _$insert(_el$108, () => data().cost.toFixed(4), null);
          _$effect((_$p) => _$setProp(_el$108, "fg", theme().textMuted, _$p));
          return _el$108;
        })()];
      }
    }), null);
    _$insert(_el$66, _$createComponent(InfoCard, {
      get api() {
        return props.api;
      },
      name: "progress",
      title: "Progres tugas",
      initialOpen: true,
      get summary() {
        return `${activity().completed}/${activity().total} selesai \xB7 ${activity().todos.length} tersisa`;
      },
      get children() {
        return _$createComponent(Show, {
          get when() {
            return activity().total > 0;
          },
          get fallback() {
            return (() => {
              var _el$127 = _$createElement("text");
              _$insertNode(_el$127, _$createTextNode(`Belum ada daftar tugas di sesi ini.`));
              _$effect((_$p) => _$setProp(_el$127, "fg", theme().textMuted, _$p));
              return _el$127;
            })();
          },
          get children() {
            return [(() => {
              var _el$110 = _$createElement("text"), _el$111 = _$createTextNode(` berjalan \xB7 `), _el$112 = _$createTextNode(` antre`);
              _$insertNode(_el$110, _el$111);
              _$insertNode(_el$110, _el$112);
              _$insert(_el$110, () => activity().todos.filter((todo) => todo.status === "in_progress").length, _el$111);
              _$insert(_el$110, () => activity().todos.filter((todo) => todo.status === "pending").length, _el$112);
              _$effect((_$p) => _$setProp(_el$110, "fg", theme().textMuted, _$p));
              return _el$110;
            })(), _$createComponent(For, {
              get each() {
                return [...props.api.state.session.todo(props.id)].sort((a, b) => ({
                  in_progress: 0,
                  pending: 1,
                  completed: 2
                }[a.status] ?? 3) - ({
                  in_progress: 0,
                  pending: 1,
                  completed: 2
                }[b.status] ?? 3));
              },
              children: (todo) => (() => {
                var _el$129 = _$createElement("box"), _el$130 = _$createElement("text"), _el$131 = _$createElement("text");
                _$insertNode(_el$129, _el$130);
                _$insertNode(_el$129, _el$131);
                _$setProp(_el$129, "marginTop", 1);
                _$insert(_el$130, (() => {
                  var _c$0 = _$memo(() => todo.status === "completed");
                  return () => _c$0() ? "\u2713 Selesai" : todo.status === "in_progress" ? "\u203A Sedang dikerjakan" : "\xB7 Menunggu";
                })());
                _$setProp(_el$131, "wrapMode", "word");
                _$insert(_el$131, () => todo.content);
                _$effect((_p$) => {
                  var _v$22 = todo.status === "in_progress" ? theme().primary : theme().textMuted, _v$23 = todo.status === "completed" ? theme().textMuted : theme().text;
                  _v$22 !== _p$.e && (_p$.e = _$setProp(_el$130, "fg", _v$22, _p$.e));
                  _v$23 !== _p$.t && (_p$.t = _$setProp(_el$131, "fg", _v$23, _p$.t));
                  return _p$;
                }, {
                  e: undefined,
                  t: undefined
                });
                return _el$129;
              })()
            })];
          }
        });
      }
    }), null);
    _$insert(_el$66, _$createComponent(WorkspaceCard, {
      get api() {
        return props.api;
      },
      get id() {
        return props.id;
      }
    }), null);
    _$effect((_p$) => {
      var _v$18 = theme().text, _v$19 = theme().textMuted;
      _v$18 !== _p$.e && (_p$.e = _$setProp(_el$68, "fg", _v$18, _p$.e));
      _v$19 !== _p$.t && (_p$.t = _$setProp(_el$70, "fg", _v$19, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$66;
  })();
}
function SidebarPresence(props) {
  onMount(() => props.visible(true));
  onCleanup(() => props.visible(false));
  return props.children;
}
function ResponsiveDock(props) {
  const size = useTerminalDimensions();
  const activity = createMemo(() => sidebarActivity(props.api, props.id));
  const data = createMemo(() => sessionMetrics(props.api, props.id));
  const theme = () => props.api.theme.current;
  const open = () => props.api.ui.dialog.replace(() => _$createComponent(props.api.ui.Dialog, {
    onClose: () => props.api.ui.dialog.clear(),
    get children() {
      var _el$132 = _$createElement("box"), _el$133 = _$createElement("text"), _el$134 = _$createElement("b"), _el$136 = _$createTextNode(` \xB7 Esc tutup`), _el$137 = _$createElement("scrollbox");
      _$insertNode(_el$132, _el$133);
      _$insertNode(_el$132, _el$137);
      _$setProp(_el$132, "padding", 1);
      _$insertNode(_el$133, _el$134);
      _$insertNode(_el$133, _el$136);
      _$insertNode(_el$134, _$createTextNode(`Studio \xB7 Detail sesi`));
      _$insert(_el$137, _$createComponent(Overview, {
        get api() {
          return props.api;
        },
        get id() {
          return props.id;
        },
        get motion() {
          return props.motion;
        },
        get compacting() {
          return props.compacting;
        },
        mini: true
      }));
      _$effect((_p$) => {
        var _v$24 = theme().primary, _v$25 = Math.max(5, size().height - 10);
        _v$24 !== _p$.e && (_p$.e = _$setProp(_el$133, "fg", _v$24, _p$.e));
        _v$25 !== _p$.t && (_p$.t = _$setProp(_el$137, "height", _v$25, _p$.t));
        return _p$;
      }, {
        e: undefined,
        t: undefined
      });
      return _el$132;
    }
  }));
  const unregister = props.api.command?.register(() => [{
    title: "Studio: buka seluruh informasi sesi",
    value: "studio.panel",
    category: "Studio",
    slash: {
      name: "studio-panel"
    },
    onSelect: () => open()
  }]);
  if (unregister)
    onCleanup(unregister);
  return _$createComponent(Show, {
    get when() {
      return !props.sidebarVisible;
    },
    get children() {
      return [_$createComponent(Show, {
        get when() {
          return _$memo(() => !!!activity().attention)() && prayerReminders.get(props.api)?.view()?.dua;
        },
        children: (dua) => _$createComponent(DuaBubble, {
          get api() {
            return props.api;
          },
          get text() {
            return dua();
          },
          compact: true
        })
      }), (() => {
        var _el$138 = _$createElement("box"), _el$139 = _$createElement("box"), _el$140 = _$createElement("box"), _el$141 = _$createElement("text"), _el$142 = _$createElement("b"), _el$143 = _$createTextNode(`STUDIO \xB7 `), _el$144 = _$createElement("text"), _el$145 = _$createElement("text"), _el$146 = _$createElement("text"), _el$147 = _$createElement("text"), _el$148 = _$createElement("text"), _el$149 = _$createElement("box"), _el$150 = _$createElement("text");
        _$insertNode(_el$138, _el$139);
        _$insertNode(_el$138, _el$140);
        _$setProp(_el$138, "flexDirection", "row");
        _$setProp(_el$138, "width", "100%");
        _$setProp(_el$138, "height", 8);
        _$setProp(_el$138, "flexShrink", 0);
        _$setProp(_el$138, "gap", 1);
        _$setProp(_el$138, "paddingLeft", 1);
        _$setProp(_el$138, "paddingRight", 1);
        _$setProp(_el$139, "width", 14);
        _$setProp(_el$139, "flexShrink", 0);
        _$insert(_el$139, _$createComponent(Companion, {
          get api() {
            return props.api;
          },
          get activity() {
            return activity();
          },
          get motion() {
            return props.motion;
          },
          get compacting() {
            return props.compacting;
          },
          mini: true,
          portraitOnly: true
        }));
        _$insertNode(_el$140, _el$141);
        _$insertNode(_el$140, _el$144);
        _$insertNode(_el$140, _el$145);
        _$insertNode(_el$140, _el$146);
        _$insertNode(_el$140, _el$147);
        _$insertNode(_el$140, _el$148);
        _$insertNode(_el$140, _el$149);
        _$setProp(_el$140, "flexGrow", 1);
        _$setProp(_el$140, "minWidth", 0);
        _$setProp(_el$140, "flexShrink", 1);
        _$insertNode(_el$141, _el$142);
        _$setProp(_el$141, "height", 1);
        _$insertNode(_el$142, _el$143);
        _$insert(_el$142, () => data().agent ?? "Sesi", null);
        _$setProp(_el$144, "height", 1);
        _$insert(_el$144, (() => {
          var _c$1 = _$memo(() => !!activity().attention);
          return () => _c$1() ? avatarState(activity(), props.compacting).label : prayerReminders.get(props.api)?.view()?.label ?? avatarState(activity(), props.compacting).label;
        })());
        _$setProp(_el$145, "height", 1);
        _$insert(_el$145, () => data().model, null);
        _$insert(_el$145, (() => {
          var _c$10 = _$memo(() => data().used === undefined);
          return () => _c$10() ? "" : ` \xB7 ${compact(data().used ?? NaN)} token (laporan)`;
        })(), null);
        _$setProp(_el$146, "height", 1);
        _$insert(_el$146, (() => {
          var _c$11 = _$memo(() => !!activity().attention);
          return () => _c$11() ? `${activity().attention} permintaan menunggu jawaban` : `MCP ${activity().mcp.length} aktif \xB7 Agent ${activity().agents.length} \xB7 Tugas ${activity().completed}/${activity().total}`;
        })());
        _$setProp(_el$147, "height", 1);
        _$insert(_el$147, (() => {
          var _c$12 = _$memo(() => !!activity().latest);
          return () => _c$12() ? `${activityDetail(activity().latest).status} \xB7 ${activityDetail(activity().latest).action}` : "Belum ada aktivitas tool";
        })());
        _$setProp(_el$148, "height", 1);
        _$insert(_el$148, (() => {
          var _c$13 = _$memo(() => !!activity().latest);
          return () => _c$13() ? activityDetail(activity().latest).target : "";
        })());
        _$insertNode(_el$149, _el$150);
        _$setProp(_el$149, "onMouseDown", (event) => {
          if (event.button === 0) {
            event.stopPropagation();
            open();
          }
        });
        _$insertNode(_el$150, _$createTextNode(`/studio-panel \xB7 detail`));
        _$setProp(_el$150, "height", 1);
        _$effect((_p$) => {
          var _v$26 = theme().backgroundPanel, _v$27 = theme().primary, _v$28 = theme().text, _v$29 = theme().textMuted, _v$30 = activity().attention ? theme().warning : theme().textMuted, _v$31 = theme().text, _v$32 = theme().textMuted, _v$33 = theme().primary;
          _v$26 !== _p$.e && (_p$.e = _$setProp(_el$138, "backgroundColor", _v$26, _p$.e));
          _v$27 !== _p$.t && (_p$.t = _$setProp(_el$141, "fg", _v$27, _p$.t));
          _v$28 !== _p$.a && (_p$.a = _$setProp(_el$144, "fg", _v$28, _p$.a));
          _v$29 !== _p$.o && (_p$.o = _$setProp(_el$145, "fg", _v$29, _p$.o));
          _v$30 !== _p$.i && (_p$.i = _$setProp(_el$146, "fg", _v$30, _p$.i));
          _v$31 !== _p$.n && (_p$.n = _$setProp(_el$147, "fg", _v$31, _p$.n));
          _v$32 !== _p$.s && (_p$.s = _$setProp(_el$148, "fg", _v$32, _p$.s));
          _v$33 !== _p$.h && (_p$.h = _$setProp(_el$150, "fg", _v$33, _p$.h));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined,
          i: undefined,
          n: undefined,
          s: undefined,
          h: undefined
        });
        return _el$138;
      })()];
    }
  });
}
function StatusBar(props) {
  const size = useTerminalDimensions();
  const theme = () => props.api.theme.current;
  const mcp = () => props.api.state.mcp();
  const plugins = () => props.api.plugins.list().filter((item) => item.source !== "internal");
  return (() => {
    var _el$152 = _$createElement("box"), _el$153 = _$createElement("text"), _el$154 = _$createElement("b"), _el$161 = _$createElement("text");
    _$insertNode(_el$152, _el$153);
    _$insertNode(_el$152, _el$161);
    _$setProp(_el$152, "flexDirection", "row");
    _$setProp(_el$152, "justifyContent", "space-between");
    _$setProp(_el$152, "paddingLeft", 1);
    _$setProp(_el$152, "paddingRight", 1);
    _$setProp(_el$152, "width", "100%");
    _$insertNode(_el$153, _el$154);
    _$insertNode(_el$154, _$createTextNode(`STUDIO`));
    _$insert(_el$152, _$createComponent(Show, {
      get when() {
        return size().width >= 65;
      },
      get children() {
        var _el$156 = _$createElement("text"), _el$157 = _$createTextNode(`/`), _el$158 = _$createTextNode(` MCP \xB7 `), _el$159 = _$createTextNode(`/`), _el$160 = _$createTextNode(` plugin TUI aktif`);
        _$insertNode(_el$156, _el$157);
        _$insertNode(_el$156, _el$158);
        _$insertNode(_el$156, _el$159);
        _$insertNode(_el$156, _el$160);
        _$insert(_el$156, () => mcp().filter((item) => item.status === "connected").length, _el$157);
        _$insert(_el$156, () => mcp().length, _el$158);
        _$insert(_el$156, () => plugins().filter((item) => item.active).length, _el$159);
        _$insert(_el$156, () => plugins().length, _el$160);
        _$effect((_$p) => _$setProp(_el$156, "fg", theme().textMuted, _$p));
        return _el$156;
      }
    }), _el$161);
    _$insert(_el$161, () => props.api.state.vcs?.branch ?? "lokal");
    _$effect((_p$) => {
      var _v$34 = theme().backgroundPanel, _v$35 = theme().primary, _v$36 = theme().textMuted;
      _v$34 !== _p$.e && (_p$.e = _$setProp(_el$152, "backgroundColor", _v$34, _p$.e));
      _v$35 !== _p$.t && (_p$.t = _$setProp(_el$153, "fg", _v$35, _p$.t));
      _v$36 !== _p$.a && (_p$.a = _$setProp(_el$161, "fg", _v$36, _p$.a));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined
    });
    return _el$152;
  })();
}
var plugin = {
  id: "saffteen-studio",
  tui: async (api, options) => {
    prayerReminders.set(api, createPrayerReminder(api, options?.prayer, prayerDesktopNotification));
    api.lifecycle.onDispose(() => {
      prayerReminders.delete(api);
    });
    attentionFeedback(api);
    visualFeedback(api);
    const compacting = compactionMonitor(api);
    const [sidebarVisible, setSidebarVisible] = createSignal2(false);
    const sessionID = () => {
      const route = api.route.current;
      return route.name === "session" && typeof route.params?.sessionID === "string" ? route.params.sessionID : undefined;
    };
    const [motion, setMotion] = createSignal2(options?.motion !== false);
    const unregister = api.command?.register(() => [{
      title: motion() ? "Studio: matikan animasi avatar" : "Studio: aktifkan animasi avatar",
      value: "studio.avatar.motion",
      category: "Studio",
      slash: {
        name: "studio-motion"
      },
      onSelect: (dialog) => {
        setMotion((value) => !value);
        dialog?.clear();
      }
    }]);
    if (unregister)
      api.lifecycle.onDispose(unregister);
    api.slots.register({
      order: 10,
      slots: {
        home_logo() {
          return _$createComponent(Welcome, {
            api,
            get motion() {
              return motion();
            }
          });
        },
        home_bottom() {
          return (() => {
            var _el$162 = _$createElement("box"), _el$163 = _$createElement("text");
            _$insertNode(_el$162, _el$163);
            _$setProp(_el$162, "width", "100%");
            _$setProp(_el$162, "maxWidth", 96);
            _$setProp(_el$162, "paddingLeft", 2);
            _$setProp(_el$162, "paddingRight", 2);
            _$setProp(_el$162, "marginTop", 1);
            _$insertNode(_el$163, _$createTextNode(`/ perintah \xB7 @ berkas & agent \xB7 ! shell`));
            _$effect((_$p) => _$setProp(_el$163, "fg", api.theme.current.textMuted, _$p));
            return _el$162;
          })();
        },
        home_footer() {
          return (() => {
            var _el$165 = _$createElement("text"), _el$166 = _$createTextNode(`SAFFTEEN STUDIO / OpenCode `);
            _$insertNode(_el$165, _el$166);
            _$insert(_el$165, () => api.app.version, null);
            _$effect((_$p) => _$setProp(_el$165, "fg", api.theme.current.textMuted, _$p));
            return _el$165;
          })();
        },
        sidebar_title(_ctx, props) {
          return (() => {
            var _el$167 = _$createElement("box"), _el$168 = _$createElement("text"), _el$169 = _$createElement("b"), _el$171 = _$createElement("text"), _el$172 = _$createElement("b");
            _$insertNode(_el$167, _el$168);
            _$insertNode(_el$167, _el$171);
            _$setProp(_el$167, "gap", 1);
            _$setProp(_el$167, "paddingBottom", 1);
            _$insertNode(_el$168, _el$169);
            _$insertNode(_el$169, _$createTextNode(`STUDIO / SESI`));
            _$insertNode(_el$171, _el$172);
            _$setProp(_el$171, "wrapMode", "word");
            _$insert(_el$172, () => props.title);
            _$insert(_el$167, _$createComponent(Show, {
              get when() {
                return props.share_url;
              },
              get children() {
                var _el$173 = _$createElement("text");
                _$setProp(_el$173, "wrapMode", "char");
                _$insert(_el$173, () => props.share_url);
                _$effect((_$p) => _$setProp(_el$173, "fg", api.theme.current.textMuted, _$p));
                return _el$173;
              }
            }), null);
            _$effect((_p$) => {
              var _v$37 = api.theme.current.primary, _v$38 = api.theme.current.text;
              _v$37 !== _p$.e && (_p$.e = _$setProp(_el$168, "fg", _v$37, _p$.e));
              _v$38 !== _p$.t && (_p$.t = _$setProp(_el$171, "fg", _v$38, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$167;
          })();
        },
        sidebar_content(_ctx, props) {
          return _$createComponent(SidebarPresence, {
            visible: setSidebarVisible,
            get children() {
              return _$createComponent(Overview, {
                api,
                get id() {
                  return props.session_id;
                },
                get motion() {
                  return motion();
                },
                get compacting() {
                  return compacting(props.session_id);
                }
              });
            }
          });
        },
        sidebar_footer() {
          return (() => {
            var _el$174 = _$createElement("text");
            _$insertNode(_el$174, _$createTextNode(`SAFFTEEN STUDIO \xB7 0.1`));
            _$effect((_$p) => _$setProp(_el$174, "fg", api.theme.current.textMuted, _$p));
            return _el$174;
          })();
        },
        app_bottom() {
          return (() => {
            var _el$176 = _$createElement("box");
            _$setProp(_el$176, "flexShrink", 0);
            _$insert(_el$176, _$createComponent(Show, {
              get when() {
                return sessionID();
              },
              children: (id) => _$createComponent(ResponsiveDock, {
                api,
                get id() {
                  return id();
                },
                get sidebarVisible() {
                  return sidebarVisible();
                },
                get motion() {
                  return motion();
                },
                get compacting() {
                  return compacting(id());
                }
              })
            }), null);
            _$insert(_el$176, _$createComponent(StatusBar, {
              api
            }), null);
            return _el$176;
          })();
        }
      }
    });
  }
};
var tui_default = plugin;
export {
  Companion,
  DuaBubble,
  InfoCard,
  ObservedWait,
  Overview,
  ResponsiveDock,
  SidebarPresence,
  SubagentCard,
  Welcome,
  WorkspaceCard,
  attentionFeedback,
  compactionMonitor,
  tui_default as default,
  desktopNotification,
  holdKeyboardPose,
  retainActivity,
  visualFeedback,
  waitingReason
};
