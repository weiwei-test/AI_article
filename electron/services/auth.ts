import * as electron from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const { app } = ((electron as unknown as { default?: unknown }).default ?? electron) as typeof import('electron')

export type UserRole = 'superadmin' | 'admin' | 'user'

export type StoredUser = {
  id: string
  username: string
  displayName: string
  role: UserRole
  passwordHash: string
  salt: string
  createdAt: string
  updatedAt: string
  lastLoginAt?: string
}

export type UserProfile = {
  id: string
  username: string
  displayName: string
  role: UserRole
  createdAt: string
  updatedAt: string
  lastLoginAt?: string
}

export type SessionAccount = {
  id: string
  username: string
  displayName: string
  role: UserRole
  lastLoginAt: string
}

const DEFAULT_SUPERADMIN = {
  username: 'admin',
  password: 'admin123456',
  displayName: '超级管理员',
} as const

function usersPath() {
  return path.join(app.getPath('userData'), 'users.json')
}

function normalizeUsername(username: string) {
  return String(username ?? '').trim().toLowerCase()
}

function hashPassword(password: string, salt: string) {
  return crypto.scryptSync(password, salt, 64).toString('hex')
}

function verifyPassword(password: string, salt: string, passwordHash: string) {
  const actual = Buffer.from(hashPassword(password, salt), 'hex')
  const expected = Buffer.from(passwordHash, 'hex')
  if (actual.length !== expected.length) return false
  return crypto.timingSafeEqual(actual, expected)
}

function toUserProfile(user: StoredUser): UserProfile {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
  }
}

function toSessionAccount(user: StoredUser): SessionAccount {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    lastLoginAt: user.lastLoginAt ?? user.updatedAt,
  }
}

async function saveUsers(users: StoredUser[]) {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(usersPath(), JSON.stringify(users, null, 2), 'utf8')
}

function validateUsername(username: string) {
  const normalized = normalizeUsername(username)
  if (!normalized) throw new Error('账号不能为空')
  if (!/^[a-zA-Z0-9_.@-]{3,32}$/.test(normalized)) {
    throw new Error('账号需为 3-32 位，只能包含字母、数字、点、下划线、减号或 @')
  }
  return normalized
}

function validatePassword(password: string) {
  const normalized = String(password ?? '')
  if (normalized.length < 6) throw new Error('密码至少 6 位')
  if (normalized.length > 64) throw new Error('密码不能超过 64 位')
  return normalized
}

function validateDisplayName(displayName: string, fallbackUsername: string) {
  const normalized = String(displayName ?? '').trim()
  if (!normalized) return fallbackUsername
  return normalized.slice(0, 24)
}

export async function loadUsers(): Promise<StoredUser[]> {
  try {
    const raw = await fs.readFile(usersPath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is StoredUser => Boolean(item && typeof item === 'object' && item.username))
  } catch {
    return []
  }
}

export async function ensureBootstrapSuperadmin(): Promise<StoredUser[]> {
  const users = await loadUsers()
  if (users.length > 0) return users

  const now = new Date().toISOString()
  const salt = crypto.randomBytes(16).toString('hex')
  const superadmin: StoredUser = {
    id: crypto.randomUUID(),
    username: DEFAULT_SUPERADMIN.username,
    displayName: DEFAULT_SUPERADMIN.displayName,
    role: 'superadmin',
    passwordHash: hashPassword(DEFAULT_SUPERADMIN.password, salt),
    salt,
    createdAt: now,
    updatedAt: now,
  }
  await saveUsers([superadmin])
  return [superadmin]
}

export async function registerUser(payload: {
  username: string
  password: string
  displayName?: string
}): Promise<UserProfile> {
  const users = await ensureBootstrapSuperadmin()
  const username = validateUsername(payload.username)
  const password = validatePassword(payload.password)
  if (users.some((user) => normalizeUsername(user.username) === username)) {
    throw new Error('账号已存在')
  }

  const now = new Date().toISOString()
  const salt = crypto.randomBytes(16).toString('hex')
  const nextUser: StoredUser = {
    id: crypto.randomUUID(),
    username,
    displayName: validateDisplayName(payload.displayName ?? '', username),
    role: 'user',
    passwordHash: hashPassword(password, salt),
    salt,
    createdAt: now,
    updatedAt: now,
  }
  const nextUsers = [...users, nextUser]
  await saveUsers(nextUsers)
  return toUserProfile(nextUser)
}

