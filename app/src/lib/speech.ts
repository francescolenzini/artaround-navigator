/**
 * Sintesi vocale (TTS) del racconto e riconoscimento dei comandi.
 *
 * Il racconto non viene dato al browser come un'unica utterance lunga ma spezzato
 * in frasi lette una dopo l'altra. Il motivo è la pausa: `speechSynthesis.pause()`
 * non svuota l'audio già consegnato al motore di sistema, che quindi finisce la
 * parola (a volte la frase) prima di fermarsi davvero. `cancel()` invece è
 * immediato, ma è distruttivo: perde la posizione di lettura. Con una coda di
 * frasi corte e la posizione tenuta qui, la pausa può essere un `cancel()` — taglia
 * l'audio nell'istante del tocco — e la ripresa riparte da dove eravamo.
 *
 * Effetto collaterale gradito: le utterance corte aggirano anche il troncamento
 * che Chrome applica ai testi lunghi.
 */

/** Oltre questa lunghezza un pezzo viene spezzato ancora: frasi corte = pausa reattiva. */
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
/** Posizione raggiunta dentro il chunk corrente, aggiornata da `onboundary`. */
let charOffset = 0;
/** `cancel()` fa scattare l'onend dell'utterance in corso: il contatore ignora i
 *  callback delle utterance ormai superate. */
let seq = 0;
let state: "idle" | "speaking" | "paused" = "idle";
let onDone: (() => void) | undefined;

function speakCurrent() {
  if (!hasSynth()) return;
  const chunk = chunks[chunkIdx];
  if (chunk == null) return finish();

  const base = charOffset;
  const text = chunk.slice(base);
  if (!text) {
    chunkIdx += 1;
    charOffset = 0;
    return speakCurrent();
  }

  const id = ++seq;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "it-IT";
  u.rate = 1;
  // Dove non è supportato (storicamente Chrome su Android) l'offset resta a 0 e
  // la ripresa riparte dall'inizio della frase corrente: qualche secondo, non
  // l'intero racconto.
  u.onboundary = (e) => {
    if (seq !== id) return;
    if (typeof e.charIndex === "number") charOffset = base + e.charIndex;
  };
  u.onend = () => {
    if (seq !== id) return;
    chunkIdx += 1;
    charOffset = 0;
    if (chunkIdx >= chunks.length) return finish();
    speakCurrent();
  };
  u.onerror = () => {
    if (seq !== id) return;
    finish();
  };
  window.speechSynthesis.speak(u);
}

function finish() {
  const cb = onDone;
  reset();
  cb?.();
}

function reset() {
  chunks = [];
  chunkIdx = 0;
  charOffset = 0;
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
  charOffset = 0;
  onDone = onEnd;
  state = "speaking";
  speakCurrent();
}

/** Ferma e azzera: la lettura successiva riparte dall'inizio del racconto. */
export function stopSpeak() {
  if (!hasSynth()) return;
  seq += 1;
  window.speechSynthesis.cancel();
  reset();
}

/**
 * Pausa istantanea: `cancel()` taglia subito l'audio, la posizione resta qui.
 * Non si usa `speechSynthesis.pause()` proprio perché lascia finire la parola
 * già in buffer.
 */
export function pauseSpeak() {
  if (!hasSynth()) return;
  if (state !== "speaking") return;
  seq += 1;
  window.speechSynthesis.cancel();
  state = "paused";
}

/** Riprende dal punto memorizzato (parola corrente, o inizio della frase). */
export function resumeSpeak() {
  if (!hasSynth()) return;
  if (state !== "paused") return;
  state = "speaking";
  speakCurrent();
}

export type RecognitionHandle = { stop: () => void };

export function startRecognition(
  onResult: (text: string) => void,
  onEnd?: () => void,
): RecognitionHandle | null {
  const w = window as any;
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = "it-IT";
  rec.continuous = false;
  rec.interimResults = false;
  rec.onresult = (e: any) => {
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
