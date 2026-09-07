import { useEffect, useMemo, useState } from "react"
import {
  Activity,
  Bot,
  Check,
  ChevronDown,
  CircleHelp,
  Database,
  Ellipsis,
  Eye,
  EyeOff,
  KeyRound,
  LaptopMinimal,
  LayoutGrid,
  List,
  LoaderCircle,
  Moon,
  Pencil,
  Plus,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sun,
  TerminalSquare,
  Trash2,
  X,
  Zap,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"
import {
  hostsApi,
  type Host,
  type HostInput,
  type HostStatus,
} from "@/api/hosts"
import { settingsApi } from "@/api/settings"
import { navigate } from "@/router/navigation"

type HostDraft = HostInput & { password: string; privateKey: string }
const emptyDraft: HostDraft = {
  name: "",
  address: "",
  port: 22,
  username: "root",
  authType: "password",
  group: "默认分组",
  tags: [],
  note: "",
  password: "",
  privateKey: "",
}
const inputClass =
  "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-foreground/40 focus:ring-2 focus:ring-ring/20"
const labelClass = "mb-1.5 block text-sm font-medium"

function openWorkspace(hostId: number) {
  window.open(`/workspace/${hostId}`, "_blank", "noopener,noreferrer")
}

export function HostsPage() {
  const { theme, setTheme } = useTheme()
  const [hosts, setHosts] = useState<Host[]>([])
  const [pageError, setPageError] = useState("")
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [groupFilter, setGroupFilter] = useState("all")
  const [view, setView] = useState<"table" | "grid">("table")
  const [editorOpen, setEditorOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<HostDraft>(emptyDraft)
  const [tagInput, setTagInput] = useState("")
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null)
  const [testError, setTestError] = useState("")
  const [menuId, setMenuId] = useState<number | null>(null)
  const groups = useMemo(
    () => Array.from(new Set(hosts.map((host) => host.group))),
    [hosts]
  )
  const filteredHosts = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return hosts.filter(
      (host) =>
        (!needle ||
          [host.name, host.address, host.username, host.group, ...host.tags]
            .join(" ")
            .toLowerCase()
            .includes(needle)) &&
        (statusFilter === "all" || host.status === statusFilter) &&
        (groupFilter === "all" || host.group === groupFilter)
    )
  }, [groupFilter, hosts, query, statusFilter])

  useEffect(() => {
    hostsApi
      .list()
      .then(setHosts)
      .catch((error: Error) => setPageError(error.message))
  }, [])

  function openCreate() {
    setEditingId(null)
    setDraft(emptyDraft)
    setTagInput("")
    setTestResult(null)
    setTestError("")
    setEditorOpen(true)
  }
  function openEdit(host: Host) {
    setEditingId(host.id)
    setDraft({
      name: host.name,
      address: host.address,
      port: host.port,
      username: host.username,
      authType: host.authType,
      group: host.group,
      tags: host.tags,
      note: host.note,
      password: "",
      privateKey: "",
    })
    setTagInput(host.tags.join(", "))
    setTestResult(null)
    setTestError("")
    setMenuId(null)
    setEditorOpen(true)
  }
  async function saveHost() {
    if (!draft.name.trim() || !draft.address.trim() || !draft.username.trim())
      return
    const tags = tagInput
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean)
    try {
      const input = { ...draft, tags }
      const saved = editingId
        ? await hostsApi.update(editingId, input)
        : await hostsApi.create(input)
      setHosts((items) =>
        editingId
          ? items.map((host) => (host.id === saved.id ? saved : host))
          : [saved, ...items]
      )
      setEditorOpen(false)
    } catch (error) {
      setPageError((error as Error).message)
    }
  }
  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    setTestError("")
    try {
      await hostsApi.test({
        ...draft,
        tags: tagInput
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
      })
      setTestResult("success")
    } catch (error) {
      setTestError((error as Error).message)
      setTestResult("error")
    } finally {
      setTesting(false)
    }
  }
  async function deleteHost(id: number) {
    try {
      await hostsApi.remove(id)
      setHosts((items) => items.filter((host) => host.id !== id))
      setMenuId(null)
    } catch (error) {
      setPageError((error as Error).message)
    }
  }

  return (
    <div className="flex min-h-svh bg-muted/25 text-foreground">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-[228px] flex-col border-r bg-sidebar px-3 py-4">
        <div className="flex h-10 items-center gap-2.5 px-2">
          <div className="grid size-8 place-items-center rounded-lg bg-foreground text-background">
            <TerminalSquare className="size-4" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">EasySSH</div>
            <div className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
              Ops workspace
            </div>
          </div>
        </div>
        <nav className="mt-7 space-y-1 text-sm">
          <NavItem
            active
            icon={<Server />}
            label="主机"
            count={hosts.length}
            onClick={() => navigate("/hosts")}
          />
          <NavItem
            icon={<Activity />}
            label="服务"
            onClick={() => navigate("/services")}
          />
          <NavItem
            icon={<Bot />}
            label="智能助手"
            onClick={() => navigate("/assistant")}
          />
        </nav>
        <div className="mt-auto space-y-1">
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex h-9 w-full items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <Settings className="size-4" />
            设置
          </button>
          <div className="mt-3 flex items-center gap-2 border-t px-2 pt-4">
            <div className="grid size-8 place-items-center rounded-full bg-emerald-500/10 text-xs font-semibold text-emerald-600">
              ES
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">本地管理员</div>
              <div className="text-[11px] text-muted-foreground">MVP 模式</div>
            </div>
            <CircleHelp className="size-4 text-muted-foreground" />
          </div>
        </div>
      </aside>
      <main className="ml-[228px] min-h-svh flex-1">
        <header className="flex h-16 items-center justify-between border-b bg-background/80 px-8 backdrop-blur">
          <div className="text-sm text-muted-foreground">
            工作空间 <span className="mx-2 text-border">/</span>
            <span className="font-medium text-foreground">主机</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="切换主题"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun /> : <Moon />}
            </Button>
            <Button variant="outline" onClick={() => setSettingsOpen(true)}>
              <Bot />
              AI 设置
            </Button>
            <Button onClick={openCreate}>
              <Plus />
              添加主机
            </Button>
          </div>
        </header>
        <div className="mx-auto max-w-[1440px] px-8 py-7">
          <div className="mb-7 flex items-end justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">主机</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                集中管理你的 SSH 主机与连接凭据。
              </p>
            </div>
            <div className="flex items-center gap-5 text-xs text-muted-foreground">
              <StatDot
                color="bg-emerald-500"
                value={hosts.filter((h) => h.status === "online").length}
                label="在线"
              />
              <StatDot
                color="bg-rose-500"
                value={hosts.filter((h) => h.status === "offline").length}
                label="离线"
              />
              <StatDot
                color="bg-slate-400"
                value={hosts.filter((h) => h.status === "unknown").length}
                label="未检测"
              />
            </div>
          </div>
          {pageError && (
            <div className="mb-4 flex items-center justify-between rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <span>{pageError}</span>
              <button onClick={() => setPageError("")}>
                <X className="size-4" />
              </button>
            </div>
          )}
          <div className="rounded-xl border bg-card shadow-sm shadow-black/[0.02]">
            <div className="flex flex-wrap items-center gap-2 border-b p-3">
              <div className="relative min-w-[260px] flex-1 md:max-w-sm">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索名称、地址、用户或标签..."
                  className={`${inputClass} pl-9`}
                />
              </div>
              <Select
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  ["all", "全部状态"],
                  ["online", "在线"],
                  ["offline", "离线"],
                  ["unknown", "未检测"],
                ]}
              />
              <Select
                value={groupFilter}
                onChange={setGroupFilter}
                options={[["all", "全部分组"], ...groups.map((g) => [g, g])]}
              />
              <div className="ml-auto flex rounded-lg border p-0.5">
                <button
                  onClick={() => setView("table")}
                  className={`rounded-md p-1.5 ${view === "table" ? "bg-muted text-foreground" : "text-muted-foreground"}`}
                >
                  <List className="size-4" />
                </button>
                <button
                  onClick={() => setView("grid")}
                  className={`rounded-md p-1.5 ${view === "grid" ? "bg-muted text-foreground" : "text-muted-foreground"}`}
                >
                  <LayoutGrid className="size-4" />
                </button>
              </div>
            </div>
            {filteredHosts.length === 0 ? (
              <div className="grid min-h-80 place-items-center p-10 text-center">
                <div>
                  <Server className="mx-auto mb-3 size-8 text-muted-foreground/50" />
                  <div className="font-medium">没有找到主机</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    调整筛选条件或添加一台新主机。
                  </p>
                </div>
              </div>
            ) : view === "table" ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/35 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3 font-medium">主机</th>
                      <th className="px-4 py-3 font-medium">连接地址</th>
                      <th className="px-4 py-3 font-medium">分组与标签</th>
                      <th className="px-4 py-3 font-medium">认证</th>
                      <th className="px-4 py-3 font-medium">最近连接</th>
                      <th className="w-40 px-5 py-3 text-right font-medium">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredHosts.map((host) => (
                      <HostRow
                        key={host.id}
                        host={host}
                        menuOpen={menuId === host.id}
                        onMenu={() =>
                          setMenuId(menuId === host.id ? null : host.id)
                        }
                        onEdit={() => openEdit(host)}
                        onConnect={() => openWorkspace(host.id)}
                        onDelete={() => void deleteHost(host.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredHosts.map((host) => (
                  <HostCard
                    key={host.id}
                    host={host}
                    onEdit={() => openEdit(host)}
                    onConnect={() => openWorkspace(host.id)}
                  />
                ))}
              </div>
            )}
            <div className="border-t px-5 py-3 text-xs text-muted-foreground">
              显示 {filteredHosts.length} 台主机，共 {hosts.length} 台
            </div>
          </div>
        </div>
      </main>
      {editorOpen && (
        <HostEditor
          draft={draft}
          setDraft={setDraft}
          editing={editingId !== null}
          tagInput={tagInput}
          setTagInput={setTagInput}
          testing={testing}
          testResult={testResult}
          testError={testError}
          onTest={testConnection}
          onClose={() => setEditorOpen(false)}
          onSave={saveHost}
        />
      )}
      {settingsOpen && <AiSettings onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

function NavItem({
  icon,
  label,
  active,
  count,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  count?: number
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-9 w-full items-center gap-3 rounded-lg px-3 transition ${active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}
    >
      <span className="[&_svg]:size-4">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {count !== undefined && (
        <span className="rounded-md bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground shadow-sm">
          {count}
        </span>
      )}
    </button>
  )
}
function StatDot({
  color,
  value,
  label,
}: {
  color: string
  value: number
  label: string
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`size-2 rounded-full ${color}`} />
      <span className="font-medium text-foreground">{value}</span>
      {label}
    </div>
  )
}
function Select({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (value: string) => void
  options: string[][]
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 appearance-none rounded-lg border bg-background pr-9 pl-3 text-sm outline-none focus:ring-2 focus:ring-ring/20"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}
function Status({ status }: { status: HostStatus }) {
  const style = {
    online: ["bg-emerald-500", "在线"],
    offline: ["bg-rose-500", "离线"],
    unknown: ["bg-slate-400", "未检测"],
  }[status]
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={`size-1.5 rounded-full ${style[0]}`} />
      {style[1]}
    </span>
  )
}

function HostRow({
  host,
  menuOpen,
  onMenu,
  onEdit,
  onConnect,
  onDelete,
}: {
  host: Host
  menuOpen: boolean
  onMenu: () => void
  onEdit: () => void
  onConnect: () => void
  onDelete: () => void
}) {
  return (
    <tr className="group transition hover:bg-muted/25">
      <td className="px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg border bg-background">
            <Server className="size-4 text-muted-foreground" />
          </div>
          <div>
            <div className="font-medium">{host.name}</div>
            <Status status={host.status} />
          </div>
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="font-mono text-[13px]">
          {host.username}@{host.address}:{host.port}
        </div>
        <div className="mt-0.5 max-w-52 truncate text-xs text-muted-foreground">
          {host.note || "暂无备注"}
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="text-xs">{host.group}</div>
        <div className="mt-1 flex gap-1">
          {host.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      </td>
      <td className="px-4 py-4">
        <span className="inline-flex items-center gap-1.5 text-xs">
          <KeyRound className="size-3.5 text-muted-foreground" />
          {host.authType === "key" ? "SSH 密钥" : "密码"}
        </span>
      </td>
      <td className="px-4 py-4 text-xs text-muted-foreground">
        {host.lastConnectedAt
          ? new Date(host.lastConnectedAt).toLocaleString("zh-CN")
          : "尚未连接"}
      </td>
      <td className="relative px-5 py-4">
        <div className="flex justify-end gap-1">
          <Button size="sm" onClick={onConnect}>
            <TerminalSquare />
            连接
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onMenu}>
            <Ellipsis />
          </Button>
        </div>
        {menuOpen && (
          <div className="absolute top-12 right-5 z-10 w-36 rounded-lg border bg-popover p-1 shadow-lg">
            <button
              onClick={onEdit}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs hover:bg-muted"
            >
              <Pencil className="size-3.5" />
              编辑主机
            </button>
            <button
              onClick={onDelete}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="size-3.5" />
              删除主机
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}
function HostCard({
  host,
  onEdit,
  onConnect,
}: {
  host: Host
  onEdit: () => void
  onConnect: () => void
}) {
  return (
    <div className="rounded-xl border bg-background p-4 transition hover:border-foreground/20 hover:shadow-sm">
      <div className="flex items-start justify-between">
        <div className="grid size-10 place-items-center rounded-lg bg-muted">
          <Server className="size-5" />
        </div>
        <Status status={host.status} />
      </div>
      <h3 className="mt-4 font-medium">{host.name}</h3>
      <p className="mt-1 font-mono text-xs text-muted-foreground">
        {host.username}@{host.address}:{host.port}
      </p>
      <div className="mt-4 flex gap-1">
        {host.tags.map((tag) => (
          <span
            key={tag}
            className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            {tag}
          </span>
        ))}
      </div>
      <div className="mt-5 flex gap-2 border-t pt-3">
        <Button className="flex-1" size="sm" onClick={onConnect}>
          <TerminalSquare />
          连接
        </Button>
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil />
        </Button>
      </div>
    </div>
  )
}
function ModalShell({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string
  subtitle: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`max-h-[92vh] w-full overflow-hidden rounded-2xl border bg-background shadow-2xl ${wide ? "max-w-2xl" : "max-w-lg"}`}
      >
        <div className="flex items-start justify-between border-b px-6 py-5">
          <div>
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X />
          </Button>
        </div>
        {children}
      </div>
    </div>
  )
}

function HostEditor({
  draft,
  setDraft,
  editing,
  tagInput,
  setTagInput,
  testing,
  testResult,
  testError,
  onTest,
  onClose,
  onSave,
}: {
  draft: HostDraft
  setDraft: React.Dispatch<React.SetStateAction<HostDraft>>
  editing: boolean
  tagInput: string
  setTagInput: (v: string) => void
  testing: boolean
  testResult: "success" | "error" | null
  testError: string
  onTest: () => void
  onClose: () => void
  onSave: () => void
}) {
  const update = <K extends keyof HostDraft>(key: K, value: HostDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  return (
    <ModalShell
      wide
      title={editing ? "编辑主机" : "添加主机"}
      subtitle="配置连接地址与 SSH 身份凭据。凭据保存后不会再次显示。"
      onClose={onClose}
    >
      <div className="max-h-[calc(92vh-150px)] overflow-y-auto px-6 py-5">
        <SectionTitle icon={<LaptopMinimal />} title="基本信息" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="主机名称 *">
            <input
              className={inputClass}
              value={draft.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="例如：生产服务器"
            />
          </Field>
          <Field label="分组">
            <input
              className={inputClass}
              value={draft.group}
              onChange={(e) => update("group", e.target.value)}
              placeholder="默认分组"
            />
          </Field>
          <Field label="主机地址 *" wide>
            <input
              className={inputClass}
              value={draft.address}
              onChange={(e) => update("address", e.target.value)}
              placeholder="IP 地址或域名"
            />
          </Field>
          <Field label="端口">
            <input
              type="number"
              min={1}
              max={65535}
              className={inputClass}
              value={draft.port}
              onChange={(e) => update("port", Number(e.target.value))}
            />
          </Field>
          <Field label="用户名 *">
            <input
              className={inputClass}
              value={draft.username}
              onChange={(e) => update("username", e.target.value)}
              placeholder="root"
            />
          </Field>
        </div>
        <SectionTitle icon={<ShieldCheck />} title="身份认证" />
        <div className="mb-4 grid grid-cols-2 rounded-lg bg-muted p-1">
          <button
            onClick={() => update("authType", "password")}
            className={`rounded-md py-2 text-sm transition ${draft.authType === "password" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
          >
            密码
          </button>
          <button
            onClick={() => update("authType", "key")}
            className={`rounded-md py-2 text-sm transition ${draft.authType === "key" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
          >
            SSH 私钥
          </button>
        </div>
        {draft.authType === "password" ? (
          <Field label={editing ? "密码（留空则不修改）" : "密码"}>
            <input
              type="password"
              className={inputClass}
              value={draft.password}
              onChange={(e) => update("password", e.target.value)}
              placeholder={editing ? "已设置" : "输入 SSH 密码"}
            />
          </Field>
        ) : (
          <Field label={editing ? "私钥（留空则不修改）" : "私钥 PEM"}>
            <textarea
              className={`${inputClass} h-28 resize-none py-2 font-mono text-xs`}
              value={draft.privateKey}
              onChange={(e) => update("privateKey", e.target.value)}
              placeholder={
                editing
                  ? "已设置，粘贴新私钥以替换"
                  : "-----BEGIN OPENSSH PRIVATE KEY-----"
              }
            />
          </Field>
        )}
        <SectionTitle icon={<Settings />} title="更多信息" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="标签">
            <input
              className={inputClass}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="production, web"
            />
          </Field>
          <Field label="备注">
            <input
              className={inputClass}
              value={draft.note}
              onChange={(e) => update("note", e.target.value)}
              placeholder="主机用途或说明"
            />
          </Field>
        </div>
        {testResult && (
          <div
            className={`mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${testResult === "success" ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"}`}
          >
            {testResult === "success" ? (
              <Check className="size-4" />
            ) : (
              <X className="size-4" />
            )}
            {testResult === "success"
              ? "连接测试成功，可以安全保存。"
              : testError || "连接测试失败，请检查主机配置。"}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t bg-muted/20 px-6 py-4">
        <Button variant="outline" onClick={onTest} disabled={testing}>
          {testing ? <LoaderCircle className="animate-spin" /> : <Zap />}
          测试连接
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={onSave}
            disabled={
              !draft.name.trim() ||
              !draft.address.trim() ||
              !draft.username.trim()
            }
          >
            保存主机
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}
function Field({
  label,
  children,
  wide,
}: {
  label: string
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <label className={wide ? "sm:col-span-2" : ""}>
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  )
}
function SectionTitle({
  icon,
  title,
}: {
  icon: React.ReactNode
  title: string
}) {
  return (
    <div className="mt-6 mb-4 flex items-center gap-2 border-b pb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase first:mt-0 [&_svg]:size-3.5">
      {icon}
      {title}
    </div>
  )
}

function AiSettings({ onClose }: { onClose: () => void }) {
  const [showKey, setShowKey] = useState(false)
  const [provider, setProvider] = useState("OpenAI")
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1")
  const [model, setModel] = useState("gpt-5-mini")
  const [apiKey, setApiKey] = useState("")
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    settingsApi
      .getAI()
      .then((settings) => {
        setProvider(settings.provider || "OpenAI")
        setBaseUrl(settings.baseUrl || "https://api.openai.com/v1")
        setModel(settings.model || "")
      })
      .catch(() => undefined)
  }, [])
  async function save() {
    setSaving(true)
    try {
      await settingsApi.saveAI({
        provider,
        baseUrl,
        model,
        apiKey: apiKey || undefined,
      })
      setApiKey("")
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }
  return (
    <ModalShell
      wide
      title="AI 模型设置"
      subtitle="连接任意兼容 OpenAI API 的模型供应商。"
      onClose={onClose}
    >
      <div className="grid min-h-[440px] grid-cols-[180px_1fr]">
        <div className="border-r bg-muted/20 p-3">
          <button className="flex w-full items-center gap-2 rounded-lg bg-background px-3 py-2 text-sm font-medium shadow-sm">
            <Bot className="size-4" />
            模型供应商
          </button>
          <button className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
            <ShieldCheck className="size-4" />
            执行策略
          </button>
          <button className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
            <Database className="size-4" />
            数据库
          </button>
        </div>
        <div className="p-6">
          <h3 className="text-sm font-semibold">模型供应商</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            EasySSH 仅在 Agent 任务执行时调用该模型。
          </p>
          <div className="mt-6 space-y-4">
            <Field label="供应商名称">
              <input
                className={inputClass}
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder="OpenAI、DeepSeek、Ollama..."
              />
            </Field>
            <Field label="Base URL">
              <input
                className={inputClass}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </Field>
            <Field label="API Key">
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  className={`${inputClass} pr-10`}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="留空则保持已保存的密钥"
                />
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
                >
                  {showKey ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </Field>
            <Field label="模型名称">
              <input
                className={inputClass}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="gpt-5-mini"
              />
            </Field>
            <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <ShieldCheck className="size-4 text-emerald-500" />
                命令执行策略
              </div>
              <p className="mt-1.5 leading-relaxed">
                只读命令自动执行；修改系统状态的命令必须由你确认。高危命令将默认阻止。
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t px-6 py-4">
        <span className="text-xs text-muted-foreground">
          配置将加密保存在服务端
        </span>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="flex items-center gap-1 text-xs text-emerald-600">
              <Check className="size-3.5" />
              已保存
            </span>
          )}
          <Button
            onClick={() => void save()}
            disabled={saving || !baseUrl || !model}
          >
            {saving ? <LoaderCircle className="animate-spin" /> : null}保存设置
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}

export default HostsPage
