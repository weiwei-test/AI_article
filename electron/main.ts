import * as electron from 'electron'
import type { BrowserWindow as BrowserWindowType } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { listModels } from './services/ai'
import { startGeneration, cancelGeneration, type GenerationBookMeta, type GenerationCompletionMode } from './services/generation'
import { cancelComicGeneration, startComicGeneration } from './services/comic'
import { cancelVideoGeneration, makeVideoShotsFromChapters, startVideoStitchGeneration } from './services/video'
import { generateBookMeta } from './services/publisherMeta'
import { generateNovelCover } from './services/cover'
import { decryptApiKey, encryptApiKey, loadSettings, saveSettings, type AppSettings } from './services/settings'
import { listProjects, readProjectChapters, readProjectDetail, readProjectState, revealInFolder } from './services/projects'
import { addConsume, addRecharge, getBillingSummary } from './services/billing'
import {
  createUserByAdmin,
  deleteUser,
  ensureBootstrapSuperadmin,
  getUserProfileById,
  listUserProfiles,
  loginUser,
  registerUser,
  resetUserPassword,
  updateUserRole,
  type SessionAccount,
} from './services/auth'

const { app, BrowserWindow, ipcMain, shell } = ((electron as unknown as { default?: unknown }).default ?? electron) as typeof import('electron')

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindowType | null
let publisherWin: BrowserWindowType | null
let settingsCache: AppSettings | null = null

function toRendererSettings(s: AppSettings) {
  return {
    baseUrl: s.baseUrl,
    modelId: s.modelId,
    videoBaseUrl: s.videoBaseUrl ?? '',
    videoModelId: s.videoModelId ?? '',
    coverModelId: s.coverModelId ?? '',
    imageBaseUrl: s.imageBaseUrl ?? '',
    publisherUrl: s.publisherUrl,
    hasApiKey: Boolean(decryptApiKey(s.apiKeyEncrypted)),
    hasImageApiKey: Boolean(decryptApiKey(s.imageApiKeyEncrypted)),
    hasVideoApiKey: Boolean(decryptApiKey(s.videoApiKeyEncrypted)),
    hasAdminAppKey: Boolean(decryptApiKey(s.adminAppKeyEncrypted)),
  }
}

function getSessionAccount(s: AppSettings) {
  return s.account ?? null
}

async function setSessionAccount(account: SessionAccount | null) {
  const current = await getSettings()
  const next: AppSettings = {
    ...current,
    account: account
      ? {
          id: account.id,
          username: account.username,
          displayName: account.displayName,
          role: account.role,
          lastLoginAt: account.lastLoginAt,
        }
      : null,
  }
  settingsCache = next
  await saveSettings(next)
  return next.account ?? null
}

async function requireAuthAccount() {
  const s = await getSettings()
  const session = getSessionAccount(s)
  if (!session?.id) throw new Error('请先登录')
  const user = await getUserProfileById(session.id)
  if (!user) {
    await setSessionAccount(null)
    throw new Error('登录已失效，请重新登录')
  }
  return user
}

async function requireSuperadmin() {
  const user = await requireAuthAccount()
  if (user.role !== 'superadmin') throw new Error('无权限：仅超管可操作')
  return user
}

async function getSettings() {
  settingsCache ??= await loadSettings()
  return settingsCache
}

