'use client'

/**
 * Layla Showcase — an autoplaying, brand-matched "product video" that
 * presents Layla, the AI voice receptionist. Pure CSS/JS visuals (no
 * media file), with an optional sound layer:
 *   - Voice-over via the Web Speech API (browser-native voices; swap in
 *     a real recording by setting VO_AUDIO_SRC to a /public mp3).
 *   - Background music synthesized with the Web Audio API (swap in a
 *     real track by setting MUSIC_AUDIO_SRC).
 *
 * Sound can't autoplay (browser policy), so it loops MUTED and offers a
 * "Play with sound" button that runs it once start-to-finish, then
 * offers Replay. Drop it anywhere:  <LaylaShowcase />
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const TEAL = '#02C39A'
const TEAL_DEEP = '#028090'
const INK = '#0B2027'
const CREAM = '#F5EFE1'

// Optional real assets — set to a /public path to override the
// synthesized audio. e.g. '/layla-vo.mp3' / '/layla-music.mp3'.
const VO_AUDIO_SRC: string | null = null
const MUSIC_AUDIO_SRC: string | null = null

const T = {
  ring:  [0,     2600],
  talk:  [2600,  9000],
  book:  [9000,  13200],
  text:  [13200, 16400],
  outro: [16400, 20000],
} as const
const TOTAL = 20000

type SceneKey = keyof typeof T
type Mode = 'idle' | 'playing' | 'paused' | 'ended' | 'frozen'

type Line = { who: 'caller' | 'layla'; at: number; text: string; vo?: string }
const LINES: Line[] = [
  { who: 'caller', at: 3100, text: 'Hi — do you have anything for Botox this Thursday?' },
  { who: 'layla',  at: 5000, text: "We do. I've got 2:30 or 4:15 with Dr. Rivera — which works better?" },
  { who: 'caller', at: 7100, text: '2:30 is perfect.' },
  { who: 'layla',  at: 8100, text: "Great — I'm booking that now and I'll text you the details." },
]
const OUTRO_VO = 'Meet Layla. Your AI receptionist — she answers every call, and books on the line.'

const SLOTS = ['10:00', '11:30', '2:30', '4:15']
const ENTER: Record<SceneKey, string> = {
  ring:  'translateY(14px) scale(0.97)',
  talk:  'translateX(26px) scale(0.99)',
  book:  'translateY(20px) scale(0.97)',
  text:  'translateX(34px) scale(0.99)',
  outro: 'translateY(16px) scale(0.96)',
}

export function LaylaShowcase() {
  const [mode, setMode] = useState<Mode>('idle')
  const [t, setT] = useState(0)
  const [muted, setMuted] = useState(false)

  const base = useRef(0)
  const pausedAt = useRef(0)
  const session = useRef(0)
  const spoken = useRef<Set<number>>(new Set())
  const voices = useRef<SpeechSynthesisVoice[]>([])
  const music = useRef<{ stop: (fade?: boolean) => void; mute: (m: boolean) => void } | null>(null)
  const voEl = useRef<HTMLAudioElement | null>(null)
  const modeRef = useRef<Mode>('idle')
  modeRef.current = mode

  // Load speech voices (async on some browsers).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    const load = () => { voices.current = window.speechSynthesis.getVoices() }
    load()
    window.speechSynthesis.onvoiceschanged = load
    return () => { window.speechSynthesis.onvoiceschanged = null }
  }, [])

  const pickVoice = useCallback((who: 'caller' | 'layla') => {
    const list = voices.current
    if (!list.length) return null
    const en = list.filter((v) => /^en/i.test(v.lang))
    const pool = en.length ? en : list
    if (who === 'layla') {
      return pool.find((v) => /samantha|ava|allison|jenny|aria|natural|female/i.test(v.name))
        ?? pool.find((v) => /en-US/i.test(v.lang)) ?? pool[0]
    }
    return pool.find((v) => /daniel|alex|tom|guy|male/i.test(v.name)) ?? pool[Math.min(1, pool.length - 1)]
  }, [])

  const speak = useCallback((text: string, who: 'caller' | 'layla') => {
    if (muted || typeof window === 'undefined' || !window.speechSynthesis) return
    if (VO_AUDIO_SRC) return
    try {
      const u = new SpeechSynthesisUtterance(text)
      const v = pickVoice(who)
      if (v) u.voice = v
      u.rate = who === 'layla' ? 1.0 : 1.03
      u.pitch = who === 'layla' ? 1.05 : 0.95
      u.volume = 1
      window.speechSynthesis.speak(u)
    } catch { /* no-op */ }
  }, [muted, pickVoice])

  const startMusic = useCallback(() => {
    try {
      if (MUSIC_AUDIO_SRC) {
        const a = new Audio(MUSIC_AUDIO_SRC); a.loop = true; a.volume = muted ? 0 : 0.3; a.play().catch(() => {})
        music.current = { stop: () => { a.pause() }, mute: (m) => { a.volume = m ? 0 : 0.3 } }
        return
      }
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new AC()
      const master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination)
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 900; filter.Q.value = 0.7; filter.connect(master)
      const chord = [130.81, 196.0, 261.63, 329.63]
      const oscs = chord.map((f, i) => {
        const o = ctx.createOscillator(); o.type = i % 2 ? 'sine' : 'triangle'; o.frequency.value = f
        const g = ctx.createGain(); g.gain.value = i === 0 ? 0.5 : 0.26
        o.connect(g); g.connect(filter); o.start(); return o
      })
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 160; lfo.connect(lfoGain); lfoGain.connect(filter.frequency); lfo.start()
      const target = muted ? 0 : 0.05
      master.gain.linearRampToValueAtTime(target, ctx.currentTime + 1.6)
      music.current = {
        stop: (fade = true) => {
          try {
            const now = ctx.currentTime
            master.gain.cancelScheduledValues(now); master.gain.setValueAtTime(master.gain.value, now)
            master.gain.linearRampToValueAtTime(0, now + (fade ? 1.0 : 0.05))
            oscs.forEach((o) => o.stop(now + (fade ? 1.1 : 0.06))); lfo.stop(now + (fade ? 1.1 : 0.06))
            setTimeout(() => ctx.close().catch(() => {}), fade ? 1300 : 120)
          } catch { /* no-op */ }
        },
        mute: (m) => { try { master.gain.linearRampToValueAtTime(m ? 0 : 0.05, ctx.currentTime + 0.2) } catch { /* */ } },
      }
    } catch { /* no-op */ }
  }, [muted])

  const stopAudio = useCallback((fade = true) => {
    music.current?.stop(fade); music.current = null
    try { window.speechSynthesis?.cancel() } catch { /* */ }
    if (voEl.current) { voEl.current.pause(); voEl.current = null }
  }, [])

  const beginPlay = useCallback(() => {
    session.current += 1
    spoken.current = new Set()
    stopAudio(false)
    base.current = performance.now()
    startMusic()
    if (VO_AUDIO_SRC) { const a = new Audio(VO_AUDIO_SRC); a.volume = muted ? 0 : 1; a.play().catch(() => {}); voEl.current = a }
    setMode('playing')
  }, [startMusic, stopAudio, muted])

  // Master clock.
  useEffect(() => {
    if (mode === 'frozen' || mode === 'paused' || mode === 'ended') return
    let raf = 0
    const loop = (now: number) => {
      if (modeRef.current === 'idle') {
        setT((now % TOTAL))
      } else if (modeRef.current === 'playing') {
        const el = now - base.current
        if (el >= TOTAL) { setT(TOTAL - 1); stopAudio(true); setMode('ended'); return }
        setT(el)
        for (let i = 0; i < LINES.length; i++) {
          if (!spoken.current.has(i) && el >= LINES[i].at) { spoken.current.add(i); speak(LINES[i].text, LINES[i].who) }
        }
        if (!spoken.current.has(99) && el >= T.outro[0] + 300) { spoken.current.add(99); speak(OUTRO_VO, 'layla') }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [mode, speak, stopAudio])

  // Dev-only ?seek=<ms> for screenshots.
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('seek')
    if (s !== null && s !== '' && !Number.isNaN(Number(s))) { setT(Number(s) % TOTAL); setMode('frozen') }
    return () => stopAudio(false)
  }, [stopAudio])

  const onPause = () => { pausedAt.current = t; try { window.speechSynthesis?.pause() } catch { /* */ }; music.current?.mute(true); setMode('paused') }
  const onResume = () => { base.current = performance.now() - pausedAt.current; try { window.speechSynthesis?.resume() } catch { /* */ }; music.current?.mute(muted); setMode('playing') }
  const onMuteToggle = () => { setMuted((m) => { const nm = !m; music.current?.mute(nm); if (nm) { try { window.speechSynthesis?.cancel() } catch { /* */ } } return nm }) }

  const inScene = (k: SceneKey) => t >= T[k][0] && t < T[k][1]
  const progress = Math.min(t / TOTAL, 1)
  const callSecs = Math.min(Math.floor(t / 1000), 20)
  const mmss = `0:${String(callSecs).padStart(2, '0')}`
  const bookEl = t - T.book[0]
  const bookPhase = bookEl < 1400 ? 'checking' : bookEl < 2800 ? 'holding' : 'booked'
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

      <div style={{ ...stage, transform: `scale(${1 + progress * 0.03})` }}>
        {/* Scene 0 — incoming */}
        <div style={layer(inScene('ring'), 'ring')}>
          <div style={{ position: 'relative', display: 'grid', placeItems: 'center', height: 150 }}>
            <span style={ring(0)} /><span style={ring(0.6)} /><span style={ring(1.2)} />
            <div style={avatar}>L</div>
          </div>
          <p style={kicker}>Incoming call</p>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: INK }}>(415) 555‑0162</p>
          <p style={{ margin: '10px 0 0', fontSize: 14, color: '#5b6b66' }}>{t > 1500 ? 'Layla is answering…' : 'Your front desk is on another line'}</p>
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
                  <span style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3, color: l.who === 'layla' ? TEAL_DEEP : 'rgba(255,255,255,0.85)' }}>
                    {l.who === 'layla' ? 'Layla' : 'Caller'}
                  </span>
                  {l.text}
                </div>
              </div>
            ))}
          </div>
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
                return (
                  <div key={s} style={{ flex: 1, textAlign: 'center', padding: '10px 0', borderRadius: 10, fontSize: 14, fontWeight: 600, color: on ? '#fff' : picked ? TEAL_DEEP : '#7c8a84', background: on ? `linear-gradient(135deg, ${TEAL}, ${TEAL_DEEP})` : '#fff', border: `1px solid ${on ? 'transparent' : 'rgba(11,32,39,0.08)'}`, transform: on ? 'translateY(-2px)' : 'none', transition: 'all .4s ease' }}>{s}</div>
                )
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, background: bookPhase === 'booked' ? 'rgba(2,195,154,0.10)' : 'transparent', transition: 'background .4s ease' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#fff', flexShrink: 0, background: bookPhase === 'booked' ? TEAL : '#d8cdb6', transition: 'background .4s' }}><CheckIcon /></div>
              <div style={{ fontSize: 14, color: INK }}>
                <b style={{ fontWeight: 700 }}>Thursday 2:30 PM</b> · Dr. Rivera
                <div style={{ fontSize: 12, color: '#7c8a84' }}>Booked on the call — no callback loop</div>
              </div>
            </div>
          </div>
        </div>

        {/* Scene 3 — confirmation text */}
        <div style={layer(inScene('text'), 'text')}>
          <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
            <div style={smsBubble}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: TEAL_DEEP, fontSize: 12, fontWeight: 700 }}><span style={{ fontSize: 15 }}>✓</span> Confirmation sent · SMS</div>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: INK }}>You&apos;re booked for <b>Botox, Thu 2:30 PM</b> with Dr. Rivera at Tarhunna Aesthetics. Need to change it? <span style={{ color: TEAL_DEEP, fontWeight: 600 }}>tarhunna.net/m/3f9k</span></p>
            </div>
          </div>
        </div>

        {/* Scene 4 — outro */}
        <div style={layer(inScene('outro'), 'outro')}>
          <div style={{ display: 'grid', placeItems: 'center', height: '100%', textAlign: 'center' }}>
            <div>
              <div style={crmChip}><span style={{ ...liveDot, animation: 'none', background: TEAL }} /> Logged to CRM · transcript + recording saved</div>
              <p style={{ margin: '20px 0 4px', fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', color: INK }}>Meet <span style={{ color: TEAL_DEEP }}>Layla</span>.</p>
              <p style={{ margin: 0, fontSize: 15, color: '#5b6b66', maxWidth: 380 }}>Your AI receptionist — answers every call, books on the line, and never sends a lead to voicemail.</p>
            </div>
          </div>
        </div>

        {/* Replay overlay */}
        {mode === 'ended' && (
          <div style={endOverlay}>
            <button style={bigBtn} onClick={beginPlay} aria-label="Replay with sound"><ReplayIcon /> Replay</button>
          </div>
        )}
      </div>

      {/* control bar */}
      {showControls && (
        <div style={scrubWrap}>
          {mode === 'idle' && (
            <button style={soundBtn} onClick={beginPlay} aria-label="Play with sound"><PlayIcon /> Play with sound</button>
          )}
          {(mode === 'playing' || mode === 'paused') && (
            <button style={iconBtn} onClick={mode === 'playing' ? onPause : onResume} aria-label={mode === 'playing' ? 'Pause' : 'Resume'}>
              {mode === 'playing' ? <PauseIcon /> : <PlayIcon />}
            </button>
          )}
          <div style={{ flex: 1, height: 4, borderRadius: 999, background: 'rgba(11,32,39,0.10)', overflow: 'hidden' }}>
            <div style={{ width: `${progress * 100}%`, height: '100%', background: `linear-gradient(90deg, ${TEAL_DEEP}, ${TEAL})`, borderRadius: 999 }} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(Object.keys(T) as SceneKey[]).map((k) => (<span key={k} style={{ width: 6, height: 6, borderRadius: '50%', background: inScene(k) ? TEAL : 'rgba(11,32,39,0.18)', transition: 'background .3s' }} />))}
          </div>
          {(mode === 'playing' || mode === 'paused') && (
            <button style={iconBtn} onClick={onMuteToggle} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? <MuteIcon /> : <SpeakerIcon />}</button>
          )}
        </div>
      )}
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
const stage: React.CSSProperties = { position: 'absolute', inset: '52px 0 56px', zIndex: 2, transformOrigin: 'center 40%', transition: 'transform .2s linear' }
const scrubWrap: React.CSSProperties = { position: 'absolute', bottom: 0, left: 0, right: 0, minHeight: 56, padding: '0 18px', display: 'flex', alignItems: 'center', gap: 12, zIndex: 6 }
const kicker: React.CSSProperties = { margin: '18px 0 2px', fontSize: 13, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: TEAL_DEEP }

