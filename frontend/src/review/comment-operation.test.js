import assert from 'node:assert/strict'
import test from 'node:test'
import { createCommentOperationGuard } from './comment-operation.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

test('a pending comment operation prevents duplicate and conflicting operations', async () => {
  const guard = createCommentOperationGuard()
  const saving = deferred()
  const saved = guard.run(() => saving.promise)
  for (const name of ['copy', 'clear', 'create', 'edit', 'delete']) {
    await assert.rejects(guard.run(() => assert.fail(`Started ${name} during a pending save`)), /Wait for the current comment operation/)
  }
  saving.resolve({ id: 'saved' })
  assert.deepEqual(await saved, { id: 'saved' })
  assert.equal(guard.isPending(), false)
  assert.deepEqual(await guard.run(async () => ({ commentCount: 3 })), { commentCount: 3 })
})

test('a failed clear releases the guard for retry and preserves the failed result', async () => {
  const guard = createCommentOperationGuard()
  const clearing = deferred()
  const operation = guard.run(() => clearing.promise)
  clearing.reject(new Error('Clear failed'))
  await assert.rejects(operation, /Clear failed/)
  assert.equal(guard.isPending(), false)
  assert.equal(await guard.run(async () => 'retry succeeded'), 'retry succeeded')
  await assert.rejects(guard.run(() => { throw new Error('Synchronous failure') }), /Synchronous failure/)
  assert.equal(await guard.run(async () => 'next operation'), 'next operation')
})
