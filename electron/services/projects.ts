import * as electron from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

const { app, shell } = ((electron as unknown as { default?: unknown }).default ?? electron) as typeof import('electron')

export type ProjectMeta = {
  id: string
  title: string
  createdAt: string
  dir: string
  chapterCount: number
}

export type ProjectState = {
  title: string
  chapterCount: number
  completed: Array<{ index: number; title: string; summary?: string }>
}

export type ProjectChapter = {
  index: number
  title: string
  content: string
  markdown: string
  summary?: string
}

export type ProjectBookMeta = {
  title: string
  targetReader?: '男频' | '女频'
  tags: string[]
  protagonists: string[]
  intro: string
  completionMode?: 'completed' | 'ongoing'
}

export type ProjectDetail = {
  project: ProjectMeta
  state: ProjectState & { nextChapterIndex?: number; completionMode?: 'completed' | 'ongoing' }
  bookMeta: ProjectBookMeta
}

function projectsRoot() {
  return path.join(app.getPath('documents'), 'AI Novel Studio')
}

export async function ensureProjectsRoot() {
  await fs.mkdir(projectsRoot(), { recursive: true })
  return projectsRoot()
}

export async function createProjectDir(title: string, chapterCount: number) {
  const root = await ensureProjectsRoot()
  const safeTitle = (title || '未命名').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
  const id = `${Date.now()}`
  const dir = path.join(root, `${safeTitle}-${id}`)
  await fs.mkdir(dir, { recursive: true })

  const meta: ProjectMeta = {
    id,
    title,
    createdAt: new Date().toISOString(),
    dir,
    chapterCount,
  }
  await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(meta, null, 2), 'utf8')
  return meta
}

export async function updateProjectMeta(projectDir: string, patch: Partial<Pick<ProjectMeta, 'title' | 'chapterCount'>>) {
  const metaPath = path.join(String(projectDir || ''), 'project.json')
  const raw = await fs.readFile(metaPath, 'utf8')
  const current = JSON.parse(raw) as ProjectMeta
  const next: ProjectMeta = {
    ...current,
    title: patch.title ?? current.title,
    chapterCount: typeof patch.chapterCount === 'number' ? patch.chapterCount : current.chapterCount,
  }
  await fs.writeFile(metaPath, JSON.stringify(next, null, 2), 'utf8')
  return next
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const root = await ensureProjectsRoot()
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const projects: ProjectMeta[] = []

  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const metaPath = path.join(root, ent.name, 'project.json')
    try {
      const raw = await fs.readFile(metaPath, 'utf8')
      projects.push(JSON.parse(raw) as ProjectMeta)
    } catch {
      // ignore
    }
  }

  projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return projects
}

export async function readProjectState(projectDir: string): Promise<ProjectState> {
  const dir = String(projectDir || '')
  if (!dir) throw new Error('projectDir 为空')

  const statePath = path.join(dir, 'state.json')
  try {
    const raw = await fs.readFile(statePath, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const title = typeof parsed.title === 'string' ? parsed.title : ''
    const chapterCount = typeof parsed.chapterCount === 'number' ? parsed.chapterCount : Number(parsed.chapterCount)
    const completedRaw = Array.isArray(parsed.completed) ? (parsed.completed as unknown[]) : []
    const completed = completedRaw
      .flatMap((c) => {
        if (!c || typeof c !== 'object') return []
        const rec = c as Record<string, unknown>
        const index = typeof rec.index === 'number' ? rec.index : Number(rec.index)
        const t = typeof rec.title === 'string' ? rec.title : ''
        const summary = typeof rec.summary === 'string' ? rec.summary : undefined
        if (!Number.isFinite(index) || index <= 0) return []
        const base: { index: number; title: string; summary?: string } = { index: Math.floor(index), title: t }
        if (summary) base.summary = summary
        return [base]
      })
      .sort((a, b) => a.index - b.index)

    return {
      title: title || path.basename(dir),
      chapterCount: Number.isFinite(chapterCount) ? Math.floor(chapterCount) : completed.length,
      completed,
    }
  } catch {
    throw new Error('读取 state.json 失败：请先在「创作中心」生成章节。')
  }
}

export async function readProjectDetail(projectDir: string): Promise<ProjectDetail> {
  const dir = String(projectDir || '')
  if (!dir) throw new Error('projectDir 为空')

  const [metaRaw, stateRaw, bookMetaRaw] = await Promise.all([
    fs.readFile(path.join(dir, 'project.json'), 'utf8'),
    fs.readFile(path.join(dir, 'state.json'), 'utf8'),
    fs.readFile(path.join(dir, 'book-meta.json'), 'utf8').catch(() => '{}'),
  ])

  const project = JSON.parse(metaRaw) as ProjectMeta
  const stateParsed = JSON.parse(stateRaw) as Record<string, unknown>
  const state = await readProjectState(dir)
  const nextChapterIndex = Number(stateParsed.nextChapterIndex)
  const completionMode =
    stateParsed.completionMode === 'ongoing' || stateParsed.completionMode === 'completed'
      ? stateParsed.completionMode
      : undefined

  let bookMetaParsed: Record<string, unknown> = {}
  try {
    bookMetaParsed = JSON.parse(bookMetaRaw) as Record<string, unknown>
  } catch {
    bookMetaParsed = {}
  }

  const bookMeta: ProjectBookMeta = {
    title: typeof bookMetaParsed.title === 'string' ? bookMetaParsed.title : state.title || project.title,
    targetReader: bookMetaParsed.targetReader === '女频' ? '女频' : '男频',
    tags: Array.isArray(bookMetaParsed.tags) ? bookMetaParsed.tags.map((x) => String(x).trim()).filter(Boolean) : [],
    protagonists: Array.isArray(bookMetaParsed.protagonists)
      ? bookMetaParsed.protagonists.map((x) => String(x).trim()).filter(Boolean)
      : [],
    intro: typeof bookMetaParsed.intro === 'string' ? bookMetaParsed.intro : '',
    completionMode:
      bookMetaParsed.completionMode === 'ongoing' || bookMetaParsed.completionMode === 'completed'
        ? bookMetaParsed.completionMode
        : completionMode,
  }

  return {
    project,
    state: {
      ...state,
      nextChapterIndex: Number.isFinite(nextChapterIndex) ? Math.floor(nextChapterIndex) : state.completed.length + 1,
      completionMode,
    },
    bookMeta,
  }
}

function normalizeChapterIndices(input: unknown): number[] {
  if (!Array.isArray(input)) return []
  const set = new Set<number>()
  for (const v of input) {
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n) || n <= 0) continue
    set.add(Math.floor(n))
  }
  return Array.from(set).sort((a, b) => a - b)
}

