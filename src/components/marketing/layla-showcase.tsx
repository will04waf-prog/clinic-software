'use client'

/**
 * Layla Showcase — an autoplaying, brand-matched "product video" that
 * presents Layla, the AI voice receptionist, and her full 16-tool kit.
 *
 *   - Voice-over: a pre-rendered narration file (VO_AUDIO_SRC) that
 *     EXPLAINS how Layla works (not the on-screen dialogue). When sound
 *     is playing, the audio element is the master clock, so the scenes
 *     stay in sync with the narration. Swap VO_AUDIO_SRC for a new
 *     recording and re-check the T boundaries against its per-line
 *     durations.
 *   - Background music: synthesized ambient bed via Web Audio (or set
 *     MUSIC_AUDIO_SRC to a real track).
 *
 * 8 scenes: incoming call → live conversation → books it → texts the
 * link → manage an existing visit → follow-up (confirm / message /
 * transfer / email) → the full 16-tool grid → outro. Each scene fires
 * the function-names of the tools it demonstrates; all 16 are named.
 *
 * Sound can't autoplay (browser policy), so it loops MUTED and offers a
 * "Play with sound" button that runs it once start-to-finish, then
 * offers Replay. Drop it anywhere:  <LaylaShowcase />
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CalendarSearch, Clock, CalendarCheck, BellRing, Search, RefreshCw, CalendarX,
  Sparkles, HelpCircle, MapPin, ClipboardList, BookOpen, MessageSquare, Voicemail,
  PhoneForwarded, Mail, Phone, type LucideIcon,
} from 'lucide-react'

const TEAL = '#02C39A'
const TEAL_DEEP = '#028090'
const INK = '#0B2027'
const CREAM = '#F5EFE1'

// Real assets. VO is required for sound; music falls back to synthesis.
const VO_AUDIO_SRC = '/layla-vo.mp3'
const MUSIC_AUDIO_SRC: string | null = null

// Scene boundaries (ms) aligned to the ElevenLabs (Jessica) narration —
// cumulative per-line durations of public/layla-vo.mp3 (incl. 0.35s
// inter-line pads): 5829 / 12541 / 18742 / 24014 / 32351 / 41153 / 46286 / 48772.
const T = {
  ring:     [0,     5829],
  talk:     [5829,  12541],
  book:     [12541, 18742],
  text:     [18742, 24014],
  manage:   [24014, 32351],
  followup: [32351, 41153],
  tools:    [41153, 46286],
  outro:    [46286, 48772],
} as const
const TOTAL = 48772

type SceneKey = keyof typeof T
type Mode = 'idle' | 'playing' | 'paused' | 'ended' | 'frozen'

type Line = { who: 'caller' | 'layla'; at: number; text: string }
const LINES: Line[] = [
  { who: 'caller', at: 6300,  text: 'Hi — do you have anything for Botox this Thursday?' },
  { who: 'layla',  at: 7900,  text: "We do. I've got 2:30 or 4:15 with Dr. Rivera — which works better?" },
  { who: 'caller', at: 9600,  text: '2:30 is perfect.' },
  { who: 'layla',  at: 10900, text: "Great — I'm booking that now and I'll text you the details." },
]

const SLOTS = ['10:00', '11:30', '2:30', '4:15']

// The 16 voice tools, in the order they light up in the grid finale.
const TOOLS: { fn: string; label: string; Icon: LucideIcon }[] = [
  { fn: 'find_service',            label: 'Find a service',     Icon: Sparkles },
  { fn: 'lookup_faq',             label: 'Answer FAQs',        Icon: HelpCircle },
  { fn: 'give_directions',        label: 'Give directions',    Icon: MapPin },
  { fn: 'get_context',            label: 'Know your clinic',   Icon: BookOpen },
  { fn: 'lookup_availability',    label: 'Check availability', Icon: CalendarSearch },
  { fn: 'create_hold',            label: 'Hold a slot',        Icon: Clock },
  { fn: 'confirm_booking',        label: 'Book it',            Icon: CalendarCheck },
  { fn: 'send_link_sms',          label: 'Text a link',        Icon: MessageSquare },
  { fn: 'lookup_my_appointments', label: 'Find your visit',    Icon: Search },
  { fn: 'reschedule_appointment', label: 'Reschedule',         Icon: RefreshCw },
  { fn: 'cancel_appointment',     label: 'Cancel',             Icon: CalendarX },
  { fn: 'pre_visit_instructions', label: 'Prep instructions',  Icon: ClipboardList },
  { fn: 'confirm_appointment',    label: 'Confirm reminders',  Icon: BellRing },
  { fn: 'take_message',           label: 'Take a message',     Icon: Voicemail },
  { fn: 'transfer_to_human',      label: 'Transfer to staff',  Icon: PhoneForwarded },
  { fn: 'post_call_summary_email',label: 'Email a recap',      Icon: Mail },
]

// Which tool function-names each scene demonstrates (fired as chips).
const SCENE_TOOLS: Record<SceneKey, string[]> = {
  ring:     [],
  talk:     ['get_context', 'find_service', 'lookup_faq', 'give_directions'],
  book:     ['lookup_availability', 'create_hold', 'confirm_booking'],
  text:     ['send_link_sms'],
  manage:   ['lookup_my_appointments', 'reschedule_appointment', 'cancel_appointment', 'pre_visit_instructions'],
  followup: ['confirm_appointment', 'take_message', 'transfer_to_human', 'post_call_summary_email'],
  tools:    [],
  outro:    [],
}

// Friendly "what Layla does" phrasing for the in-scene chips (instead of
// the raw tool function-names).
const TOOL_LABELS: Record<string, string> = {
  get_context:            'Knows your clinic',
  find_service:           'Finds the right service',
  lookup_faq:             'Answers FAQs',
  give_directions:        'Gives directions',
  lookup_availability:    'Checks availability',
  create_hold:            'Holds the slot',
  confirm_booking:        'Books the appointment',
  send_link_sms:          'Texts a link',
  lookup_my_appointments: 'Finds your appointment',
  reschedule_appointment: 'Reschedules',
  cancel_appointment:     'Cancels',
  pre_visit_instructions: 'Sends prep instructions',
  confirm_appointment:    'Confirms appointments',
  take_message:           'Takes messages',
  transfer_to_human:      'Transfers to staff',
  post_call_summary_email:'Emails a recap',
}

const ENTER: Record<SceneKey, string> = {
  ring:     'translateY(14px) scale(0.97)',
  talk:     'translateX(26px) scale(0.99)',
  book:     'translateY(20px) scale(0.97)',
  text:     'translateX(34px) scale(0.99)',
  manage:   'translateY(20px) scale(0.97)',
  followup: 'translateX(-30px) scale(0.99)',
  tools:    'scale(0.94)',
  outro:    'translateY(16px) scale(0.96)',
}

export function LaylaShowcase() {
  const [mode, setMode] = useState<Mode>('idle')
  const [t, setT] = useState(0)
  const [muted, setMuted] = useState(false)

  const music = useRef<{ stop: (fade?: boolean) => void; mute: (m: boolean) => void } | null>(null)
  const vo = useRef<HTMLAudioElement | null>(null)
  const modeRef = useRef<Mode>('idle')
  modeRef.current = mode

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
      const chord = [130.81, 196.0, 261.63, 329.63]
      const oscs = chord.map((f, i) => { const o = ctx.createOscillator(); o.type = i % 2 ? 'sine' : 'triangle'; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = i === 0 ? 0.5 : 0.24; o.connect(g); g.connect(filter); o.start(); return o })
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06; const lfoGain = ctx.createGain(); lfoGain.gain.value = 150; lfo.connect(lfoGain); lfoGain.connect(filter.frequency); lfo.start()
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

  // Master clock: performance.now for the muted idle loop, the audio
  // element's currentTime when playing with sound (perfect sync).
  useEffect(() => {
    if (mode === 'frozen' || mode === 'paused' || mode === 'ended') return
    let raf = 0
    const loop = (now: number) => {
      if (modeRef.current === 'idle') setT(now % TOTAL)
      else if (modeRef.current === 'playing' && vo.current) setT(Math.min(vo.current.currentTime * 1000, TOTAL - 1))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [mode])

  // Dev-only ?seek=<ms> for screenshots.
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
  const callSecs = Math.min(Math.floor(t / 1000), 48)
  const mmss = `0:${String(callSecs).padStart(2, '0')}`
  const bookEl = t - T.book[0]
  const bookPhase = bookEl < 1700 ? 'checking' : bookEl < 3400 ? 'holding' : 'booked'
  const manageEl = t - T.manage[0]
  const managePhase = manageEl < 4200 ? 'before' : 'after'
  const visibleLines = LINES.filter((l) => t >= l.at).slice(-3)
  const showControls = mode !== 'frozen'

  return (
    <div style={wrap}>
      <style>{KEYFRAMES}</style>
      <div style={glowA} aria-hidden />
      <div style={glowB} aria-hidden />

      <div style={topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/tarhunna-mark.png" alt="" width={22} height={22} style={{ display: 'block' }} />
          <span style={{ fontWeight: 600, color: INK, letterSpacing: '-0.01em' }}>Tarhunna</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TEAL_DEEP, fontWeight: 600 }}>
          <span style={liveDot} /> Live call · {mmss}
        </div>
      </div>

      <div style={{ ...stage, transform: `scale(${1 + progress * 0.02})` }}>
        {/* Scene 0 — incoming */}
        <div style={layer(inScene('ring'), 'ring')}>
          <div style={{ position: 'relative', display: 'grid', placeItems: 'center', height: 150 }}>
            <span style={ring(0)} /><span style={ring(0.6)} /><span style={ring(1.2)} />
            <div style={avatar}>L</div>
          </div>
          <p style={kicker}>Incoming call</p>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: INK }}>(415) 555‑0162</p>
          <p style={{ margin: '10px 0 0', fontSize: 14, color: '#5b6b66' }}>{t > 2000 ? 'Layla is answering…' : 'Your front desk is on another line'}</p>
        </div>

        {/* Scene 1 — conversation */}
        <div style={layer(inScene('talk'), 'talk')}>
          <div style={waveRow} aria-hidden>
            {Array.from({ length: 38 }).map((_, i) => {
              const env = inScene('talk') ? 0.45 + 0.55 * Math.abs(Math.sin(t / 130 + i * 0.5)) : 0.4
              const h = (10 + (i % 5) * 7) * env
              return <span key={i} style={{ width: 4, height: h, borderRadius: 999, background: i % 2 ? TEAL : TEAL_DEEP }} />
            })}
          </div>
          <div style={captionCol}>
            {visibleLines.map((l, i) => (
              <div key={l.at} style={{ ...bubbleRow, justifyContent: l.who === 'layla' ? 'flex-start' : 'flex-end', opacity: i === visibleLines.length - 1 ? 1 : 0.5 }}>
                {l.who === 'layla' && <div style={miniAvatar}>L</div>}
                <div style={l.who === 'layla' ? laylaBubble : callerBubble}>
                  <span style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3, color: l.who === 'layla' ? TEAL_DEEP : 'rgba(255,255,255,0.85)' }}>{l.who === 'layla' ? 'Layla' : 'Caller'}</span>
                  {l.text}
                </div>
              </div>
            ))}
          </div>
          <ToolChips tools={SCENE_TOOLS.talk} start={T.talk[0]} t={t} />
        </div>

        {/* Scene 2 — books it */}
        <div style={layer(inScene('book'), 'book')}>
          <div style={bookCard}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontWeight: 600, color: INK }}>Botox · 30 min</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: TEAL_DEEP, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ ...liveDot, animation: 'none', background: bookPhase === 'booked' ? TEAL : '#cbb994' }} />
                {bookPhase === 'checking' ? 'Checking real availability…' : bookPhase === 'holding' ? 'Holding your slot…' : 'Confirmed'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {SLOTS.map((s) => {
                const picked = s === '2:30'; const on = picked && bookPhase !== 'checking'
                return (<div key={s} style={{ flex: 1, textAlign: 'center', padding: '10px 0', borderRadius: 10, fontSize: 14, fontWeight: 600, color: on ? '#fff' : picked ? TEAL_DEEP : '#7c8a84', background: on ? `linear-gradient(135deg, ${TEAL}, ${TEAL_DEEP})` : '#fff', border: `1px solid ${on ? 'transparent' : 'rgba(11,32,39,0.08)'}`, transform: on ? 'translateY(-2px)' : 'none', transition: 'all .4s ease' }}>{s}</div>)
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, background: bookPhase === 'booked' ? 'rgba(2,195,154,0.10)' : 'transparent', transition: 'background .4s ease' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#fff', flexShrink: 0, background: bookPhase === 'booked' ? TEAL : '#d8cdb6', transition: 'background .4s' }}><CheckIcon /></div>
              <div style={{ fontSize: 14, color: INK }}><b style={{ fontWeight: 700 }}>Thursday 2:30 PM</b> · Dr. Rivera<div style={{ fontSize: 12, color: '#7c8a84' }}>Booked on the call — no callback loop</div></div>
            </div>
          </div>
          <ToolChips tools={SCENE_TOOLS.book} start={T.book[0]} t={t} />
        </div>

        {/* Scene 3 — confirmation text */}
        <div style={layer(inScene('text'), 'text')}>
          <div style={smsBubble}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: TEAL_DEEP, fontSize: 12, fontWeight: 700 }}><span style={{ fontSize: 15 }}>✓</span> Confirmation sent · SMS</div>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: INK }}>You&apos;re booked for <b>Botox, Thu 2:30 PM</b> with Dr. Rivera at Tarhunna Aesthetics. Need to change it? <span style={{ color: TEAL_DEEP, fontWeight: 600 }}>tarhunna.net/m/3f9k</span></p>
          </div>
          <ToolChips tools={SCENE_TOOLS.text} start={T.text[0]} t={t} />
        </div>

        {/* Scene 4 — manage an existing appointment */}
        <div style={layer(inScene('manage'), 'manage')}>
          <p style={kicker}>Already a patient?</p>
          <div style={{ ...bookCard, maxWidth: 440 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14 }}>
              <div style={{ ...miniAvatar, width: 36, height: 36, fontSize: 14 }}>JM</div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 600, color: INK, fontSize: 15 }}>Jordan Maxwell</div>
                <div style={{ fontSize: 12.5, color: '#7c8a84' }}>Filler · {managePhase === 'before' ? 'Fri 11:00 AM' : 'Tue 3:00 PM'} · Dr. Rivera</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { label: 'Reschedule', Icon: RefreshCw, hot: managePhase === 'after' },
                { label: 'Cancel', Icon: CalendarX, hot: false },
                { label: 'Text prep', Icon: ClipboardList, hot: false },
              ].map(({ label, Icon, hot }) => (
                <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '11px 0', borderRadius: 12, fontSize: 12.5, fontWeight: 600, color: hot ? '#fff' : TEAL_DEEP, background: hot ? `linear-gradient(135deg, ${TEAL}, ${TEAL_DEEP})` : '#fff', border: `1px solid ${hot ? 'transparent' : 'rgba(2,195,154,0.22)'}`, transition: 'all .4s ease' }}>
                  <Icon size={17} aria-hidden /> {label}
                </div>
              ))}
            </div>
            {managePhase === 'after' && <div style={{ marginTop: 12, fontSize: 12.5, color: TEAL_DEEP, fontWeight: 600 }}>✓ Moved to Tuesday 3:00 PM — confirmation texted</div>}
          </div>
          <ToolChips tools={SCENE_TOOLS.manage} start={T.manage[0]} t={t} />
        </div>

        {/* Scene 5 — follow-up */}
        <div style={layer(inScene('followup'), 'followup')}>
          <p style={kicker}>After the call</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, width: '100%', maxWidth: 460 }}>
            {[
              { Icon: Phone,          title: 'Reminder call placed', body: '“Hi, this is Layla confirming tomorrow’s visit.”' },
              { Icon: Voicemail,      title: 'Message taken',        body: 'Caller asked about financing — saved to the inbox.' },
              { Icon: PhoneForwarded, title: 'Transferred to staff', body: 'Urgent post-op question routed to Dr. Rivera.' },
              { Icon: Mail,           title: 'Summary emailed',      body: 'Owner gets a recap + transcript of every call.' },
            ].map(({ Icon, title, body }, i) => {
              const on = t >= T.followup[0] + 600 + i * 1700
              return (
                <div key={title} style={{ ...followRow, opacity: on ? 1 : 0.18, transform: on ? 'translateX(0)' : 'translateX(-12px)' }}>
                  <div style={followIcon}><Icon size={17} aria-hidden /></div>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{title}</div>
                    <div style={{ fontSize: 12.5, color: '#7c8a84' }}>{body}</div>
                  </div>
                </div>
              )
            })}
          </div>
          <ToolChips tools={SCENE_TOOLS.followup} start={T.followup[0]} t={t} />
        </div>

        {/* Scene 6 — the 16-tool grid */}
        <div style={layer(inScene('tools'), 'tools')}>
          <p style={{ ...kicker, margin: '0 0 4px' }}>One receptionist</p>
          <p style={{ margin: '0 0 16px', fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: INK }}>16 tools, on every call</p>
          <div style={gridWrap}>
            {TOOLS.map(({ fn, label, Icon }, i) => {
              const on = t >= T.tools[0] + 250 + i * 170
              return (
                <div key={fn} style={{ ...toolCell, opacity: on ? 1 : 0, transform: on ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.96)', borderColor: on ? 'rgba(2,195,154,0.45)' : 'rgba(11,32,39,0.08)' }}>
                  <Icon size={17} color={TEAL_DEEP} aria-hidden />
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: INK, lineHeight: 1.2 }}>{label}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Scene 7 — outro */}
        <div style={layer(inScene('outro'), 'outro')}>
          <div style={{ display: 'grid', placeItems: 'center', height: '100%', textAlign: 'center' }}>
            <div>
              <div style={crmChip}><span style={{ ...liveDot, animation: 'none', background: TEAL }} /> Every call logged to your CRM</div>
              <p style={{ margin: '20px 0 4px', fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', color: INK }}>Meet <span style={{ color: TEAL_DEEP }}>Layla</span>.</p>
              <p style={{ margin: 0, fontSize: 15, color: '#5b6b66', maxWidth: 400 }}>Your front desk, always on — answering, booking, and following up on every call.</p>
            </div>
          </div>
        </div>

        {mode === 'ended' && (
          <div style={endOverlay}><button style={bigBtn} onClick={beginPlay} aria-label="Replay with sound"><ReplayIcon /> Replay</button></div>
        )}
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

function ToolChips({ tools, start, t }: { tools: string[]; start: number; t: number }) {
  if (tools.length === 0) return null
  return (
    <div style={chipRow}>
      {tools.map((fn, i) => {
        const on = t >= start + 500 + i * 650
        return (
          <span key={fn} style={{ ...toolChip, opacity: on ? 1 : 0, transform: on ? 'translateY(0)' : 'translateY(6px)' }}>
            <span style={chipDot} />{TOOL_LABELS[fn] ?? fn}
          </span>
        )
      })}
    </div>
  )
}

function CheckIcon() { return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6" /></svg>) }
function PlayIcon() { return (<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l12-7z" /></svg>) }
function PauseIcon() { return (<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>) }
function ReplayIcon() { return (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>) }
function SpeakerIcon() { return (<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9H4z" /><path d="M16 8a5 5 0 0 1 0 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>) }
function MuteIcon() { return (<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9H4z" /><path d="M17 9l5 5M22 9l-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>) }

const wrap: React.CSSProperties = { position: 'relative', width: '100%', maxWidth: 940, margin: '0 auto', aspectRatio: '16 / 10', background: CREAM, borderRadius: 24, overflow: 'hidden', border: '1px solid rgba(2,195,154,0.18)', boxShadow: '0 30px 60px -28px rgba(11,32,39,0.28)', fontFamily: 'var(--font-inter, ui-sans-serif, system-ui, sans-serif)' }
const glowA: React.CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(50% 45% at 50% 8%, rgba(2,195,154,0.16), transparent 70%)' }
const glowB: React.CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(42% 42% at 88% 88%, rgba(2,128,144,0.12), transparent 70%)', animation: 'drift 9s ease-in-out infinite alternate' }
const topBar: React.CSSProperties = { position: 'absolute', top: 0, left: 0, right: 0, height: 52, padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 14, zIndex: 5 }
const liveDot: React.CSSProperties = { width: 8, height: 8, borderRadius: '50%', background: TEAL, display: 'inline-block', boxShadow: `0 0 0 0 ${TEAL}`, animation: 'pulse 1.6s infinite' }
const stage: React.CSSProperties = { position: 'absolute', inset: '52px 0 56px', zIndex: 2, transformOrigin: 'center 42%', transition: 'transform .2s linear' }
const scrubWrap: React.CSSProperties = { position: 'absolute', bottom: 0, left: 0, right: 0, minHeight: 56, padding: '0 18px', display: 'flex', alignItems: 'center', gap: 12, zIndex: 6 }
const kicker: React.CSSProperties = { margin: '0 0 10px', fontSize: 13, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: TEAL_DEEP }

function layer(active: boolean, k: SceneKey): React.CSSProperties { return { position: 'absolute', inset: 0, padding: '0 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', opacity: active ? 1 : 0, transform: active ? 'translate(0) scale(1)' : ENTER[k], filter: active ? 'blur(0)' : 'blur(3px)', transition: 'opacity .6s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1), filter .6s ease', pointerEvents: 'none' } }
const avatar: React.CSSProperties = { width: 84, height: 84, borderRadius: '50%', background: `linear-gradient(135deg, ${TEAL}, ${TEAL_DEEP})`, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 34, fontWeight: 700, fontFamily: 'var(--font-newsreader, Georgia, serif)', boxShadow: '0 14px 28px -10px rgba(2,128,144,0.6)', zIndex: 2 }
function ring(delay: number): React.CSSProperties { return { position: 'absolute', width: 84, height: 84, borderRadius: '50%', border: `2px solid ${TEAL}`, animation: `ripple 2.4s ease-out ${delay}s infinite`, opacity: 0 } }
const waveRow: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, height: 56, marginBottom: 20 }
const captionCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 560 }
const bubbleRow: React.CSSProperties = { display: 'flex', alignItems: 'flex-end', gap: 8, animation: 'rise .5s cubic-bezier(.2,.8,.2,1) both' }
const miniAvatar: React.CSSProperties = { width: 30, height: 30, borderRadius: '50%', background: `linear-gradient(135deg, ${TEAL}, ${TEAL_DEEP})`, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0, fontFamily: 'var(--font-newsreader, Georgia, serif)' }
const bubbleBase: React.CSSProperties = { maxWidth: 400, padding: '10px 14px', borderRadius: 16, fontSize: 14.5, lineHeight: 1.5, textAlign: 'left' }
const laylaBubble: React.CSSProperties = { ...bubbleBase, background: '#fff', color: INK, border: '1px solid rgba(2,195,154,0.22)', borderBottomLeftRadius: 4 }
const callerBubble: React.CSSProperties = { ...bubbleBase, background: `linear-gradient(135deg, ${INK}, #16323b)`, color: '#fff', borderBottomRightRadius: 4 }
const bookCard: React.CSSProperties = { width: '100%', maxWidth: 460, background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', border: '1px solid rgba(2,195,154,0.22)', borderRadius: 18, padding: 18, textAlign: 'left', boxShadow: '0 18px 40px -24px rgba(11,32,39,0.4)' }
const smsBubble: React.CSSProperties = { maxWidth: 420, background: '#fff', border: '1px solid rgba(2,195,154,0.22)', borderRadius: 18, borderBottomLeftRadius: 4, padding: '16px 18px', textAlign: 'left', boxShadow: '0 18px 40px -22px rgba(11,32,39,0.4)' }
const crmChip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 999, background: 'rgba(2,195,154,0.10)', border: '1px solid rgba(2,195,154,0.25)', fontSize: 13, fontWeight: 600, color: TEAL_DEEP }
const followRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 13px', background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(2,195,154,0.18)', borderRadius: 13, transition: 'opacity .5s ease, transform .5s ease' }
const followIcon: React.CSSProperties = { width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center', color: TEAL_DEEP, background: 'rgba(2,195,154,0.12)' }
const gridWrap: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 9, width: '100%', maxWidth: 600 }
const toolCell: React.CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px 6px', background: 'rgba(255,255,255,0.75)', border: '1px solid rgba(11,32,39,0.08)', borderRadius: 13, textAlign: 'center', transition: 'opacity .35s ease, transform .35s ease, border-color .35s ease' }
const chipRow: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 7, marginTop: 14, minHeight: 26, maxWidth: 580 }
const toolChip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999, background: 'rgba(2,195,154,0.10)', border: '1px solid rgba(2,195,154,0.28)', color: TEAL_DEEP, fontSize: 12.5, fontWeight: 600, transition: 'opacity .4s ease, transform .4s ease' }
const chipDot: React.CSSProperties = { width: 5, height: 5, borderRadius: '50%', background: TEAL, flexShrink: 0 }
const endOverlay: React.CSSProperties = { position: 'absolute', inset: 0, display: 'grid', placeItems: 'end center', paddingBottom: 18, pointerEvents: 'none', zIndex: 4 }
const bigBtn: React.CSSProperties = { pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 999, border: 'none', cursor: 'pointer', color: '#fff', fontSize: 14, fontWeight: 600, background: `linear-gradient(135deg, ${TEAL}, ${TEAL_DEEP})`, boxShadow: '0 10px 22px -10px rgba(2,128,144,0.7)' }
const soundBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 999, border: 'none', cursor: 'pointer', color: '#fff', fontSize: 13, fontWeight: 600, background: `linear-gradient(135deg, ${TEAL}, ${TEAL_DEEP})`, whiteSpace: 'nowrap', flexShrink: 0 }
const iconBtn: React.CSSProperties = { display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: '50%', border: '1px solid rgba(11,32,39,0.12)', background: '#fff', color: INK, cursor: 'pointer', flexShrink: 0 }

const KEYFRAMES = `
@keyframes pulse { 0%{box-shadow:0 0 0 0 rgba(2,195,154,0.5)} 70%{box-shadow:0 0 0 7px rgba(2,195,154,0)} 100%{box-shadow:0 0 0 0 rgba(2,195,154,0)} }
@keyframes ripple { 0%{transform:scale(1);opacity:0.5} 100%{transform:scale(2.3);opacity:0} }
@keyframes rise { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
@keyframes drift { from{transform:translate(0,0)} to{transform:translate(-14px,-10px)} }
`
