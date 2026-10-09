export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1"

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ message: response.statusText }))
    throw new ApiError(body.message || "请求失败", response.status)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
