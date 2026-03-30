/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  api: {
    settings: {
      get: () => Promise<{
        baseUrl: string
        modelId: string
        videoBaseUrl: string
        videoModelId: string
        coverModelId: string
        imageBaseUrl: string
        publisherUrl?: string
        hasApiKey: boolean
        hasImageApiKey: boolean
        hasVideoApiKey: boolean
        hasAdminAppKey: boolean
      }>
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
      }) => Promise<{
        baseUrl: string
        modelId: string
        videoBaseUrl: string
        videoModelId: string
        coverModelId: string
        imageBaseUrl: string
        publisherUrl?: string
        hasApiKey: boolean
        hasImageApiKey: boolean
        hasVideoApiKey: boolean
        hasAdminAppKey: boolean
      }>
      listModels: (payload?: { target?: 'text' | 'image' | 'video' }) => Promise<Array<{ id: string; owned_by?: string }>>
    }
    auth: {
      getSession: () => Promise<{
        account: {
          id: string
          username: string
          displayName: string
          role: 'superadmin' | 'admin' | 'user'
          lastLoginAt: string
        } | null
      }>
      register: (payload: { username: string; password: string; displayName?: string }) => Promise<{ ok: boolean }>
      login: (payload: { username: string; password: string }) => Promise<{
        account: {
          id: string
          username: string
          displayName: string
          role: 'superadmin' | 'admin' | 'user'
          lastLoginAt: string
        }
      }>
      logout: () => Promise<{ ok: boolean }>
      users: {
        list: () => Promise<{
          users: Array<{
            id: string
            username: string
            displayName: string
            role: 'superadmin' | 'admin' | 'user'
            createdAt: string
            updatedAt: string
            lastLoginAt?: string
          }>
        }>
        create: (payload: {
          username: string
          password: string
          displayName?: string
          role?: 'superadmin' | 'admin' | 'user'
        }) => Promise<{
          user: {
            id: string
            username: string
            displayName: string
            role: 'superadmin' | 'admin' | 'user'
            createdAt: string
            updatedAt: string
            lastLoginAt?: string
          }
        }>
        updateRole: (payload: { userId: string; role: 'superadmin' | 'admin' | 'user' }) => Promise<{
          user: {
            id: string
            username: string
            displayName: string
            role: 'superadmin' | 'admin' | 'user'
            createdAt: string
            updatedAt: string
            lastLoginAt?: string
          }
        }>
        resetPassword: (payload: { userId: string; password: string }) => Promise<{
          user: {
            id: string
            username: string
            displayName: string
            role: 'superadmin' | 'admin' | 'user'
            createdAt: string
            updatedAt: string
            lastLoginAt?: string
          }
        }>
        delete: (payload: { userId: string }) => Promise<{ ok: boolean }>
      }
    }
    billing: {
      get: () => Promise<{
        balance: number
        records: Array<{
          id: string
          userId: string
          type: 'recharge' | 'consume'
          amount: number
          balanceAfter: number
          title: string
          note?: string
          createdAt: string
        }>
      }>
      recharge: (payload: { amount: number; title?: string; note?: string }) => Promise<{
        balance: number
        records: Array<{
          id: string
          userId: string
          type: 'recharge' | 'consume'
          amount: number
          balanceAfter: number
          title: string
          note?: string
          createdAt: string
        }>
      }>
      mockConsume: (payload: { amount: number; title?: string; note?: string }) => Promise<{
        balance: number
        records: Array<{
          id: string
          userId: string
          type: 'recharge' | 'consume'
          amount: number
          balanceAfter: number
          title: string
          note?: string
          createdAt: string
        }>
      }>
    }
    generation: {
      start: (payload: {
        title: string
        chapterCount: number
        completionMode?: 'completed' | 'ongoing'
        projectDir?: string
        bookMeta?: {
          targetReader?: '男频' | '女频'
          tags?: string[]
          protagonists?: string[]
          intro?: string
        }
      }) => Promise<{ jobId: string }>
      cancel: (payload: { jobId: string }) => Promise<{ ok: boolean }>
      onEvent: (cb: (ev: unknown) => void) => () => void
    }
    projects: {
      list: () => Promise<Array<{ id: string; title: string; createdAt: string; dir: string; chapterCount: number }>>
      state: (payload: {
        projectDir: string
      }) => Promise<{ title: string; chapterCount: number; completed: Array<{ index: number; title: string; summary?: string }> }>
      detail: (payload: { projectDir: string }) => Promise<{
        project: { id: string; title: string; createdAt: string; dir: string; chapterCount: number }
        state: {
          title: string
          chapterCount: number
          completed: Array<{ index: number; title: string; summary?: string }>
          nextChapterIndex?: number
          completionMode?: 'completed' | 'ongoing'
        }
        bookMeta: {
          title: string
          targetReader?: '男频' | '女频'
          tags: string[]
          protagonists: string[]
          intro: string
          completionMode?: 'completed' | 'ongoing'
        }
      }>
      chapters: (payload: { projectDir: string }) => Promise<
        Array<{ index: number; title: string; content: string; markdown: string; summary?: string }>
      >
      reveal: (payload: { path: string }) => Promise<{ ok: boolean }>
    }
    comic: {
      start: (payload: {
        projectDir: string
        chapterFrom: number
        chapterTo: number
        chapterIndices?: number[]
        styleHint?: string
      }) => Promise<{ jobId: string }>
      cancel: (payload: { jobId: string }) => Promise<{ ok: boolean }>
      onEvent: (cb: (ev: unknown) => void) => () => void
    }
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
      }) => Promise<{ jobId: string; outPath: string }>
      makeShots: (payload: {
        projectDir: string
        chapterIndices: number[]
        shotCount: number
        secondsPerShot: number
        videoStyleHint?: string
      }) => Promise<{ shots: Array<{ title: string; prompt: string }> }>
      cancel: (payload: { jobId: string }) => Promise<{ ok: boolean }>
      onEvent: (cb: (ev: unknown) => void) => () => void
    }
    publisher: {
      open: () => Promise<{ ok: boolean }>
      inject: (payload: { title?: string; content?: string; clickPublish?: boolean }) => Promise<{ ok: boolean }>
      generateBookMeta: (payload: { title: string }) => Promise<{
        meta: { title: string; targetReader: '男频' | '女频'; tags: string[]; protagonists: string[]; intro: string }
      }>
      injectBookMeta: (payload: {
        title?: string
        targetReader?: '男频' | '女频'
        tags?: string[]
        protagonists?: string[]
        intro?: string
      }) => Promise<{ ok: boolean }>
    }
    cover: {
      generate: (payload: {
        title: string
        targetReader?: '男频' | '女频'
        tags?: string[]
        protagonists?: string[]
        intro?: string
      }) => Promise<{ imageDataUrl: string; prompt: string; modelId: string }>
    }
    os: {
      openExternal: (payload: { url: string }) => Promise<{ ok: boolean }>
    }
    debug: {
      openDevTools: () => Promise<{ ok: boolean }>
    }
  }
}
