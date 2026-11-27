"use client";

/* FEEL PROTOTYPE — global feel listener (mounted once in the app shell).
 *  - On navigation, plays a sound armed just before a redirect (money
 *    completions) and arms the won-moment pulse after a landed chime.
 *  - Plays sounds fired directly via feelPlay() (same-page results).
 *  - The Sales Orders list's search submit is a gesture path: unlock
 *    audio and play the pop right there (the search itself performs a
 *    full navigation, after which a fresh page is silent by design).
 */
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  FEEL_PLAY_EVENT,
  armFeelPulse,
  consumeArmedSound,
  playFeelSound,
  unlockFeelAudio,
  type FeelSoundName,
} from "@/lib/feel/sound";

export function FeelListener() {
  const pathname = usePathname();

  useEffect(() => {
    const name = consumeArmedSound(pathname);
    if (name) {
      playFeelSound(name);
      if (name === "chime") armFeelPulse();
    }
  }, [pathname]);

  useEffect(() => {
    const onPlay = (e: Event) => {
      const name = (e as CustomEvent<FeelSoundName>).detail;
      if (name === "chime" || name === "pop" || name === "alert") {
        playFeelSound(name);
      }
    };
    const onSubmit = (e: Event) => {
      const form = e.target as HTMLElement | null;
      if (
        form &&
        form.classList.contains("search-pill") &&
        form.closest(".feel-page")
      ) {
        unlockFeelAudio();
        playFeelSound("pop");
      }
    };
    window.addEventListener(FEEL_PLAY_EVENT, onPlay);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      window.removeEventListener(FEEL_PLAY_EVENT, onPlay);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);

  return null;
}
