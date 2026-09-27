import { DEFAULT_THEMES, getFiletypeFromFileName, getThemes, preloadHighlighter } from '@pierre/diffs'

export const REVIEW_THEME = DEFAULT_THEMES
export const PRELOAD_LANGUAGE_LIMIT = 5

export function selectPreloadLanguages(paths, limit = PRELOAD_LANGUAGE_LIMIT) {
  const counts = new Map()
  for (const path of new Set(paths)) {
    const language = getFiletypeFromFileName(path)
    if (language === 'text' || language === 'ansi') continue
    counts.set(language, (counts.get(language) ?? 0) + 1)
  }
  return [...counts].sort(([a, ac], [b, bc]) => bc - ac || a.localeCompare(b))
    .slice(0, limit).map(([language]) => language)
}

export function schedulePreloadIdle(callback) {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(callback)
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(callback, 50)
  return () => clearTimeout(id)
}

export function createHighlighterPreloader({ load = preloadHighlighter, schedule = schedulePreloadIdle } = {}) {
  // Match the lifetime of the renderer's shared highlighter, including reloads.
  const resources = new Map()
  function loadResource(kind, name) {
    const key = `${kind}:${name}`
    if (!resources.has(key)) {
      const promise = Promise.resolve().then(() => load({
        themes: kind === 'theme' ? [name] : [],
        langs: kind === 'language' ? [name] : [],
      })).then(() => true, () => {
        resources.delete(key)
        return false
      })
      resources.set(key, promise)
    }
    return resources.get(key)
  }
  return function start(paths, { limit = PRELOAD_LANGUAGE_LIMIT, onComplete = () => {} } = {}) {
    let cancelled = false
    let cancelIdle
    let jobs
    function next() {
      if (cancelled) return
      cancelIdle = schedule(async () => {
        if (cancelled) return
        // Selection and sorting also run outside the startup/selection effect.
        jobs ??= [
          ...getThemes(REVIEW_THEME).map((name) => ['theme', name]),
          ...selectPreloadLanguages(paths, limit).map((name) => ['language', name]),
        ]
        const job = jobs.shift()
        if (!job) { onComplete(); return }
        await loadResource(...job)
        next()
      })
    }
    next()
    return () => { cancelled = true; cancelIdle?.() }
  }
}

export const preloadReviewHighlighter = createHighlighterPreloader()
