import { useEffect, useMemo, useState } from "react"
import { Activity, Bot, CheckCircle2, Database, ExternalLink, LoaderCircle, Pencil, Plus, Search, Server, ShieldCheck, Trash2, X } from "lucide-react"
import { databasesApi, type DatabaseConnection, type DatabaseInput, type DatabaseType } from "@/api/databases"
import { hostsApi, type Host } from "@/api/hosts"
import { Button } from "@/components/ui/button"
import { navigate } from "@/router/navigation"

const blank = (): DatabaseInput => ({ name: "", type: "mysql", address: "", port: 3306, databaseName: "", username: "", password: "", sqlitePath: "", sslMode: "disable", useSshTunnel: false, sshHostId: null, group: "", tags: [], note: "" })
const inputClass = "h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/20"
const labels: Record<DatabaseType, string> = { sqlite: "SQLite", mysql: "MySQL", postgres: "PostgreSQL" }

export function DatabasesPage() {
  const [items, setItems] = useState<DatabaseConnection[]>([])
  const [hosts, setHosts] = useState<Host[]>([])
  const [query, setQuery] = useState("")
  const [type, setType] = useState<"all" | DatabaseType>("all")
  const [editor, setEditor] = useState<DatabaseConnection | "new" | null>(null)
  const [draft, setDraft] = useState<DatabaseInput>(blank())
  const [tagText, setTagText] = useState("")
  const [busy, setBusy] = useState(false)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [testMessage, setTestMessage] = useState("")
  const [error, setError] = useState("")
  useEffect(() => {
    databasesApi.list().then(setItems).catch((e: Error) => setError(e.message))
    hostsApi.list().then(setHosts).catch(() => undefined)
  }, [])
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return items.filter((item) => (type === "all" || item.type === type) && (!needle || [item.name, item.address, item.databaseName, item.sqlitePath, item.group, ...item.tags].join(" ").toLowerCase().includes(needle)))
  }, [items, query, type])
  function openEditor(item?: DatabaseConnection) {
    setTestMessage(""); setError("")
    if (!item) { setEditor("new"); setDraft(blank()); setTagText(""); return }
    setEditor(item)
    setDraft({ name: item.name, type: item.type, address: item.address, port: item.port, databaseName: item.databaseName, username: item.username, password: "", sqlitePath: item.sqlitePath, sslMode: item.sslMode, useSshTunnel: item.useSshTunnel, sshHostId: item.sshHostId, group: item.group, tags: item.tags, note: item.note })
    setTagText(item.tags.join(", "))
  }
  const payload = (): DatabaseInput => ({ ...draft, connectionId: editor !== "new" && editor ? editor.id : undefined, tags: tagText.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) })
  async function save() {
    if (busy) return
    setBusy(true); setError("")
    try {
      const saved = editor === "new" ? await databasesApi.create(payload()) : await databasesApi.update((editor as DatabaseConnection).id, payload())
      setItems((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current])
      setEditor(null)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function testDraft() {
    setBusy(true); setTestMessage(""); setError("")
    try { const result = await databasesApi.test(payload()); setTestMessage(`连接成功 · ${result.latencyMs ?? 0} ms`) }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function testSaved(item: DatabaseConnection) {
    setTestingId(item.id); setError("")
    try {
      await databasesApi.testSaved(item.id)
      setItems((current) => current.map((value) => value.id === item.id ? { ...value, status: "online", lastError: "", lastTestedAt: new Date().toISOString() } : value))
    } catch (e) {
      setError((e as Error).message)
      setItems((current) => current.map((value) => value.id === item.id ? { ...value, status: "offline", lastError: (e as Error).message, lastTestedAt: new Date().toISOString() } : value))
    } finally { setTestingId(null) }
  }
  async function remove(item: DatabaseConnection) {
    if (!window.confirm(`确认删除数据库连接“${item.name}”？`)) return
    try { await databasesApi.remove(item.id); setItems((current) => current.filter((value) => value.id !== item.id)) }
    catch (e) { setError((e as Error).message) }
  }
  return <div className="flex min-h-svh bg-muted/25 text-foreground">
    <aside className="fixed inset-y-0 left-0 z-20 flex w-[228px] flex-col border-r bg-sidebar px-3 py-4"><Brand /><nav className="mt-7 space-y-1 text-sm"><Nav icon={<Server />} label="主机" onClick={() => navigate("/hosts")} /><Nav icon={<Activity />} label="服务" onClick={() => navigate("/services")} /><Nav active icon={<Database />} label="数据库" /><Nav icon={<Bot />} label="智能助手" onClick={() => navigate("/assistant")} /></nav></aside>
    <main className="ml-[228px] min-h-svh flex-1"><header className="flex h-16 items-center border-b bg-background/80 px-8"><div className="text-sm text-muted-foreground">工作空间 <span className="mx-2">/</span><span className="font-medium text-foreground">数据库</span></div><Button className="ml-auto" onClick={() => openEditor()}><Plus />添加数据库</Button></header>
      <div className="mx-auto max-w-[1440px] px-8 py-7"><div className="mb-6"><h1 className="text-2xl font-semibold">数据库连接</h1><p className="mt-1 text-sm text-muted-foreground">集中管理 SQLite、MySQL 和 PostgreSQL 数据库连接。</p></div>
        {error && <div className="mb-4 flex items-center justify-between rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive"><span>{error}</span><button onClick={() => setError("")}><X className="size-4" /></button></div>}
        <div className="rounded-xl border bg-card shadow-sm"><div className="flex items-center gap-2 border-b p-3"><div className="relative max-w-md min-w-72 flex-1"><Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><input className={`${inputClass} pl-9`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索名称、地址、数据库或标签..." /></div><select className={inputClass + " w-40"} value={type} onChange={(e) => setType(e.target.value as typeof type)}><option value="all">全部类型</option><option value="sqlite">SQLite</option><option value="mysql">MySQL</option><option value="postgres">PostgreSQL</option></select></div>
          {shown.length === 0 ? <div className="grid min-h-72 place-items-center text-center"><div><Database className="mx-auto size-9 text-muted-foreground/40" /><div className="mt-3 font-medium">没有数据库连接</div><p className="mt-1 text-sm text-muted-foreground">添加一个数据库连接开始使用。</p></div></div> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-muted/35 text-xs text-muted-foreground"><tr><th className="px-5 py-3 font-medium">名称</th><th className="px-4 py-3 font-medium">类型</th><th className="px-4 py-3 font-medium">连接地址</th><th className="px-4 py-3 font-medium">状态</th><th className="px-5 py-3 text-right font-medium">操作</th></tr></thead><tbody className="divide-y">{shown.map((item) => <tr key={item.id} className="hover:bg-muted/25"><td className="px-5 py-4"><div className="font-medium">{item.name}</div><div className="mt-1 text-xs text-muted-foreground">{item.group || "未分组"}</div></td><td className="px-4 py-4"><span className="rounded-md bg-muted px-2 py-1 text-xs">{labels[item.type]}</span>{item.useSshTunnel && <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground"><ShieldCheck className="size-3" />SSH</span>}</td><td className="px-4 py-4 font-mono text-xs text-muted-foreground">{item.type === "sqlite" ? item.sqlitePath : `${item.username}@${item.address}:${item.port}/${item.databaseName}`}</td><td className="px-4 py-4"><Status item={item} /></td><td className="px-5 py-4"><div className="flex justify-end gap-1"><Button variant="outline" onClick={() => window.open(`/database/${item.id}`, "_blank", "noopener,noreferrer")}><ExternalLink />连接</Button><Button variant="ghost" size="icon-sm" title="测试连接" disabled={testingId === item.id} onClick={() => void testSaved(item)}>{testingId === item.id ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}</Button><Button variant="ghost" size="icon-sm" title="编辑" onClick={() => openEditor(item)}><Pencil /></Button><Button variant="ghost" size="icon-sm" title="删除" onClick={() => void remove(item)}><Trash2 /></Button></div></td></tr>)}</tbody></table></div>}
          <div className="border-t px-5 py-3 text-xs text-muted-foreground">显示 {shown.length} 个连接，共 {items.length} 个</div></div></div></main>
    {editor && <Editor draft={draft} setDraft={setDraft} hosts={hosts} editing={editor !== "new"} tagText={tagText} setTagText={setTagText} busy={busy} error={error} message={testMessage} onClose={() => setEditor(null)} onTest={() => void testDraft()} onSave={() => void save()} />}
  </div>
}

