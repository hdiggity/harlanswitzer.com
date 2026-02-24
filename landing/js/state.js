// js/state.js
export const EFFECTS = [
  { key:"kinetic",  label:"kinetic type", theme:"dark",  layout:"center" },
  { key:"split",    label:"split minimal", theme:"dark",  layout:"center" },
  { key:"spotlight",label:"spotlight",     theme:"dark",  layout:"center" },
  { key:"signal",   label:"signal underline", theme:"dark", layout:"center" },
  { key:"grid",     label:"typographic grid", theme:"dark", layout:"center" },
  { key:"glass",    label:"glass card",    theme:"dark",  layout:"center" },
  { key:"monogram", label:"monogram",      theme:"dark",  layout:"center" },
  { key:"print",    label:"print vibe",    theme:"print", layout:"center" }
];

export function effectByIndex(i){
  const idx = ((i % EFFECTS.length) + EFFECTS.length) % EFFECTS.length;
  return EFFECTS[idx];
}
