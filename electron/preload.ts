import { ipcRenderer, contextBridge } from 'electron'

const windowArg = process.argv.find((a) => a.startsWith('--ans-window='))
const windowType = windowArg?.split('=')[1] ?? 'main'
const isPublisher = windowType === 'publisher'

type InjectPayload = {
  title?: string
  content?: string
  clickPublish?: boolean
}

type InjectBookMetaPayload = {
  title?: string
  targetReader?: '男频' | '女频'
  tags?: string[]
  protagonists?: string[]
  intro?: string
}

type GenerationBookMetaPayload = {
  targetReader?: '男频' | '女频'
  tags?: string[]
  protagonists?: string[]
  intro?: string
}

type GenerationCompletionModePayload = 'completed' | 'ongoing'

function setValueOnElement(el: Element, value: string) {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    el.focus()
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (setter) setter.call(el, value)
    else el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return
  }

  if (el instanceof HTMLElement && el.isContentEditable) {
    el.focus()
    el.textContent = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return
  }
}

function findLikelyContentField(): Element | null {
  const active = document.activeElement
  if (active && active !== document.body) return active

  const textarea = document.querySelector('textarea')
  if (textarea) return textarea

  const editable = document.querySelector('[contenteditable="true"]')
  if (editable) return editable

  return null
}

function clickLikelyPublishButton() {
  const buttons = Array.from(document.querySelectorAll('button'))
  const target = buttons.find((b) => {
    const txt = (b.textContent || '').trim()
    return txt.includes('发布') || txt.includes('提交') || txt.includes('保存')
  })
  ;(target as HTMLButtonElement | undefined)?.click()
}

function normalizeText(s: string) {
  return String(s ?? '').replace(/\s+/g, ' ').trim()
}

function elementText(el: Element) {
  return normalizeText((el as HTMLElement).innerText || el.textContent || '')
}

function findByPlaceholder(patterns: string[]): Element | null {
  const inputs = Array.from(document.querySelectorAll('input, textarea'))
  for (const el of inputs) {
    const ph = normalizeText((el as HTMLInputElement).getAttribute('placeholder') || '')
    if (!ph) continue
    if (patterns.some((p) => ph.includes(p))) return el
  }
  return null
}

function findFormFieldByLabel(labelText: string): Element | null {
  const needles = [labelText, labelText.replace(/\s+/g, '')].filter(Boolean)
  const candidates = Array.from(document.querySelectorAll('label, div, span, p'))
  const label = candidates.find((el) => {
    const t = elementText(el)
    return t && needles.some((n) => t.includes(n))
  })
  if (!label) return null

  const container = label.closest('div') ?? label.parentElement
  const roots = [container, container?.parentElement, container?.parentElement?.parentElement].filter(Boolean) as Element[]
  for (const r of roots) {
    const input = r.querySelector('input, textarea, [contenteditable="true"]')
    if (input) return input
  }
  return null
}

function clickChoiceByText(text: string) {
  const targetText = normalizeText(text)
  if (!targetText) return
  const clickable = Array.from(document.querySelectorAll('label, button, [role="radio"], [role="tab"], span, div'))
  const hit = clickable.find((el) => elementText(el) === targetText || elementText(el).includes(targetText))
  ;(hit as HTMLElement | null)?.click?.()
}

function dispatchEnter(el: Element) {
  const target = el as HTMLElement
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
  target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }))
}

function tryFillTags(tags: string[]) {
  const input =
    findFormFieldByLabel('标签') ||
    findByPlaceholder(['标签', '选择标签', '请输入标签']) ||
    findByPlaceholder(['tag', 'Tag'])
  if (!input) return false

  for (const t of tags) {
    const v = normalizeText(t)
    if (!v) continue
    setValueOnElement(input, v)
    dispatchEnter(input)
    setValueOnElement(input, '')
  }
  return true
}

