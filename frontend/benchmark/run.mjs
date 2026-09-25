import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir, cpus, platform, release, homedir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import process from 'node:process'
import { build, preview } from 'vite'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const temporary = await mkdtemp(resolve(tmpdir(), 'rvw-file-benchmark-'))
const repository = resolve(temporary, 'repository')
const output = process.argv[2] ?? resolve(root, 'file-load-results.json')
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function freePort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}
const port = await freePort()
const url = `http://127.0.0.1:${port}`
let backend, web, browser, cleanupPromise
function cleanup() {
  return cleanupPromise ??= (async () => {
    if (backend?.pid) { try { process.kill(-backend.pid, 'SIGTERM') } catch { /* Already stopped. */ } }
    await browser?.close()
    web?.httpServer.closeAllConnections()
    await new Promise((resolve) => web ? web.httpServer.close(resolve) : resolve())
    await rm(temporary, { recursive: true, force: true })
  })()
}
process.once('SIGINT', () => { void cleanup().finally(() => process.exit(130)) })
process.once('SIGTERM', () => { void cleanup().finally(() => process.exit(143)) })
try {
  execFileSync('git', ['init', '-q', repository])
  const files = []
  for (const lines of [100, 1000, 8000]) {
    for (const changed of [true, false]) {
      const path = `${changed ? 'diff' : 'file'}-${lines}.js`
      const contents = Array.from({ length: lines }, (_, i) => `export const value${i} = ${i};\n`).join('')
      await writeFile(resolve(repository, path), contents)
      files.push({ path, changed, lines, bytes: Buffer.byteLength(contents) })
    }
  }
  execFileSync('git', ['-C', repository, 'add', '.'])
  execFileSync('git', ['-C', repository, '-c', 'user.name=Benchmark', '-c', 'user.email=benchmark@example.invalid', 'commit', '-qm', 'Fixed workload'])
  for (const file of files.filter((file) => file.changed)) {
    const contents = Array.from({ length: file.lines }, (_, i) => `export const value${i} = ${i % 20 === 0 ? i + 1 : i};\n`).join('')
    await writeFile(resolve(repository, file.path), contents)
  }
  backend = spawn('zig', ['build', 'serve', '-Doptimize=ReleaseFast', '--', 'serve', '--directory', repository, '--port', String(port), '--log-level', 'debug'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'], detached: true })
  let ready = false
  for (let attempt = 0; attempt < 600; attempt++) {
    if (backend.exitCode !== null) throw new Error('Backend exited before readiness')
    try { ready = (await fetch(`${url}/api/configuration`)).ok } catch { /* Wait for compilation. */ }
    if (ready) break
    await pause(100)
  }
  if (!ready) throw new Error('Backend readiness timed out')
  const config = { root: resolve(root, 'frontend'), configFile: false, logLevel: 'warn', build: {
    outDir: resolve(temporary, 'dist'), emptyOutDir: true,
    rollupOptions: { input: resolve(root, 'frontend/benchmark/index.html') },
  } }
  // The benchmark uses the same production renderer and hook, without development StrictMode.
  const { default: react } = await import('@vitejs/plugin-react')
  config.plugins = [react()]
  await build(config)
  web = await preview({ ...config, preview: { host: '127.0.0.1', port: await freePort(), proxy: { '/api': url } } })
  browser = await chromium.launch(process.env.RVW_BENCH_BROWSER === 'chromium' ? {} : { channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  page.on('pageerror', (error) => { console.error(error); process.exitCode = 1 })
  await page.goto(`${web.resolvedUrls.local[0]}benchmark/index.html`)
  await page.waitForFunction(() => window.benchmark)
  await page.evaluate(() => {
    window.benchmark.frameGaps = []
    let previous = performance.now()
    function frame(now) {
      window.benchmark.frameGaps.push(now - previous)
      previous = now
      window.benchmark.frameRequest = requestAnimationFrame(frame)
    }
    window.benchmark.frameRequest = requestAnimationFrame(frame)
  })
  const samples = []
  async function select(file, scenario, settle = true) {
    const offset = await page.evaluate(({ path, changed }) => {
      const offset = window.benchmark.events.length
      window.benchmark.select(path, changed)
      return offset
    }, file)
    await page.waitForFunction((offset) => window.benchmark.events.slice(offset).some((event) => event.context.stage === 'request_schedule'), offset)
    const traceId = await page.evaluate((offset) => window.benchmark.events.slice(offset).find((event) => event.context.stage === 'request_schedule').traceId, offset)
    if (settle) {
      await page.waitForFunction((id) => ['visible', 'highlight_tokens'].every((stage) => window.benchmark.events.some((event) => event.traceId === id && event.context.stage === stage)), traceId)
    }
    samples.push({ scenario, ...file, traceId })
  }
  for (const file of files) await select(file, 'initial')
  for (let repeat = 0; repeat < 5; repeat++) for (const file of files) await select(file, 'repeated')
  for (let repeat = 0; repeat < 5; repeat++) {
    for (const file of files) await select(file, 'rapid', false)
    await page.waitForFunction(() => {
      const events = window.benchmark.events
      const last = events.findLast((event) => event.context.stage === 'request_schedule')
      return events.some((event) => event.traceId === last.traceId && event.context.stage === 'visible')
    })
  }
  await page.evaluate(() => window.benchmark.select(null, false))
  await pause(200)
  const { events, frameGaps } = await page.evaluate(() => {
    cancelAnimationFrame(window.benchmark.frameRequest)
    return { events: window.benchmark.events, frameGaps: window.benchmark.frameGaps }
  })
  const ids = new Set(samples.map((sample) => sample.traceId))
  const logDirectory = platform() === 'darwin' ? resolve(homedir(), 'Library/Logs/rvw') : resolve(process.env.XDG_STATE_HOME ?? resolve(homedir(), '.local/state'), 'rvw')
  const backendEvents = []
  for (const name of await readdir(logDirectory)) {
    if (!/^rvw-[0-9]+\.jsonl$/.test(name)) continue
    for (const line of (await readFile(resolve(logDirectory, name), 'utf8')).split('\n')) {
      let event
      try { event = JSON.parse(line) } catch { continue }
      if (event.source === 'backend' && event.message === 'file load timing' && ids.has(event.traceId)) backendEvents.push(event)
    }
  }
  if (!backendEvents.length) throw new Error('No correlated backend timing events found')
  const groups = new Map()
  const fileGroups = new Map()
  for (const sample of samples) {
    for (const event of [...events, ...backendEvents].filter((event) => event.traceId === sample.traceId)) {
      const key = `${sample.scenario}/${sample.changed ? 'diff' : 'file'}/${event.context.stage}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(event.context.durationMs)
      const fileKey = `${sample.scenario}/${sample.path}/${event.context.stage}`
      if (!fileGroups.has(fileKey)) fileGroups.set(fileKey, [])
      fileGroups.get(fileKey).push(event.context.durationMs)
    }
  }
  function statistics(values) {
    values.sort((a, b) => a - b)
    return { n: values.length, p50: values[Math.ceil(values.length * .5) - 1], p95: values[Math.ceil(values.length * .95) - 1], max: values.at(-1) }
  }
  const summary = Object.fromEntries([...groups].map(([key, values]) => [key, statistics(values)]))
  const byFile = Object.fromEntries([...fileGroups].map(([key, values]) => [key, statistics(values)]))
  const packages = Object.fromEntries(await Promise.all(['@pierre/diffs', 'react', 'vite', 'playwright'].map(async (name) => [name, JSON.parse(await readFile(resolve(root, 'frontend/node_modules', name, 'package.json'), 'utf8')).version])))
  const result = { environment: { date: new Date().toISOString(), revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), platform: platform(), release: release(), cpu: cpus()[0].model, node: process.version, zig: execFileSync('zig', ['version'], { encoding: 'utf8' }).trim(), browser: browser.version(), viewport: '1440x900', optimize: 'ReleaseFast', packages }, files, samples, events, backendEvents, summary, byFile, frameGaps: statistics(frameGaps) }
  await writeFile(output, JSON.stringify(result, null, 2) + '\n')
  console.table(summary)
  console.log(`Results: ${output}`)
} finally {
  await cleanup()
}
