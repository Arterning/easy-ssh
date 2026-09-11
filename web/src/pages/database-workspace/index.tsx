import { useEffect, useState } from "react"
import { ArrowLeft, Database, LoaderCircle } from "lucide-react"
import { databasesApi, type DatabaseConnection } from "@/api/databases"
import { Button } from "@/components/ui/button"
import { navigate } from "@/router/navigation"

export function DatabaseWorkspacePage({ databaseId }: { databaseId: number }) {
  const [connection, setConnection] = useState<DatabaseConnection | null>(null)
  const [error, setError] = useState("")
  useEffect(() => { databasesApi.get(databaseId).then(setConnection).catch((e: Error) => setError(e.message)) }, [databaseId])
  return <main className="grid min-h-svh place-items-center bg-muted/25 p-6 text-center"><div className="max-w-lg"><div className="mx-auto grid size-14 place-items-center rounded-2xl border bg-background shadow-sm">{!connection && !error ? <LoaderCircle className="animate-spin" /> : <Database className="size-6" />}</div><h1 className="mt-5 text-2xl font-semibold">{connection?.name ?? "数据库工作台"}</h1><p className="mt-2 text-sm text-muted-foreground">{error || "连接已配置完成。SQL 编辑、表结构浏览和结果查看功能将在下一阶段实现。"}</p><Button variant="outline" className="mt-6" onClick={() => navigate("/databases")}><ArrowLeft />返回数据库列表</Button></div></main>
}
export default DatabaseWorkspacePage
