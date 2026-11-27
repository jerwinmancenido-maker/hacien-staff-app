"use client";

import { useEffect } from "react";
import { consumeFeelPulse } from "@/lib/feel/sound";

/**
 * FEEL PROTOTYPE — the won moment: after a collection is recorded, the next
 * Sales Order page the user opens gives its header one calm pulse.
 */
export function FeelPulse() {
  useEffect(() => {
    if (!consumeFeelPulse()) return;
    const header = document.querySelector(".page-header");
    if (!header) return;
    header.classList.add("feel-pulse-once");
    const t = setTimeout(() => header.classList.remove("feel-pulse-once"), 1600);
    return () => clearTimeout(t);
  }, []);

  return null;
}