function layer(active: boolean, k: SceneKey): React.CSSProperties {
  return { position: 'absolute', inset: 0, padding: '0 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', opacity: active ? 1 : 0, transform: active ? 'translate(0) scale(1)' : ENTER[k], filter: active ? 'blur(0)' : 'blur(3px)', transition: 'opacity .6s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1), filter .6s ease', pointerEvents: 'none' }
}
const avatar: React.CSSProperties = { width: 84, height: 84, borderRadius: '50%', background: `linear-gradient(135deg, ${TEAL}, ${TEAL_DEEP})`, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 34, fontWeight: 700, fontFamily: 'var(--font-newsreader, Georgia, serif)', boxShadow: '0 14px 28px -10px rgba(2,128,144,0.6)', zIndex: 2 }
function ring(delay: number): React.CSSProperties { return { position: 'absolute', width: 84, height: 84, borderRadius: '50%', border: `2px solid ${TEAL}`, animation: `ripple 2.4s ease-out ${delay}s infinite`, opacity: 0 } }
const waveRow: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, height: 60, marginBottom: 22 }
const captionCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 560 }
const bubbleRow: React.CSSProperties = { display: 'flex', alignItems: 'flex-end', gap: 8, animation: 'rise .5s cubic-bezier(.2,.8,.2,1) both' }
const miniAvatar: React.CSSProperties = { width: 30, height: 30, borderRadius: '50%', background: `linear-gradient(135deg, ${TEAL}, ${TEAL_DEEP})`, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0, fontFamily: 'var(--font-newsreader, Georgia, serif)' }
const bubbleBase: React.CSSProperties = { maxWidth: 400, padding: '10px 14px', borderRadius: 16, fontSize: 14.5, lineHeight: 1.5, textAlign: 'left' }
const laylaBubble: React.CSSProperties = { ...bubbleBase, background: '#fff', color: INK, border: '1px solid rgba(2,195,154,0.22)', borderBottomLeftRadius: 4 }
const callerBubble: React.CSSProperties = { ...bubbleBase, background: `linear-gradient(135deg, ${INK}, #16323b)`, color: '#fff', borderBottomRightRadius: 4 }
const bookCard: React.CSSProperties = { width: '100%', maxWidth: 460, background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', border: '1px solid rgba(2,195,154,0.22)', borderRadius: 18, padding: 18, textAlign: 'left', boxShadow: '0 18px 40px -24px rgba(11,32,39,0.4)' }
const smsBubble: React.CSSProperties = { maxWidth: 420, background: '#fff', border: '1px solid rgba(2,195,154,0.22)', borderRadius: 18, borderBottomLeftRadius: 4, padding: '16px 18px', textAlign: 'left', boxShadow: '0 18px 40px -22px rgba(11,32,39,0.4)' }
const crmChip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 999, background: 'rgba(2,195,154,0.10)', border: '1px solid rgba(2,195,154,0.25)', fontSize: 13, fontWeight: 600, color: TEAL_DEEP }
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
