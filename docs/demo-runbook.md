# Door-knock demo runbook (phone-first)

One page. Read time under 3 minutes. Follow top to bottom, mid-conversation.

**The two lines**

- Rivera Landscaping (trades, EN+ES): **[(855) 589-4238](tel:+18555894238)**
- Med-spa backup line, always on (EN): **[(301) 962-2856](tel:+13019622856)**
- Alerts land on YOUR cell: **[(301) 673-6362](tel:+13016736362)**

---

## 1. 30-second setup (before you knock)

- [ ] Ring volume MAX. Do Not Disturb OFF — the urgent alert must buzz out loud.
- [ ] Both numbers saved as contacts: "Layla — Rivera" and "Layla — Med Spa".
- [ ] tarhunna.net logged in on your phone, **Calls** page open in a tab.
- [ ] If alerts were switched to WhatsApp (see morning check), WhatsApp open.

**MORNING OF — once, not at the door:**

- [ ] Call **[(855) 589-4238](tel:+18555894238)** yourself. Confirm: answers as Rivera Landscaping, switches to Spanish when you do.
- [ ] Say the urgent phrase (section 4). Confirm the Spanish alert hits your phone — and note WHICH app it lands in (SMS or WhatsApp). Demo whichever one fired.

> **If it goes wrong:** The Rivera line answers as a med spa → the shared toll-free was reverted (teardown in docs/multivertical-manual-test.md §2c). Do NOT fix it from the field. Demo the med-spa line today; re-seed at the laptop later.

---

## 2. THE HOOK — call 1, English

Hand them your phone, or speaker-call in front of them.

- [ ] Tap **[(855) 589-4238](tel:+18555894238)**.
- [ ] Say: **"Hi — I need a quote for weekly lawn service."**
- [ ] Then: **"Can you book me for Thursday morning?"**

What Layla does: talks "jobs" and "technicians" (never "appointments"), and asks for the service address, what the job is, a day/time window, and access notes (gate code, pets, parking).

Land it: *"That's not a person. That's what answers when he can't pick up."*

> **If it goes wrong:** She pauses mid-sentence → tell the prospect "she's checking the calendar — this is live." Dead air over 10 seconds → hang up, redial, blame cell signal. Fails twice → switch to the med-spa line **[(301) 962-2856](tel:+13019622856)**: "different business, same receptionist."

---

## 3. THE SPANISH MOMENT — call 2, Spanish

Redial the same number. Let the PROSPECT do the talking if they want.

- [ ] Opening line: **"Hola, ¿hacen limpieza de jardines?"**
      *(OH-lah — AH-sen leem-PYEH-sah deh har-DEE-nes)*

What Layla does: follows the caller's language — the whole call runs in Spanish, formal "usted", and she books the *trabajo* the same way. No menu, no "press 2 for Spanish." Switch languages mid-call and she follows whichever you used last.

> **If it goes wrong:** She greets in English → fine. Just speak Spanish; she switches. Prospect too shy to talk → you make the call with the cheat-sheet lines below.

---

## 4. THE URGENT MOMENT — call 3, the closer

Redial one more time.

- [ ] Say: **"Hola, tengo una fuga de agua en la cocina, es urgente."**
      *(TEN-goh OO-nah FOO-gah deh AH-gwah en lah koh-SEE-nah, es oor-HEN-teh)*
- [ ] Layla flags the emergency. Within seconds YOUR phone buzzes with a Spanish alert carrying the **caller's number** and the **stated issue**:

> *URGENTE — Rivera Landscaping. Un cliente necesita que le devuelvan la llamada ya. Problema: fuga de agua en la cocina. Llámelo: +1 …*

- [ ] Show them your screen: *"One tap, and the owner is already calling that customer back."*

> **If it goes wrong:** No buzz in ~60 seconds → don't stall. Show the morning-of alert still sitting in your messages and move to the close. (Every urgent call fires its own alert — they are never deduped — so a miss means signal, not the product.)

---

## 5. THE CLOSE

- [ ] Open tarhunna.net → **Calls** on your phone: all three calls are there with duration and outcome.
- [ ] Tap the Spanish call → full transcript, **in Spanish**. That's the proof it understood.

The pitch, one line:
*"Every call you miss becomes a booked job or a message — English or Spanish — and emergencies hit your phone in seconds."*

The ask — fill this in before you leave:

1. Business name: ______________________
2. Owner cell: ______________________
3. Owner email: ______________________
4. Owner language (en / es): ______________________
5. Current business number: ______________________

Also jot: what they do (landscaping / cleaning / plumbing / …) — sets the
`--vertical` flag; defaults to trades.

These five are exactly what `scripts/onboard-tenant.ts` takes:

```
npx tsx scripts/onboard-tenant.ts --name "..." --owner-cell +1... \
  --owner-email ... --owner-language es --business-number +1... --live
```

---

## 6. RESET / HYGIENE

- Demo calls leave real call logs + transcripts on the Rivera org (`b9b77026`). Leave them — they make the next demo's dashboard look alive. No cleanup between doors.
- Each urgent test call = one more alert on your phone. Expected; alerts bypass dedupe by design.
- Retiring the demo tenant entirely = teardown steps in docs/multivertical-manual-test.md §2c. Laptop job.
- **STANDING RULE: never touch voice configs on live numbers.** The toll-free is shared infrastructure — rebinding or re-seeding assistants happens at the laptop with the runbook, never from the field.

---

## Cheat sheet — 6 Spanish lines for the door

1. **"Mire — llame a este número."** — Look, call this number.
   *(MEE-reh — YAH-meh ah ES-teh NOO-meh-roh)*
2. **"Ella contesta cuando usted no puede."** — She answers when you can't.
   *(EH-yah kon-TES-tah KWAN-doh oos-TED noh PWEH-deh)*
3. **"Hable en español — ella le sigue."** — Speak Spanish, she follows you.
   *(AH-bleh en es-pah-NYOL — EH-yah leh SEE-geh)*
4. **"Si es una emergencia, le avisa al dueño al instante."** — If it's an emergency, it alerts the owner instantly.
   *(see es OO-nah eh-mer-HEN-syah, leh ah-VEE-sah al DWEH-nyoh al een-STAHN-teh)*
5. **"¿Cuántas llamadas pierde a la semana?"** — How many calls do you miss a week?
   *(KWAHN-tahs yah-MAH-dahs PYEHR-deh ah lah seh-MAH-nah)*
6. **"Puede probarlo gratis."** — You can try it for free.
   *(PWEH-deh proh-BAR-loh GRAH-tees)*
