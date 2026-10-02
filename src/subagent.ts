import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Message, Part, Session, Todo } from "@opencode-ai/sdk/v2"
import { activityDetail } from "./model"

export function subagentDetails(session: Session | undefined, messages: { info: Message; parts: Part[] }[], todos: Todo[]) {
  const assistant = [...messages].reverse().find((entry) => entry.info.role === "assistant")?.info
  const tools = messages.flatMap((entry) => entry.parts.filter((part) => part.type === "tool"))
  const current = [...tools].reverse().find((part) => part.state.status === "running" || part.state.status === "pending")
  const latest = current ?? tools.at(-1)
  return {
    model: assistant?.role === "assistant" ? `${assistant.providerID} / ${assistant.modelID}` : session?.model ? `${session.model.providerID} / ${session.model.id}` : "Model belum dilaporkan",
    started: session?.time.created,
    activity: latest ? activityDetail(latest) : undefined,
    current: Boolean(current),
    todos,
    completed: todos.filter((todo) => todo.status === "completed").length,
  }
}

export async function fetchSubagent(api: TuiPluginApi, sessionID: string, signal: AbortSignal) {
  const params = { sessionID, directory: api.state.path.directory }
  const [session, messages, todos] = await Promise.all([
    api.client.session.get(params, { signal }),
    api.client.session.messages({ ...params, limit: 30 }, { signal }),
    api.client.session.todo(params, { signal }),
  ])
  if (session.error || messages.error || todos.error) throw new Error("Detail subagent belum tersedia dari host")
  return subagentDetails(session.data, messages.data ?? [], todos.data ?? [])
}

export function elapsedLabel(start: number | undefined, now: number) {
  if (start === undefined || !Number.isFinite(start) || start <= 0) return "Durasi belum tersedia"
  const seconds = Math.max(0, Math.floor((now - start) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  return hours ? `${hours}j ${minutes}m ${seconds % 60}d` : `${minutes}m ${seconds % 60}d`
}
