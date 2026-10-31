import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { constants } from 'node:fs'
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

assert.equal(process.argv.length, 4, 'pass the built server and CLI paths')
const [serverExecutable, cliExecutable] = process.argv.slice(2).map((value) => path.resolve(value))

async function findTool(name) {
  for (const directory of process.env.PATH.split(path.delimiter)) {
    const candidate = path.resolve(directory, name)
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch { /* Try the next PATH entry. */ }
  }
  throw new Error(name + ' must be on PATH for executable integration tests')
}

const git = await findTool('git')
const rg = await findTool('rg')
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'"

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rvw-executables-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const home = path.join(root, 'home')
  const repository = path.join(root, 'repository')
  const configPath = path.join(home, '.config/rvw/config.json')
  const bin = path.join(repository, '.git/tools with spaces')
  await mkdir(path.dirname(configPath), { recursive: true })
  await mkdir(repository)
  const env = {
    ...process.env,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(home, 'no-global-config'),
  }
  const runGit = (...args) => execFileSync(git, [
    '-C', repository, '-c', 'core.hooksPath=/dev/null',
    '-c', 'user.name=rvw tests', '-c', 'user.email=rvw-tests@example.invalid',
    '-c', 'commit.gpgSign=false', ...args,
  ], { env, encoding: 'utf8' }).trim()
  runGit('init', '--quiet')
  await writeFile(path.join(repository, '.gitignore'), 'ignored.txt\n')
  await writeFile(path.join(repository, 'tracked.txt'), 'base needle\n')
  runGit('add', '.')
  runGit('commit', '--quiet', '-m', 'base')
  await writeFile(path.join(repository, 'tracked.txt'), 'head needle\n')
  runGit('commit', '--quiet', '-am', 'head')
  runGit('remote', 'add', 'origin', 'https://github.com/owner/repository.git')
  await writeFile(path.join(repository, 'ignored.txt'), 'ignored needle\n')
  await mkdir(bin)
  const tool = async (name, body) => {
    const executable = path.join(bin, name)
    await writeFile(executable, '#!/bin/sh\nprintf \'%s\\n\' "$*" >> ' + quote(executable + '.calls') + '\n' + body + '\n')
    await chmod(executable, 0o755)
    return executable
  }
  const executables = {
    git: await tool('custom git', 'exec ' + quote(git) + ' "$@"'),
    gh: await tool('custom gh', "printf '[]'"),
    rg: await tool('custom rg', 'exec ' + quote(rg) + ' "$@"'),
  }
  const configure = (configuration) => writeFile(configPath, JSON.stringify(configuration))
  await configure({ executables })
  return { repository, bin, env, executables, configure }
}

async function unusedPort() {
  const socket = net.createServer()
  socket.listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const { port } = socket.address()
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()))
  return port
}

async function startServer(t, fixture, env = fixture.env) {
  const port = await unusedPort()
  const child = spawn(serverExecutable, [
    'serve', '--directory', fixture.repository, '--port', String(port),
  ], { env, stdio: ['ignore', 'ignore', 'pipe'] })
  let output = ''
  child.stderr.on('data', (chunk) => { output += chunk })
  const exited = once(child, 'exit')
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
  })
  const request = async (route, body) => {
    const response = await fetch('http://127.0.0.1:' + port + '/api/' + route, {
      ...(body ? { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
      signal: AbortSignal.timeout(2000),
    })
    return { status: response.status, body: await response.json() }
  }
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, 'server failed at startup: ' + output)
    try {
      await request('configuration')
      return request
    } catch {
      await delay(25)
    }
  }
  assert.fail('server did not become ready: ' + output)
}

