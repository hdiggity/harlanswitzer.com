// js/effects/kineticType.js
import { clamp } from "../utils.js";

export function kineticType({ letters, stage }, pointer){
  const REPEL_RADIUS = 0.28;
  const REPEL_FORCE  = 72;
  const TILT_NEAR    = 28;
  const TILT_FAR     = 10;
  const SCALE_NEAR   = 0.38;

  const mid = (letters.length - 1) / 2;
  const sr  = stage.getBoundingClientRect();

  // global tilt from pointer position
  const gnx = (pointer.x - 0.5) * 2;
  const gny = (pointer.y - 0.5) * 2;

  letters.forEach((el, i) => {
    const r  = el.getBoundingClientRect();
    const cx = (r.left + r.width  / 2 - sr.left) / sr.width;
    const cy = (r.top  + r.height / 2 - sr.top)  / sr.height;

    const dx   = cx - pointer.x;
    const dy   = cy - pointer.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // smooth proximity 0→1 as cursor enters REPEL_RADIUS
    const raw  = clamp(1 - dist / REPEL_RADIUS, 0, 1);
    const prox = raw * raw * raw; // cubic — sharp at edge, strong at center

    // push letter directly away from cursor
    const tx = dist > 0.001 ? (dx / dist) * REPEL_FORCE * prox : 0;
    const ty = dist > 0.001 ? (dy / dist) * REPEL_FORCE * prox * 0.75 : 0;

    // tilt: near letters tilt toward cursor, far letters follow global pointer
    const ry = (-dx * TILT_NEAR * prox) + (gnx * TILT_FAR * (1 - prox));
    const rx = ( dy * TILT_NEAR * prox) + (gny * TILT_FAR * (1 - prox));

    // scale up nearest letters
    const sc = 1 + prox * SCALE_NEAR;

    el.style.setProperty("--tx", `${tx.toFixed(2)}px`);
    el.style.setProperty("--ty", `${ty.toFixed(2)}px`);
    el.style.setProperty("--rx", `${rx.toFixed(2)}deg`);
    el.style.setProperty("--ry", `${ry.toFixed(2)}deg`);
    el.style.setProperty("--sc", `${sc.toFixed(3)}`);
  });
}
