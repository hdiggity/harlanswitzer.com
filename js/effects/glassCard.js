// js/effects/glassCard.js
import { clamp } from "../utils.js";

export function glassCard({ card }, pointer){
  const nx = (pointer.x - 0.5) * 2;
  const ny = (pointer.y - 0.5) * 2;

  const rx = clamp(ny * 6, -6, 6);
  const ry = clamp(nx * -10, -10, 10);

  card.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
}