function runFailure(executable, args, env) {
  try {
    execFileSync(executable, args, { env, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
    assert.fail('the operation must fail')
  } catch (error) {
    assert.ok(error.status > 0, 'expected an exit failure, received ' + error)
    return error.stderr
  }
}

test('configured paths with spaces support HTTP startup, runtime operations, and failures without fallback', async (t) => {
  const f = await fixture(t)
  const request = await startServer(t, f, { ...f.env, PATH: f.bin })
  const configuration = await request('configuration')
  assert.equal(configuration.body.diagnostic, null)
  assert.deepEqual(configuration.body.configuration.executables, f.executables)
  assert.equal((await request('repository/commits')).body.commits.length, 2)
  await writeFile(path.join(f.repository, 'tracked.txt'), 'working needle\n')
  assert.equal((await request('repository/working-tree-changes')).body.files.length, 1)
  assert.deepEqual((await request('repository/pull-requests')).body.pullRequests, [])
  for (const mode of ['ignore-aware', 'all-files']) {
    const search = await request('search/text', { type: 'search_text', mode, query: 'needle' })
    assert.equal(search.status, 200)
    assert.ok(search.body.matches.some((match) => match.path === 'tracked.txt'))
    assert.equal(search.body.matches.some((match) => match.path === 'ignored.txt'), mode === 'all-files')
  }
  assert.equal((await request('review/reload', { type: 'reload_review' })).status, 200)
  const overview = (await request('diffs/active')).body
  const diff = await request('diffs/' + encodeURIComponent(overview.id) + '/files?path=tracked.txt')
  assert.equal(diff.body.content.newFile.contents, 'working needle\n')
  assert.ok(!(await request('files/not-ignored')).body.includes('ignored.txt'))
  for (const executable of Object.values(f.executables)) {
    assert.ok((await readFile(executable + '.calls', 'utf8')).length > 0)
  }
  // Make working defaults available after startup. A runtime failure must not
  // switch to them when a configured executable stops working.
  for (const [name, body] of [
    ['git', 'exec ' + quote(git) + ' "$@"'],
    ['gh', "printf '[]'"],
    ['rg', 'exec ' + quote(rg) + ' "$@"'],
  ]) {
    await writeFile(path.join(f.bin, name), '#!/bin/sh\n' + body + '\n', { mode: 0o755 })
  }
  await writeFile(f.executables.gh, '#!/bin/sh\nexit 7\n')
  assert.equal((await request('repository/pull-requests')).body.error.code, 'pull_request_list_failed')
  await rm(f.executables.gh)
  const prs = await request('repository/pull-requests')
  assert.equal(prs.body.error.code, 'pull_request_list_unavailable')
  assert.match(prs.body.error.message, /executables\.gh/)
  await writeFile(f.executables.rg, '#!/bin/sh\nexit 7\n')
  assert.equal((await request('search/text', { type: 'search_text', mode: 'ignore-aware', query: 'needle' })).body.error.code, 'search_failed')
  await rm(f.executables.rg)
  for (const mode of ['ignore-aware', 'all-files']) {
    const search = await request('search/text', { type: 'search_text', mode, query: 'needle' })
    assert.equal(search.body.error.code, 'search_unavailable')
    assert.match(search.body.error.message, /executables\.rg/)
  }
  await writeFile(f.executables.git, '#!/bin/sh\nexit 7\n')
  assert.equal((await request('repository/commits')).body.error.code, 'repository_failed')
  await rm(f.executables.git)
  const commits = await request('repository/commits')
  assert.equal(commits.body.error.code, 'repository_unavailable')
  assert.match(commits.body.error.message, /executables\.git/)
  assert.equal((await request('review/reload', { type: 'reload_review' })).body.error.code, 'reload_unavailable')
  assert.deepEqual((await request('diffs/active')).body, overview)
})

test('omitted tools use process PATH independently and invalid settings retain configuration diagnostics', async (t) => {
  const f = await fixture(t)
  await writeFile(path.join(f.bin, 'gh'), "#!/bin/sh\nprintf '[]'\n", { mode: 0o755 })
  const env = { ...f.env, PATH: f.bin + path.delimiter + f.env.PATH }
  for (const configuration of [{}, { executables: {} }, { executables: { git: f.executables.git } }, { executables: { git: 'relative/git' } }]) {
    await t.test(JSON.stringify(configuration), async (t) => {
      await f.configure(configuration)
      const request = await startServer(t, f, env)
      const snapshot = (await request('configuration')).body
      if (configuration.executables?.git === 'relative/git') {
        assert.equal(snapshot.diagnostic.code, 'invalid_schema')
        assert.match(snapshot.diagnostic.message, /executables/)
        assert.deepEqual(snapshot.configuration, {})
      } else {
        assert.equal(snapshot.diagnostic, null)
      }
      assert.equal((await request('repository/commits')).status, 200)
      assert.equal((await request('repository/pull-requests')).status, 200)
      assert.equal((await request('search/text', { type: 'search_text', mode: 'ignore-aware', query: 'needle' })).status, 200)
    })
  }
})

test('startup reports missing and non-executable configured Git without using PATH Git', async (t) => {
  const f = await fixture(t)
  for (const executable of [path.join(f.bin, 'missing git'), f.executables.git]) {
    if (executable === f.executables.git) await chmod(executable, 0o644)
    await f.configure({ executables: { git: executable } })
    for (const [binary, args] of [
      [serverExecutable, ['serve', '--directory', f.repository]],
      [cliExecutable, [f.repository, '--last-commit']],
      [cliExecutable, [f.repository, '--pr', '42']],
    ]) {
      assert.match(runFailure(binary, args, f.env), /Cannot run Git; check executables\.git/)
    }
  }
})

test('CLI resolves both last-commit revisions and PR refs with the selected Git path', async (t) => {
  const f = await fixture(t)
  // Fail before launch to avoid opening a native application or using a real remote.
  const record = '#!/bin/sh\nprintf \'%s\\n\' "$*" >> ' + quote(f.executables.git + '.calls') + '\n'
  const delegate = 'exec ' + quote(git) + ' "$@"\n'
  await writeFile(f.executables.git, record + 'case "$*" in *\'^1\'*) exit 7;; esac\n' + delegate)
  const env = { ...f.env, PATH: '/rvw-no-tools' }
  assert.match(runFailure(cliExecutable, [f.repository, '--last-commit'], env), /cannot resolve the first parent/)
  let calls = await readFile(f.executables.git + '.calls', 'utf8')
  assert.match(calls, /HEAD\^\{commit\}/)
  assert.match(calls, /\^1/)
  await writeFile(f.executables.git, record + 'case "$*" in *\'fetch --atomic\'*) exit 7;; esac\n' + delegate)
  assert.match(runFailure(cliExecutable, [f.repository, '--pr', '42'], env), /unable to fetch PR head and merge refs/)
  calls = await readFile(f.executables.git + '.calls', 'utf8')
  assert.match(calls, /remote get-url origin/)
  assert.match(calls, /fetch --atomic origin/)
})
