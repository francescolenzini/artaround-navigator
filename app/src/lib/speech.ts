export function speak(text: string, onEnd?: () => void) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "it-IT";
  u.rate = 1;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  window.speechSynthesis.speak(u);
}

export function stopSpeak() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
}

// Pausa/ripresa native: mantengono la posizione di lettura dell'utterance in
// corso (a differenza di cancel(), che è distruttivo). Nota: su Chrome Android
// pause()/resume() hanno supporto storicamente incoerente — la UI del player si
// affida al proprio stato applicativo, non a speechSynthesis.paused.
export function pauseSpeak() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.pause();
}

export function resumeSpeak() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.resume();
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
