// Creates a disposable, deterministic repository; never modifies the checkout.
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = await mkdtemp(join(tmpdir(), 'rvw-file-load-'))
const samples = [['small', 100], ['medium', 1500], ['large', 6000]]
for (const [size, count] of samples) {
  const contents = Array.from({ length: count }, (_, i) =>
    `export const value${i} = { name: "item${i}", count: ${i} };\n`).join('')
  for (const kind of ['file', 'diff']) await writeFile(join(root, `${size}-${kind}.js`), contents)
}
const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' })
git('init', '-q')
git('add', '.')
git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test',
  '-c', 'commit.gpgSign=false', 'commit', '-qm', 'baseline')
for (const [size, count] of samples) {
  await writeFile(join(root, `${size}-diff.js`), Array.from({ length: count }, (_, i) =>
    `export const value${i} = { name: "item${i}", total: ${i} };\n`).join(''))
}
console.log(root)
