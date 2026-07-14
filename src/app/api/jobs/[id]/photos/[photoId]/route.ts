/**
 * DELETE /api/jobs/[id]/photos/[photoId] — remove a completion photo.
 * Owner-authenticated + org-scoped. Deletes the storage object then the
 * row (order matters: if the object delete fails we keep the row so it can
 * be retried rather than orphaning the file).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { dbErrorResponse } from '@/lib/api/db-error'

const BUCKET = 'job-photos'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const { id: jobId, photoId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { data: photo } = await supabaseAdmin
    .from('job_photos').select('id, storage_path')
    .eq('id', photoId).eq('job_id', jobId).eq('organization_id', profile.organization_id).maybeSingle()
  if (!photo) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { error: rmErr } = await supabaseAdmin.storage.from(BUCKET).remove([photo.storage_path])
  if (rmErr) return dbErrorResponse('job-photos:remove', rmErr)

  const { error: delErr } = await supabaseAdmin
    .from('job_photos').delete().eq('id', photoId).eq('organization_id', profile.organization_id)
  if (delErr) return dbErrorResponse('job-photos:delete', delErr)

  return NextResponse.json({ ok: true })
}
