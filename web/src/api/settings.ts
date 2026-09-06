import { request } from "@/api/client"
export type AISettings = {
  provider: string
  baseUrl: string
  model: string
  hasApiKey: boolean
}
export type AISettingsInput = {
  provider: string
  baseUrl: string
  model: string
  apiKey?: string
}
export const settingsApi = {
  getAI: () => request<AISettings>("/settings/ai"),
  saveAI: (input: AISettingsInput) =>
    request<AISettings>("/settings/ai", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
}
