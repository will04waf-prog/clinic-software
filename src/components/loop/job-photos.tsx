'use client'

import { useState, useRef, useEffect } from 'react'
import { Camera, X, Loader2 } from 'lucide-react'
import { dict, type Locale } from '@/lib/i18n'

type Photo = { id: string; url: string | null; createdAt: string }

/**
 * Proof-of-work capture for a job (Phase 3). Dead-simple on mobile: one
 * "Agregar foto" tile (opens camera OR library — no `capture` attr so the
 * OS offers both), thumbnails with a delete X. Reads/writes via the
 * org-scoped /api/jobs/[id]/photos routes; images are signed URLs.
 */
export function JobPhotos({ jobId, locale }: { jobId: string; locale: Locale }) {
  const t = dict(locale).job
  const [photos, setPhotos] = useState<Photo[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/jobs/${jobId}/photos`)
      .then((r) => r.json())
      .then((b) => { if (alive) setPhotos(b.photos ?? []) })
      .catch(() => {})
    return () => { alive = false }
  }, [jobId])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/jobs/${jobId}/photos`, { method: 'POST', body: fd })
      const b = await res.json().catch(() => null)
      if (!res.ok || !b?.id) { setError(b?.error ?? t.photoError); return }
      setPhotos((prev) => [...prev, { id: b.id, url: b.url, createdAt: b.createdAt }])
    } catch {
      setError(t.photoError)
    } finally {
      setUploading(false)
    }
  }

  async function remove(id: string) {
    setPhotos((prev) => prev.filter((p) => p.id !== id)) // optimistic
    await fetch(`/api/jobs/${jobId}/photos/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  return (
    <div className="mt-2">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">{t.photosTitle}</p>
      <div className="flex flex-wrap gap-2">
        {photos.map((p) => (
          <div key={p.id} className="relative h-16 w-16 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
            {p.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.url} alt="" className="h-full w-full object-cover" />
            )}
            <button
              type="button"
              onClick={() => remove(p.id)}
              aria-label={t.deletePhoto}
              className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/55 text-white"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[#028090]/40 bg-[#028090]/5 text-[#028090] transition-colors active:scale-95 disabled:opacity-60"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          <span className="px-1 text-[10px] font-medium leading-tight text-center">
            {uploading ? t.uploadingPhoto : t.addPhoto}
          </span>
        </button>
      </div>
      <input ref={inputRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
