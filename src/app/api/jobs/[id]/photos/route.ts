/**
 * Completion photos for a job (Phase 3 — proof of work).
 *
 *   POST → upload one image (multipart 'file', optional geo_lat/geo_lng);
 *          stored PRIVATELY in the job-photos bucket, row appended.
 *   GET  → list this job's photos with short-lived signed URLs.
 *
 * Owner-authenticated, org-scoped. All storage access is service-role; the
 * bucket is private, so photos are only ever reachable via signed URLs we
 * mint here. The public /pagar + receipt paths mint their own via
 * service-role — the bucket is never public.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { dbErrorResponse } from '@/lib/api/db-error'

const BUCKET = 'job-photos'
const SIGNED_TTL = 60 * 60 // 1h
const MAX_BYTES = 10 * 1024 * 1024
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
}

async function resolveOwnedJob(req: NextRequest, jobId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single()
  if (!profile) return { error: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) }
  const { data: job } = await supabase
    .from('jobs').select('id').eq('id', jobId).eq('organization_id', profile.organization_id).maybeSingle()
  if (!job) return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) }
  return { user, organizationId: profile.organization_id as string }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params
  const ctx = await resolveOwnedJob(req, jobId)
  if ('error' in ctx) return ctx.error

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 }) }
  const file = form.get('file')
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'No file.' }, { status: 400 })
  if (file.size === 0 || file.size > MAX_BYTES) return NextResponse.json({ error: 'La foto es muy grande (máx. 10MB).' }, { status: 400 })
  const ext = EXT[file.type]
  if (!ext) return NextResponse.json({ error: 'Formato no admitido.' }, { status: 400 })

  const geoLat = parseFloat(String(form.get('geo_lat') ?? '')); const geoLng = parseFloat(String(form.get('geo_lng') ?? ''))
  const path = `${ctx.organizationId}/${jobId}/${crypto.randomUUID()}.${ext}`

  const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (upErr) return dbErrorResponse('job-photos:upload', upErr)

  const { data: row, error: insErr } = await supabaseAdmin.from('job_photos').insert({
    organization_id: ctx.organizationId, job_id: jobId, storage_path: path,
    geo_lat: isFinite(geoLat) ? geoLat : null, geo_lng: isFinite(geoLng) ? geoLng : null,
    created_by: ctx.user.id,
  }).select('id, created_at').single()
  if (insErr || !row) {
    await supabaseAdmin.storage.from(BUCKET).remove([path]) // don't orphan the file
    return dbErrorResponse('job-photos:insert', insErr)
  }

  const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL)
  return NextResponse.json({ id: row.id, url: signed?.signedUrl ?? null, createdAt: row.created_at })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params
  const ctx = await resolveOwnedJob(req, jobId)
  if ('error' in ctx) return ctx.error

  const { data: rows, error } = await supabaseAdmin
    .from('job_photos').select('id, storage_path, created_at')
    .eq('job_id', jobId).eq('organization_id', ctx.organizationId)
    .order('created_at', { ascending: true })
  if (error) return dbErrorResponse('job-photos:list', error)

  const photos = await Promise.all((rows ?? []).map(async (r: { id: string; storage_path: string; created_at: string }) => {
    const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(r.storage_path, SIGNED_TTL)
    return { id: r.id, url: signed?.signedUrl ?? null, createdAt: r.created_at }
  }))
  return NextResponse.json({ photos })
}
