import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../lib/AppContext";
import { apiFetch, getErrorMessage, toAbsoluteUrl } from "../lib/api";
import {
  type Artwork,
  type ArtworkItem,
  type LanguageRegister,
  type ListResponse,
  type Visit,
} from "../lib/types";
import {
  buildGrid,
  neighbour,
  resolveVariant,
  type Variant,
  type VariantAxis,
  type VariantGrid,
  type VariantPref,
} from "../lib/itemVariants";
import { ErrorScreen, LoadingScreen, Modal, Toast } from "../components/Shell";
import { RichText } from "../components/RichText";
import { BackLink, HeaderActions } from "../components/Nav";
import { CommandSheet } from "../components/CommandSheet";
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
  | { label: string; kind: "variant"; axis: VariantAxis; dir: 1 | -1 }
  | { label: string; kind: "author" | "style" };

// Vocabolario dei comandi (specifiche docente): ogni voce è insieme un comando
// vocale riconosciuto e un bottone toccabile — la parità fra i due è un requisito,
// non un dettaglio, quindi la lista è una sola per entrambi.
//
// I comandi di variante sono raggruppati per asse, ed è l'unica ragione per cui
// il gruppo esiste: "dimmi di più" e "troppo semplice" facevano la stessa cosa
// finché la selezione dell'item guardava solo il registro. Ora il primo allunga
// il racconto tenendo il linguaggio, il secondo cambia linguaggio tenendo la
// durata, e i due gruppi lo dicono anche a chi guarda invece di parlare.
const COMMAND_GROUPS: { label: string; commands: VoiceCommand[] }[] = [
  {
    label: "Quanto racconto",
    commands: [
      { label: "Dimmi di più", kind: "variant", axis: "duration", dir: 1 },
      { label: "Dimmi di meno", kind: "variant", axis: "duration", dir: -1 },
    ],
  },
  {
    label: "Come lo racconto",
    commands: [
      { label: "Troppo semplice", kind: "variant", axis: "register", dir: 1 },
      { label: "Non capisco", kind: "variant", axis: "register", dir: -1 },
    ],
  },
  {
    label: "Chiedi dell'opera",
    commands: [
      { label: "Chi è l'autore", kind: "author" },
      { label: "Qual è lo stile", kind: "style" },
    ],
  },
];

const LOGISTICS: { key: LogisticsKey; label: string }[] = [
  { key: "exit", label: "Uscita" },
  { key: "toilet", label: "Toilette" },
  { key: "bar", label: "Bar" },
  { key: "shop", label: "Shop" },
  { key: "obstacles", label: "Ostacoli" },
];

type LogisticsKey = "exit" | "toilet" | "bar" | "shop" | "obstacles";

// Stato aperto/chiuso persistito per sessione (non per tappa): chi usa i chip
// li usa ripetutamente, richiuderli a ogni cambio tappa sarebbe punitivo.
const COMMANDS_OPEN_KEY = "artaround.player.commandsOpen";

// Posizione sui due assi, persistita per sessione: sopravvive al reload della
// pagina, non alla chiusura del browser. Chi ha già detto "non capisco" una
// volta non deve ridirlo a ogni tappa, né dopo un refresh accidentale.
const VARIANT_PREF_KEY = "artaround.player.variantPref";