export async function loginUser(payload: { username: string; password: string }): Promise<SessionAccount> {
  const users = await ensureBootstrapSuperadmin()
  const username = validateUsername(payload.username)
  const password = validatePassword(payload.password)
  const idx = users.findIndex((user) => normalizeUsername(user.username) === username)
  if (idx < 0) throw new Error('账号或密码错误')
  const user = users[idx]
  if (!verifyPassword(password, user.salt, user.passwordHash)) {
    throw new Error('账号或密码错误')
  }
  const now = new Date().toISOString()
  const nextUser: StoredUser = {
    ...user,
    lastLoginAt: now,
    updatedAt: now,
  }
  const nextUsers = [...users]
  nextUsers[idx] = nextUser
  await saveUsers(nextUsers)
  return toSessionAccount(nextUser)
}

export async function listUserProfiles(): Promise<UserProfile[]> {
  const users = await ensureBootstrapSuperadmin()
  return users.map(toUserProfile)
}

export async function getUserProfileById(userId: string): Promise<UserProfile | null> {
  const users = await loadUsers()
  const user = users.find((u) => u.id === userId)
  return user ? toUserProfile(user) : null
}

export async function createUserByAdmin(payload: {
  username: string
  password: string
  displayName?: string
  role?: UserRole
}): Promise<UserProfile> {
  const users = await ensureBootstrapSuperadmin()
  const username = validateUsername(payload.username)
  const password = validatePassword(payload.password)
  const displayName = validateDisplayName(payload.displayName ?? '', username)
  const role: UserRole = payload.role === 'admin' || payload.role === 'superadmin' ? payload.role : 'user'
  if (users.some((user) => normalizeUsername(user.username) === username)) {
    throw new Error('账号已存在')
  }
  const now = new Date().toISOString()
  const salt = crypto.randomBytes(16).toString('hex')
  const nextUser: StoredUser = {
    id: crypto.randomUUID(),
    username,
    displayName,
    role,
    passwordHash: hashPassword(password, salt),
    salt,
    createdAt: now,
    updatedAt: now,
  }
  const nextUsers = [...users, nextUser]
  await saveUsers(nextUsers)
  return toUserProfile(nextUser)
}

export async function updateUserRole(payload: { userId: string; role: UserRole }): Promise<UserProfile> {
  const users = await ensureBootstrapSuperadmin()
  const idx = users.findIndex((user) => user.id === payload.userId)
  if (idx < 0) throw new Error('用户不存在')
  const nextRole: UserRole = payload.role === 'superadmin' || payload.role === 'admin' ? payload.role : 'user'
  const current = users[idx]
  if (current.role === 'superadmin' && nextRole !== 'superadmin') {
    const superadmins = users.filter((user) => user.role === 'superadmin')
    if (superadmins.length <= 1) throw new Error('至少需要保留一个超管')
  }
  const nextUser: StoredUser = {
    ...current,
    role: nextRole,
    updatedAt: new Date().toISOString(),
  }
  const nextUsers = [...users]
  nextUsers[idx] = nextUser
  await saveUsers(nextUsers)
  return toUserProfile(nextUser)
}

export async function resetUserPassword(payload: { userId: string; password: string }): Promise<UserProfile> {
  const users = await ensureBootstrapSuperadmin()
  const idx = users.findIndex((user) => user.id === payload.userId)
  if (idx < 0) throw new Error('用户不存在')
  const password = validatePassword(payload.password)
  const salt = crypto.randomBytes(16).toString('hex')
  const nextUser: StoredUser = {
    ...users[idx],
    salt,
    passwordHash: hashPassword(password, salt),
    updatedAt: new Date().toISOString(),
  }
  const nextUsers = [...users]
  nextUsers[idx] = nextUser
  await saveUsers(nextUsers)
  return toUserProfile(nextUser)
}

export async function deleteUser(payload: { userId: string }): Promise<void> {
  const users = await ensureBootstrapSuperadmin()
  const idx = users.findIndex((user) => user.id === payload.userId)
  if (idx < 0) throw new Error('用户不存在')
  const current = users[idx]
  if (current.role === 'superadmin') {
    const superadmins = users.filter((user) => user.role === 'superadmin')
    if (superadmins.length <= 1) throw new Error('至少需要保留一个超管')
  }
  const nextUsers = users.filter((user) => user.id !== payload.userId)
  await saveUsers(nextUsers)
}
