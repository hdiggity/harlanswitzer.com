// js/effects/spotlightReveal.js
import { clamp } from "../utils.js";

export function spotlightReveal({ letters, stage }, pointer){
  const MAX_DIST = 0.52;
  const soft = 0.14;

  letters.forEach((el) => {
    const r = el.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const cx = (r.left + r.width/2 - sr.left) / sr.width;
    const cy = (r.top + r.height/2 - sr.top) / sr.height;

    const dx = cx - pointer.x;
    const dy = cy - pointer.y;
    const d = Math.sqrt(dx*dx + dy*dy);

    const t = clamp(1 - (d - soft) / (MAX_DIST - soft), 0, 1);
    const op = 0.14 + t * 0.92;
    const blur = (1 - t) * 1.4;

    el.style.setProperty("--spot", `${op.toFixed(3)}`);
    el.style.setProperty("--spotBlur", `${blur.toFixed(2)}px`);

    // tiny drift so it still feels alive
    el.style.setProperty("--tx", `${(dx * -18 * t).toFixed(2)}px`);
    el.style.setProperty("--ty", `${(dy * -10 * t).toFixed(2)}px`);
    el.style.setProperty("--rx", `${(dy * 8 * t).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${(dx * -10 * t).toFixed(2)}deg`);
  });
}
