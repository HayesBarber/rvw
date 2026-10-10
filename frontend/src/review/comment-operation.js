/** Keep comment mutations, copy, and clear from running at the same time. */
export function createCommentOperationGuard() {
  let pending = false
  return Object.freeze({
    isPending: () => pending,
    async run(operation) {
      if (pending) throw new Error('Wait for the current comment operation to finish.')
      pending = true
      try {
        return await operation()
      } finally {
        pending = false
      }
    },
  })
}
