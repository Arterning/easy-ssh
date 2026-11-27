import { isDesktopApp } from "@/lib/storage"

export function openWorkspace(path: string, id: number) {
  if (isDesktopApp()) {
    const type = path.startsWith("/database/") ? "database" : "host"
    void fetch("/desktop/open-workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, id }),
    }).then((response) => {
      if (!response.ok) throw new Error("无法打开 workspace 窗口")
    }).catch(console.error)
    return
  }
  window.open(path, "_blank", "noopener,noreferrer")
}

