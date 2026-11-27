/* FEEL PROTOTYPE (Phase 0) — WebAudio synth sound engine.
 *
 * Recipes adopted from the Pasabuy Design Standard v1 §4 (proven in
 * Pasabuy slices S1–S3): peak gains ≤ .07, exponential envelopes, pop
 * throttled at 300 ms. Staff-app rules on top: sound defaults OFF
 * (shared office), the preference lives in its own localStorage key
 * (never in synced business settings), and there are exactly 3 sounds —
 * chime / pop / alert (the alert is the staff-app exception ruled by
 * Errands; failed saves always ALSO show their visual cue).
 *
 * The AudioContext is created lazily and resumed ONLY inside a
 * user-gesture call path (unlockFeelAudio) — a fresh page load is
 * always silent; playFeelSound is fire-and-forget and no-ops when the
 * preference is off, the API is unsupported, or the context has not
 * been unlocked by a gesture yet.
 */

export type FeelSoundName = "chime" | "pop" | "alert";

const PREF_KEY = "hacien-feel-sound";
export const FEEL_PREF_EVENT = "hacien-feel-pref";
export const FEEL_PLAY_EVENT = "hacien-feel-play";
const ARM_KEY = "hacien-feel-pending";
const PULSE_KEY = "hacien-feel-pulse";
const POP_THROTTLE_MS = 300;

let audioCtx: AudioContext | null = null;
let lastPopAt = 0;

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === "on";
  } catch {
    return false;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? "on" : "off");
  } catch {
    /* storage unavailable — preference just won't persist */
  }
  try {
    window.dispatchEvent(new Event(FEEL_PREF_EVENT));
  } catch {
    /* non-browser */
  }
}

function getContext(resume: boolean): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!audioCtx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }
    if (resume && audioCtx.state === "suspended") {
      void audioCtx.resume().catch(() => undefined);
    }
    return audioCtx;
  } catch {
    return null;
  }
}

/** Call ONLY from a user-gesture call path (a click / submit handler):
 *  creates the AudioContext if needed and resumes it. */
export function unlockFeelAudio(): void {
  getContext(true);
}

function tone(
  ctx: AudioContext,
  freq: number,
  delayS: number,
  durS: number,
  peak: number,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const t = ctx.currentTime + delayS;
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + durS);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + durS + 0.05);
}

export function playFeelSound(name: FeelSoundName): void {
  if (!soundEnabled()) return;
  if (name === "pop") {
    const now = Date.now();
    if (now - lastPopAt < POP_THROTTLE_MS) return;
    lastPopAt = now;
  }
  const ctx = getContext(false);
  if (!ctx || ctx.state !== "running") return;
  try {
    if (name === "chime") {
      // Money / won completion — the one "big" sound.
      tone(ctx, 659.25, 0, 0.35, 0.07);
      tone(ctx, 987.77, 0.09, 0.45, 0.06);
    } else if (name === "pop") {
      tone(ctx, 520, 0, 0.12, 0.06);
      tone(ctx, 760, 0.05, 0.1, 0.04);
    } else {
      // Soft alert — failed save / credit warning. Quiet, never harsh,
      // and never the only signal (the visual cue always shows too).
      tone(ctx, 196, 0, 0.3, 0.07);
    }
  } catch {
    // A failed oscillator must never break the action it celebrates.
  }
}

/** Fire a sound from anywhere (e.g. a client component whose result
 *  arrives outside a gesture): routed through FeelListener. */
export function feelPlay(name: FeelSoundName): void {
  try {
    window.dispatchEvent(
      new CustomEvent<FeelSoundName>(FEEL_PLAY_EVENT, { detail: name }),
    );
  } catch {
    /* non-browser */
  }
}

/* --- cross-navigation arming -------------------------------------
 * Money actions redirect on success (a server action returns a
 * redirect, applied as a client-side transition — the JS realm and
 * the unlocked AudioContext survive it). The submit handler (a
 * gesture path) arms the sound + unlocks audio; FeelListener plays
 * it once the path actually changes. A hard navigation instead lands
 * on a fresh, silent page — by design.
 */
export function armFeelSound(name: FeelSoundName): void {
  unlockFeelAudio();
  try {
    sessionStorage.setItem(
      ARM_KEY,
      JSON.stringify({ name, at: Date.now(), from: window.location.pathname }),
    );
  } catch {
    /* storage unavailable */
  }
}

export function consumeArmedSound(pathname: string): FeelSoundName | null {
  try {
    const raw = sessionStorage.getItem(ARM_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as {
      name: FeelSoundName;
      at: number;
      from: string;
    };
    if (Date.now() - data.at > 30_000) {
      sessionStorage.removeItem(ARM_KEY);
      return null;
    }
    if (data.from === pathname) return null; // still on the form — wait
    sessionStorage.removeItem(ARM_KEY);
    return data.name;
  } catch {
    return null;
  }
}

/* --- won-moment pulse --------------------------------------------
 * After a landed chime, FeelListener arms a one-shot calm pulse;
 * FeelPulse (mounted on the SO detail) plays it when the user next
 * views that order within a few minutes.
 */
export function armFeelPulse(): void {
  try {
    sessionStorage.setItem(PULSE_KEY, String(Date.now()));
  } catch {
    /* storage unavailable */
  }
}

export function consumeFeelPulse(): boolean {
  try {
    const raw = sessionStorage.getItem(PULSE_KEY);
    if (!raw) return false;
    sessionStorage.removeItem(PULSE_KEY);
    return Date.now() - Number(raw) < 5 * 60_000;
  } catch {
    return false;
  }
}
