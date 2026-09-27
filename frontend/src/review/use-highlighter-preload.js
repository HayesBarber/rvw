import { useEffect } from 'react'
import { preloadReviewHighlighter } from './highlighter-preload.js'

export function useHighlighterPreload(paths, busy = false) {
  useEffect(() => {
    if (busy || paths.length === 0) return undefined
    return preloadReviewHighlighter(paths)
  }, [paths, busy])
}
