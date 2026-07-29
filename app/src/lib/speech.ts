/**
 * Sintesi vocale (TTS) del racconto e riconoscimento dei comandi.
 *
 * Il racconto non viene dato al browser come un'unica utterance lunga ma spezzato
 * in frasi lette una dopo l'altra: Chrome tronca le utterance oltre una certa
 * durata, e una coda di pezzi brevi aggira il problema. Lo spezzettamento non
 * c'entra con la pausa, che resta quella nativa (vedi `pauseSpeak`).
 */

/** Oltre questa lunghezza un pezzo viene spezzato ancora. */
const MAX_CHUNK = 180;

const hasSynth = () => typeof window !== "undefined" && "speechSynthesis" in window;

/**
 * Spezza il testo in unità di lettura: prima sui punti fermi, poi — se un pezzo
 * resta troppo lungo — su punto e virgola/due punti e infine sull'ultimo spazio
 * utile, per non tagliare mai in mezzo a una parola.
 */
export function splitIntoChunks(text: string, maxLen = MAX_CHUNK): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];
  const out: string[] = [];

  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    // Frammento breve (una sigla, un "Ecco.") accorpato al precedente: una
    // utterance di due parole suonerebbe staccata dal resto.
    if (s.length < 24 && out.length > 0 && out[out.length - 1].length + s.length <= maxLen) {
      out[out.length - 1] = `${out[out.length - 1]} ${s}`;
      continue;
    }
    if (s.length <= maxLen) {
      out.push(s);
      continue;
    }
    out.push(...hardSplit(s, maxLen));
  }

  return out.length > 0 ? out : [text.trim()].filter(Boolean);
}

function hardSplit(s: string, maxLen: number): string[] {
  const out: string[] = [];
  let rest = s;
  while (rest.length > maxLen) {
    const window = rest.slice(0, maxLen);
    const cut =
      Math.max(window.lastIndexOf("; "), window.lastIndexOf(": "), window.lastIndexOf(", ")) + 1 ||
      window.lastIndexOf(" ");
    const at = cut > maxLen * 0.4 ? cut : maxLen;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

// Stato della coda. È di modulo perché c'è una sola sintesi vocale per pagina:
// il player la pilota da più punti (barra, microfono, cambio tappa) senza doversi
// passare un handle.
let chunks: string[] = [];
let chunkIdx = 0;
/** `cancel()` fa scattare l'onend dell'utterance in corso: il contatore ignora i
 *  callback delle utterance ormai superate. */
let seq = 0;
let state: "idle" | "speaking" | "paused" = "idle";
let onDone: (() => void) | undefined;

function speakCurrent() {
  if (!hasSynth()) return;
  const text = chunks[chunkIdx];
  if (text == null) return finish();

  const id = ++seq;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "it-IT";
  u.rate = 1;
  u.onend = () => {
    if (seq !== id) return;
    chunkIdx += 1;
    if (chunkIdx >= chunks.length) return finish();
    speakCurrent();
  };
  u.onerror = () => {
    if (seq !== id) return;
    finish();
  };
  window.speechSynthesis.speak(u);
}

/**
 * Su Chrome il flag `paused` non si azzera con `cancel()`: se resta alzato, ogni
 * `speak()` successivo viene accodato e non parte mai. Va sbloccato prima di
 * accodare o di annullare.
 */
function clearPausedFlag() {
  if (window.speechSynthesis.paused) window.speechSynthesis.resume();
}

function finish() {
  const cb = onDone;
  reset();
  cb?.();
}

function reset() {
  chunks = [];
  chunkIdx = 0;
  state = "idle";
  onDone = undefined;
}

/** Legge il testo dall'inizio. `onEnd` scatta solo a fine naturale (o su errore),
 *  mai per un'interruzione provocata da stop/pausa/nuovo testo. */
export function speak(text: string, onEnd?: () => void) {
  if (!hasSynth()) return;
  stopSpeak();
  const parts = splitIntoChunks(text);
  if (parts.length === 0) return;
  chunks = parts;
  chunkIdx = 0;
  onDone = onEnd;
  state = "speaking";
  speakCurrent();
}

/** Ferma e azzera: la lettura successiva riparte dall'inizio del racconto. */
export function stopSpeak() {
  if (!hasSynth()) return;
  seq += 1;
  clearPausedFlag();
  window.speechSynthesis.cancel();
  reset();
}

/**
 * Pausa nativa: congela l'utterance in corso, quindi la ripresa riparte esatta,
 * senza rileggere la parola tagliata. In cambio non è istantanea — il motore di
 * sistema finisce l'audio che ha già in buffer, di norma la parola corrente.
 * È un limite della Web Speech API: `cancel()` sarebbe immediato ma perde la
 * posizione, e non esiste una granularità sotto la parola (né accesso ai
 * campioni audio) per avere entrambe le cose.
 */
export function pauseSpeak() {
  if (!hasSynth()) return;
  if (state !== "speaking") return;
  window.speechSynthesis.pause();
  state = "paused";
}

/** Riprende esattamente dal punto in cui l'audio si era fermato. */
export function resumeSpeak() {
  if (!hasSynth()) return;
  if (state !== "paused") return;
  window.speechSynthesis.resume();
  state = "speaking";
}

export type RecognitionHandle = { stop: () => void };

type SpeechRecognitionResultLike = {
  [index: number]: { transcript?: string } | undefined;
};

type SpeechRecognitionEventLike = {
  results: {
    [index: number]: SpeechRecognitionResultLike | undefined;
  };
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export function startRecognition(
  onResult: (text: string) => void,
  onEnd?: () => void,
): RecognitionHandle | null {
  const w = window as SpeechRecognitionWindow;
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = "it-IT";
  rec.continuous = false;
  rec.interimResults = false;
  rec.onresult = (e) => {
    const t = e.results[0]?.[0]?.transcript ?? "";
    onResult(String(t).toLowerCase().trim());
  };
  rec.onend = () => onEnd?.();
  rec.onerror = () => onEnd?.();
  try {
    rec.start();
  } catch {
    return null;
  }
  return { stop: () => rec.stop() };
}
