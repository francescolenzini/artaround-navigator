import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../lib/AppContext";
import { apiFetch, toAbsoluteUrl } from "../lib/api";
import {
  REGISTER_ORDER,
  type Artwork,
  type ArtworkItem,
  type LanguageRegister,
  type ListResponse,
  type Visit,
  type VisitStep,
} from "../lib/types";
import { ErrorScreen, LoadingScreen, Modal, Toast } from "../components/Shell";
import { RichText } from "../components/RichText";
import { richTextToPlain } from "../lib/richtext";
import {
  pauseSpeak,
  resumeSpeak,
  speak,
  startRecognition,
  stopSpeak,
  type RecognitionHandle,
} from "../lib/speech";

export const Route = createFileRoute("/player/$visitId/$stepIndex")({
  component: PlayerPage,
});

// Coppie semantiche dei comandi vocali (specifiche docente): una coppia per
// "pagina" della strip; le frecce avanzano di una coppia alla volta.
const VOICE_PAIRS: [string, string][] = [
  ["Dimmi di meno", "Dimmi di più"],
  ["Troppo semplice", "Non capisco"],
  ["Chi è l'autore", "Qual è lo stile"],
];

// Registri disponibili per lo step, già nell'ordine della scala.
function availableRegisters(step?: VisitStep): LanguageRegister[] {
  const map = step?.itemsByRegister;
  if (!map) return [];
  return REGISTER_ORDER.filter((r) => map[r]);
}

// Registro effettivo per uno step: il preferito se coperto, altrimenti il più
// vicino nella scala (a parità di distanza vince il più semplice, per non
// spiazzare l'utente con un salto verso l'alto).
function resolveRegister(
  step: VisitStep | undefined,
  preferred: LanguageRegister | null,
): LanguageRegister | null {
  const avail = availableRegisters(step);
  if (!avail.length) return null;
  const target = preferred ?? "medio";
  if (avail.includes(target)) return target;
  const ti = REGISTER_ORDER.indexOf(target);
  let best = avail[0];
  let bestDist = Infinity;
  for (const r of avail) {
    const d = Math.abs(REGISTER_ORDER.indexOf(r) - ti);
    if (d < bestDist) {
      best = r;
      bestDist = d;
    }
  }
  return best;
}

function registerLabel(r: LanguageRegister) {
  return r.charAt(0).toUpperCase() + r.slice(1);
}

// Fonte immagine dell'opera: primo asset di tipo 'image', altrimenti il primo
// asset con un source (l'immagine vive su Artwork.assets, non sull'item).
function imageSourceOf(artwork: Artwork | null): string | null {
  return (
    artwork?.assets?.find((a) => a.type === "image" && a.source)?.source ??
    artwork?.assets?.find((a) => a.source)?.source ??
    null
  );
}

