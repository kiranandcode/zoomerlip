import { useEffect, useRef, useState } from 'react'
import { request } from '../api'
import { sanitizeContent } from '../content'
import type { Account } from '../types'
export function MessageContent({ html, account }: { html: string; account: Account }) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const objectUrls: string[] = []
    const container = ref.current!
    container.replaceChildren(sanitizeContent(html, account.url)); setError('')
    const resolveUpload = async (path: string) => {
      const result = await request<{ url: string }>(account, path, {}, 'GET', controller.signal)
      const url = new URL(result.url, account.url)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid attachment URL')
      return url.href
    }
    // Fetch temporary URLs immediately; retain the image blob, never the signed URL.
    container.querySelectorAll<HTMLImageElement>('img[data-upload]').forEach(img => {
      void (async () => {
        try {
          const url = await resolveUpload(img.dataset.upload!)
          const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
          if (!response.ok) throw new Error('Attachment unavailable')
          const blob = await response.blob()
          if (controller.signal.aborted) return
          const objectUrl = URL.createObjectURL(blob); objectUrls.push(objectUrl); img.src = objectUrl
        } catch { if (!controller.signal.aborted) setError('An attachment could not be loaded.') }
      })()
    })
    const click = (event: MouseEvent) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[data-upload]')
      if (!link) return
      event.preventDefault()
      const popup = window.open('about:blank', '_blank')
      if (popup) popup.opener = null
      void resolveUpload(link.dataset.upload!).then(url => {
        if (popup) popup.location.replace(url)
        else setError('Allow popups to open attachments.')
      }).catch(() => { popup?.close(); if (!controller.signal.aborted) setError('Attachment unavailable. Try again.') })
    }
    container.addEventListener('click', click)
    return () => { controller.abort(); container.removeEventListener('click', click); objectUrls.forEach(URL.revokeObjectURL) }
  }, [html, account])
  return <><div className="message-content" ref={ref}/>{error && <small className="error">{error}</small>}</>
}
