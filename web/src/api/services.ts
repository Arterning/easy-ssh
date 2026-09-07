import { API_BASE, request } from "@/api/client"

export type ServiceStatus =
  "unknown" | "checking" | "up" | "degraded" | "down" | "paused"
export type Service = {
  id: number
  name: string
  url: string
  method: "GET" | "HEAD"
  intervalSec: number
  timeoutSec: number
  expectedStatus: string
  keyword: string
  followRedirects: boolean
  maxLatencyMs: number
  enabled: boolean
  group: string
  hostId: number | null
  status: ServiceStatus
  lastHttpStatus: number
  lastLatencyMs: number
  lastError: string
  lastCheckedAt: string | null
  consecutiveSuccesses: number
  consecutiveFailures: number
  createdAt: string
  updatedAt: string
}
export type ServiceInput = Pick<
  Service,
  | "name"
  | "url"
  | "method"
  | "intervalSec"
  | "timeoutSec"
  | "expectedStatus"
  | "keyword"
  | "followRedirects"
  | "maxLatencyMs"
  | "enabled"
  | "group"
  | "hostId"
>
export type ServiceCheck = {
  ID: number
  ServiceID: number
  Status: string
  HTTPStatus: number
  LatencyMS: number
  Error: string
  CheckedAt: string
}

export const servicesApi = {
  list: () => request<Service[]>("/services"),
  create: (input: ServiceInput) =>
    request<Service>("/services", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (id: number, input: ServiceInput) =>
    request<Service>(`/services/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  remove: (id: number) =>
    request<void>(`/services/${id}`, { method: "DELETE" }),
  check: (id: number) =>
    request<Service>(`/services/${id}/check`, { method: "POST" }),
  checks: (id: number) => request<ServiceCheck[]>(`/services/${id}/checks`),
  eventsUrl: `${API_BASE}/services/events`,
}
