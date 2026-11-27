let desktopValues: Record<string, string> | null = null
let pending = Promise.resolve()

export async function initializeStorage(): Promise<boolean> {
  try {
    const response = await fetch("/desktop/preferences")
    if (response.ok && response.headers.get("Content-Type")?.includes("application/json")) {
      desktopValues = await response.json() as Record<string, string>
      return true
    }
  } catch { /* Browser development continues to use localStorage. */ }
  return false
}

export function isDesktopApp() {
  return desktopValues !== null
}

export const storage = {
  getItem(key: string): string | null {
    return desktopValues ? desktopValues[key] ?? null : localStorage.getItem(key)
  },
  setItem(key: string, value: string) {
    if (!desktopValues) { localStorage.setItem(key, value); return }
    desktopValues[key] = value
    // Serialize writes so an older SQL draft cannot overwrite a newer one.
    pending = pending.catch(() => undefined).then(async () => {
      const response = await fetch("/desktop/preferences", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }), keepalive: true,
      })
      if (!response.ok) throw new Error("本地偏好设置保存失败")
    })
    void pending.catch(console.error)
  },
}
