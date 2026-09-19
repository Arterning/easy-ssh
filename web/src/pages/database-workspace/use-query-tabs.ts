import { useEffect, useRef, useState } from "react"
import { databasesApi, type QueryResult, type SavedQuery } from "@/api/databases"

export type QueryTab = { id: string; name: string; sql: string; savedId?: number; savedSQL?: string; result: QueryResult | null; resultTab: "result" | "message"; executing: boolean; queryError: string; executedSQL: string }
function newTab(name: string, sql = "") : QueryTab { return { id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`, name, sql, result: null, resultTab: "result", executing: false, queryError: "", executedSQL: "" } }
export function isDirty(tab: QueryTab) { return tab.savedId ? tab.sql !== tab.savedSQL : Boolean(tab.sql.trim()) }
function restore(databaseId: number) {
  try {
    const data = JSON.parse(localStorage.getItem(`easyssh.database.${databaseId}.tabs`) ?? "null")
    if (Array.isArray(data?.tabs) && data.tabs.length) {
      const tabs: QueryTab[] = data.tabs.filter((t: QueryTab) => typeof t.id === "string" && typeof t.name === "string" && typeof t.sql === "string").map((t: QueryTab) => ({ ...newTab(t.name, t.sql), id: t.id, savedId: typeof t.savedId === "number" ? t.savedId : undefined, savedSQL: typeof t.savedSQL === "string" ? t.savedSQL : undefined }))
      if (tabs.length) return { tabs, activeId: tabs.some(t => t.id === data.activeId) ? data.activeId as string : tabs[0].id }
    }
  } catch { /* Corrupt or unavailable storage falls back to a fresh draft. */ }
  let sql = "-- 在这里输入 SQL\nSELECT 1;"
  try { sql = localStorage.getItem(`easyssh.database.${databaseId}.sql`) ?? sql } catch { /* Storage may be disabled. */ }
  const tab = newTab("Query 1", sql)
  return { tabs: [tab], activeId: tab.id }
}
export function useQueryTabs(databaseId: number) {
  const [workspace, setWorkspace] = useState(() => restore(databaseId))
  const [saved, setSaved] = useState<SavedQuery[]>([])
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const controllers = useRef(new Map<string, AbortController>())
  const { tabs, activeId } = workspace
  const active = tabs.find(t => t.id === activeId) ?? tabs[0]
  useEffect(() => {
    let live = true
    databasesApi.queries(databaseId).then(items => { if (live) setSaved(items) }).catch((e: Error) => { if (live) setError(e.message) })
    const requests = controllers.current
    return () => { live = false; requests.forEach(c => c.abort()) }
  }, [databaseId])
  useEffect(() => {
    try {
      localStorage.setItem(`easyssh.database.${databaseId}.tabs`, JSON.stringify({ activeId, tabs: tabs.map(({ id, name, sql, savedId, savedSQL }) => ({ id, name, sql, savedId, savedSQL })) }))
    } catch {
      // Surface an external storage failure; this does not derive state from props.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError("本地草稿保存失败，请使用保存按钮将查询保存到服务器。")
    }
  }, [databaseId, tabs, activeId])
  function update(id: string, patch: Partial<QueryTab>) { setWorkspace(w => ({ ...w, tabs: w.tabs.map(t => t.id === id ? { ...t, ...patch } : t) })) }
  function select(id: string) { setWorkspace(w => ({ ...w, activeId: id })) }
  function add(sql = "", name?: string, item?: SavedQuery) {
    const tab = newTab(name ?? `Query ${Math.max(0, ...tabs.map(t => Number(/^Query (\d+)$/.exec(t.name)?.[1] ?? 0))) + 1}`, sql)
    if (item) { tab.savedId = item.id; tab.savedSQL = item.sql }
    setWorkspace(w => ({ tabs: [...w.tabs, tab], activeId: tab.id }))
  }
  function close(tab: QueryTab) {
    if (savingRef.current) return
    if ((isDirty(tab) || tab.executing) && !window.confirm(tab.executing ? "关闭将取消此查询，并丢弃尚未保存的修改。继续吗？" : "此查询有尚未保存的修改，关闭并丢弃修改吗？")) return
    controllers.current.get(tab.id)?.abort()
    setWorkspace(w => {
      const remaining = w.tabs.filter(t => t.id !== tab.id)
      if (!remaining.length) remaining.push(newTab("Query 1"))
      return { tabs: remaining, activeId: w.activeId === tab.id ? remaining[Math.max(0, w.tabs.findIndex(t => t.id === tab.id) - 1)].id : w.activeId }
    })
  }
  function open(item: SavedQuery) { const existing = tabs.find(t => t.savedId === item.id); if (existing) select(existing.id); else add(item.sql, item.name, item) }
  async function save(tab = active) {
    if (savingRef.current || !tab.sql.trim()) return
    const name = tab.savedId ? tab.name : window.prompt("查询名称", tab.name)?.trim()
    if (!name) return
    savingRef.current = true; setSaving(true); setError("")
    try {
      const item = await databasesApi.saveQuery(databaseId, { name, sql: tab.sql }, tab.savedId)
      setSaved(items => [item, ...items.filter(s => s.id !== item.id)])
      update(tab.id, { savedId: item.id, name: item.name, savedSQL: item.sql })
    } catch (e) { setError((e as Error).message) }
    finally { savingRef.current = false; setSaving(false) }
  }
  async function rename(item: SavedQuery) {
    const name = window.prompt("查询名称", item.name)?.trim()
    if (!name || name === item.name || savingRef.current) return
    savingRef.current = true; setSaving(true); setError("")
    try {
      const next = await databasesApi.saveQuery(databaseId, { name, sql: item.sql }, item.id)
      setSaved(items => items.map(s => s.id === item.id ? next : s))
      setWorkspace(w => ({ ...w, tabs: w.tabs.map(t => t.savedId === item.id ? { ...t, name } : t) }))
    } catch (e) { setError((e as Error).message) }
    finally { savingRef.current = false; setSaving(false) }
  }
  async function remove(item: SavedQuery) {
    if (savingRef.current || !window.confirm(`删除已保存查询“${item.name}”？已打开的内容会保留为草稿。`)) return
    savingRef.current = true; setSaving(true); setError("")
    try {
      await databasesApi.deleteQuery(databaseId, item.id)
      setSaved(items => items.filter(s => s.id !== item.id))
      setWorkspace(w => ({ ...w, tabs: w.tabs.map(t => t.savedId === item.id ? { ...t, savedId: undefined, savedSQL: undefined } : t) }))
    } catch (e) { setError((e as Error).message) }
    finally { savingRef.current = false; setSaving(false) }
  }
  return { tabs, active, select, add, close, update, saved, error, saving, save, open, rename, remove, controllers }
}
