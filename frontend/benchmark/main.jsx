import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { getConfiguration, getDiffOverview } from '../src/review/api.js'
import { markFileSelection, observeFileTiming } from '../src/review/file-timing.js'
import { useReviewFile } from '../src/review/selected-file-request.js'
import { useHighlighterPreload } from '../src/review/use-highlighter-preload.js'
import { preloadReviewHighlighter, selectPreloadLanguages } from '../src/review/highlighter-preload.js'
import DiffSurface from '../src/components/diff-pane/DiffSurface.jsx'
import '../src/index.css'

const emptyPaths = []
const events = []
observeFileTiming((event) => events.push(event))
const overview = await getDiffOverview()
await getConfiguration()

export default function Benchmark() {
  const [selection, setSelection] = useState({ path: null, generation: 0 })
  const [files, setFiles] = useState([])
  const [settings, setSettings] = useState({ warm: true, preload: true })
  const paths = useMemo(() => files.map((file) => file.path), [files])
  const changedPaths = useMemo(() => new Set(files.filter((file) => file.changed).map((file) => file.path)), [files])
  const request = useReviewFile({ diffId: overview.id, ...selection, paths: settings.warm ? paths : undefined, changedPaths })
  useHighlighterPreload(settings.preload ? paths : emptyPaths, request.status === 'loading')
  useEffect(() => {
    window.benchmark = {
      events,
      configure(files, settings) { setFiles(files); setSettings(settings) },
      async profilePreload(paths, limit) {
        const start = performance.now()
        await new Promise((resolve) => preloadReviewHighlighter(paths, { limit, onComplete: resolve }))
        return { durationMs: performance.now() - start, languages: selectPreloadLanguages(paths, limit) }
      },
      select(path, changed) {
        markFileSelection(path)
        setSelection({ path, changed, generation: 0 })
      },
    }
    return () => { delete window.benchmark }
  }, [])
  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <p>{selection.path ?? 'Ready'} — {request.status}</p>
    {request.data && <DiffSurface fileDiff={request.data} />}
    {request.error && <p role="alert">{request.error}</p>}
  </div>
}
createRoot(document.getElementById('root')).render(<Benchmark />)
