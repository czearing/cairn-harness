export const agentPalette = [
  "#8ab4f8",
  "#c4a7e7",
  "#f6c177",
  "#7dd3a7",
  "#eb9a97",
  "#9ccfd8",
  "#f0a6ca",
  "#a7c080",
];

export function agentColor(name: string, overrides: Record<string, string> = {}) {
  if (overrides[name]) return overrides[name];
  let hash = 0;
  for (const character of name) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return agentPalette[Math.abs(hash) % agentPalette.length];
}
