// js/main.js
import { clamp, normPointer, setGlowVars } from "./utils.js";
import { EFFECTS, effectByIndex } from "./state.js";

import { spotlightReveal } from "./effects/spotlightReveal.js";
import { signalUnderline } from "./effects/signalUnderline.js";
import { gridMagnet } from "./effects/gridMagnet.js";
import { glassCard } from "./effects/glassCard.js";
import { monogramParallax } from "./effects/monogramParallax.js";
import { printVibe } from "./effects/printVibe.js";

const DISPLAY_NAME = "HARLAN SWITZER";

const app = document.getElementById("app");
const stage = document.getElementById("stage");
const card = document.getElementById("card");
const nameEl = document.getElementById("name");
const modePill = document.getElementById("modePill");
const bgGlow = document.getElementById("bgGlow");
const shine = document.getElementById("shine");
const monogram = document.getElementById("monogram");
const underlineCanvas = document.getElementById("underline");
const underlineCtx = underlineCanvas.getContext("2d");

function buildName(text){
  nameEl.innerHTML = "";
  [...text].forEach((c, i) => {
    const span = document.createElement("span");
    span.className = "ch";
    span.textContent = c === " " ? "\u00A0" : c;
    span.dataset.index = String(i);
    nameEl.appendChild(span);
  });
}
buildName(DISPLAY_NAME);

const letters = Array.from(nameEl.querySelectorAll(".ch"));

let effectIndex = 0;
let pointer = { x:0.5, y:0.5 };
let last = { x:0.5, y:0.5, t: performance.now() };
let lastMoveAt = performance.now();

function applyMode(idx){
  effectIndex = idx;
  const mode = effectByIndex(effectIndex);
  app.dataset.effect = mode.key;
  app.dataset.theme = mode.theme;
  app.dataset.layout = mode.layout;
  modePill.textContent = `effect: ${mode.key}`;
  card.style.transform = "";
}
applyMode(0);

function updateGlow(){
  const xPct = clamp(pointer.x * 100, 0, 100);
  const yPct = clamp(pointer.y * 100, 0, 100);
  setGlowVars(stage, xPct, yPct);
  setGlowVars(bgGlow, xPct, yPct);
  setGlowVars(shine, xPct, yPct);
}

function resetTransforms(){
  letters.forEach((el) => {
    el.style.setProperty("--tx","0px");
    el.style.setProperty("--ty","0px");
    el.style.setProperty("--rx","0deg");
    el.style.setProperty("--ry","0deg");
    el.style.setProperty("--sc","1");
    el.style.setProperty("--bl","0px");
    el.style.setProperty("--op","1");
    el.style.setProperty("--spot",".18");
    el.style.setProperty("--spotBlur","0px");
  });
}

const underlineState = {
  canvas: underlineCanvas,
  ctx: underlineCtx,
  t: 0,
  speed: 0
};

function tick(t){
  const dt = Math.max(1, t - last.t);
  const dx = pointer.x - last.x;
  const dy = pointer.y - last.y;
  const dist = Math.sqrt(dx*dx + dy*dy);
  const speed = clamp(dist / (dt/1000), 0, 2);

  underlineState.t = t;
  underlineState.speed = speed;

  updateGlow();

  const mode = effectByIndex(effectIndex);
  const ctx = { letters, stage, card, monogram };

  resetTransforms();

  if(mode.key === "spotlight") spotlightReveal(ctx, pointer);
  if(mode.key === "grid") gridMagnet(ctx, pointer);
  if(mode.key === "glass") glassCard(ctx, pointer);
  if(mode.key === "monogram") monogramParallax(ctx, pointer);
  if(mode.key === "print") printVibe(ctx, pointer);
  if(mode.key === "signal") signalUnderline(underlineState, pointer);
  nameEl.style.transform = "";

  // idle breathing if no movement recently
  if((t - lastMoveAt) > 850){
    const ix = 0.5 + Math.sin(t/2200) * 0.08;
    const iy = 0.5 + Math.cos(t/2600) * 0.07;
    pointer = { x: ix, y: iy };
  }

  last = { x: pointer.x, y: pointer.y, t };
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

stage.addEventListener("pointermove", (e) => {
  lastMoveAt = performance.now();
  const n = normPointer(e, stage);
  pointer = { x: clamp(n.x,0,1), y: clamp(n.y,0,1) };
});

stage.addEventListener("pointerleave", () => {
  lastMoveAt = performance.now();
  pointer = { x:0.5, y:0.5 };
});

window.addEventListener("keydown", (e) => {
  const k = e.key;
  if(k >= "1" && k <= "8"){
    applyMode(parseInt(k,10) - 1);
  }
  if(k === "ArrowRight") applyMode((effectIndex + 1) % EFFECTS.length);
  if(k === "ArrowLeft") applyMode((effectIndex - 1 + EFFECTS.length) % EFFECTS.length);
});
