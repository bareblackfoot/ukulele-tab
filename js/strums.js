// Strum patterns for "스트럼 연습", easiest first. Slots use the score's notation:
// D down, U up, X chuck (muted strum), - no strum (the arm still moves).
//   beats: beats in a bar, sub: slots in a beat (2 = 8ths, 3 = triplets / 6/8), swing: 2nd 8th played late (shuffle)

export const STRUMS = [
  { id: "down4", name: "다운 4번", slots: "D-D-D-D-", beats: 4, sub: 2,
    desc: "박마다 다운 한 번. 코드 바꾸는 왼손부터 익힐 때" },
  { id: "du8", name: "다운·업 8분음표", slots: "DUDUDUDU", beats: 4, sub: 2,
    desc: "박에 다운, 박 사이(&)에 업. 팔은 쉬지 않고 위아래로 움직임" },
  { id: "dddudu", name: "다운 다운 다운업 다운업", slots: "D-D-DUDU", beats: 4, sub: 2,
    desc: "1·2박은 다운만, 3·4박은 다운·업" },
  { id: "calypso", name: "calypso (island strum)", slots: "D-DU-UDU", beats: 4, sub: 2,
    desc: "우쿨렐레에서 가장 많이 쓰는 패턴. 1박 &와 3박은 줄을 치지 않고 팔만 움직임" },
  { id: "waltz", name: "waltz 3/4", slots: "D-DUDU", beats: 3, sub: 2,
    desc: "3/4박자. 1박은 다운, 2·3박은 다운·업" },
  { id: "shuffle", name: "shuffle 다운·업", slots: "DUDUDUDU", beats: 4, sub: 2, swing: true,
    desc: "다운은 길게, 업은 짧게 침. 박을 셋으로 나눠 다운 2칸, 업 1칸" },
  { id: "calypso-swing", name: "calypso shuffle", slots: "D-DU-UDU", beats: 4, sub: 2, swing: true,
    desc: "calypso를 shuffle 박자로 침" },
  { id: "chuck24", name: "chuck 2·4박", slots: "D-X-D-X-", beats: 4, sub: 2,
    desc: "2·4박에 손바닥 옆면으로 줄을 덮으며 쳐서 소리를 끊음(✕)" },
  { id: "chuck-du", name: "chuck 다운·업", slots: "DUXUDUXU", beats: 4, sub: 2,
    desc: "다운·업을 계속하면서 2·4박 다운만 chuck" },
  { id: "reggae", name: "reggae 박 사이 업", slots: "-U-U-U-U", beats: 4, sub: 2,
    desc: "박 사이(&)에만 업. 박에서는 줄을 치지 않고 팔만 내림" },
  { id: "six8", name: "6/8박자", slots: "DDUDDU", beats: 2, sub: 3, count: ["1", "2", "3", "4", "5", "6"],
    desc: "8분음표 셋을 한 박으로 셈(1 2 3 / 4 5 6). BPM은 그 한 박 기준" },
  { id: "triplet1", name: "triplet 한 번 + 다운", slots: "DDUD--D--D--", beats: 4, sub: 3,
    desc: "1박만 셋잇단 다운·다운·업(검지 다운, 엄지 다운, 검지 업), 나머지 박은 다운" },
  { id: "triplet", name: "triplet 계속", slots: "DDUDDUDDUDDU", beats: 4, sub: 3,
    desc: "모든 박을 셋잇단 다운·다운·업으로 침" },
];

export const ARROW = { D: "↓", U: "↑", X: "✕", "-": "·" };

// counting under each slot: 1 & 2 & ... (8ths), 1 & a ... (triplets), or the pattern's own labels
export function countLabels(p) {
  if (p.count) return p.count;
  const out = [];
  for (let b = 0; b < p.beats; b++) {
    out.push(String(b + 1));
    if (p.sub === 2) out.push("&");
    else if (p.sub === 3) out.push("&", "a");
    else for (let k = 1; k < p.sub; k++) out.push(["e", "&", "a"][k - 1] || "");
  }
  return out;
}

// where slot i sounds inside the bar, in beats
export function slotBeat(p, i) {
  const b = Math.floor(i / p.sub), k = i % p.sub;
  if (p.swing && p.sub === 2 && k === 1) return b + 2 / 3;
  return b + k / p.sub;
}

// chord choices: one chord, or a progression with one chord per bar
export const PROGRESSIONS = [
  { id: "C", label: "C", chords: ["C"] },
  { id: "Am", label: "Am", chords: ["Am"] },
  { id: "F", label: "F", chords: ["F"] },
  { id: "G", label: "G", chords: ["G"] },
  { id: "C-Am-F-G", label: "C → Am → F → G", chords: ["C", "Am", "F", "G"] },
  { id: "C-G-Am-F", label: "C → G → Am → F", chords: ["C", "G", "Am", "F"] },
  { id: "F-G-Em-Am", label: "F → G → Em → Am", chords: ["F", "G", "Em", "Am"] },
  { id: "G-Em-C-D", label: "G → Em → C → D", chords: ["G", "Em", "C", "D"] },
];
