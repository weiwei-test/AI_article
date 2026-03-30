import * as electron from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

const { app } = ((electron as unknown as { default?: unknown }).default ?? electron) as typeof import('electron')

export type BillingType = 'recharge' | 'consume'

export type BillingRecord = {
  id: string
  userId: string
  type: BillingType
  amount: number
  balanceAfter: number
  title: string
  note?: string
  createdAt: string
}

type BillingStore = {
  records: BillingRecord[]
}

function billingPath() {
  return path.join(app.getPath('userData'), 'billing.json')
}

async function loadStore(): Promise<BillingStore> {
  try {
    const raw = await fs.readFile(billingPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<BillingStore>
    return { records: Array.isArray(parsed.records) ? parsed.records : [] }
  } catch {
    return { records: [] }
  }
}

async function saveStore(store: BillingStore) {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(billingPath(), JSON.stringify(store, null, 2), 'utf8')
}

function getUserRecords(store: BillingStore, userId: string) {
  return store.records
    .filter((r) => r.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getBillingSummary(userId: string) {
  const store = await loadStore()
  const records = getUserRecords(store, userId)
  const balance = records[0]?.balanceAfter ?? 0
  return { balance, records: records.slice(0, 100) }
}

export async function addRecharge(input: { userId: string; amount: number; title?: string; note?: string }) {
  const amount = Math.max(1, Math.floor(Number(input.amount) || 0))
  const store = await loadStore()
  const records = getUserRecords(store, input.userId)
  const current = records[0]?.balanceAfter ?? 0
  const balanceAfter = current + amount
  const next: BillingRecord = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    userId: input.userId,
    type: 'recharge',
    amount,
    balanceAfter,
    title: input.title || '用户充值',
    note: input.note || '',
    createdAt: new Date().toISOString(),
  }
  store.records.push(next)
  await saveStore(store)
  return next
}

export async function addConsume(input: { userId: string; amount: number; title?: string; note?: string }) {
  const amount = Math.max(1, Math.floor(Number(input.amount) || 0))
  const store = await loadStore()
  const records = getUserRecords(store, input.userId)
  const current = records[0]?.balanceAfter ?? 0
  const balanceAfter = Math.max(0, current - amount)
  const next: BillingRecord = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    userId: input.userId,
    type: 'consume',
    amount,
    balanceAfter,
    title: input.title || '创作消耗',
    note: input.note || '',
    createdAt: new Date().toISOString(),
  }
  store.records.push(next)
  await saveStore(store)
  return next
}

