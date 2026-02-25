// js/effects/monogramParallax.js
import { clamp } from "../utils.js";

export function monogramParallax({ monogram }, pointer){
  const nx = (pointer.x - 0.5) * 2;
  const ny = (pointer.y - 0.5) * 2;

  const px = clamp(nx * 20, -20, 20);
  const py = clamp(ny * 14, -14, 14);

  monogram.style.setProperty("--px", `${px.toFixed(2)}px`);
  monogram.style.setProperty("--py", `${py.toFixed(2)}px`);
}
