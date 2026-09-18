// CPU-only comparison; end-to-end browser measurements are in docs/file-load-performance.md.
import { performance } from 'node:perf_hooks'
import { parseDiffFromFile } from '../frontend/node_modules/@pierre/diffs/dist/index.js'
import { parseDisplayDiff } from '../frontend/src/review/prepare-file.js'

for (const count of [100, 1500, 6000]) {
  const contents = Array.from({ length: count }, (_, i) =>
    `export const value${i} = { name: "item${i}", count: ${i} };\n`).join('')
  const old = { name: 'fixture.js', contents }
  const next = { name: 'fixture.js', contents: contents.replaceAll('count:', 'total:') }
  for (const [name, parse] of [['baseline', parseDiffFromFile], ['optimized', parseDisplayDiff]]) {
    const samples = []
    for (let repeat = 0; repeat < 3; repeat++) {
      const start = performance.now()
      parse(old, next)
      samples.push(Number((performance.now() - start).toFixed(2)))
    }
    console.log(JSON.stringify({ lines: count, parser: name, durationMs: samples }))
  }
}
