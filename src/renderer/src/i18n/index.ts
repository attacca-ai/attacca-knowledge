import { useState, useCallback } from 'react'
import en from './en.json'
import es from './es.json'

type Locale = 'en' | 'es'
type Translations = Record<string, string>

const TRANSLATIONS: Record<Locale, Translations> = { en, es }

function detectLocale(): Locale {
  try {
    const lang = navigator.language?.slice(0, 2)?.toLowerCase()
    if (lang === 'es') return 'es'
  } catch {
    // SSR or unavailable
  }
  return 'en'
}

let currentLocale: Locale = detectLocale()

export function getLocale(): Locale {
  return currentLocale
}

export function setLocale(locale: Locale): void {
  currentLocale = locale
}

export function t(key: string, params?: Record<string, string | number>): string {
  const translations = TRANSLATIONS[currentLocale] ?? TRANSLATIONS.en
  let value = translations[key] ?? TRANSLATIONS.en[key] ?? key

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(`{${k}}`, String(v))
    }
  }

  return value
}

export function useTranslation(): {
  t: typeof t
  locale: Locale
  setLocale: (l: Locale) => void
} {
  const [locale, setLocaleState] = useState<Locale>(currentLocale)

  const changeLocale = useCallback((l: Locale) => {
    setLocale(l)
    setLocaleState(l)
  }, [])

  return { t, locale, setLocale: changeLocale }
}
