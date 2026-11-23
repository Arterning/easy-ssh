import { lazy, Suspense, useEffect, useState } from "react"
import { Moon, Settings, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"
import { AISettingsDialog } from "@/components/ai-settings-dialog"
import { navigate } from "@/router/navigation"

const HostsPage = lazy(() => import("@/pages/hosts"))
const WorkspacePage = lazy(() => import("@/pages/workspace"))
const AssistantPage = lazy(() => import("@/pages/assistant"))
const ServicesPage = lazy(() => import("@/pages/services"))
const DatabasesPage = lazy(() => import("@/pages/databases"))
const DatabaseWorkspacePage = lazy(() => import("@/pages/database-workspace"))
const routes = {
  "/": HostsPage,
  "/hosts": HostsPage,
  "/services": ServicesPage,
  "/databases": DatabasesPage,
  "/assistant": AssistantPage,
}

function PendingPage() {
  return (
    <main className="grid min-h-svh place-items-center text-sm text-muted-foreground">
      加载中...
    </main>
  )
}

export function AppRouter() {
  const [path, setPath] = useState(window.location.pathname)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { theme, setTheme } = useTheme()
  useEffect(() => {
    const handleNavigation = () => setPath(window.location.pathname)
    window.addEventListener("popstate", handleNavigation)
    return () => window.removeEventListener("popstate", handleNavigation)
  }, [])
  const Page = routes[path as keyof typeof routes]
  const showGlobalControls = !/^\/(workspace|database)\/\d+$/.test(path)
  let page: React.ReactNode
  if (Page)
    page = (
      <Suspense fallback={<PendingPage />}>
        <Page />
      </Suspense>
    )
  else {
  const workspaceMatch = path.match(/^\/workspace\/(\d+)$/)
  if (workspaceMatch)
    page = (
      <Suspense fallback={<PendingPage />}>
        <WorkspacePage hostId={Number(workspaceMatch[1])} />
      </Suspense>
    )
  const databaseMatch = path.match(/^\/database\/(\d+)$/)
  if (databaseMatch)
    page = (
      <Suspense fallback={<PendingPage />}>
        <DatabaseWorkspacePage key={databaseMatch[1]} databaseId={Number(databaseMatch[1])} />
      </Suspense>
    )
  if (!page) page = (
    <main className="grid min-h-svh place-items-center text-center">
      <div>
        <h1 className="text-5xl font-semibold">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">页面不存在</p>
        <button className="mt-4 underline" onClick={() => navigate("/hosts")}>
          返回主机管理
        </button>
      </div>
    </main>
  )
  }
  return <>
    {page}
    {showGlobalControls && <div className="fixed top-2 right-4 z-30 flex items-center gap-1">
      <Button variant="ghost" size="icon" aria-label="切换主题" title="切换主题" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
        {theme === "dark" ? <Sun /> : <Moon />}
      </Button>
      <Button variant="ghost" className="px-2" onClick={() => setSettingsOpen(true)}>
        <Settings className="size-4" />设置
      </Button>
    </div>}
    {settingsOpen && <AISettingsDialog onClose={() => setSettingsOpen(false)} />}
  </>
}