function fillBookMeta(payload: InjectBookMetaPayload) {
  const bookTitle = normalizeText(payload.title || '')
  const intro = normalizeText(payload.intro || '')
  const targetReader = normalizeText(payload.targetReader || '')
  const tags = Array.isArray(payload.tags) ? payload.tags.map((t) => normalizeText(t)).filter(Boolean) : []
  const protagonists = Array.isArray(payload.protagonists)
    ? payload.protagonists.map((t) => normalizeText(t)).filter(Boolean)
    : []

  if (bookTitle) {
    const titleInput =
      findFormFieldByLabel('书本名称') ||
      findFormFieldByLabel('书名') ||
      findByPlaceholder(['书本名称', '书名', '作品名称', '名称'])
    if (titleInput) setValueOnElement(titleInput, bookTitle)
  }

  if (targetReader) {
    clickChoiceByText(targetReader)
  }

  if (tags.length) {
    tryFillTags(tags.slice(0, 8))
  }

  if (protagonists.length) {
    const mainChar =
      findFormFieldByLabel('主角名') ||
      findFormFieldByLabel('主角') ||
      findByPlaceholder(['主角', '主角名'])
    if (mainChar) setValueOnElement(mainChar, protagonists.slice(0, 3).join('，'))
  }

  if (intro) {
    const introField =
      findFormFieldByLabel('作品简介') ||
      findFormFieldByLabel('简介') ||
      findByPlaceholder(['作品简介', '简介'])
    if (introField) setValueOnElement(introField, intro)
  }
}

ipcRenderer.on('publisher:inject', (_event, payload: InjectPayload) => {
  if (!isPublisher) return
  const { title, content, clickPublish } = payload || {}

  if (title) {
    const titleInput =
      document.querySelector('input[placeholder*="标题"]') ||
      document.querySelector('input[placeholder*="章"]') ||
      document.querySelector('input[type="text"]')
    if (titleInput) setValueOnElement(titleInput, title)
  }

  if (content) {
    const field = findLikelyContentField()
    if (field) setValueOnElement(field, content)
  }

  if (clickPublish) clickLikelyPublishButton()
})

ipcRenderer.on('publisher:injectBookMeta', (_event, payload: InjectBookMetaPayload) => {
  if (!isPublisher) return
  try {
    fillBookMeta(payload ?? {})
  } catch {
    // ignore
  }
})

