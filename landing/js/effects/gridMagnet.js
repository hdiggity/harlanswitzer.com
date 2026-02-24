// js/effects/gridMagnet.js
import { clamp } from "../utils.js";

export function gridMagnet({ letters, stage }, pointer){
  const GRID = 28;
  const MAX = 20;

  letters.forEach((el) => {
    const r = el.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const cx = (r.left + r.width/2);
    const cy = (r.top + r.height/2);

    const mx = sr.left + pointer.x * sr.width;
    const my = sr.top + pointer.y * sr.height;

    const dx = mx - cx;
    const dy = my - cy;

    const fx = clamp(dx / 220, -1, 1);
    const fy = clamp(dy / 220, -1, 1);

    const snapX = Math.round(fx * GRID) * (GRID/4);
    const snapY = Math.round(fy * GRID) * (GRID/5);

    el.style.setProperty("--tx", `${clamp(snapX, -MAX, MAX).toFixed(2)}px`);
    el.style.setProperty("--ty", `${clamp(snapY, -MAX, MAX).toFixed(2)}px`);
    el.style.setProperty("--rx", `${(fy * 6).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${(-fx * 8).toFixed(2)}deg`);
    el.style.setProperty("--sc", `${(1 + (Math.abs(fx)+Math.abs(fy))*0.02).toFixed(3)}`);
    el.style.setProperty("--bl", `0px`);
    el.style.setProperty("--op", `1`);
  });
}
