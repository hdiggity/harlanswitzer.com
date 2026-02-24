// js/utils.js
export function clamp(v, lo, hi){
  return Math.max(lo, Math.min(hi, v));
}

export function lerp(a, b, t){
  return a + (b - a) * t;
}

export function normPointer(e, el){
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  return { x, y, r };
}

export function setGlowVars(el, xPct, yPct){
  el.style.setProperty("--mx", `${xPct}%`);
  el.style.setProperty("--my", `${yPct}%`);
}
