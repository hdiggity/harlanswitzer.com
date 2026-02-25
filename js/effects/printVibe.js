// js/effects/printVibe.js
import { clamp } from "../utils.js";

export function printVibe({ letters }, pointer){
  const nx = (pointer.x - 0.5) * 2;
  const ny = (pointer.y - 0.5) * 2;

  letters.forEach((el, i) => {
    const d = (i - (letters.length-1)/2) / Math.max(1, (letters.length-1)/2);
    const tx = nx * 10 * d;
    const ty = ny * 4;

    const blur = (Math.abs(nx)+Math.abs(ny)) * 0.15;

    el.style.setProperty("--tx", `${tx.toFixed(2)}px`);
    el.style.setProperty("--ty", `${ty.toFixed(2)}px`);
    el.style.setProperty("--rx", `0deg`);
    el.style.setProperty("--ry", `0deg`);
    el.style.setProperty("--sc", `1`);
    el.style.setProperty("--bl", `${blur.toFixed(2)}px`);
    el.style.setProperty("--op", `1`);
  });
}
