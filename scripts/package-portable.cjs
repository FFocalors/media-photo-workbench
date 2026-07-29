const {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  cpSync,
} = require('node:fs')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')

const projectRoot = resolve(__dirname, '..')
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const releaseDirectory = join(projectRoot, 'release-pack')
const unpackedDirectory = join(releaseDirectory, 'win-unpacked')
const layoutDirectory = join(releaseDirectory, 'portable-layout')
const runtimeDirectory = join(layoutDirectory, 'runtime')
const launcherPath = join(layoutDirectory, 'Media Photo Workbench.exe')
const archivePath = join(
  releaseDirectory,
  `MediaPhotoWorkbench-v${packageJson.version}-x64.zip`,
)
const launcherSource = join(projectRoot, 'scripts', 'portable-launcher.cs')
const iconPath = join(projectRoot, 'build', 'icon.ico')
const sevenZipPath = join(projectRoot, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe')
const compilerCandidates = [
  join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
]
const compilerPath = compilerCandidates.find(existsSync)

function fail(message) {
  console.error(`[portable-package] ${message}`)
  process.exit(1)
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  })

  if (result.error) {
    fail(`${executable} failed to start: ${result.error.message}`)
  }
  if (result.status !== 0) {
    fail(`${executable} exited with code ${result.status}`)
  }
}

if (!existsSync(unpackedDirectory)) {
  fail('release-pack/win-unpacked is missing; run electron-builder --win dir first')
}
if (!compilerPath) {
  fail('Microsoft .NET Framework 4 C# compiler was not found')
}
if (!existsSync(sevenZipPath)) {
  fail('7zip-bin x64 executable was not found')
}

rmSync(layoutDirectory, { recursive: true, force: true })
mkdirSync(runtimeDirectory, { recursive: true })
cpSync(unpackedDirectory, runtimeDirectory, { recursive: true })

run(compilerPath, [
  '/nologo',
  '/target:winexe',
  '/platform:x64',
  '/optimize+',
  `/win32icon:${iconPath}`,
  '/reference:System.dll',
  '/reference:System.Windows.Forms.dll',
  `/out:${launcherPath}`,
  launcherSource,
])

if (!existsSync(join(runtimeDirectory, 'Media Photo Workbench.exe'))) {
  fail('the packaged Electron executable is missing from runtime')
}
if (!existsSync(join(runtimeDirectory, 'resources', 'app.asar'))) {
  fail('runtime/resources/app.asar is missing')
}

const rootEntries = readdirSync(layoutDirectory).sort()
const expectedRootEntries = ['Media Photo Workbench.exe', 'runtime']
if (JSON.stringify(rootEntries) !== JSON.stringify(expectedRootEntries)) {
  fail(`unexpected portable root entries: ${rootEntries.join(', ')}`)
}

rmSync(archivePath, { force: true })
run(sevenZipPath, ['a', '-tzip', '-mx=7', archivePath, '.\\*'], {
  cwd: layoutDirectory,
})

console.log(`[portable-package] created ${archivePath}`)
console.log(`[portable-package] root layout verified: ${rootEntries.join(' + ')}`)
