import * as electron from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { UserRole } from './auth'

const { app, safeStorage } = ((electron as unknown as { default?: unknown }).default ?? electron) as typeof import('electron')

export type AppSettings = {
  baseUrl: string
  modelId: string
  videoBaseUrl?: string
  videoModelId?: string
  coverModelId?: string
  imageBaseUrl?: string
  apiKeyEncrypted?: string
  imageApiKeyEncrypted?: string
  videoApiKeyEncrypted?: string
  adminAppKeyEncrypted?: string
  publisherUrl?: string
  account?: {
    id: string
    username: string
    displayName: string
    role: UserRole
    lastLoginAt: string
  } | null
}

const LEGACY_PUBLISHER_URL = 'https://writer.fanqienovel.com/'
const DEFAULT_PUBLISHER_URL = 'https://fanqienovel.com/main/writer/home'

const DEFAULT_SETTINGS: AppSettings = {
  baseUrl: 'http://localhost:11434',
  modelId: '',
  videoBaseUrl: '',
  videoModelId: '',
  coverModelId: '',
  imageBaseUrl: '',
  publisherUrl: DEFAULT_PUBLISHER_URL,
  account: null,
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    const merged = { ...DEFAULT_SETTINGS, ...parsed }
    if (!merged.publisherUrl || merged.publisherUrl === LEGACY_PUBLISHER_URL) {
      merged.publisherUrl = DEFAULT_PUBLISHER_URL
    }
    return merged
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveSettings(next: AppSettings): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
}

export function encryptApiKey(apiKey: string): string {
  if (!apiKey) return ''
  if (!safeStorage.isEncryptionAvailable()) return apiKey
  return safeStorage.encryptString(apiKey).toString('base64')
}

export function decryptApiKey(apiKeyEncrypted?: string): string {
  if (!apiKeyEncrypted) return ''
  if (!safeStorage.isEncryptionAvailable()) return apiKeyEncrypted
  try {
    return safeStorage.decryptString(Buffer.from(apiKeyEncrypted, 'base64'))
  } catch {
    return ''
  }
}