function readStoredPref(): VariantPref {
  try {
    const raw = sessionStorage.getItem(VARIANT_PREF_KEY);
    if (!raw) return { register: null, minutes: null };
    const parsed = JSON.parse(raw) as Partial<VariantPref>;
    return {
      register: typeof parsed.register === "string" ? (parsed.register as LanguageRegister) : null,
      minutes: typeof parsed.minutes === "number" ? parsed.minutes : null,
    };
  } catch {
    return { register: null, minutes: null };
  }
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
  const [sheetOpen, setSheetOpen] = useState(
    () => sessionStorage.getItem(COMMANDS_OPEN_KEY) === "1",
  );
  useEffect(() => {
    sessionStorage.setItem(COMMANDS_OPEN_KEY, sheetOpen ? "1" : "0");
  }, [sheetOpen]);
  // Ref della shell tenuta in stato e non in `useRef`: `sheetOpen` può essere
  // già `true` al primo render (viene da sessionStorage) e il portale del velo
  // deve trovare il nodo, che con una `useRef` sarebbe ancora null.
  const [shellEl, setShellEl] = useState<HTMLDivElement | null>(null);
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
      .catch((e) => setErr(getErrorMessage(e)));
  }, [apiConfig, token, visitId, visit, setVisit]);

  const step = visit?.steps[idx];

  // Posizione dell'utente sui due assi. Persiste fra le tappe e fra i reload;
  // `resolveVariant` la traduce ogni volta nella variante più vicina fra quelle
  // che la tappa offre davvero.
  const [pref, setPref] = useState<VariantPref>(readStoredPref);
  useEffect(() => {
    sessionStorage.setItem(VARIANT_PREF_KEY, JSON.stringify(pref));
  }, [pref]);

  // Cache degli item già scaricati: muoversi avanti e indietro sulla griglia
  // non deve rifare richieste di rete.
  const itemCache = useRef<Record<string, ArtworkItem>>({});
  const [stepItems, setStepItems] = useState<ArtworkItem[]>([]);

  // Tutte le varianti della tappa in una sola richiesta: la rotta accetta un
  // CSV di id (`?id=a,b,c`). Caricarle in blocco è anche ciò che permette di
  // sapere subito quali comandi sono disponibili, senza tentare la richiesta.
  const stepItemIds = useMemo(() => step?.itemIds ?? [], [step]);
  const stepItemsKey = stepItemIds.join(",");

  useEffect(() => {
    if (!apiConfig || !token) return;
    if (!stepItemsKey) {
      setStepItems([]);
      return;
    }
    let active = true;

    const ids = stepItemsKey.split(",");
    const missing = ids.filter((id) => !itemCache.current[id]);
    const fromCache = () => ids.map((id) => itemCache.current[id]).filter(Boolean);

    if (!missing.length) {
      setStepItems(fromCache());
      return;
    }

    apiFetch<ListResponse<ArtworkItem>>(
      apiConfig,
      token,
      `/artwork-items?id=${encodeURIComponent(missing.join(","))}&pageSize=${missing.length}`,
    )
      .then((r) => {
        for (const item of r.data) itemCache.current[item.id] = item;
        if (active) setStepItems(fromCache());
      })
      .catch(() => {
        if (active) setToast("Impossibile caricare il contenuto");
      });

    return () => {
      active = false;
    };
  }, [apiConfig, token, stepItemsKey]);

  const grid: VariantGrid = useMemo(() => buildGrid(stepItems), [stepItems]);

  // Variante da mostrare: la preferenza di sessione, o il registro proposto
  // dall'autore della visita al primo ingresso.
  const variant: Variant | null = useMemo(
    () =>
      resolveVariant(grid, {
        register: pref.register ?? step?.defaultRegister ?? null,
        minutes: pref.minutes,
      }),
    [grid, pref, step],
  );
  const currentItemId = variant?.item.id;

  useEffect(() => {
    setCurrentItem(variant?.item ?? null);
  }, [variant, setCurrentItem]);

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

  // Variante raggiungibile muovendosi di un gradino su un asse, o null se
  // l'asse è saturo in quella direzione. La regola sta tutta in `neighbour`.
  const variantInDirection = useCallback(
    (axis: VariantAxis, dir: 1 | -1): Variant | null =>
      variant ? neighbour(grid, variant, axis, dir) : null,
    [grid, variant],
  );

  // Sposta la selezione di un gradino, aggiornando insieme schermo
  // (`screenText`) e sintesi vocale (`ttsText`), come richiede la spec.
  //
  // Quando l'asse è saturo il messaggio dice *quale* asse lo è, e per la durata
  // suggerisce l'altro comando: è il momento in cui l'utente sta imparando che
  // gli assi sono due, e sprecarlo con un "non disponibile" generico sarebbe un
  // peccato.
  const goToVariant = useCallback(
    (axis: VariantAxis, dir: 1 | -1, opts?: { speak?: boolean }) => {
      const target = variantInDirection(axis, dir);
      if (!target) {
        if (!variant) {
          setToast("Questa tappa non ha contenuti da adattare");
          return;
        }
        setToast(
          axis === "duration"
            ? dir === 1
              ? 'Non c\'è una versione più lunga per questa tappa — prova "troppo semplice"'
              : "Non c'è una versione più breve per questa tappa"
            : dir === 1
              ? "Non c'è una versione più avanzata per questa tappa"
              : "Non c'è una versione più semplice per questa tappa",
        );
        return;
      }

      setPref({ register: target.register, minutes: target.minutes });
      // Interrompe sempre l'audio precedente (il testo è cambiato), ma lo
      // riavvia da solo solo se il comando è arrivato a voce — da bottone
      // aggiorna solo lo schermo, l'ascolto resta una scelta esplicita.
      stopTts();
      if (opts?.speak && target.item.content?.ttsText) playTts(target.item.content.ttsText);
    },
    [variantInDirection, variant, stopTts, playTts],
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

      if (has("prossimo", "avanti")) {
        goTo(idx + 1);
        return true;
      }
      if (has("precedente", "indietro")) {
        goTo(idx - 1);
        return true;
      }
      // Prima della pausa: "ferma tutto" azzera, "ferma un attimo" sospende.
      if (has("stop", "ferma tutto", "basta", "silenzio")) {
        stopTts();
        return true;
      }
      if (has("pausa", "ferma un attimo", "aspetta")) {
        return true;
      }
      if (has("riprendi", "continua", "riproduci")) {
        resumeTts();
        return true;
      }
      if (has("cos'è questo", "cos è questo", "descrivi")) {
        const tts = currentItem?.content?.ttsText;
        if (tts) playTts(tts);
        return true;
      }
      // I due assi, in quest'ordine per una ragione precisa: il matching è per
      // sottostringa e vince il primo ramo, quindi "troppo semplice" (registro
      // su) va testato PRIMA di "più semplice" (registro giù), che altrimenti
      // lo intercetterebbe. Stessa cautela fra "di più" e "più lungo".
      if (
        has("troppo semplice", "meno scolastico", "più difficile", "piu difficile", "per esperti")
      ) {
        goToVariant("register", 1, { speak: true });
        return true;
      }
      if (
        has(
          "non capisco",
          "non ho capito",
          "troppo complicato",
          "troppo difficile",
          "più semplice",
          "piu semplice",
          "spiegami meglio",
        )
      ) {
        goToVariant("register", -1, { speak: true });
        return true;
      }
      if (has("di più", "di piu", "più lungo", "piu lungo", "approfondisci", "raccontami tutto")) {
        goToVariant("duration", 1, { speak: true });
        return true;
      }
      if (has("di meno", "più corto", "piu corto", "in breve", "fai veloce", "ho fretta")) {
        goToVariant("duration", -1, { speak: true });
        return true;
      }
      if (has("autore", "chi l'ha dipinto", "chi lo ha dipinto", "chi ha dipinto")) {
        showAuthor();
        return false;
      }
      if (has("stile", "corrente", "movimento")) {
        showStyle();
        return false;
      }
      const logistic = LOGISTICS.find(({ key, label }) =>
        has(label.toLowerCase(), ...LOGISTICS_SYNONYMS[key]),
      );
      if (logistic) {
        showLogistics(logistic.key);
        return false;
      }
      setToast(`Comando non riconosciuto: "${text}"`);
      setSheetOpen(true);
      return false;
    },
    [
      idx,
      goTo,
      currentItem,
      playTts,
      resumeTts,
      stopTts,
      goToVariant,
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
    setSheetOpen(false);

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

  // Un comando è non disponibile quando non può fare ciò che promette: la
  // variante se la tappa non ne ha una nella direzione richiesta su quell'asse,
  // autore/stile se la tappa non ha un'opera (logistica/transizione).
  //
  // Non disponibile non vuol dire `disabled`: il bottone resta tappabile e
  // spiega il perché, come già fa la voce. `disabled` bloccherebbe `onClick` e
  // con esso il Toast esplicativo che `goToVariant`/`showAuthor`/`showStyle`
  // emettono già da soli — il messaggio sarebbe raggiungibile solo parlando,
  // rompendo la parità comando vocale ↔ bottone (`handleVoice` non ha mai
  // consultato lo stato del bottone). È la stessa logica delle pill logistica,
  // sempre tappabili anche quando il museo non ha quell'informazione.
  //
  // I comandi di variante cambiano il testo a schermo e chiudono la tendina
  // (l'esito va mostrato) — ma solo se hanno davvero cambiato qualcosa, così il
  // Toast di indisponibilità si legge nel suo contesto; autore/stile aprono un
  // Modal sopra la tendina, che resta aperta per un'altra domanda.
  const commandState = useCallback(
    (c: VoiceCommand) => {
      if (c.kind === "variant") {
        const unavailable = variantInDirection(c.axis, c.dir) == null;
        return {
          unavailable,
          run: () => {
            goToVariant(c.axis, c.dir);
            if (!unavailable) setSheetOpen(false);
          },
        };
      }
      return { unavailable: !currentItemId, run: c.kind === "author" ? showAuthor : showStyle };
    },
    [variantInDirection, goToVariant, showAuthor, showStyle, currentItemId],
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
    // `relative` + la ref: la shell è il contenitore in cui la tendina monta il
    // proprio velo, così l'oscuramento resta dentro la colonna del telefono
    // invece di debordare sul fondo pagina su schermi larghi.
    <div
      ref={setShellEl}
      className="relative mx-auto flex h-[100dvh] max-w-md flex-col overflow-hidden bg-card text-foreground"
    >
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
              {artworkMeta && (
                <p className="mt-1 truncate text-xs text-muted-foreground">{artworkMeta}</p>
              )}
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

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
          <RichText value={content} fallback="—" className="text-sm leading-[1.7]" />
        </div>
      </main>

      {/* relative z-40: la riga di navigazione e la maniglia restano sopra il
          velo della tendina, che altrimenti coprirebbe l'intera shell. La
          maniglia sta subito sopra la riga di navigazione — nella zona del
          pollice — così il pannello emerge da dietro di lei verso l'alto, senza
          mai sovrapporsi a Precedente/Microfono/Prossimo.

          Nessun padding orizzontale qui: lo mettono i figli, così il pannello
          della tendina arriva a filo dei bordi della shell. Il filo superiore
          diventa trasparente a tendina aperta — resterebbe in mezzo fra
          pannello e maniglia, spezzando in due quella che deve leggersi come
          una sola superficie continua — e cambia colore, non presenza, per non
          spostare tutto di 1px. */}
      <footer
        className={`relative z-40 flex shrink-0 flex-col border-t bg-card pb-5 ${
          sheetOpen ? "border-transparent" : "border-border"
        }`}
      >
        <CommandSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          label="Comandi e info del museo"
          scrimContainer={shellEl}
        >
          {/* Un gruppo per asse: i due comandi di ogni riga sono l'uno il
              contrario dell'altro, e righe diverse toccano cose diverse. È la
              stessa distinzione che la riga di stato mostra sopra il testo. */}
          {COMMAND_GROUPS.map((group, groupIndex) => (
            <div key={group.label} className={groupIndex ? "mt-3.5" : undefined}>
              <SectionLabel>{group.label}</SectionLabel>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {group.commands.map((c) => {
                  const { unavailable, run } = commandState(c);
                  return (
                    <button
                      key={c.label}
                      onClick={run}
                      aria-disabled={unavailable || undefined}
                      // Disponibile e non disponibile si distinguono per la
                      // superficie — pieno in pietra contro solo contorno — e non
                      // sbiadendo l'etichetta: il testo resta pienamente leggibile
                      // perché insegnare il vocabolario vocale è metà del senso
                      // della tendina, anche quando il comando ora non si applica.
                      className={`min-h-[44px] whitespace-nowrap rounded-full border border-line px-4 text-[12.5px] transition-colors active:scale-95 ${
                        unavailable
                          ? "bg-card font-medium text-muted-foreground"
                          : "bg-secondary font-semibold text-foreground"
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="my-4 h-px bg-border" />

          <LogisticsPanel onSelect={showLogistics} />
        </CommandSheet>

        {/* Il microfono sta fra Precedente e Prossimo — posizione già appresa —
            ed è l'unico elemento pieno d'accento della schermata. La didascalia
            sta su una riga a parte: dentro la colonna del microfono ne detterebbe
            la larghezza, comprimendo i due bottoni quando il testo cambia. */}
        <div className="relative z-40 mt-3 flex shrink-0 items-center gap-3 px-5">
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
            onClick={() => {
              if (isLast) {
                stopTts();
                navigate({ to: "/visits" });
                return;
              }
              goTo(idx + 1);
            }}
            className="min-h-[48px] min-w-0 flex-1 truncate rounded-xl bg-foreground px-2 text-[13px] font-semibold text-background disabled:bg-secondary disabled:text-foreground-subtle"
          >
            {isLast ? "Torna alle visite" : "Prossimo ›"}
          </button>
        </div>

        {/* Didascalia del microfono: fuori dalla fila, così può essere lunga
            quanto serve senza spostare i bottoni. */}
        <p
          className={`relative z-40 mt-2 shrink-0 px-5 text-center text-[9.5px] font-semibold uppercase tracking-[0.14em] ${
            listening ? "text-primary" : "text-foreground-subtle"
          }`}
        >
          {listening ? "Ferma" : "Chiedi a voce"}
        </p>
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

// Pannello "Info del museo": sempre tappabile, stesso aspetto indipendentemente
// dal microfono — solo il pulsante del microfono cambia con `listening`.
function LogisticsPanel({ onSelect }: { onSelect: (key: LogisticsKey) => void }) {
  return (
    <section>
      <SectionLabel>Info del museo</SectionLabel>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {LOGISTICS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onSelect(key)}
            className="rounded-full border border-line bg-surface-muted px-3 py-1.5 text-[12px] text-muted-foreground active:scale-95"
          >
            {label}
          </button>
        ))}
      </div>
    </section>
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