function PlayerPage() {
  const { visitId, stepIndex } = Route.useParams();
  const idx = Math.max(0, parseInt(stepIndex, 10) || 0);
  const navigate = useNavigate();
  const {
    apiConfig,
    token,
    museum,
    visit: ctxVisit,
    setVisit,
    currentItem,
    setCurrentItem,
  } = useApp();

  const [visit, setLocalVisit] = useState<Visit | null>(
    ctxVisit && ctxVisit.id === visitId ? ctxVisit : null,
  );
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<{ title: string; body: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const recRef = useRef<RecognitionHandle | null>(null);
  // Stato della riproduzione TTS: "paused" mantiene la posizione (pause/resume
  // nativi), distinto da "idle" che è il risultato di Stop (distruttivo).
  const [playState, setPlayState] = useState<"idle" | "speaking" | "paused">("idle");
  // cancel() fa scattare l'onend dell'utterance precedente in modo asincrono:
  // il contatore ignora i callback di utterance ormai superate
  const playSeq = useRef(0);

  const playTts = useCallback((text: string) => {
    const id = ++playSeq.current;
    speak(text, () => {
      // Fine (o errore) dell'utterance corrente → torna a idle.
      if (playSeq.current === id) setPlayState("idle");
    });
    setPlayState("speaking");
  }, []);

  // Pausa/ripresa native: mantengono la posizione di lettura dell'utterance in
  // corso (a differenza di Stop, che è distruttivo).
  const pauseTts = useCallback(() => {
    pauseSpeak();
    setPlayState("paused");
  }, []);

  const resumeTts = useCallback(() => {
    resumeSpeak();
    setPlayState("speaking");
  }, []);

  const stopTts = useCallback(() => {
    playSeq.current++;
    stopSpeak();
    setPlayState("idle");
  }, []);

  // Load visit if missing
  useEffect(() => {
    if (!apiConfig || !token) return;
    if (visit && visit.id === visitId) return;
    apiFetch<Visit>(apiConfig, token, `/visits/${visitId}`)
      .then((v) => {
        setLocalVisit(v);
        setVisit(v);
      })
      .catch((e) => setErr(e?.message ?? "Errore"));
  }, [apiConfig, token, visitId, visit, setVisit]);

  const step = visit?.steps[idx];

  // Registro preferito dall'utente nella sessione: persiste tra le tappe
  // (il componente non si smonta al cambio di stepIndex).
  const [register, setRegister] = useState<LanguageRegister | null>(null);
  const effectiveRegister = useMemo(() => resolveRegister(step, register), [step, register]);
  const currentItemId =
    step && effectiveRegister ? step.itemsByRegister?.[effectiveRegister] : undefined;

  // Cache degli item già scaricati: cambiare registro avanti e indietro non
  // deve rifare richieste di rete.
  const itemCache = useRef<Record<string, ArtworkItem>>({});

  const fetchItem = useCallback(
    async (id: string): Promise<ArtworkItem | null> => {
      if (itemCache.current[id]) return itemCache.current[id];
      if (!apiConfig || !token) return null;
      const r = await apiFetch<ListResponse<ArtworkItem>>(
        apiConfig,
        token,
        `/artwork-items?id=${encodeURIComponent(id)}`,
      );
      const item = r.data[0] ?? null;
      if (item) itemCache.current[id] = item;
      return item;
    },
    [apiConfig, token],
  );

  // Carica l'item corrente (tappa + registro effettivo)
  useEffect(() => {
    if (!apiConfig || !token || !step) return;
    if (!currentItemId) {
      setCurrentItem(null);
      return;
    }
    fetchItem(currentItemId)
      .then((item) => setCurrentItem(item))
      .catch(() => setToast("Impossibile caricare il contenuto"));
  }, [apiConfig, token, step, currentItemId, fetchItem, setCurrentItem]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => () => stopSpeak(), []);

  const goTo = useCallback(
    (i: number) => {
      if (!visit) return;
      if (i < 0 || i >= visit.steps.length) return;
      stopTts();
      navigate({
        to: "/player/$visitId/$stepIndex",
        params: { visitId, stepIndex: String(i) },
      });
    },
    [navigate, visit, visitId, stopTts],
  );

  // Primo registro disponibile nella direzione richiesta lungo la scala
  // (-1 = più semplice, +1 = più avanzato), o null se non ce n'è.
  const registerInDirection = useCallback(
    (dir: 1 | -1): LanguageRegister | null => {
      if (!effectiveRegister) return null;
      const avail = availableRegisters(step);
      const from = REGISTER_ORDER.indexOf(effectiveRegister);
      const candidates =
        dir === 1
          ? REGISTER_ORDER.slice(from + 1)
          : REGISTER_ORDER.slice(0, from).reverse();
      return candidates.find((r) => avail.includes(r)) ?? null;
    },
    [effectiveRegister, step],
  );

  const canSimpler = registerInDirection(-1) != null;
  const canAdvanced = registerInDirection(1) != null;

  // Cambia registro: aggiorna insieme schermo (screenText via currentItem)
  // e sintesi vocale (ttsText), come richiesto dalla spec.
  const goToRegister = useCallback(
    async (dir: 1 | -1) => {
      const target = registerInDirection(dir);
      if (!target) {
        setToast(
          dir === 1
            ? "Non c'è una versione più avanzata per questa tappa"
            : "Non c'è una versione più semplice per questa tappa",
        );
        return;
      }
      const id = step?.itemsByRegister?.[target];
      if (!id) return;
      setRegister(target);
      try {
        const item = await fetchItem(id);
        if (!item) {
          setToast("Contenuto non disponibile");
          return;
        }
        setCurrentItem(item);
        stopTts();
        if (item.content?.ttsText) playTts(item.content.ttsText);
      } catch {
        setToast("Contenuto non disponibile");
      }
    },
    [registerInDirection, step, fetchItem, setCurrentItem, stopTts, playTts],
  );

  // Cache delle opere già caricate (l'endpoint item non include autore/stile,
  // che vivono sull'Artwork padre): evita richieste ripetute nella stessa visita.
  const artworkCache = useRef<Record<string, Artwork>>({});

  const getArtwork = useCallback(async (): Promise<Artwork | null> => {
    const artworkId = currentItem?.artworkId;
    if (!apiConfig || !token || !artworkId) return null;
    if (artworkCache.current[artworkId]) return artworkCache.current[artworkId];
    try {
      const a = await apiFetch<Artwork>(
        apiConfig,
        token,
        `/artworks/${encodeURIComponent(artworkId)}`,
      );
      artworkCache.current[artworkId] = a;
      return a;
    } catch {
      return null;
    }
  }, [apiConfig, token, currentItem]);

  // Opera padre dell'item corrente: caricata subito (non più solo su richiesta
  // di autore/stile) perché serve l'immagine hero. Riusa getArtwork/artworkCache.
  const [artwork, setArtwork] = useState<Artwork | null>(null);
  useEffect(() => {
    if (!currentItem?.artworkId) {
      setArtwork(null);
      return;
    }
    let active = true;
    getArtwork().then((a) => {
      if (active) setArtwork(a);
    });
    return () => {
      active = false;
    };
  }, [currentItem, getArtwork]);

  const heroSrc = useMemo(() => {
    const src = imageSourceOf(artwork);
    return src && apiConfig ? toAbsoluteUrl(apiConfig.baseUrl, src) : null;
  }, [artwork, apiConfig]);

  const showAuthor = useCallback(async () => {
    const a = await getArtwork();
    if (a?.artist) {
      setModal({ title: "Autore", body: a.year ? `${a.artist} (${a.year})` : a.artist });
    } else {
      setToast("Autore non disponibile");
    }
  }, [getArtwork]);

  const showStyle = useCallback(async () => {
    const a = await getArtwork();
    const parts = [a?.style, a?.category].filter(Boolean);
    if (parts.length) {
      setModal({ title: "Stile", body: parts.join(" · ") });
    } else {
      setToast("Stile non disponibile");
    }
  }, [getArtwork]);

  const handleExit = useCallback(() => {
    if (window.confirm("Vuoi uscire dalla visita?")) {
      stopTts();
      navigate({ to: "/visits" });
    }
  }, [navigate, stopTts]);

  const showLogistics = useCallback(
    (key: keyof NonNullable<typeof museum>["logistics"]) => {
      const text = museum?.logistics?.[key];
      if (!text) return setToast("Informazione non disponibile");
      setModal({ title: labelLogistics(key), body: text });
    },
    [museum],
  );

  const handleVoice = useCallback(
    (text: string) => {
      const t = text.toLowerCase();
      const has = (...keys: string[]) => keys.some((k) => t.includes(k));
      if (has("prossimo", "avanti")) return goTo(idx + 1);
      if (has("precedente", "indietro")) return goTo(idx - 1);
      if (has("pausa", "ferma un attimo", "aspetta") && playState === "speaking")
        return pauseTts();
      if (has("riprendi", "continua", "riproduci") && playState === "paused")
        return resumeTts();
      if (has("cos'è questo", "cos è questo", "descrivi"))
        return currentItem?.content?.ttsText && playTts(currentItem.content.ttsText);
      if (has("di più", "di piu", "dimmi di più", "dimmi di piu", "troppo semplice"))
        return goToRegister(1);
      if (has("di meno", "dimmi di meno", "non capisco")) return goToRegister(-1);
      if (has("autore")) return showAuthor();
      if (has("stile")) return showStyle();
      if (has("uscita")) return showLogistics("exit");
      if (has("toilette", "bagno")) return showLogistics("toilet");
      if (has("bar")) return showLogistics("bar");
      if (has("shop", "negozio")) return showLogistics("shop");
      if (has("ostacoli")) return showLogistics("obstacles");
      setToast(`Comando non riconosciuto: "${text}"`);
    },
    [
      idx,
      goTo,
      currentItem,
      playTts,
      pauseTts,
      resumeTts,
      playState,
      goToRegister,
      showAuthor,
      showStyle,
      showLogistics,
    ],
  );

  const toggleMic = useCallback(() => {
    if (listening) {
      recRef.current?.stop();
      recRef.current = null;
      setListening(false);
      return;
    }
    const h = startRecognition(
      (text) => {
        setListening(false);
        handleVoice(text);
      },
      () => setListening(false),
    );
    if (!h) {
      setToast("Riconoscimento vocale non supportato");
      return;
    }
    recRef.current = h;
    setListening(true);
  }, [listening, handleVoice]);

  const content = useMemo(() => {
    if (!step) return "";
    if (currentItemId) return currentItem?.content?.screenText ?? "";
    return step.description ?? "";
  }, [step, currentItemId, currentItem]);

  // Strip orizzontale "Chiedi all'audioguida": pagine e posizione corrente
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [stripPages, setStripPages] = useState(1);
  const [stripPage, setStripPage] = useState(0);

  const updateStrip = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const pages = VOICE_PAIRS.length;
    setStripPages(pages);
    setStripPage(Math.min(pages - 1, Math.round(el.scrollLeft / el.clientWidth)));
  }, []);

  useEffect(() => {
    updateStrip();
    window.addEventListener("resize", updateStrip);
    return () => window.removeEventListener("resize", updateStrip);
  }, [updateStrip]);

  const scrollStrip = useCallback((dir: 1 | -1) => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth, behavior: "smooth" });
  }, []);

  // Handler per etichetta: le pill riusano gli stessi handler dei comandi
  // vocali; disabled = nessun registro disponibile in quella direzione.
  const voiceActions: Record<string, { run: () => void; disabled?: boolean }> = {
    "Dimmi di meno": { run: () => goToRegister(-1), disabled: !canSimpler },
    "Dimmi di più": { run: () => goToRegister(1), disabled: !canAdvanced },
    "Troppo semplice": { run: () => goToRegister(1), disabled: !canAdvanced },
    "Non capisco": { run: () => goToRegister(-1), disabled: !canSimpler },
    "Chi è l'autore": { run: showAuthor },
    "Qual è lo stile": { run: showStyle },
  };

  if (!token) return <Navigate to="/login" />;
  if (err) return <ErrorScreen message={err} />;
  if (!visit || !step) return <LoadingScreen />;

  const total = visit.steps.length;
  const isFirst = idx === 0;
  const isLast = idx >= total - 1;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between gap-2 px-5 pt-4 pb-3">
        <button
          onClick={handleExit}
          aria-label="Esci dalla visita"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-card text-xl"
        >
          ‹
        </button>
        <div className="min-w-0 text-center">
          <span className="font-display text-base font-bold">
            Tappa {String(idx + 1).padStart(2, "0")}
          </span>{" "}
          <span className="text-sm text-muted-foreground">/ {total}</span>
          <h1 className="truncate text-xs text-muted-foreground">{visit.title}</h1>
        </div>
        <button
          onClick={() => navigate({ to: "/map/$visitId", params: { visitId } })}
          className="flex min-h-[44px] shrink-0 items-center rounded-full border border-border bg-card px-4 text-[11px] font-semibold uppercase tracking-[0.15em]"
        >
          Mappa
        </button>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-5 pb-6 pt-2">
        {heroSrc && (
          <img
            src={heroSrc}
            alt={currentItem?.content?.title ?? step.title ?? "Opera"}
            className="mb-4 aspect-[4/3] w-full rounded-2xl border border-border object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        )}
        {(currentItem?.content?.title ?? step.title) && (
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-4">
              <div className="min-w-0">
                <h2 className="font-display text-lg font-bold leading-snug">
                  {currentItem?.content?.title ?? step.title}
                </h2>
                {currentItemId && effectiveRegister && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Registro: {registerLabel(effectiveRegister)}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-4 flex w-full gap-2">
              <button
                onClick={() => {
                  // Il bottone principale cambia comportamento con lo stato:
                  // speaking → Pausa, paused → Riprendi, idle → Ascolta.
                  if (playState === "speaking") return pauseTts();
                  if (playState === "paused") return resumeTts();
                  // Il testo a schermo può contenere markup: al TTS va la
                  // versione in testo semplice, mai i tag.
                  const t = currentItem?.content?.ttsText ?? richTextToPlain(content);
                  if (t) playTts(t);
                }}
                aria-label={
                  playState === "speaking"
                    ? "Metti in pausa"
                    : playState === "paused"
                      ? "Riprendi la lettura"
                      : "Ascolta"
                }
                className="flex min-h-[44px] flex-1 items-center justify-center whitespace-nowrap rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-all duration-300 ease-in-out"
              >
                {playState === "speaking"
                  ? "⏸ Pausa"
                  : playState === "paused"
                    ? "▶ Riprendi"
                    : "▶ Ascolta"}
              </button>
              <button
                onClick={stopTts}
                aria-label="Ferma la lettura"
                className={`flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-full border border-border bg-background px-4 text-sm font-semibold transition-all duration-300 ease-in-out ${
                  playState !== "idle" ? "flex-1" : "w-auto pointer-events-none opacity-40"
                }`}
              >
                Stop
              </button>
            </div>
          </div>
        )}
        {step.directionsFromPrevious && (
          <div className="mt-4 rounded-xl border border-border border-l-2 border-l-primary bg-card p-4 text-sm leading-relaxed text-muted-foreground">
            {step.directionsFromPrevious}
          </div>
        )}
        <RichText
          value={content}
          fallback="—"
          className="mt-5 text-[17px] leading-relaxed"
        />
      </main>

      {/* Bottom panel */}
      <footer className="border-t border-border bg-background px-5 pb-5 pt-3">
        {/* Nav tappe */}
        <div className="flex gap-2">
          <button
            disabled={isFirst}
            onClick={() => goTo(idx - 1)}
            className="min-h-[48px] flex-1 rounded-xl border border-border bg-transparent px-3 text-base font-semibold text-foreground hover:bg-secondary active:bg-secondary disabled:opacity-40"
          >
            ‹ Precedente
          </button>
          <button
            onClick={toggleMic}
            aria-label="Microfono"
            className={`flex min-h-[48px] min-w-[52px] flex-col items-center justify-center rounded-xl border border-border bg-card px-3 ${
              listening
                ? "outline-2 outline-offset-[3px] outline-primary [animation:pulse-outline_1s_ease-in-out_infinite]"
                : ""
            }`}
          >
            <span className="text-xl leading-none" aria-hidden>
              🎤
            </span>
            <span className="text-[10px] uppercase tracking-[0.05em] text-muted-foreground">
              Voce
            </span>
          </button>
          <button
            onClick={() =>
              isLast
                ? navigate({ to: "/visit-complete/$visitId", params: { visitId } })
                : goTo(idx + 1)
            }
            className="min-h-[48px] flex-1 rounded-xl border-2 border-foreground bg-foreground px-3 text-base font-semibold text-background hover:opacity-90"
          >
            {isLast ? "Fine ✓" : "Prossimo ›"}
          </button>
        </div>

        {/* Strip "Chiedi all'audioguida" */}
        <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Comandi
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => scrollStrip(-1)}
            aria-label="Scorri i comandi indietro"
            className="flex h-11 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-lg"
          >
            ‹
          </button>
          <div
            ref={stripRef}
            onScroll={updateStrip}
            className="flex flex-1 snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {VOICE_PAIRS.map(([left, right]) => (
              <div key={left} className="flex w-full shrink-0 snap-start gap-2">
                <Chip
                  label={left}
                  onClick={voiceActions[left].run}
                  disabled={voiceActions[left].disabled}
                  grow
                />
                <Chip
                  label={right}
                  onClick={voiceActions[right].run}
                  disabled={voiceActions[right].disabled}
                  grow
                />
              </div>
            ))}
          </div>
          <button
            onClick={() => scrollStrip(1)}
            aria-label="Scorri i comandi avanti"
            className="flex h-11 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-lg"
          >
            ›
          </button>
        </div>
        <div className="mt-2 flex justify-center gap-1.5" aria-hidden>
          {Array.from({ length: stripPages }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === stripPage ? "w-4 bg-primary" : "w-1.5 bg-border"
              }`}
            />
          ))}
        </div>

        {/* Servizi */}
        <div className="mt-3 flex flex-nowrap gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Chip muted label="Uscita" onClick={() => showLogistics("exit")} />
          <Chip muted label="Toilette" onClick={() => showLogistics("toilet")} />
          <Chip muted label="Bar" onClick={() => showLogistics("bar")} />
          <Chip muted label="Shop" onClick={() => showLogistics("shop")} />
          <Chip muted label="Ostacoli" onClick={() => showLogistics("obstacles")} />
        </div>
      </footer>

      {modal && (
        <Modal title={modal.title} onClose={() => setModal(null)}>
          {modal.body}
        </Modal>
      )}
      {toast && <Toast message={toast} />}
    </div>
  );
}

function Chip({
  label,
  onClick,
  muted,
  grow,
  disabled,
}: {
  label: string;
  onClick: () => void;
  muted?: boolean;
  grow?: boolean;
  disabled?: boolean;
}) {
  const style = muted
    ? "bg-secondary text-foreground"
    : "border border-border bg-card text-foreground";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`min-h-[44px] rounded-full px-4 text-sm font-medium active:scale-95 disabled:opacity-40 disabled:active:scale-100 ${
        grow ? "flex-1" : "shrink-0 whitespace-nowrap"
      } ${style}`}
    >
      {label}
    </button>
  );
}

function labelLogistics(k: string) {
  return (
    (
      {
        exit: "Uscita",
        toilet: "Toilette",
        bar: "Bar",
        shop: "Shop",
        obstacles: "Ostacoli",
      } as Record<string, string>
    )[k] ?? k
  );
}
