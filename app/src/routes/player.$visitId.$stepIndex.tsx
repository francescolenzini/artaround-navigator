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
import { BackLink, HeaderActions } from "../components/Nav";
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

type VoiceCommand =
  | { label: string; kind: "register"; dir: 1 | -1 }
  | { label: string; kind: "author" | "style" };

// Vocabolario dei comandi (specifiche docente): ogni voce è insieme un comando
// vocale riconosciuto e un bottone toccabile — la parità fra i due è un requisito,
// non un dettaglio, quindi la lista è una sola per entrambi.
const VOICE_COMMANDS: VoiceCommand[] = [
  { label: "Dimmi di meno", kind: "register", dir: -1 },
  { label: "Dimmi di più", kind: "register", dir: 1 },
  { label: "Troppo semplice", kind: "register", dir: 1 },
  { label: "Troppo complicato", kind: "register", dir: -1 },
  { label: "Chi è l'autore", kind: "author" },
  { label: "Qual è lo stile", kind: "style" },
];

const LOGISTICS: { key: LogisticsKey; label: string }[] = [
  { key: "exit", label: "Uscita" },
  { key: "toilet", label: "Toilette" },
  { key: "bar", label: "Bar" },
  { key: "shop", label: "Shop" },
  { key: "obstacles", label: "Ostacoli" },
];

