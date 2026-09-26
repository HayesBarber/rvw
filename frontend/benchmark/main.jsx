import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { getConfiguration, getDiffOverview } from '../src/review/api.js'
import { markFileSelection, observeFileTiming } from '../src/review/file-timing.js'
import { useReviewFile } from '../src/review/selected-file-request.js'
import DiffSurface from '../src/components/diff-pane/DiffSurface.jsx'
import '../src/index.css'

const events = []
observeFileTiming((event) => events.push(event))
const overview = await getDiffOverview()
await getConfiguration()

export default function Benchmark() {
  const [selection, setSelection] = useState({ path: null, generation: 0 })
  const [files, setFiles] = useState([])
  const paths = useMemo(() => files.map((file) => file.path), [files])
  const changedPaths = useMemo(() => new Set(files.filter((file) => file.changed).map((file) => file.path)), [files])
  const request = useReviewFile({ diffId: overview.id, ...selection, paths, changedPaths })
  useEffect(() => {
    window.benchmark = {
      events,
      configure: setFiles,
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