if (isPublisher) {
  contextBridge.exposeInMainWorld('publisherBridge', { ready: true })
} else {
  contextBridge.exposeInMainWorld('api', {
    settings: {
      get: () => ipcRenderer.invoke('settings:get'),
      set: (patch: {
        baseUrl?: string
        modelId?: string
        videoBaseUrl?: string
        videoModelId?: string
        coverModelId?: string
        imageBaseUrl?: string
        apiKey?: string
        imageApiKey?: string
        videoApiKey?: string
        adminAppKey?: string
        publisherUrl?: string
      }) => ipcRenderer.invoke('settings:set', patch),
      listModels: (payload?: { target?: 'text' | 'image' | 'video' }) => ipcRenderer.invoke('ai:listModels', payload),
    },
    auth: {
      getSession: () => ipcRenderer.invoke('auth:getSession'),
      register: (payload: { username: string; password: string; displayName?: string }) =>
        ipcRenderer.invoke('auth:register', payload),
      login: (payload: { username: string; password: string }) => ipcRenderer.invoke('auth:login', payload),
      logout: () => ipcRenderer.invoke('auth:logout'),
      users: {
        list: () => ipcRenderer.invoke('auth:users:list'),
        create: (payload: { username: string; password: string; displayName?: string; role?: 'superadmin' | 'admin' | 'user' }) =>
          ipcRenderer.invoke('auth:users:create', payload),
        updateRole: (payload: { userId: string; role: 'superadmin' | 'admin' | 'user' }) =>
          ipcRenderer.invoke('auth:users:updateRole', payload),
        resetPassword: (payload: { userId: string; password: string }) =>
          ipcRenderer.invoke('auth:users:resetPassword', payload),
        delete: (payload: { userId: string }) => ipcRenderer.invoke('auth:users:delete', payload),
      },
    },
    billing: {
      get: () => ipcRenderer.invoke('billing:get'),
      recharge: (payload: { amount: number; title?: string; note?: string }) => ipcRenderer.invoke('billing:recharge', payload),
      mockConsume: (payload: { amount: number; title?: string; note?: string }) =>
        ipcRenderer.invoke('billing:mockConsume', payload),
    },
    generation: {
      start: (payload: {
        title: string
        chapterCount: number
        bookMeta?: GenerationBookMetaPayload
        completionMode?: GenerationCompletionModePayload
        projectDir?: string
      }) =>
        ipcRenderer.invoke('gen:start', payload),
      cancel: (payload: { jobId: string }) => ipcRenderer.invoke('gen:cancel', payload),
      onEvent: (cb: (ev: unknown) => void) => {
        const listener = (_event: unknown, ev: unknown) => cb(ev)
        ipcRenderer.on('gen:event', listener)
        return () => ipcRenderer.off('gen:event', listener)
      },
    },
    projects: {
      list: () => ipcRenderer.invoke('projects:list'),
      state: (payload: { projectDir: string }) => ipcRenderer.invoke('projects:state', payload),
      detail: (payload: { projectDir: string }) => ipcRenderer.invoke('projects:detail', payload),
      chapters: (payload: { projectDir: string }) => ipcRenderer.invoke('projects:chapters', payload),
      reveal: (payload: { path: string }) => ipcRenderer.invoke('projects:reveal', payload),
    },
    comic: {
      start: (payload: {
        projectDir: string
        chapterFrom: number
        chapterTo: number
        chapterIndices?: number[]
        styleHint?: string
      }) => ipcRenderer.invoke('comic:start', payload),
      cancel: (payload: { jobId: string }) => ipcRenderer.invoke('comic:cancel', payload),
      onEvent: (cb: (ev: unknown) => void) => {
        const listener = (_event: unknown, ev: unknown) => cb(ev)
        ipcRenderer.on('comic:event', listener)
        return () => ipcRenderer.off('comic:event', listener)
      },
    },
    video: {
      start: (payload: {
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
      }) => ipcRenderer.invoke('video:start', payload),
      makeShots: (payload: {
        projectDir: string
        chapterIndices: number[]
        shotCount: number
        secondsPerShot: number
        videoStyleHint?: string
      }) => ipcRenderer.invoke('video:makeShots', payload),
      cancel: (payload: { jobId: string }) => ipcRenderer.invoke('video:cancel', payload),
      onEvent: (cb: (ev: unknown) => void) => {
        const listener = (_event: unknown, ev: unknown) => cb(ev)
        ipcRenderer.on('video:event', listener)
        return () => ipcRenderer.off('video:event', listener)
      },
    },
    publisher: {
      open: () => ipcRenderer.invoke('publisher:open'),
      inject: (payload: { title?: string; content?: string; clickPublish?: boolean }) =>
        ipcRenderer.invoke('publisher:inject', payload),
      generateBookMeta: (payload: { title: string }) => ipcRenderer.invoke('publisher:generateBookMeta', payload),
      injectBookMeta: (payload: {
        title?: string
        targetReader?: '男频' | '女频'
        tags?: string[]
        protagonists?: string[]
        intro?: string
      }) => ipcRenderer.invoke('publisher:injectBookMeta', payload),
    },
    cover: {
      generate: (payload: {
        title: string
        targetReader?: '男频' | '女频'
        tags?: string[]
        protagonists?: string[]
        intro?: string
      }) => ipcRenderer.invoke('cover:generate', payload),
    },
    os: {
      openExternal: (payload: { url: string }) => ipcRenderer.invoke('os:openExternal', payload),
    },
    debug: {
      openDevTools: () => ipcRenderer.invoke('debug:openDevTools'),
    },
  })
}
