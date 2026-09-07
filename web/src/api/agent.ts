import { request } from "@/api/client"

export type AgentCommand = {
  command: string
  description: string
  risk: "readonly" | "change"
  status: "running" | "success" | "failed" | "pending_approval" | "rejected"
  output?: string
  exitCode?: number
}
export type AgentTask = {
  id: number
  hostId: number
  question: string
  summary: string
  status: "completed" | "waiting_approval" | "rejected" | "submitting"
  commands: AgentCommand[]
  createdAt: string
}

export const agentApi = {
  listTasks: (hostId: number) =>
    request<AgentTask[]>(`/hosts/${hostId}/agent/tasks`),
  createTask: (hostId: number, question: string) =>
    request<AgentTask>(`/hosts/${hostId}/agent/tasks`, {
      method: "POST",
      body: JSON.stringify({ question }),
    }),
  approve: (taskId: number) =>
    request<AgentTask>(`/agent/tasks/${taskId}/approve`, { method: "POST" }),
  reject: (taskId: number) =>
    request<AgentTask>(`/agent/tasks/${taskId}/reject`, { method: "POST" }),
}
