import { useCallback, useMemo, useRef, useState } from 'react'
import { File, MultiFileDiff, Virtualizer } from '@pierre/diffs/react'
import PaneStatus from './PaneStatus.jsx'

const baseOptions = {
  diffStyle: 'split',
  enableGutterUtility: true,
  enableLineSelection: true,
  lineHoverHighlight: 'line',
}

function normalizeRange(path, range, isDiff) {
  const startSide = range.side ?? range.endSide ?? 'additions'
  const endSide = range.endSide ?? startSide
  const crossesSides = isDiff && startSide !== endSide
  const startLine = crossesSides ? range.end : Math.min(range.start, range.end)
  const endLine = crossesSides ? range.end : Math.max(range.start, range.end)
  const side = endSide

  return {
    annotationSide: side,
    selection: isDiff
      ? { start: startLine, end: endLine, side, endSide: side }
      : { start: startLine, end: endLine },
    target: {
      kind: 'line',
      path,
      side: side === 'deletions' ? 'old' : 'new',
      startLine,
      endLine,
    },
  }
}

function targetLabel(target) {
  const side = target.side === 'old' ? 'old' : 'new'
  const lines = target.startLine === target.endLine
    ? `line ${target.startLine}`
    : `lines ${target.startLine}–${target.endLine}`
  return `Comment on ${side} ${lines}`
}

function CommentComposer({ target, onCancel, onCreate }) {
  const [body, setBody] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const formRef = useRef(null)

  async function handleSubmit(event) {
    event.preventDefault()
    const nextBody = body.trim()
    if (!nextBody || saving) return

    setSaving(true)
    setError(null)
    try {
      await onCreate(nextBody, target)
      onCancel()
    } catch (nextError) {
      setError(nextError.message)
      setSaving(false)
    }
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape' && !saving) {
      event.preventDefault()
      onCancel()
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      formRef.current?.requestSubmit()
    }
  }

  return (
    <form
      ref={formRef}
      className="comment-composer"
      data-vim-ignore
      onSubmit={handleSubmit}
    >
      <label className="comment-target" htmlFor="comment-body">
        {targetLabel(target)}
      </label>
      <textarea
        id="comment-body"
        autoFocus
        rows="4"
        value={body}
        placeholder="Leave a comment"
        disabled={saving}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {error && <p className="comment-error" role="alert">{error}</p>}
      <div className="comment-actions">
        <span>⌘↵ to submit</span>
        <button type="button" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={saving || body.trim().length === 0}>
          {saving ? 'Saving…' : 'Comment'}
        </button>
      </div>
    </form>
  )
}

function SavedComment({ comment }) {
  return (
    <article className="saved-comment">
      <header>You</header>
      <p>{comment.body}</p>
    </article>
  )
}

function commentAnnotation(comment, isDiff, fallbackSide) {
  const lineNumber = comment.target.kind === 'line' ? comment.target.endLine : 0
  const metadata = { kind: 'comment', comment }
  if (!isDiff) return { lineNumber, metadata }

  const side = comment.target.kind === 'line'
    ? (comment.target.side === 'old' ? 'deletions' : 'additions')
    : fallbackSide
  return { lineNumber, side, metadata }
}

export default function DiffPane({
  fileDiff,
  loading,
  error,
  comments,
  onCreateComment,
}) {
  const [draft, setDraft] = useState(null)
  const [selectedLines, setSelectedLines] = useState(null)

  const isDiff = fileDiff?.content.kind === 'diff'
  const beginComment = useCallback((range) => {
    if (!fileDiff || !range) return
    const nextDraft = normalizeRange(fileDiff.path, range, isDiff)
    setSelectedLines(nextDraft.selection)
    setDraft(nextDraft)
  }, [fileDiff, isDiff])

  const cancelComment = useCallback(() => {
    setDraft(null)
    setSelectedLines(null)
  }, [])

  const options = useMemo(() => ({
    ...baseOptions,
    onGutterUtilityClick: beginComment,
    onLineSelected: setSelectedLines,
    onLineSelectionChange: setSelectedLines,
    onLineSelectionEnd: setSelectedLines,
  }), [beginComment])

  const lineAnnotations = useMemo(() => {
    if (!fileDiff) return []
    const fallbackSide = fileDiff.content.kind === 'diff' && !fileDiff.content.newFile
      ? 'deletions'
      : 'additions'
    const nextAnnotations = comments
      .filter((comment) => comment.target.path === fileDiff.path)
      .map((comment) => commentAnnotation(comment, isDiff, fallbackSide))

    if (draft) {
      const annotation = {
        lineNumber: draft.target.endLine,
        metadata: { kind: 'draft', draft },
      }
      nextAnnotations.push(isDiff
        ? { ...annotation, side: draft.annotationSide }
        : annotation)
    }
    return nextAnnotations
  }, [comments, draft, fileDiff, isDiff])

  const renderAnnotation = useCallback((annotation) => {
    if (annotation.metadata.kind === 'draft') {
      const { target } = annotation.metadata.draft
      return (
        <CommentComposer
          key={`${target.side}:${target.startLine}:${target.endLine}`}
          target={target}
          onCancel={cancelComment}
          onCreate={onCreateComment}
        />
      )
    }
    return <SavedComment comment={annotation.metadata.comment} />
  }, [cancelComment, onCreateComment])

  if (loading) {
    return <PaneStatus>Loading file…</PaneStatus>
  }

  if (error) {
    return <PaneStatus>{error}</PaneStatus>
  }

  if (!fileDiff) {
    return <PaneStatus>Select a file to view it.</PaneStatus>
  }

  if (fileDiff.content.kind === 'unavailable') {
    const descriptions = {
      binary: 'Binary file contents cannot be displayed.',
      'invalid-utf8': 'This file is not valid UTF-8 text.',
      'too-large': 'This file is larger than the 512 KiB review limit.',
      symlink: 'Symbolic link changes cannot be displayed.',
      submodule: 'Submodule changes cannot be displayed.',
    }
    return <PaneStatus>{descriptions[fileDiff.content.reason]}</PaneStatus>
  }

  return (
    <Virtualizer className="diff-scroll">
      {fileDiff.content.kind === 'diff' ? (
        <MultiFileDiff
          oldFile={fileDiff.content.oldFile}
          newFile={fileDiff.content.newFile}
          lineAnnotations={lineAnnotations}
          selectedLines={selectedLines}
          renderAnnotation={renderAnnotation}
          options={options}
        />
      ) : (
        <File
          file={fileDiff.content.file}
          lineAnnotations={lineAnnotations}
          selectedLines={selectedLines}
          renderAnnotation={renderAnnotation}
          options={options}
        />
      )}
    </Virtualizer>
  )
}
