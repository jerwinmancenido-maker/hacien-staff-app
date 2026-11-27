"use client";

/* FEEL PROTOTYPE — top-bar sound switch. Sound is OFF by default
 * (shared office); the choice persists per user in localStorage.
 * Toggling ON unlocks audio (a gesture path) and plays the pop once
 * as confirmation; toggling OFF is silent.
 */
import { useEffect, useState } from "react";
import {
  FEEL_PREF_EVENT,
  playFeelSound,
  setSoundEnabled,
  soundEnabled,
  unlockFeelAudio,
} from "@/lib/feel/sound";

export function SoundSwitch() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const sync = () => setOn(soundEnabled());
    sync();
    window.addEventListener(FEEL_PREF_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(FEEL_PREF_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggle = () => {
    const next = !on;
    if (next) unlockFeelAudio();
    setSoundEnabled(next);
    setOn(next);
    if (next) playFeelSound("pop");
  };

  return (
    <button
      type="button"
      className="feel-sound-switch"
      role="switch"
      aria-checked={on}
      aria-label="Interface sounds"
      title={on ? "Interface sounds on" : "Interface sounds off"}
      onClick={toggle}
    >
      <span className={on ? "feel-dot on" : "feel-dot"} aria-hidden="true" />
      {on ? "Sound on" : "Sound off"}
    </button>
  );
}
