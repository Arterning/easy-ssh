import { request } from "@/api/client"

export type DatabaseType = "sqlite" | "mysql" | "postgres"
export type DatabaseStatus = "online" | "offline" | "unknown"
export type DatabaseConnection = {
  id: number
  name: string
  type: DatabaseType
  address: string
  port: number
  databaseName: string
  username: string
  sqlitePath: string
  sslMode: string
  useSshTunnel: boolean
  sshHostId: number | null
  group: string
  tags: string[]
  note: string
  status: DatabaseStatus
  lastError: string
  hasCredential: boolean
  lastTestedAt: string | null
  createdAt: string
  updatedAt: string
}
export type DatabaseInput = Omit<
  DatabaseConnection,
  | "id"
  | "status"
  | "lastError"
  | "hasCredential"
  | "lastTestedAt"
  | "createdAt"
  | "updatedAt"
> & { password?: string; connectionId?: number }
export type ConnectionResult = { success: boolean; message: string; latencyMs?: number }
export type DatabaseColumn = { name: string; type: string; nullable: boolean; primaryKey: boolean }
export type DatabaseTable = { name: string; columns: DatabaseColumn[] }
export type DatabaseSchema = { name: string; tables: DatabaseTable[] }
export type DatabaseSchemaResult = { schemas: DatabaseSchema[] }
export type QueryColumn = { name: string; type: string }
export type QueryResult = { kind: "rows" | "command"; columns: QueryColumn[]; rows: unknown[][]; rowsAffected: number; durationMs: number; truncated: boolean; message: string }

export const databasesApi = {
  list: () => request<DatabaseConnection[]>("/databases"),
  get: (id: number) => request<DatabaseConnection>(`/databases/${id}`),
  create: (input: DatabaseInput) => request<DatabaseConnection>("/databases", { method: "POST", body: JSON.stringify(input) }),
  update: (id: number, input: DatabaseInput) => request<DatabaseConnection>(`/databases/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  remove: (id: number) => request<void>(`/databases/${id}`, { method: "DELETE" }),
  test: (input: DatabaseInput) => request<ConnectionResult>("/databases/test", { method: "POST", body: JSON.stringify(input) }),
  testSaved: (id: number) => request<ConnectionResult>(`/databases/${id}/test`, { method: "POST" }),
  schema: (id: number, signal?: AbortSignal) => request<DatabaseSchemaResult>(`/databases/${id}/schema`, { signal }),
  execute: (id: number, sql: string, confirmed: boolean, signal?: AbortSignal) => request<QueryResult>(`/databases/${id}/execute`, { method: "POST", body: JSON.stringify({ sql, confirmed }), signal }),
}
