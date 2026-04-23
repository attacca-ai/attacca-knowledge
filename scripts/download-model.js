/**
 * Downloads the all-MiniLM-L6-v2 ONNX weights for local embedding generation.
 *
 * Runs automatically as part of `npm install` (postinstall hook). The model
 * is bundled into the installer via electron-builder `extraResources`, so it
 * must exist on disk before `npm run build:win` is invoked.
 *
 * Skips the download when the file is already present. Set
 * `ATTACCA_SKIP_MODEL_DOWNLOAD=1` to skip entirely (CI builds that don't
 * package the desktop app, contributors who only need typecheck/lint).
 *
 * Tokenizer + config files are kept in git — only the 90 MB .onnx weight is
 * fetched here.
 */

const { existsSync, mkdirSync, createWriteStream, statSync, unlinkSync } = require('fs')
const { join } = require('path')
const https = require('https')

const MODEL_DIR = join(__dirname, '..', 'models', 'all-MiniLM-L6-v2')
const ONNX_DIR = join(MODEL_DIR, 'onnx')
const ONNX_FILE = join(ONNX_DIR, 'model.onnx')
const ONNX_URL =
  'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx?download=true'
const EXPECTED_BYTES = 90387606

function log(msg) {
  process.stdout.write(`[download-model] ${msg}\n`)
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'))

    const req = https.get(url, (res) => {
      // Follow redirects (HuggingFace returns 302 to a CDN URL).
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return resolve(download(res.headers.location, dest, redirects + 1))
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`))
      }

      const total = Number(res.headers['content-length']) || 0
      let received = 0
      let nextLog = 10 * 1024 * 1024 // log every ~10 MB

      const out = createWriteStream(dest)
      res.on('data', (chunk) => {
        received += chunk.length
        if (received >= nextLog) {
          const mb = (received / 1024 / 1024).toFixed(1)
          const pct = total ? ` (${((received / total) * 100).toFixed(0)}%)` : ''
          log(`  ${mb} MB${pct}`)
          nextLog += 10 * 1024 * 1024
        }
      })
      res.pipe(out)
      out.on('finish', () => out.close(resolve))
      out.on('error', reject)
    })
    req.on('error', reject)
  })
}

async function main() {
  if (process.env.ATTACCA_SKIP_MODEL_DOWNLOAD === '1') {
    log('ATTACCA_SKIP_MODEL_DOWNLOAD=1 set — skipping')
    return
  }

  if (existsSync(ONNX_FILE)) {
    const size = statSync(ONNX_FILE).size
    if (size === EXPECTED_BYTES) {
      log(`already present (${size} bytes), skipping`)
      return
    }
    log(`existing file is ${size} bytes (expected ${EXPECTED_BYTES}), re-downloading`)
    unlinkSync(ONNX_FILE)
  }

  mkdirSync(ONNX_DIR, { recursive: true })
  log(`downloading ONNX weights → ${ONNX_FILE}`)

  try {
    await download(ONNX_URL, ONNX_FILE)
    const size = statSync(ONNX_FILE).size
    log(`done (${size} bytes)`)
    if (size !== EXPECTED_BYTES) {
      log(`WARNING: size mismatch (got ${size}, expected ${EXPECTED_BYTES})`)
    }
  } catch (err) {
    log(`FAILED: ${err.message}`)
    log('The desktop installer will not include the embedding model.')
    log('Re-run `node scripts/download-model.js` once the network is available.')
    // Don't fail `npm install` for offline contributors. The app already
    // falls back to keyword search when the model is missing.
    process.exit(0)
  }
}

main()