type LogisticsKey = "exit" | "toilet" | "bar" | "shop" | "obstacles";

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

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function registerLabel(r: LanguageRegister) {
  return capitalize(r);
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
  // Ultimo comando riconosciuto e suo effetto: mentre il microfono è aperto è
  // l'unica prova che la voce sta funzionando davvero.
  const [lastCommand, setLastCommand] = useState<{ label: string; effect: string } | null>(
    null,
  );
  const recRef = useRef<RecognitionHandle | null>(null);
  // Stato della riproduzione TTS: "paused" mantiene la posizione di lettura,
  // distinto da "idle" che è il risultato di Stop (azzera e riparte da capo).
  const [playState, setPlayState] = useState<"idle" | "speaking" | "paused">("idle");
  // Il racconto va in pausa mentre si parla al microfono e riprende da solo se il
  // comando non ha toccato l'audio (es. "chi è l'autore").
  const resumeAfterListen = useRef(false);

  const playTts = useCallback((text: string) => {
    // `speak` richiama onEnd solo a fine naturale: le interruzioni (pausa, stop,
    // nuovo testo) sono già filtrate dentro lib/speech.
    speak(text, () => setPlayState("idle"));
    setPlayState("speaking");
  }, []);

  // Pausa e ripresa mantengono la posizione di lettura, a differenza di Stop che
  // è distruttivo.
  const pauseTts = useCallback(() => {
    pauseSpeak();
    setPlayState("paused");
  }, []);

  const resumeTts = useCallback(() => {
    resumeSpeak();
    setPlayState("speaking");
  }, []);

  const stopTts = useCallback(() => {
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
  // di autore/stile) perché serve la miniatura in testata. Riusa getArtwork/artworkCache.
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

  const thumbSrc = useMemo(() => {
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

  const showLogistics = useCallback(
    (key: LogisticsKey) => {
      const text = museum?.logistics?.[key];
      if (!text) return setToast("Informazione non disponibile");
      setModal({ title: labelLogistics(key), body: text });
    },
    [museum],
  );

  /**
   * Riconoscimento del comando vocale (vocabolario controllato, matching di
   * sottostringa — non NLP). Ritorna `true` se il comando ha toccato l'audio:
   * in quel caso il racconto non va ripreso da dove era stato messo in pausa.
   */
  const handleVoice = useCallback(
    (text: string): boolean => {
      const t = text.toLowerCase();
      const has = (...keys: string[]) => keys.some((k) => t.includes(k));
      const mark = (effect: string) => setLastCommand({ label: text, effect });

      if (has("prossimo", "avanti")) {
        mark(`tappa ${idx + 2}`);
        goTo(idx + 1);
        return true;
      }
      if (has("precedente", "indietro")) {
        mark(`tappa ${idx}`);
        goTo(idx - 1);
        return true;
      }
      // Prima della pausa: "ferma tutto" azzera, "ferma un attimo" sospende.
      if (has("stop", "ferma tutto", "basta", "silenzio")) {
        mark("audio fermato");
        stopTts();
        return true;
      }
      if (has("pausa", "ferma un attimo", "aspetta")) {
        mark("audio in pausa");
        return true;
      }
      if (has("riprendi", "continua", "riproduci")) {
        mark("audio ripreso");
        resumeTts();
        return true;
      }
      if (has("cos'è questo", "cos è questo", "descrivi")) {
        mark("racconto da capo");
        const tts = currentItem?.content?.ttsText;
        if (tts) playTts(tts);
        return true;
      }
      if (has("di più", "di piu", "troppo semplice")) {
        mark(`registro ${registerInDirection(1) ?? "non disponibile"}`);
        goToRegister(1);
        return true;
      }
      if (has("di meno", "non capisco", "troppo complicato")) {
        mark(`registro ${registerInDirection(-1) ?? "non disponibile"}`);
        goToRegister(-1);
        return true;
      }
      if (has("autore")) {
        mark("scheda autore");
        showAuthor();
        return false;
      }
      if (has("stile")) {
        mark("scheda stile");
        showStyle();
        return false;
      }
      const logistic = LOGISTICS.find(({ key, label }) =>
        has(label.toLowerCase(), ...LOGISTICS_SYNONYMS[key]),
      );
      if (logistic) {
        mark(logistic.label.toLowerCase());
        showLogistics(logistic.key);
        return false;
      }
      setToast(`Comando non riconosciuto: "${text}"`);
      return false;
    },
    [
      idx,
      goTo,
      currentItem,
      playTts,
      resumeTts,
      stopTts,
      registerInDirection,
      goToRegister,
      showAuthor,
      showStyle,
      showLogistics,
    ],
  );

  const stopListening = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
    if (resumeAfterListen.current) {
      resumeAfterListen.current = false;
      resumeTts();
    }
  }, [resumeTts]);

  const toggleMic = useCallback(() => {
    if (listening) return stopListening();

    // Il racconto e la voce dell'utente non possono sovrapporsi: si mette in
    // pausa (non stop) per poter riprendere dallo stesso punto.
    const wasSpeaking = playState === "speaking";
    const h = startRecognition(
      (text) => {
        setListening(false);
        recRef.current = null;
        const touchedAudio = handleVoice(text);
        if (resumeAfterListen.current) {
          resumeAfterListen.current = false;
          if (!touchedAudio) resumeTts();
        }
      },
      () => {
        // onend scatta anche quando il riconoscimento si chiude da solo senza
        // risultato: in quel caso il racconto riprende senza che l'utente agisca.
        setListening(false);
        recRef.current = null;
        if (resumeAfterListen.current) {
          resumeAfterListen.current = false;
          resumeTts();
        }
      },
    );
    if (!h) {
      setToast("Riconoscimento vocale non supportato");
      return;
    }
    if (wasSpeaking) {
      pauseTts();
      resumeAfterListen.current = true;
    }
    recRef.current = h;
    setListening(true);
  }, [listening, stopListening, playState, handleVoice, pauseTts, resumeTts]);

  const content = useMemo(() => {
    if (!step) return "";
    if (currentItemId) return currentItem?.content?.screenText ?? "";
    return step.description ?? "";
  }, [step, currentItemId, currentItem]);

  // Strip orizzontale dei comandi: pagine e posizione corrente per i puntini.
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [stripPages, setStripPages] = useState(1);
  const [stripPage, setStripPage] = useState(0);

  const updateStrip = useCallback(() => {
    const el = stripRef.current;
    if (!el || el.clientWidth === 0) return;
    setStripPages(Math.max(1, Math.ceil(el.scrollWidth / el.clientWidth)));
    setStripPage(Math.round(el.scrollLeft / el.clientWidth));
  }, []);

  useEffect(() => {
    updateStrip();
    window.addEventListener("resize", updateStrip);
    return () => window.removeEventListener("resize", updateStrip);
  }, [updateStrip, listening]);

  const scrollStrip = useCallback((dir: 1 | -1) => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: "smooth" });
  }, []);

  // Un comando è disattivato quando la tappa non ha un registro in quella
  // direzione: il bottone resta visibile, ma non promette ciò che non può fare.
  const commandState = useCallback(
    (c: VoiceCommand) => {
      if (c.kind !== "register") return { disabled: false, run: c.kind === "author" ? showAuthor : showStyle };
      const disabled = c.dir === 1 ? !canAdvanced : !canSimpler;
      return { disabled, run: () => goToRegister(c.dir) };
    },
    [canAdvanced, canSimpler, goToRegister, showAuthor, showStyle],
  );

  if (!token) return <Navigate to="/login" />;
  if (err) return <ErrorScreen message={err} />;
  if (!visit || !step) return <LoadingScreen />;

  const total = visit.steps.length;
  const isFirst = idx === 0;
  const isLast = idx >= total - 1;
  const artworkTitle = currentItem?.content?.title ?? step.title;
  const artworkMeta = [artwork?.artist, artwork?.year].filter(Boolean).join(" · ");

  return (
    // Altezza fissa e scorrimento confinato al contenuto: il microfono e i
    // comandi restano sempre visibili, senza doverli cercare scorrendo.
    <div className="mx-auto flex h-[100dvh] max-w-md flex-col overflow-hidden bg-card text-foreground">
      {/* Indietro a sinistra, mappa + account a destra: le uscite dalla tappa. */}
      <header className="flex shrink-0 items-center justify-between gap-2 px-5 pt-4 pb-3">
        <BackLink
          label="Torna alla visita"
          onClick={() => {
            stopTts();
            navigate({ to: "/visit/$visitId", params: { visitId } });
          }}
        />
        <HeaderActions
          onMap={() =>
            navigate({
              to: "/map/$visitId",
              params: { visitId },
              search: { from: "player", step: idx },
            })
          }
        />
      </header>

      <main className="flex min-h-0 flex-1 flex-col px-5 pb-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="font-display text-[19px] font-semibold leading-tight">
            Tappa {String(idx + 1).padStart(2, "0")}{" "}
            <span className="font-sans text-[13px] font-normal text-foreground-subtle">
              / {total}
            </span>
          </div>
          <div className="min-w-0 truncate text-[11px] font-semibold tracking-[0.04em] text-muted-foreground">
            {visit.title}
          </div>
        </div>

        {/* Blocco opera: l'immagine resta piccola, la voce è protagonista.
            In ascolto passa in secondo piano. */}
        {artworkTitle && (
          <div
            className={`mt-3.5 flex items-center gap-3.5 transition-opacity ${
              listening ? "opacity-45" : ""
            }`}
          >
            {currentItemId &&
              (thumbSrc ? (
                <img
                  src={thumbSrc}
                  alt={artworkTitle}
                  className="h-[58px] w-[58px] shrink-0 rounded-lg border border-border object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <div className="h-[58px] w-[58px] shrink-0 rounded-lg bg-secondary" aria-hidden />
              ))}
            <div className="min-w-0">
              <h1 className="font-display text-[21px] font-semibold leading-tight tracking-[-0.01em]">
                {artworkTitle}
              </h1>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {artworkMeta ||
                  (effectiveRegister ? `Registro: ${registerLabel(effectiveRegister)}` : "")}
              </p>
            </div>
          </div>
        )}

        {/* I due bottoni sono l'unico stato del player: l'etichetta principale dice
            già cosa sta succedendo (Ascolta / Pausa / Riprendi), quindi non serve
            una barra che lo ripeta. Niente timer, del resto: speechSynthesis non
            espone né durata né posizione dell'utterance. Lo Stop si allarga solo
            quando c'è davvero qualcosa da fermare; comando vocale equivalente:
            "stop". */}
        <div className="mt-3.5 flex w-full gap-2">
          <button
            disabled={listening}
            onClick={() => {
              if (playState === "speaking") return pauseTts();
              if (playState === "paused") return resumeTts();
              // Il testo a schermo può contenere markup: al TTS va la versione in
              // testo semplice, mai i tag.
              const t = currentItem?.content?.ttsText ?? richTextToPlain(content);
              if (t) playTts(t);
            }}
            aria-label={
              playState === "speaking"
                ? "Metti in pausa il racconto"
                : playState === "paused"
                  ? "Riprendi il racconto"
                  : "Ascolta il racconto"
            }
            className="flex min-h-[48px] flex-1 items-center justify-center whitespace-nowrap rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-all duration-300 ease-in-out disabled:bg-secondary disabled:text-foreground-subtle"
          >
            {playState === "speaking"
              ? "⏸ Pausa"
              : playState === "paused"
                ? "▶ Riprendi"
                : "▶ Ascolta"}
          </button>
          <button
            onClick={stopTts}
            disabled={listening}
            aria-label="Ferma il racconto e riparti dall'inizio"
            className={`flex min-h-[48px] items-center justify-center whitespace-nowrap rounded-full border border-border bg-background px-4 text-sm font-semibold transition-all duration-300 ease-in-out disabled:opacity-40 ${
              playState !== "idle" ? "flex-1" : "pointer-events-none w-auto opacity-40"
            }`}
          >
            Stop
          </button>
        </div>

        {listening ? (
          /* In ascolto il testo lascia il posto a ciò che si può dire adesso. */
          <>
            <SectionLabel className="mt-4">Comandi per questa tappa</SectionLabel>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              {VOICE_COMMANDS.filter((c) => !commandState(c).disabled).map((c) => (
                <span
                  key={c.label}
                  className="rounded-full border border-line bg-card px-3.5 py-2.5 text-center text-[12.5px] font-semibold"
                >
                  {c.label}
                </span>
              ))}
            </div>
            {/* I servizi restano un gruppo unico: pannello quieto invece di pill
                sciolte, così l'ultima riga spaiata legge come scelta e non come
                sbavatura. Non sono tappabili — in ascolto si dicono. */}
            <section className="mt-4 rounded-xl bg-surface-muted px-3.5 py-3.5">
              <SectionLabel className="text-center">Info del museo</SectionLabel>
              <div className="mt-2.5 flex flex-wrap justify-center gap-1.5">
                {LOGISTICS.map(({ key, label }) => (
                  <span
                    key={key}
                    className="rounded-full border border-line bg-card px-3 py-1.5 text-[12px] text-muted-foreground"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </section>
          </>
        ) : (
          <>
            <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
              <RichText value={content} fallback="—" className="text-sm leading-[1.7]" />
            </div>
          </>
        )}
      </main>

      {/* Il footer può restringersi (niente shrink-0) e tiene il proprio scroll:
          così la fila di navigazione resta sempre intera e visibile invece di
          finire tagliata dall'overflow-hidden della schermata. */}
      <footer className="flex max-h-[55%] min-h-0 flex-col border-t border-border px-5 pb-5 pt-3.5">
        {/* Il microfono sta fra Precedente e Prossimo — posizione già appresa —
            ed è l'unico elemento pieno d'accento della schermata. La didascalia
            sta su una riga a parte: dentro la colonna del microfono ne detterebbe
            la larghezza, comprimendo i due bottoni quando il testo cambia. */}
        <div className="flex shrink-0 items-center gap-3">
          <button
            disabled={isFirst || listening}
            onClick={() => goTo(idx - 1)}
            className="min-h-[48px] min-w-0 flex-1 truncate rounded-xl border border-line px-2 text-[13px] font-semibold disabled:border-border disabled:text-foreground-subtle"
          >
            ‹ Precedente
          </button>

          <button
            onClick={toggleMic}
            aria-label={listening ? "Ferma l'ascolto" : "Parla con la guida"}
            aria-pressed={listening}
            className="relative flex h-[68px] w-[68px] shrink-0 items-center justify-center"
          >
            {listening && (
              <>
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-full bg-primary [animation:mic-ring_1.6s_ease-out_infinite]"
                />
                <span
                  aria-hidden
                  style={{ animationDelay: "0.8s" }}
                  className="absolute inset-0 rounded-full bg-primary [animation:mic-ring_1.6s_ease-out_infinite]"
                />
              </>
            )}
            <span
              className={`relative flex h-[68px] w-[68px] items-center justify-center rounded-full text-background transition-colors ${
                listening
                  ? "bg-foreground shadow-[0_10px_24px_-6px_rgba(26,26,24,0.5)]"
                  : "bg-primary shadow-[0_10px_24px_-6px_rgba(210,69,43,0.55)]"
              }`}
            >
              <MicGlyph />
            </span>
          </button>

          <button
            disabled={listening}
            onClick={() =>
              isLast
                ? navigate({ to: "/visit-complete/$visitId", params: { visitId } })
                : goTo(idx + 1)
            }
            className="min-h-[48px] min-w-0 flex-1 truncate rounded-xl bg-foreground px-2 text-[13px] font-semibold text-background disabled:bg-secondary disabled:text-foreground-subtle"
          >
            {isLast ? "Fine ✓" : "Prossimo ›"}
          </button>
        </div>

        {/* Didascalia del microfono: fuori dalla fila, così può essere lunga
            quanto serve senza spostare i bottoni. */}
        <p
          className={`mt-2 shrink-0 text-center text-[9.5px] font-semibold uppercase tracking-[0.14em] ${
            listening ? "text-primary" : "text-foreground-subtle"
          }`}
        >
          {listening ? "Ferma" : "Chiedi a voce"}
        </p>

        {/* Ciò che eccede scorre qui dentro invece di uscire dallo schermo. */}
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {listening ? (
            lastCommand && (
              <div className="mt-4 rounded-xl border border-border bg-background px-3.5 py-3">
                <SectionLabel>Ultimo comando</SectionLabel>
                <p className="mt-1 text-sm font-semibold">
                  {capitalize(lastCommand.label)} → {lastCommand.effect}
                </p>
              </div>
            )
          ) : (
            <>
              <SectionLabel className="mt-4">Oppure tocca un comando</SectionLabel>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  onClick={() => scrollStrip(-1)}
                  aria-label="Scorri i comandi indietro"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-card text-[17px] leading-none"
                >
                  ‹
                </button>
                <div
                  ref={stripRef}
                  onScroll={updateStrip}
                  className="flex flex-1 gap-2 overflow-x-auto scroll-smooth [-webkit-mask-image:linear-gradient(90deg,#000_82%,transparent)] [mask-image:linear-gradient(90deg,#000_82%,transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {VOICE_COMMANDS.map((c) => {
                    const { disabled, run } = commandState(c);
                    return (
                      <button
                        key={c.label}
                        onClick={run}
                        disabled={disabled}
                        className="min-h-[44px] shrink-0 whitespace-nowrap rounded-full border border-line bg-secondary px-4 text-[12.5px] font-semibold active:scale-95 disabled:opacity-40 disabled:active:scale-100"
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => scrollStrip(1)}
                  aria-label="Scorri i comandi avanti"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-card text-[17px] leading-none"
                >
                  ›
                </button>
              </div>
              <div className="mt-2.5 flex justify-center gap-1.5" aria-hidden>
                {Array.from({ length: stripPages }, (_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 rounded-full transition-all ${
                      i === stripPage ? "w-4 bg-primary" : "w-1.5 bg-border"
                    }`}
                  />
                ))}
              </div>

              <div className="mt-3.5 flex flex-nowrap gap-1.5 overflow-x-auto border-t border-border pt-3.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {LOGISTICS.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => showLogistics(key)}
                    className="min-h-[44px] shrink-0 whitespace-nowrap rounded-full bg-secondary px-3.5 text-[11px] text-muted-foreground active:scale-95"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
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

function SectionLabel({ children, className }: { children: string; className?: string }) {
  return (
    <p
      className={`text-[9px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle ${className ?? ""}`}
    >
      {children}
    </p>
  );
}

/** Microfono disegnato con i bordi: nessuna icon library per una forma sola. */
function MicGlyph() {
  return (
    <span className="flex flex-col items-center gap-0.5" aria-hidden>
      <span className="h-[19px] w-3 rounded-full bg-current" />
      <span className="h-[9px] w-[22px] rounded-b-[14px] border-[2.5px] border-t-0 border-current" />
    </span>
  );
}

// Sinonimi vocali per i servizi: le pill mostrano l'etichetta ufficiale, la voce
// accetta anche il modo in cui la gente lo dice davvero.
const LOGISTICS_SYNONYMS: Record<LogisticsKey, string[]> = {
  exit: ["uscire"],
  toilet: ["bagno", "servizi igienici"],
  bar: ["caffè", "caffe"],
  shop: ["negozio", "bookshop"],
  obstacles: ["barriere", "accessibilità", "accessibilita"],
};

function labelLogistics(k: LogisticsKey) {
  return LOGISTICS.find((l) => l.key === k)?.label ?? k;
}
