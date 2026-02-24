// js/effects/signalUnderline.js
import { clamp } from "../utils.js";

export function signalUnderline(ctxState, pointer){
  const { canvas, ctx, t, speed } = ctxState;

  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0,0,w,h);

  const baseY = h * 0.55;
  const amp = 10 + clamp(speed * 240, 0, 26);
  const freq = 0.012 + clamp(speed * 0.02, 0, 0.02);

  ctx.beginPath();
  for(let x=0; x<=w; x+=6){
    const n = Math.sin((x * freq) + (t * 0.004)) * amp;
    const n2 = Math.sin((x * (freq*0.55)) + (t * 0.0022)) * (amp*0.45);
    const pull = (pointer.x - 0.5) * 10;
    const y = baseY + n + n2 + pull;
    if(x===0) ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  }

  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--fg") || "#f5f7ff";
  ctx.stroke();
  ctx.globalAlpha = 1;
}
