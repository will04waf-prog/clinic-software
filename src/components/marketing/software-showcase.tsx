'use client'

/**
 * Software Showcase — the companion to <LaylaShowcase />, but touring the
 * platform instead of the voice agent. Same treatment: brand-matched
 * (cream + teal) CSS/JS animation, a real Jessica narration as the master
 * clock when playing with sound, a synthesized music bed, autoplay-muted
 * loop + "Play with sound", scrubber, and a mobile-responsive portrait
 * layout.
 *
 * 6 scenes: dashboard → pipeline (a lead moves stages) → contact timeline
 * → AI Twin draft → calendar → outro. Swap VO_AUDIO_SRC for a new
 * recording and re-check the T boundaries against its per-line durations.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  LayoutDashboard, Phone, MessageSquare, CalendarCheck, Sparkles, Bell,
  TrendingUp, Users, CalendarDays,
} from 'lucide-react'

const TEAL = '#02C39A'
const TEAL_DEEP = '#028090'
const INK = '#0B2027'
const CREAM = '#F5EFE1'

const VO_AUDIO_SRC = '/software-vo.mp3'
const MUSIC_AUDIO_SRC: string | null = null

// Scene boundaries (ms) aligned to the ElevenLabs (Jessica) narration —
// cumulative per-line durations of public/software-vo.mp3.
const T = {
  dash:    [0,     5133],
  pipe:    [5133,  10219],
  contact: [10219, 16513],
  twin:    [16513, 22714],
  cal:     [22714, 26779],
  outro:   [26779, 31076],
} as const
const TOTAL = 31076

type SceneKey = keyof typeof T
type Mode = 'idle' | 'playing' | 'paused' | 'ended' | 'frozen'

const MODULE: Record<SceneKey, string> = {
  dash: 'Dashboard', pipe: 'Pipeline', contact: 'Contacts', twin: 'AI Twin', cal: 'Calendar', outro: 'Tarhunna',
}

const KPIS = [
  { label: 'New leads',      value: 12,  suffix: '',   Icon: Users },
  { label: 'Booked',         value: 8,   suffix: '',   Icon: CalendarCheck },
  { label: 'Calls recovered',value: 5,   suffix: '',   Icon: Phone },
  { label: 'Revenue',        value: 9.4, suffix: 'k',  prefix: '$', Icon: TrendingUp },
]
const BARS = [34, 48, 41, 62, 55, 73, 68]

const COLUMNS = [
  { name: 'New', cards: [{ who: 'James W.', tag: 'Filler' }, { who: 'Ava N.', tag: 'Botox' }] },
  { name: 'Contacted', cards: [{ who: 'Emma C.', tag: 'Laser' }] },
  { name: 'Consult booked', cards: [{ who: 'Olivia P.', tag: 'Filler' }] },
  { name: 'Won', cards: [{ who: 'Priya S.', tag: 'HydraFacial' }] },
]

const TIMELINE = [
  { Icon: Phone,          tint: TEAL_DEEP, title: 'Inbound call booked by Layla', meta: 'Botox · Thu 2:30 PM · Dr. Rivera', time: '2h ago' },
  { Icon: MessageSquare,  tint: TEAL_DEEP, title: 'Confirmation SMS sent',         meta: 'Manage link delivered to +1 (415) 555‑0162', time: '2h ago' },
  { Icon: CalendarCheck,  tint: TEAL_DEEP, title: 'Consultation booked',           meta: 'Added to the calendar, no double-book', time: '2h ago' },
  { Icon: Bell,           tint: TEAL_DEEP, title: 'Day-before reminder scheduled', meta: 'Outbound AI call · Wed 2:30 PM',  time: 'upcoming' },
]

const AGENDA = [
  { time: '10:00', name: 'Emma Chen',     svc: 'Laser consult',  reminder: true },
  { time: '11:30', name: 'James Wilson',  svc: 'Filler consult', reminder: true },
  { time: '2:30',  name: 'Sofia Martinez',svc: 'Botox consult',  reminder: false, fresh: true },
  { time: '4:15',  name: 'Ava Nguyen',    svc: 'Botox consult',  reminder: false },
]

export function SoftwareShowcase() {
  const [mode, setMode] = useState<Mode>('idle')
  const [t, setT] = useState(0)
  const [muted, setMuted] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [inView, setInView] = useState(true)

  const music = useRef<{ stop: (fade?: boolean) => void; mute: (m: boolean) => void } | null>(null)
  const vo = useRef<HTMLAudioElement | null>(null)
  const modeRef = useRef<Mode>('idle')
  modeRef.current = mode
  const rootRef = useRef<HTMLDivElement>(null)

  // Pause the animation loop while off-screen — avoids a continuous rAF
  // burning CPU on the landing page (helps INP / battery).
  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.05 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 600px)')
    const apply = () => setIsMobile(mq.matches)
    apply(); mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  const startMusic = useCallback(() => {
    try {
      if (MUSIC_AUDIO_SRC) {
        const a = new Audio(MUSIC_AUDIO_SRC); a.loop = true; a.volume = muted ? 0 : 0.3; a.play().catch(() => {})
        music.current = { stop: () => a.pause(), mute: (m) => { a.volume = m ? 0 : 0.3 } }; return
      }
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new AC()
      const master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination)
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 850; filter.Q.value = 0.7; filter.connect(master)
      const chord = [146.83, 220.0, 293.66, 349.23]
      const oscs = chord.map((f, i) => { const o = ctx.createOscillator(); o.type = i % 2 ? 'sine' : 'triangle'; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = i === 0 ? 0.5 : 0.24; o.connect(g); g.connect(filter); o.start(); return o })
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lfoGain = ctx.createGain(); lfoGain.gain.value = 150; lfo.connect(lfoGain); lfoGain.connect(filter.frequency); lfo.start()
      master.gain.linearRampToValueAtTime(muted ? 0 : 0.04, ctx.currentTime + 1.8)
      music.current = {
        stop: (fade = true) => { try { const now = ctx.currentTime; master.gain.cancelScheduledValues(now); master.gain.setValueAtTime(master.gain.value, now); master.gain.linearRampToValueAtTime(0, now + (fade ? 1.0 : 0.05)); oscs.forEach((o) => o.stop(now + (fade ? 1.1 : 0.06))); lfo.stop(now + (fade ? 1.1 : 0.06)); setTimeout(() => ctx.close().catch(() => {}), fade ? 1300 : 120) } catch { /* */ } },
        mute: (m) => { try { master.gain.linearRampToValueAtTime(m ? 0 : 0.04, ctx.currentTime + 0.2) } catch { /* */ } },
      }
    } catch { /* no-op */ }
  }, [muted])

  const stopAudio = useCallback((fade = true) => {
    music.current?.stop(fade); music.current = null
    if (vo.current) { vo.current.pause(); vo.current.src = ''; vo.current = null }
  }, [])

  const beginPlay = useCallback(() => {
    stopAudio(false)
    startMusic()
    const a = new Audio(VO_AUDIO_SRC); a.preload = 'auto'; a.muted = muted
    a.onended = () => { setT(TOTAL - 1); music.current?.stop(true); setMode('ended') }
    a.play().catch(() => {})
    vo.current = a
    setT(0); setMode('playing')
  }, [startMusic, stopAudio, muted])

  useEffect(() => {
    if (mode === 'frozen' || mode === 'paused' || mode === 'ended' || !inView) return
    let raf = 0
    const loop = (now: number) => {
      if (modeRef.current === 'idle') setT(now % TOTAL)
      else if (modeRef.current === 'playing' && vo.current) setT(Math.min(vo.current.currentTime * 1000, TOTAL - 1))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [mode, inView])

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('seek')
    if (s !== null && s !== '' && !Number.isNaN(Number(s))) { setT(Number(s) % TOTAL); setMode('frozen') }
    return () => stopAudio(false)
  }, [stopAudio])

  const onPause = () => { vo.current?.pause(); music.current?.mute(true); setMode('paused') }
  const onResume = () => { vo.current?.play().catch(() => {}); music.current?.mute(muted); setMode('playing') }
  const onMuteToggle = () => { setMuted((m) => { const nm = !m; if (vo.current) vo.current.muted = nm; music.current?.mute(nm); return nm }) }

  const inScene = (k: SceneKey) => t >= T[k][0] && t < T[k][1]
  const progress = Math.min(t / TOTAL, 1)
  const showControls = mode !== 'frozen'
  const currentModule = (Object.keys(T) as SceneKey[]).find((k) => inScene(k)) ?? 'dash'

  // sub-scene progress helpers
  const sub = (k: SceneKey) => Math.max(0, t - T[k][0])
  const pipeMoved = sub('pipe') > 2600                     // Emma moves Contacted -> Consult
  const twinApproved = sub('twin') > 4600

  return (
    <div ref={rootRef} style={{ ...wrap, aspectRatio: isMobile ? '0.68' : '16 / 10', maxWidth: isMobile ? 460 : 940 }}>
      <style>{KEYFRAMES}</style>
      <div style={glowA} aria-hidden />
      <div style={glowB} aria-hidden />

      {/* browser-chrome top bar — frames it as the app */}
      <div style={topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/tarhunna-mark.png" alt="" width={20} height={20} style={{ display: 'block' }} />
          <div style={dots} aria-hidden><span style={{ ...dot, background: '#ff5f57' }} /><span style={{ ...dot, background: '#febc2e' }} /><span style={{ ...dot, background: '#28c840' }} /></div>
        </div>
        <div style={urlPill}>app.tarhunna.net/<span style={{ color: TEAL_DEEP, fontWeight: 600 }}>{MODULE[currentModule].toLowerCase()}</span></div>
      </div>

      <div style={{ ...stage, inset: isMobile ? '44px 0 48px' : '48px 0 56px', transform: `scale(${1 + progress * 0.02})` }}>

        {/* Scene 1 — Dashboard */}
        <div style={layer(inScene('dash'), 'dash')}>
          <Panel title="Dashboard" Icon={LayoutDashboard} isMobile={isMobile}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 12 }}>
              {KPIS.map((k, i) => {
                const val = k.suffix === 'k' ? k.value.toFixed(1) : String(k.value)
                return (
                  <div key={k.label} style={{ ...kpiTile, animation: `rise .5s ease ${i * 0.08}s both` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#7c8a84', fontSize: 11.5, fontWeight: 600 }}><k.Icon size={14} aria-hidden />{k.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: INK, marginTop: 3 }}>{k.prefix ?? ''}{val}{k.suffix ?? ''}</div>
                  </div>
                )
              })}
            </div>
            <div style={chartCard}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: '#7c8a84', marginBottom: 8 }}>Bookings · last 7 days</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 7, height: 56 }}>
                {BARS.map((h, i) => (
                  <div key={i} style={{ flex: 1, height: `${h}%`, minHeight: 4, borderRadius: 5, background: i === BARS.length - 1 ? `linear-gradient(${TEAL}, ${TEAL_DEEP})` : 'rgba(2,128,144,0.28)', transition: 'height .5s ease' }} />
                ))}
              </div>
            </div>
          </Panel>
        </div>

        {/* Scene 2 — Pipeline */}
        <div style={layer(inScene('pipe'), 'pipe')}>
          <Panel title="Pipeline" Icon={Users} isMobile={isMobile}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: isMobile ? 5 : 8 }}>
              {COLUMNS.map((col, ci) => {
                const cards = [...col.cards]
                if (pipeMoved && ci === 2) cards.unshift({ who: 'Emma C.', tag: 'Laser' })
                return (
                  <div key={col.name} style={pipeCol}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: TEAL, flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: isMobile ? 9 : 10.5, fontWeight: 600, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.name}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {cards.map((c, idx) => {
                        const isMover = c.who === 'Emma C.'
                        const inDest = isMover && ci === 2
                        if (isMover && ci === 1 && pipeMoved) return null
                        return (
                          <div key={`${c.who}-${idx}`} style={{ ...pipeCard, ...(inDest ? { borderColor: TEAL, boxShadow: `0 6px 16px -8px ${TEAL}`, animation: 'slideInL .5s cubic-bezier(.2,.8,.2,1) both' } : {}) }}>
                            <div style={{ fontSize: isMobile ? 9.5 : 11, fontWeight: 600, color: INK, lineHeight: 1.2 }}>{c.who}</div>
                            <div style={{ fontSize: isMobile ? 8.5 : 9.5, color: '#7c8a84', marginTop: 2 }}>{c.tag}</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </Panel>
        </div>

        {/* Scene 3 — Contact timeline */}
        <div style={layer(inScene('contact'), 'contact')}>
          <Panel title="Contact" Icon={Users} isMobile={isMobile}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={contactAvatar}>SM</div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 700, color: INK, fontSize: 15 }}>Sofia Martinez</div>
                <div style={{ fontSize: 12, color: '#7c8a84' }}>New patient · via Layla (inbound call)</div>
              </div>
              <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: TEAL_DEEP, background: 'rgba(2,195,154,0.12)', border: '1px solid rgba(2,195,154,0.3)', borderRadius: 999, padding: '3px 9px' }}>Booked</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {TIMELINE.map((e, i) => {
                const on = t >= T.contact[0] + 700 + i * 1200
                return (
                  <div key={e.title} style={{ ...timelineRow, opacity: on ? 1 : 0.16, transform: on ? 'translateX(0)' : 'translateX(-10px)' }}>
                    <div style={timelineIcon}><e.Icon size={15} aria-hidden /></div>
                    <div style={{ textAlign: 'left', flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>{e.title}</div>
                      <div style={{ fontSize: 11.5, color: '#7c8a84', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.meta}</div>
                    </div>
                    <span style={{ fontSize: 10.5, color: '#9aa8a2', flexShrink: 0 }}>{e.time}</span>
                  </div>
                )
              })}
            </div>
          </Panel>
        </div>

        {/* Scene 4 — AI Twin draft */}
        <div style={layer(inScene('twin'), 'twin')}>
          <Panel title="AI Twin" Icon={Sparkles} isMobile={isMobile}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ alignSelf: 'flex-start', maxWidth: '85%', ...inboundBubble }}>
                <span style={bubbleTag}>Sofia · inbound SMS</span>
                Hi! Do you have any openings for filler this week?
              </div>
              <div style={{ alignSelf: 'flex-end', maxWidth: '90%', ...draftCard }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                  <Sparkles size={13} color={TEAL_DEEP} aria-hidden />
                  <span style={{ fontSize: 11, fontWeight: 700, color: TEAL_DEEP }}>Drafted by AI Twin · in your voice</span>
                </div>
                Hi Sofia! Yes — we have <b>Thursday 2:30</b> or <b>Friday 11:00</b> with Dr. Rivera. Want me to hold one for you?
              </div>
              <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 8 }}>
                <span style={{ ...ghostBtn }}>Edit</span>
                <span style={{ ...approveBtn, ...(twinApproved ? { background: `linear-gradient(135deg, ${TEAL}, ${TEAL_DEEP})`, color: '#fff', boxShadow: `0 8px 18px -8px ${TEAL_DEEP}` } : {}) }}>
                  {twinApproved ? '✓ Sent' : 'Approve & send'}
                </span>
              </div>
            </div>
          </Panel>
        </div>

        {/* Scene 5 — Calendar / agenda */}
        <div style={layer(inScene('cal'), 'cal')}>
          <Panel title="Calendar" Icon={CalendarDays} isMobile={isMobile}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontWeight: 600, color: INK, fontSize: 13 }}>Thursday, April 18</span>
              <span style={{ fontSize: 11.5, color: '#7c8a84' }}>4 consultations</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {AGENDA.map((a, i) => {
                const on = t >= T.cal[0] + 500 + i * 800
                return (
                  <div key={a.time} style={{ ...agendaRow, opacity: on ? 1 : 0.16, transform: on ? 'translateY(0)' : 'translateY(8px)', ...(a.fresh ? { borderColor: 'rgba(2,195,154,0.45)' } : {}) }}>
                    <div style={agendaTime}>{a.time}</div>
                    <div style={{ textAlign: 'left', flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>{a.name}{a.fresh && <span style={{ fontSize: 10.5, fontWeight: 600, color: TEAL_DEEP, marginLeft: 6 }}>· new via Layla</span>}</div>
                      <div style={{ fontSize: 11.5, color: '#7c8a84' }}>{a.svc}</div>
                    </div>
                    {a.reminder && <span style={{ fontSize: 10, fontWeight: 600, color: TEAL_DEEP, background: 'rgba(2,195,154,0.12)', borderRadius: 999, padding: '3px 8px', flexShrink: 0 }}>Reminder sent</span>}
                  </div>
                )
              })}
            </div>
          </Panel>
        </div>

        {/* Scene 6 — Outro */}
        <div style={layer(inScene('outro'), 'outro')}>
          <div style={{ display: 'grid', placeItems: 'center', height: '100%', textAlign: 'center' }}>
            <div>
              <p style={{ margin: '0 0 6px', fontSize: isMobile ? 26 : 34, fontWeight: 800, letterSpacing: '-0.02em', color: INK }}>One <span style={{ color: TEAL_DEEP }}>platform</span>.</p>
              <p style={{ margin: '0 auto 16px', fontSize: 15, color: '#5b6b66', maxWidth: 420 }}>Your whole front office — voice, SMS, booking, and CRM, finally in one place.</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 7 }}>
                {['Dashboard', 'Pipeline', 'Contacts', 'AI Twin', 'Calendar', 'Automations'].map((m) => (
                  <span key={m} style={moduleChip}>{m}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {mode === 'ended' && (<div style={endOverlay}><button style={bigBtn} onClick={beginPlay} aria-label="Replay with sound"><ReplayIcon /> Replay</button></div>)}
      </div>

      {showControls && (
        <div style={scrubWrap}>
          {mode === 'idle' && (<button style={soundBtn} onClick={beginPlay} aria-label="Play with sound"><PlayIcon /> Play with sound</button>)}
          {(mode === 'playing' || mode === 'paused') && (<button style={iconBtn} onClick={mode === 'playing' ? onPause : onResume} aria-label={mode === 'playing' ? 'Pause' : 'Resume'}>{mode === 'playing' ? <PauseIcon /> : <PlayIcon />}</button>)}
          <div style={{ flex: 1, height: 4, borderRadius: 999, background: 'rgba(11,32,39,0.10)', overflow: 'hidden' }}>
            <div style={{ width: `${progress * 100}%`, height: '100%', background: `linear-gradient(90deg, ${TEAL_DEEP}, ${TEAL})`, borderRadius: 999 }} />
          </div>
          <div style={{ display: 'flex', gap: 5 }}>{(Object.keys(T) as SceneKey[]).map((k) => (<span key={k} style={{ width: 6, height: 6, borderRadius: '50%', background: inScene(k) ? TEAL : 'rgba(11,32,39,0.18)', transition: 'background .3s' }} />))}</div>
          {(mode === 'playing' || mode === 'paused') && (<button style={iconBtn} onClick={onMuteToggle} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? <MuteIcon /> : <SpeakerIcon />}</button>)}
        </div>
      )}
    </div>
  )
}

function Panel({ title, Icon, isMobile, children }: { title: string; Icon: typeof Users; isMobile: boolean; children: React.ReactNode }) {
  return (
    <div style={{ ...panel, maxWidth: isMobile ? 360 : 540 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'rgba(2,195,154,0.14)', color: TEAL_DEEP }}><Icon size={16} aria-hidden /></div>
        <span style={{ fontWeight: 700, color: INK, fontSize: 15 }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function PlayIcon() { return (<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l12-7z" /></svg>) }
function PauseIcon() { return (<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>) }
function ReplayIcon() { return (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>) }
function SpeakerIcon() { return (<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9H4z" /><path d="M16 8a5 5 0 0 1 0 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>) }
function MuteIcon() { return (<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9H4z" /><path d="M17 9l5 5M22 9l-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>) }

const wrap: React.CSSProperties = { position: 'relative', width: '100%', margin: '0 auto', background: CREAM, borderRadius: 24, overflow: 'hidden', border: '1px solid rgba(2,195,154,0.18)', boxShadow: '0 30px 60px -28px rgba(11,32,39,0.28)', fontFamily: 'var(--font-inter, ui-sans-serif, system-ui, sans-serif)' }
const glowA: React.CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(50% 45% at 50% 8%, rgba(2,195,154,0.16), transparent 70%)' }
const glowB: React.CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(42% 42% at 88% 88%, rgba(2,128,144,0.12), transparent 70%)', animation: 'drift 9s ease-in-out infinite alternate' }
const topBar: React.CSSProperties = { position: 'absolute', top: 0, left: 0, right: 0, height: 48, padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, zIndex: 5 }
const dots: React.CSSProperties = { display: 'flex', gap: 5 }
const dot: React.CSSProperties = { width: 9, height: 9, borderRadius: '50%' }
const urlPill: React.CSSProperties = { flex: 1, maxWidth: 320, margin: '0 auto', textAlign: 'center', fontSize: 12, color: '#7c8a84', background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(11,32,39,0.08)', borderRadius: 999, padding: '4px 12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const stage: React.CSSProperties = { position: 'absolute', zIndex: 2, transformOrigin: 'center 42%', transition: 'transform .2s linear' }
const scrubWrap: React.CSSProperties = { position: 'absolute', bottom: 0, left: 0, right: 0, minHeight: 56, padding: '0 18px', display: 'flex', alignItems: 'center', gap: 12, zIndex: 6 }

const ENTER: Record<SceneKey, string> = {
  dash: 'translateY(16px) scale(0.98)', pipe: 'translateX(28px) scale(0.99)', contact: 'translateX(-28px) scale(0.99)', twin: 'translateY(18px) scale(0.98)', cal: 'translateX(28px) scale(0.99)', outro: 'scale(0.95)',
}
function layer(active: boolean, k: SceneKey): React.CSSProperties { return { position: 'absolute', inset: 0, padding: '0 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', opacity: active ? 1 : 0, transform: active ? 'translate(0) scale(1)' : ENTER[k], filter: active ? 'blur(0)' : 'blur(3px)', transition: 'opacity .6s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1), filter .6s ease', pointerEvents: 'none' } }

const panel: React.CSSProperties = { width: '100%', background: 'rgba(255,255,255,0.74)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', border: '1px solid rgba(2,195,154,0.22)', borderRadius: 18, padding: 18, textAlign: 'left', boxShadow: '0 18px 40px -24px rgba(11,32,39,0.4)' }
const kpiTile: React.CSSProperties = { background: '#fff', border: '1px solid rgba(11,32,39,0.07)', borderRadius: 12, padding: '10px 12px' }
const chartCard: React.CSSProperties = { background: '#fff', border: '1px solid rgba(11,32,39,0.07)', borderRadius: 12, padding: '10px 12px' }
const pipeCol: React.CSSProperties = { background: 'rgba(11,32,39,0.03)', border: '1px solid rgba(11,32,39,0.06)', borderRadius: 10, padding: 6, minHeight: 90, minWidth: 0, overflow: 'hidden' }
const pipeCard: React.CSSProperties = { background: '#fff', border: '1px solid rgba(11,32,39,0.1)', borderRadius: 8, padding: '7px 8px', boxShadow: '0 2px 5px -3px rgba(11,32,39,0.3)', minWidth: 0, overflowWrap: 'break-word' }
const contactAvatar: React.CSSProperties = { width: 40, height: 40, borderRadius: '50%', background: `linear-gradient(135deg, ${TEAL}, ${TEAL_DEEP})`, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0, fontFamily: 'var(--font-newsreader, Georgia, serif)' }
const timelineRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 11, padding: '9px 11px', background: '#fff', border: '1px solid rgba(2,195,154,0.16)', borderRadius: 12, transition: 'opacity .5s ease, transform .5s ease' }
const timelineIcon: React.CSSProperties = { width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: 'grid', placeItems: 'center', color: TEAL_DEEP, background: 'rgba(2,195,154,0.12)' }
const inboundBubble: React.CSSProperties = { background: '#fff', border: '1px solid rgba(11,32,39,0.1)', borderRadius: 16, borderBottomLeftRadius: 4, padding: '9px 13px', fontSize: 14, lineHeight: 1.45, color: INK, textAlign: 'left' }
const draftCard: React.CSSProperties = { background: 'rgba(2,195,154,0.08)', border: '1px solid rgba(2,195,154,0.3)', borderRadius: 16, borderBottomRightRadius: 4, padding: '10px 13px', fontSize: 14, lineHeight: 1.45, color: INK, textAlign: 'left' }
const bubbleTag: React.CSSProperties = { display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#9aa8a2', marginBottom: 3 }
const ghostBtn: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: '#7c8a84', background: '#fff', border: '1px solid rgba(11,32,39,0.12)', borderRadius: 9, padding: '7px 14px' }
const approveBtn: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: TEAL_DEEP, background: '#fff', border: '1px solid rgba(2,195,154,0.4)', borderRadius: 9, padding: '7px 14px', transition: 'all .4s ease' }
const agendaRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 11, padding: '8px 11px', background: '#fff', border: '1px solid rgba(11,32,39,0.08)', borderRadius: 12, transition: 'opacity .45s ease, transform .45s ease' }
const agendaTime: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: TEAL_DEEP, width: 44, flexShrink: 0, textAlign: 'left' }
const moduleChip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', padding: '5px 12px', borderRadius: 999, background: 'rgba(2,195,154,0.10)', border: '1px solid rgba(2,195,154,0.28)', color: TEAL_DEEP, fontSize: 12.5, fontWeight: 600 }
const endOverlay: React.CSSProperties = { position: 'absolute', inset: 0, display: 'grid', placeItems: 'end center', paddingBottom: 18, pointerEvents: 'none', zIndex: 4 }
const bigBtn: React.CSSProperties = { pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 999, border: 'none', cursor: 'pointer', color: '#fff', fontSize: 14, fontWeight: 600, background: `linear-gradient(135deg, ${TEAL}, ${TEAL_DEEP})`, boxShadow: '0 10px 22px -10px rgba(2,128,144,0.7)' }
const soundBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 999, border: 'none', cursor: 'pointer', color: '#fff', fontSize: 13, fontWeight: 600, background: `linear-gradient(135deg, ${TEAL}, ${TEAL_DEEP})`, whiteSpace: 'nowrap', flexShrink: 0 }
const iconBtn: React.CSSProperties = { display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: '50%', border: '1px solid rgba(11,32,39,0.12)', background: '#fff', color: INK, cursor: 'pointer', flexShrink: 0 }

const KEYFRAMES = `
@keyframes ripple { 0%{transform:scale(1);opacity:0.5} 100%{transform:scale(2.3);opacity:0} }
@keyframes rise { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
@keyframes slideInL { from{opacity:0;transform:translateX(-16px)} to{opacity:1;transform:translateX(0)} }
@keyframes drift { from{transform:translate(0,0)} to{transform:translate(-14px,-10px)} }
`
