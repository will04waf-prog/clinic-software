import { supabaseAdmin } from '@/lib/supabase/admin'

const BUCKET = 'job-photos'
const TTL = 60 * 60 // 1h

/**
 * Signed URLs for a job's completion photos — server-side, service-role.
 * The bucket is private, so these short-lived signed URLs are the only way
 * the photos are ever exposed (owner invoice + the public /pagar page a
 * client/bank sees). Returns [] for no job / no photos.
 */
export async function getJobPhotoUrls(jobId: string | null | undefined): Promise<string[]> {
  if (!jobId) return []
  const { data: rows } = await supabaseAdmin
    .from('job_photos')
    .select('storage_path')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })
  if (!rows || rows.length === 0) return []

  const signed = await Promise.all(
    rows.map(async (r) => {
      const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(r.storage_path, TTL)
      return data?.signedUrl ?? null
    }),
  )
  return signed.filter((u): u is string => !!u)
}
