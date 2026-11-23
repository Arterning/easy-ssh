import { Activity, Bot, Database, Moon, Server, Settings as SettingsIcon, Sun, Laptop } from "lucide-react"
import { AISettingsDialog } from "@/components/ai-settings-dialog"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { navigate } from "@/router/navigation"

export function SettingsPage() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex min-h-svh bg-muted/25 text-foreground">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-[228px] flex-col border-r bg-sidebar px-3 py-4">
        <div className="flex h-10 items-center gap-2.5 px-2">
          <div className="grid size-8 place-items-center rounded-lg bg-foreground text-background"><SettingsIcon className="size-4" /></div>
          <div><div className="text-sm font-semibold tracking-tight">EasySSH</div><div className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase">Ops workspace</div></div>
        </div>
        <nav className="mt-7 space-y-1 text-sm">
          <NavItem icon={<Server />} label="主机" path="/hosts" />
          <NavItem icon={<Activity />} label="服务" path="/services" />
          <NavItem icon={<Database />} label="数据库" path="/databases" />
          <NavItem icon={<SettingsIcon />} label="设置" active />
          <NavItem icon={<Bot />} label="智能助手" path="/assistant" />
        </nav>
      </aside>
      <main className="ml-[228px] min-h-svh flex-1">
        <header className="flex h-16 items-center border-b bg-background/80 px-8">
          <div className="text-sm text-muted-foreground">工作空间 <span className="mx-2">/</span><span className="font-medium text-foreground">设置</span></div>
        </header>
        <div className="mx-auto max-w-[1100px] space-y-6 px-8 py-7">
          <div><h1 className="text-2xl font-semibold tracking-tight">设置</h1><p className="mt-1 text-sm text-muted-foreground">管理主题和 AI 模型连接。</p></div>
          <section className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="grid size-9 place-items-center rounded-lg bg-muted">{theme === "dark" ? <Moon className="size-4" /> : theme === "light" ? <Sun className="size-4" /> : <Laptop className="size-4" />}</div>
              <div><h2 className="text-sm font-semibold">外观主题</h2><p className="mt-1 text-xs text-muted-foreground">选择应用的颜色主题。</p></div>
            </div>
            <div className="mt-4 flex gap-2">
              <ThemeOption active={theme === "light"} onClick={() => setTheme("light")} icon={<Sun />} label="浅色" />
              <ThemeOption active={theme === "dark"} onClick={() => setTheme("dark")} icon={<Moon />} label="深色" />
              <ThemeOption active={theme === "system"} onClick={() => setTheme("system")} icon={<Laptop />} label="跟随系统" />
            </div>
          </section>
          <section>
            <div className="mb-3"><h2 className="text-sm font-semibold">AI 模型</h2><p className="mt-1 text-xs text-muted-foreground">配置 Agent 使用的模型服务。</p></div>
            <AISettingsDialog inline />
          </section>
        </div>
      </main>
    </div>
  )
}

function NavItem({ icon, label, path, active = false }: { icon: React.ReactNode; label: string; path?: string; active?: boolean }) {
  return <button onClick={() => path && navigate(path)} className={`flex h-9 w-full items-center gap-3 rounded-lg px-3 transition ${active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}>
    <span className="[&_svg]:size-4">{icon}</span><span>{label}</span>
  </button>
}

function ThemeOption({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <Button variant={active ? "secondary" : "outline"} onClick={onClick}>{icon}{label}</Button>
}

export default SettingsPage
