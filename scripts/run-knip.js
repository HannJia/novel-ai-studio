const { spawnSync } = require('node:child_process')
const path = require('node:path')

const knipEntry = path.join(__dirname, '..', 'node_modules', 'knip', 'bin', 'knip.js')
const result = spawnSync(process.execPath, [knipEntry, '--no-progress'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    // Oxc raw transfer reserves 6 GiB of virtual address space even for a
    // small project, which can fail on Windows machines with a small pagefile.
    KNIP_DISABLE_RAW_TRANSFER: '1',
  },
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)
