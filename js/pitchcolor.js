// SPRED's note colours, so a note looks the same here as in SPRED: one hue per note name (C red, D orange,
// E yellow, F green, G sky blue, A blue, B purple), a sharp in another shade of the note below it. The sung
// melody (basic) is strong, the instrument line (optional) pastel, the added runs (extra) black; the row names
// sit on a dark shade of the same hue.

const NATURAL = new Set([0, 2, 4, 5, 7, 9, 11]);
// [natural, sharp] per note name, C C# D D# E F F# G G# A A# B
const STRONG = [["#ff3b30", "#b62a22"], ["#ff9500", "#b56a00"], ["#ffcc00", "#b89200"], ["#34c759", "#23873c"], ["#5ac8fa", "#2a7ea6"], ["#007aff", "#0052ad"], ["#af52de", "#6f3390"]];
const PASTEL = [["#ff9f99", "#ffc1bd"], ["#ffbf80", "#ffd6a8"], ["#ffe699", "#fff0bf"], ["#8fe1a6", "#b3edc3"], ["#9fd8f5", "#c3e9fb"], ["#9fbfff", "#c3d6ff"], ["#d6b0f0", "#e6cff7"]];
const DARK = [["#8f2f2b", "#692723"], ["#99601c", "#704816"], ["#958022", "#6f611b"], ["#2f7f49", "#275f3b"], ["#397f9d", "#315f75"], ["#2f548f", "#283f6a"], ["#704187", "#563464"]];
const NAME_OF = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]; // pitch class -> note name (a sharp goes with the note below)

const pick = (set, m) => {
  const pc = ((Math.round(m) % 12) + 12) % 12;
  return set[NAME_OF[pc]][NATURAL.has(pc) ? 0 : 1];
};

// 0 sung melody, 1 instrument line, 2 added runs: SPRED's track ids, else the track's place in the sheet
export const trackKind = (t, i) => (t.id === "basic" ? 0 : t.id === "optional" ? 1 : t.id === "extra" ? 2 : i % 3);
export const noteFill = (m, kind) => (kind === 2 ? "#000000" : pick(kind === 1 ? PASTEL : STRONG, m));
export const noteText = (kind) => (kind === 2 ? "#ffffff" : "#000000");
export const rowFill = (m) => pick(DARK, m);