async function setSettings(
  patch: Partial<{
    baseUrl: string
    modelId: string
    videoBaseUrl: string
    videoModelId: string
    coverModelId: string
    imageBaseUrl: string
    apiKey: string
    imageApiKey: string
    videoApiKey: string
    adminAppKey: string
    publisherUrl: string
  }>,
) {
  const current = await getSettings()
  const next: AppSettings = {
    ...current,
    baseUrl: patch.baseUrl ?? current.baseUrl,
    modelId: patch.modelId ?? current.modelId,
    videoBaseUrl: patch.videoBaseUrl ?? current.videoBaseUrl,
    videoModelId: patch.videoModelId ?? current.videoModelId,
    coverModelId: patch.coverModelId ?? current.coverModelId,
    imageBaseUrl: patch.imageBaseUrl ?? current.imageBaseUrl,
    publisherUrl: patch.publisherUrl ?? current.publisherUrl,
    apiKeyEncrypted:
      patch.apiKey === undefined ? current.apiKeyEncrypted : patch.apiKey ? encryptApiKey(patch.apiKey) : undefined,
    imageApiKeyEncrypted:
      patch.imageApiKey === undefined
        ? current.imageApiKeyEncrypted
        : patch.imageApiKey
          ? encryptApiKey(patch.imageApiKey)
          : undefined,
    videoApiKeyEncrypted:
      patch.videoApiKey === undefined
        ? current.videoApiKeyEncrypted
        : patch.videoApiKey
          ? encryptApiKey(patch.videoApiKey)
          : undefined,
    adminAppKeyEncrypted:
      patch.adminAppKey === undefined
        ? current.adminAppKeyEncrypted
        : patch.adminAppKey
          ? encryptApiKey(patch.adminAppKey)
          : undefined,
    account: current.account ?? null,
  }
  settingsCache = next
  await saveSettings(next)
  return next
}

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    width: 1100,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: ['--ans-window=main'],
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function createPublisherWindow(url: string) {
  if (publisherWin && !publisherWin.isDestroyed()) {
    publisherWin.focus()
    publisherWin.loadURL(url)
    return publisherWin
  }

  publisherWin = new BrowserWindow({
    width: 1100,
    height: 800,
    title: '番茄发布（实验）',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: ['--ans-window=publisher'],
    },
  })

  publisherWin.on('closed', () => {
    publisherWin = null
  })

  publisherWin.loadURL(url)
  return publisherWin
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
    publisherWin = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(async () => {
  await ensureBootstrapSuperadmin()
  createWindow()

  ipcMain.handle('settings:get', async () => {
    const s = await getSettings()
    return toRendererSettings(s)
  })

  ipcMain.handle('settings:set', async (_ev, patch) => {
    await requireSuperadmin()
    const next = await setSettings(patch ?? {})
    return toRendererSettings(next)
  })

  ipcMain.handle('auth:getSession', async () => {
    const s = await getSettings()
    const session = getSessionAccount(s)
    if (!session?.id) return { account: null }
    const profile = await getUserProfileById(session.id)
    if (!profile) {
      await setSessionAccount(null)
      return { account: null }
    }
    const next: SessionAccount = {
      id: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      role: profile.role,
      lastLoginAt: profile.lastLoginAt ?? session.lastLoginAt,
    }
    await setSessionAccount(next)
    return { account: next }
  })

  ipcMain.handle('auth:register', async (_ev, payload: { username: string; password: string; displayName?: string }) => {
    await registerUser(payload ?? { username: '', password: '' })
    return { ok: true }
  })

  ipcMain.handle('auth:login', async (_ev, payload: { username: string; password: string }) => {
    const session = await loginUser(payload ?? { username: '', password: '' })
    await setSessionAccount(session)
    return { account: session }
  })

  ipcMain.handle('auth:logout', async () => {
    await setSessionAccount(null);
    return { ok: true };
  })

  ipcMain.handle('auth:users:list', async () => {
    await requireSuperadmin()
    const users = await listUserProfiles()
    return { users }
  })

  ipcMain.handle(
    'auth:users:create',
    async (_ev, payload: { username: string; password: string; displayName?: string; role?: 'superadmin' | 'admin' | 'user' }) => {
      await requireSuperadmin()
      const user = await createUserByAdmin(payload ?? { username: '', password: '' })
      return { user }
    },
  )

  ipcMain.handle('auth:users:updateRole', async (_ev, payload: { userId: string; role: 'superadmin' | 'admin' | 'user' }) => {
    await requireSuperadmin()
    const user = await updateUserRole(payload ?? { userId: '', role: 'user' })
    const s = await getSettings()
    if (s.account?.id === user.id) {
      await setSessionAccount({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        lastLoginAt: s.account.lastLoginAt,
      })
    }
    return { user }
  })

  ipcMain.handle('auth:users:resetPassword', async (_ev, payload: { userId: string; password: string }) => {
    await requireSuperadmin()
    const user = await resetUserPassword(payload ?? { userId: '', password: '' })
    return { user }
  })

  ipcMain.handle('auth:users:delete', async (_ev, payload: { userId: string }) => {
    const current = await requireSuperadmin()
    await deleteUser(payload ?? { userId: '' })
    if (current.id === payload?.userId) {
      await setSessionAccount(null)
    }
    return { ok: true }
  })

  ipcMain.handle('billing:get', async () => {
    const user = await requireAuthAccount()
    return await getBillingSummary(user.id)
  })

  ipcMain.handle('billing:recharge', async (_ev, payload: { amount: number; title?: string; note?: string }) => {
    const user = await requireAuthAccount()
    await addRecharge({
      userId: user.id,
      amount: Number(payload?.amount ?? 0),
      title: String(payload?.title ?? '用户充值'),
      note: String(payload?.note ?? ''),
    })
    return await getBillingSummary(user.id)
  })

  ipcMain.handle('billing:mockConsume', async (_ev, payload: { amount: number; title?: string; note?: string }) => {
    const user = await requireAuthAccount()
    await addConsume({
      userId: user.id,
      amount: Number(payload?.amount ?? 0),
      title: String(payload?.title ?? '创作消耗'),
      note: String(payload?.note ?? ''),
    })
    return await getBillingSummary(user.id)
  })

  ipcMain.handle('ai:listModels', async (_ev, payload: { target?: 'text' | 'image' | 'video' } | undefined) => {
    await requireSuperadmin()
    const s = await getSettings()
    const target = payload?.target ?? 'text'
    const textBaseUrl = String(s.baseUrl ?? '').trim()
    const textApiKey = decryptApiKey(s.apiKeyEncrypted)
    const imageBaseUrl = String(s.imageBaseUrl ?? '').trim() || textBaseUrl
    const imageApiKey = decryptApiKey(s.imageApiKeyEncrypted) || textApiKey
    const videoBaseUrl = String(s.videoBaseUrl ?? '').trim() || textBaseUrl
    const videoApiKey = decryptApiKey(s.videoApiKeyEncrypted) || textApiKey

    const baseUrl = target === 'image' ? imageBaseUrl : target === 'video' ? videoBaseUrl : textBaseUrl
    const apiKey = target === 'image' ? imageApiKey : target === 'video' ? videoApiKey : textApiKey
    return await listModels({ baseUrl, apiKey })
  })

  ipcMain.handle(
    'gen:start',
    async (
      _ev,
      payload: {
        title: string
        chapterCount: number
        bookMeta?: GenerationBookMeta
        completionMode?: GenerationCompletionMode
        projectDir?: string
      },
    ) => {
    const s = await getSettings()
    const jobId = startGeneration({
      settings: s,
      title: payload?.title ?? '',
      chapterCount: payload?.chapterCount ?? 1,
      bookMeta: payload?.bookMeta,
      completionMode: payload?.completionMode,
      projectDir: payload?.projectDir ?? '',
      emit: (e) => win?.webContents.send('gen:event', e),
    })
    return { jobId }
    },
  )

  ipcMain.handle('gen:cancel', async (_ev, payload: { jobId: string }) => {
    if (payload?.jobId) cancelGeneration(payload.jobId)
    return { ok: true }
  })

  ipcMain.handle('projects:list', async () => {
    return await listProjects()
  })

  ipcMain.handle('projects:state', async (_ev, payload: { projectDir: string }) => {
    return await readProjectState(payload?.projectDir ?? '')
  })

  ipcMain.handle('projects:detail', async (_ev, payload: { projectDir: string }) => {
    return await readProjectDetail(payload?.projectDir ?? '')
  })

  ipcMain.handle('projects:chapters', async (_ev, payload: { projectDir: string }) => {
    return await readProjectChapters(payload?.projectDir ?? '')
  })

  ipcMain.handle('projects:reveal', async (_ev, payload: { path: string }) => {
    await revealInFolder(payload?.path ?? '')
    return { ok: true }
  })

  ipcMain.handle('os:openExternal', async (_ev, payload: { url: string }) => {
    const url = String(payload?.url ?? '')
    if (url) await shell.openExternal(url)
    return { ok: true }
  })

  ipcMain.handle('debug:openDevTools', async () => {
    if (!win || win.isDestroyed()) return { ok: false }
    win.webContents.openDevTools({ mode: 'detach' })
    win.focus()
    return { ok: true }
  })

  ipcMain.handle('publisher:open', async () => {
    const s = await getSettings()
    const url = s.publisherUrl || 'https://fanqienovel.com/main/writer/home'
    createPublisherWindow(url)
    return { ok: true }
  })

  ipcMain.handle(
    'publisher:inject',
    async (_ev, payload: { title?: string; content?: string; clickPublish?: boolean }) => {
      if (!publisherWin || publisherWin.isDestroyed()) return { ok: false, error: 'publisher window not open' }
      publisherWin.webContents.send('publisher:inject', payload ?? {})
      publisherWin.focus()
      return { ok: true }
    },
  )

  ipcMain.handle(
    'publisher:injectBookMeta',
    async (
      _ev,
      payload: {
        title?: string
        targetReader?: '男频' | '女频'
        tags?: string[]
        protagonists?: string[]
        intro?: string
      },
    ) => {
      if (!publisherWin || publisherWin.isDestroyed()) return { ok: false, error: 'publisher window not open' }
      publisherWin.webContents.send('publisher:injectBookMeta', payload ?? {})
      publisherWin.focus()
      return { ok: true }
    },
  )

  ipcMain.handle('publisher:generateBookMeta', async (_ev, payload: { title: string }) => {
    const s = await getSettings()
    const meta = await generateBookMeta({ settings: s, title: String(payload?.title ?? '') })
    return { meta }
  })

  ipcMain.handle(
    'cover:generate',
    async (
      _ev,
      payload: {
        title: string
        targetReader?: '男频' | '女频'
        tags?: string[]
        protagonists?: string[]
        intro?: string
      },
    ) => {
      const s = await getSettings()
      return await generateNovelCover({ settings: s, meta: payload ?? { title: '' } })
    },
  )

  ipcMain.handle(
    'comic:start',
    async (
      _ev,
      payload: { projectDir: string; chapterFrom: number; chapterTo: number; chapterIndices?: number[]; styleHint?: string },
    ) => {
      const s = await getSettings()
      const jobId = startComicGeneration({
        settings: s,
        projectDir: payload?.projectDir ?? '',
        chapterFrom: payload?.chapterFrom ?? 1,
        chapterTo: payload?.chapterTo ?? 1,
        chapterIndices: payload?.chapterIndices,
        styleHint: payload?.styleHint ?? '',
        emit: (e) => win?.webContents.send('comic:event', e),
      })
      return { jobId }
    },
  )

  ipcMain.handle('comic:cancel', async (_ev, payload: { jobId: string }) => {
    if (payload?.jobId) cancelComicGeneration(payload.jobId)
    return { ok: true }
  })

  ipcMain.handle(
    'video:start',
    async (
      _ev,
      payload: {
        model: string
        prompt: string
        seconds: number
        chunkSeconds: number
        size?: string
        quality?: string
        shots?: string[]
        continuityHint?: string
        ffmpegPath?: string
        outName?: string
      },
    ) => {
      const s = await getSettings()
      const textApiKey = decryptApiKey(s.apiKeyEncrypted)
      const videoApiKey = decryptApiKey(s.videoApiKeyEncrypted) || textApiKey
      const adminKey = decryptApiKey(s.adminAppKeyEncrypted)
      const baseUrl = String(s.videoBaseUrl ?? '').trim() || String(s.baseUrl ?? '').trim()
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const workdir = path.join(app.getPath('userData'), 'video-stitch', stamp)
      const outDir = path.join(app.getPath('documents'), 'AI Novel Studio', 'videos')
      const safeOutName =
        String(payload?.outName || '').trim().replace(/[\\/:*?"<>|]/g, '_') ||
        `stitched_${Math.floor(Number(payload?.seconds ?? 0) || 0)}s_${stamp}.mp4`
      const outPath = path.join(outDir, safeOutName.endsWith('.mp4') ? safeOutName : `${safeOutName}.mp4`)

      const jobId = startVideoStitchGeneration({
        baseUrl,
        apiKey: videoApiKey,
        adminKey,
        model: String(payload?.model ?? '').trim() || String(s.videoModelId ?? '').trim(),
        prompt: String(payload?.prompt ?? ''),
        size: String(payload?.size ?? '720x1280'),
        quality: String(payload?.quality ?? 'standard'),
        totalSeconds: Number(payload?.seconds ?? 0),
        chunkSeconds: Number(payload?.chunkSeconds ?? 10),
        shots: Array.isArray(payload?.shots) ? payload.shots : [],
        continuityHint: String(payload?.continuityHint ?? ''),
        ffmpegPath: String(payload?.ffmpegPath ?? ''),
        workdir,
        outPath,
        emit: (e) => win?.webContents.send('video:event', e),
      })

      win?.webContents.send('video:event', {
        type: 'progress',
        jobId,
        phase: 'videos',
        message: '任务已提交，等待开始生成第一段…',
      })

      return { jobId, outPath }
    },
  )

  ipcMain.handle(
    'video:makeShots',
    async (
      _ev,
      payload: {
        projectDir: string
        chapterIndices: number[]
        shotCount: number
        secondsPerShot: number
        videoStyleHint?: string
      },
    ) => {
      const s = await getSettings()
      const shots = await makeVideoShotsFromChapters({
        settings: s,
        projectDir: String(payload?.projectDir ?? ''),
        chapterIndices: Array.isArray(payload?.chapterIndices) ? payload.chapterIndices : [],
        shotCount: Number(payload?.shotCount ?? 0),
        secondsPerShot: Number(payload?.secondsPerShot ?? 10),
        videoStyleHint: String(payload?.videoStyleHint ?? ''),
      })
      return { shots }
    },
  )

  ipcMain.handle('video:cancel', async (_ev, payload: { jobId: string }) => {
    if (payload?.jobId) cancelVideoGeneration(payload.jobId)
    return { ok: true }
  })
})
