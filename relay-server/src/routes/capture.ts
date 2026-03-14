import { Router } from 'express'
import { createRequire } from 'module'
import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'

const _require = createRequire(import.meta.url)
const { YoutubeTranscript } = _require('youtube-transcript') as {
  YoutubeTranscript: {
    fetchTranscript: (
      videoId: string
    ) => Promise<Array<{ text: string; duration: number; offset: number }>>
  }
}

const router = Router()

function isYouTubeUrl(url: string): boolean {
  return /youtube\.com\/watch|youtu\.be\//.test(url)
}

function extractYouTubeId(url: string): string | null {
  const m = url.match(/[?&]v=([^&]+)/) ?? url.match(/youtu\.be\/([^?&]+)/)
  return m ? m[1] : null
}

router.post('/extract-url', async (req, res) => {
  const { url } = req.body as { url?: string }
  if (!url) {
    res.status(400).json({ success: false, error: 'url required' })
    return
  }

  // ── YouTube: extract transcript ────────────────────────────────────────────
  if (isYouTubeUrl(url)) {
    const videoId = extractYouTubeId(url)
    if (!videoId) {
      res.json({ success: false, error: 'No se pudo extraer el ID del video de YouTube' })
      return
    }
    try {
      const transcript = await YoutubeTranscript.fetchTranscript(videoId)
      const text = transcript.map((t) => t.text).join(' ')

      // Fetch title via oEmbed (no API key needed)
      let title = `YouTube ${videoId}`
      try {
        const oembed = await fetch(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
        )
        if (oembed.ok) {
          const data = (await oembed.json()) as { title?: string }
          if (data.title) title = data.title
        }
      } catch {
        // title stays as fallback
      }

      console.log(`[capture] YouTube transcript extracted: "${title}" (${text.split(/\s+/).length} words)`)
      res.json({ success: true, type: 'youtube', title, text, wordCount: text.split(/\s+/).length })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.log(`[capture] YouTube transcript failed for ${videoId}: ${msg}`)
      res.json({ success: false, error: `Transcripción de YouTube no disponible: ${msg}` })
    }
    return
  }

  // ── Regular URL: fetch + Readability ──────────────────────────────────────
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Attacca/1.0; +https://attacca.app)' },
      signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) {
      res.json({ success: false, error: `HTTP ${response.status} al acceder a la URL` })
      return
    }
    const html = await response.text()
    const dom = new JSDOM(html, { url })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()

    if (!article?.textContent?.trim()) {
      res.json({ success: false, error: 'No se pudo extraer contenido legible de esta página' })
      return
    }

    const text = article.textContent.trim()
    console.log(`[capture] Article extracted: "${article.title}" (${text.split(/\s+/).length} words)`)
    res.json({
      success: true,
      type: 'article',
      title: article.title ?? url,
      text,
      wordCount: text.split(/\s+/).length
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`[capture] URL fetch failed for ${url}: ${msg}`)
    res.json({ success: false, error: `No se pudo acceder a la URL: ${msg}` })
  }
})

export default router
