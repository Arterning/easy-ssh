import { request } from "@/api/client"

export type ToolCall = {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}
export type AssistantMessage = {
  role: "user" | "assistant" | "tool"
  content?: string
  tool_call_id?: string
  tool_calls?: ToolCall[]
}
export type Approval = {
  id: number
  hostId: number
  command: string
  timeoutSec: number
  riskReason: string
  status: "pending" | "approved" | "rejected"
  expiresAt: string
}
export type Conversation = {
  id: number
  title: string
  scopeType: "global" | "host"
  hostId: number | null
  status: "ready" | "waiting_approval"
  messages: AssistantMessage[]
  approvals: Approval[]
  createdAt: string
  updatedAt: string
}
export type ConversationSummary = Omit<Conversation, "messages" | "approvals">

export const assistantApi = {
  list: () => request<ConversationSummary[]>("/assistant/conversations"),
  create: () =>
    request<Conversation>("/assistant/conversations", { method: "POST" }),
  listForHost: (hostId: number) =>
    request<ConversationSummary[]>(`/hosts/${hostId}/assistant/conversations`),
  createForHost: (hostId: number) =>
    request<Conversation>(`/hosts/${hostId}/assistant/conversations`, {
      method: "POST",
    }),
  get: (id: number) => request<Conversation>(`/assistant/conversations/${id}`),
  send: (id: number, message: string) =>
    request<Conversation>(`/assistant/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  approve: (id: number) =>
    request<Conversation>(`/assistant/approvals/${id}/approve`, {
      method: "POST",
    }),
  reject: (id: number) =>
    request<Conversation>(`/assistant/approvals/${id}/reject`, {
      method: "POST",
    }),
}
