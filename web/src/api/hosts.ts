import { request } from "@/api/client"

export type AuthType = "password" | "key"
export type HostStatus = "online" | "offline" | "unknown"
export type Host = {
  id: number
  name: string
  address: string
  port: number
  username: string
  authType: AuthType
  group: string
  tags: string[]
  note: string
  status: HostStatus
  hasCredential: boolean
  lastConnectedAt: string | null
  createdAt: string
  updatedAt: string
}
export type HostInput = {
  name: string
  address: string
  port: number
  username: string
  authType: AuthType
  group: string
  tags: string[]
  note: string
  password?: string
  privateKey?: string
}
export type ConnectionResult = {
  success: boolean
  message: string
  latencyMs?: number
}

export const hostsApi = {
  list: () => request<Host[]>("/hosts"),
  create: (input: HostInput) =>
    request<Host>("/hosts", { method: "POST", body: JSON.stringify(input) }),
  update: (id: number, input: HostInput) =>
    request<Host>(`/hosts/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  remove: (id: number) => request<void>(`/hosts/${id}`, { method: "DELETE" }),
  test: (input: HostInput) =>
    request<ConnectionResult>("/hosts/test", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  testSaved: (id: number) =>
    request<ConnectionResult>(`/hosts/${id}/test`, { method: "POST" }),
}
