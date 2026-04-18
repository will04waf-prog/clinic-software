import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const { name, clinic_name, email, phone, preferred_date, notes, source, page_path } = body

    if (!name || !clinic_name || !email) {
      return NextResponse.json({ error: 'Name, clinic name, and email are required.' }, { status: 400 })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('demo_requests')
      .insert({
        name: String(name).slice(0, 200),
        clinic_name: String(clinic_name).slice(0, 200),
        email: String(email).slice(0, 200),
        phone: phone ? String(phone).slice(0, 50) : null,
        preferred_date: preferred_date ? String(preferred_date).slice(0, 200) : null,
        notes: notes ? String(notes).slice(0, 2000) : null,
        source: source ? String(source).slice(0, 500) : null,
        page_path: page_path ? String(page_path).slice(0, 500) : null,
        status: 'new',
      })

    if (error) {
      console.error('demo_requests insert error:', error)
      return NextResponse.json({ error: 'Failed to save request.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    console.error('demo POST error:', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