export async function readChaptersMarkdown(input: {
  projectDir: string
  chapterFrom?: number
  chapterTo?: number
  chapterIndices?: number[]
}): Promise<Array<{ index: number; title: string; markdown: string; summary?: string }>> {
  const projectDir = String(input.projectDir || '')
  if (!projectDir) throw new Error('projectDir 为空')

  const state = await readProjectState(projectDir)

  const indices = normalizeChapterIndices(input.chapterIndices)
  const indexSet = new Set<number>()

  if (indices.length) {
    for (const i of indices) indexSet.add(i)
  } else {
    const from = Math.floor(Number(input.chapterFrom))
    const to = Math.floor(Number(input.chapterTo))
    if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0 || from > to) {
      throw new Error('章节范围不合法')
    }
    for (let i = from; i <= to; i++) indexSet.add(i)
  }

  const targets = state.completed.filter((c) => indexSet.has(c.index))
  if (!targets.length) throw new Error('所选范围内没有已生成章节')

  const statePath = path.join(projectDir, 'state.json')
  const raw = await fs.readFile(statePath, 'utf8')
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const completedRaw = Array.isArray(parsed.completed) ? (parsed.completed as unknown[]) : []
  const byIndex = new Map<number, { fileName?: string }>()
  for (const c of completedRaw) {
    if (!c || typeof c !== 'object') continue
    const rec = c as Record<string, unknown>
    const index = typeof rec.index === 'number' ? rec.index : Number(rec.index)
    const fileName = typeof rec.fileName === 'string' ? rec.fileName : undefined
    if (!Number.isFinite(index) || index <= 0) continue
    byIndex.set(Math.floor(index), { fileName })
  }

  const out: Array<{ index: number; title: string; markdown: string; summary?: string }> = []
  for (const c of targets) {
    const fileName = byIndex.get(c.index)?.fileName
    if (!fileName) continue
    const mdPath = path.join(projectDir, 'chapters', fileName)
    const md = await fs.readFile(mdPath, 'utf8')
    out.push({ index: c.index, title: c.title, markdown: md, summary: c.summary })
  }

  out.sort((a, b) => a.index - b.index)
  if (!out.length) throw new Error('读取章节文件失败：请检查工程目录是否完整')
  return out
}

function chapterMarkdownToContent(markdown: string) {
  const text = String(markdown ?? '').replace(/^\uFEFF/, '').trim()
  return text.replace(/^##[^\n]*\n+/, '').trim()
}

export async function readProjectChapters(projectDir: string): Promise<ProjectChapter[]> {
  const state = await readProjectState(projectDir)
  if (!state.completed.length) return []

  const chapters = await readChaptersMarkdown({
    projectDir,
    chapterIndices: state.completed.map((item) => item.index),
  })

  return chapters.map((chapter) => ({
    index: chapter.index,
    title: chapter.title,
    content: chapterMarkdownToContent(chapter.markdown),
    markdown: chapter.markdown,
    summary: chapter.summary,
  }))
}

export async function revealInFolder(targetPath: string) {
  if (!targetPath) return
  try {
    const stat = await fs.stat(targetPath)
    if (stat.isDirectory()) {
      await shell.openPath(targetPath)
      return
    }
  } catch {
    // ignore
  }
  shell.showItemInFolder(targetPath)
}
