import { request } from "@/api/client"

export type DebugHeader = { key: string; value: string; enabled: boolean }
export type DebugResponse = {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  size: number
  truncated: boolean
  durationMs: number
}

export async function sendDebugRequest(input: {
  method: string
  url: string
  headers: Record<string, string>
  body: string
  timeoutSec: number
}) {
  return request<DebugResponse>("/debugger/send", {
    method: "POST",
    body: JSON.stringify(input),
  })
}