function Editor({ draft, setDraft, hosts, editing, tagText, setTagText, busy, error, message, onClose, onTest, onSave }: { draft: DatabaseInput; setDraft: (value: DatabaseInput) => void; hosts: Host[]; editing: boolean; tagText: string; setTagText: (value: string) => void; busy: boolean; error: string; message: string; onClose: () => void; onTest: () => void; onSave: () => void }) {
  const update = <K extends keyof DatabaseInput>(key: K, value: DatabaseInput[K]) => setDraft({ ...draft, [key]: value })
  const valid = draft.name.trim() && (draft.type === "sqlite" ? draft.sqlitePath.trim() : draft.address.trim() && draft.databaseName.trim() && draft.username.trim() && (!draft.useSshTunnel || draft.sshHostId))
  function changeType(value: DatabaseType) { setDraft({ ...draft, type: value, port: value === "mysql" ? 3306 : value === "postgres" ? 5432 : 0, useSshTunnel: value === "sqlite" ? false : draft.useSshTunnel, sshHostId: value === "sqlite" ? null : draft.sshHostId }) }
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border bg-background shadow-2xl"><div className="flex items-start justify-between border-b px-6 py-5"><div><h2 className="font-semibold">{editing ? "编辑数据库连接" : "添加数据库连接"}</h2><p className="mt-1 text-xs text-muted-foreground">连接凭据将加密保存在本地。</p></div><Button variant="ghost" size="icon-sm" onClick={onClose}><X /></Button></div><div className="grid gap-4 p-6 sm:grid-cols-2">
    <Field label="连接名称 *"><input className={inputClass} value={draft.name} onChange={(e) => update("name", e.target.value)} placeholder="生产订单库" /></Field><Field label="数据库类型 *"><select className={inputClass} value={draft.type} onChange={(e) => changeType(e.target.value as DatabaseType)}><option value="mysql">MySQL</option><option value="postgres">PostgreSQL</option><option value="sqlite">SQLite</option></select></Field>
    {draft.type === "sqlite" ? <Field label="数据库文件路径 *" wide><input className={inputClass} value={draft.sqlitePath} onChange={(e) => update("sqlitePath", e.target.value)} placeholder="C:\data\application.db 或 /data/application.db" /></Field> : <><Field label="数据库地址 *"><input className={inputClass} value={draft.address} onChange={(e) => update("address", e.target.value)} placeholder={draft.useSshTunnel ? "数据库在 SSH 主机侧可访问的地址" : "127.0.0.1"} /></Field><Field label="端口 *"><input type="number" min={1} max={65535} className={inputClass} value={draft.port} onChange={(e) => update("port", Number(e.target.value))} /></Field><Field label="数据库名 *"><input className={inputClass} value={draft.databaseName} onChange={(e) => update("databaseName", e.target.value)} /></Field><Field label="用户名 *"><input className={inputClass} value={draft.username} onChange={(e) => update("username", e.target.value)} /></Field><Field label={editing ? "密码（留空则不修改）" : "密码"}><input type="password" className={inputClass} value={draft.password ?? ""} onChange={(e) => update("password", e.target.value)} /></Field><Field label="SSL 模式"><select className={inputClass} value={draft.sslMode} onChange={(e) => update("sslMode", e.target.value)}><option value="disable">禁用</option><option value="prefer">优先使用</option><option value="require">必须使用</option>{draft.type === "postgres" && <><option value="verify-ca">验证 CA</option><option value="verify-full">完整验证</option></>}</select></Field><label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={draft.useSshTunnel} onChange={(e) => update("useSshTunnel", e.target.checked)} />通过 SSH 隧道连接</label>{draft.useSshTunnel && <Field label="SSH 主机 *" wide><select className={inputClass} value={draft.sshHostId ?? ""} onChange={(e) => update("sshHostId", e.target.value ? Number(e.target.value) : null)}><option value="">请选择已有主机</option>{hosts.map((host) => <option key={host.id} value={host.id}>{host.name} · {host.username}@{host.address}</option>)}</select></Field>}</>}
    <Field label="分组"><input className={inputClass} value={draft.group} onChange={(e) => update("group", e.target.value)} /></Field><Field label="标签"><input className={inputClass} value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="生产, 核心" /></Field><Field label="备注" wide><textarea className="min-h-20 w-full rounded-lg border bg-background p-3 text-sm outline-none" value={draft.note} onChange={(e) => update("note", e.target.value)} /></Field>{message && <div className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-700 sm:col-span-2">{message}</div>}{error && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive sm:col-span-2">{error}</div>}</div><div className="flex justify-end gap-2 border-t px-6 py-4"><Button variant="outline" disabled={!valid || busy} onClick={onTest}>{busy && <LoaderCircle className="animate-spin" />}测试连接</Button><Button variant="ghost" onClick={onClose}>取消</Button><Button disabled={!valid || busy} onClick={onSave}>保存连接</Button></div></div></div>
}
function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) { return <label className={wide ? "sm:col-span-2" : ""}><span className="mb-1.5 block text-sm font-medium">{label}</span>{children}</label> }
function Status({ item }: { item: DatabaseConnection }) { const value = { online: ["bg-emerald-500", "可连接"], offline: ["bg-red-500", "连接失败"], unknown: ["bg-slate-400", "未测试"] }[item.status]; return <span className="inline-flex items-center gap-2 text-xs text-muted-foreground" title={item.lastError}><span className={`size-2 rounded-full ${value[0]}`} />{value[1]}</span> }
function Brand() { return <div className="flex h-10 items-center gap-2.5 px-2"><div className="grid size-8 place-items-center rounded-lg bg-foreground text-background"><Database className="size-4" /></div><div><div className="text-sm font-semibold">EasySSH</div><div className="text-[10px] tracking-[.18em] text-muted-foreground uppercase">Ops workspace</div></div></div> }
function Nav({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void }) { return <button onClick={onClick} className={`flex h-9 w-full items-center gap-3 rounded-lg px-3 transition ${active ? "bg-sidebar-accent font-medium" : "text-muted-foreground hover:bg-sidebar-accent"}`}><span className="[&_svg]:size-4">{icon}</span>{label}</button> }
export default DatabasesPage
