import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Zoom e pan della planimetria, senza dipendenze: Pointer Events per i gesti,
 * una sola `transform` sullo stage che contiene immagine e pin.
 *
 * L'idea che tiene tutto insieme: immagine e pin vivono nello stesso stage, a
 * cui si applica `translate() scale()` con origine `0 0`. I pin sono posizionati
 * in percentuale dentro lo stage, quindi restano allineati alla pianta a
 * qualsiasi zoom senza doverli ricalcolare. Al pin serve solo il counter-scale
 * (`1/scale`) per restare grande uguale a schermo.
 */

export type MapView = { scale: number; tx: number; ty: number };
type Fits = { min: number; max: number; cover: number };
type Point = { x: number; y: number };
type Natural = { w: number; h: number };

const DRAG_THRESHOLD = 6; // px prima di considerare il gesto un trascinamento
const ZOOM_STEP = 1.6; // fattore dei bottoni +/-
const WHEEL_STEP = 1.12; // fattore per tacca di rotellina
const MAX_ZOOM_FACTOR = 4; // zoom massimo, relativo al "riempi contenitore"
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 24;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function useMapZoomPan() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const naturalRef = useRef<Natural | null>(null);
  const fitsRef = useRef<Fits | null>(null);
  const viewRef = useRef<MapView>({ scale: 1, tx: 0, ty: 0 });
  // Dopo la prima interazione smettiamo di ri-adattare da soli: la vista è
  // dell'utente, un resize non deve riportarla al punto di partenza.
  const userTouchedRef = useRef(false);

  const [view, setView] = useState<MapView>(viewRef.current);
  const [natural, setNatural] = useState<Natural | null>(null);

  const computeFits = useCallback((nat: Natural): Fits | null => {
    const el = containerRef.current;
    if (!el || !el.clientWidth || !el.clientHeight) return null;
    // "cover" riempie il contenitore ed è il punto di partenza; "contain" mostra
    // l'intera pianta ed è lo zoom-out minimo consentito.
    const cover = Math.max(el.clientWidth / nat.w, el.clientHeight / nat.h);
    const contain = Math.min(el.clientWidth / nat.w, el.clientHeight / nat.h);
    return { min: contain, max: cover * MAX_ZOOM_FACTOR, cover };
  }, []);

  const clampView = useCallback((next: MapView): MapView => {
    const el = containerRef.current;
    const nat = naturalRef.current;
    const fits = fitsRef.current;
    if (!el || !nat || !fits) return next;

    const scale = clamp(next.scale, fits.min, fits.max);
    const scaledW = nat.w * scale;
    const scaledH = nat.h * scale;
    const { clientWidth, clientHeight } = el;

    // Se una dimensione ci sta tutta la centriamo; altrimenti impediamo di
    // trascinare la pianta fuori dai bordi del contenitore.
    return {
      scale,
      tx:
        scaledW <= clientWidth
          ? (clientWidth - scaledW) / 2
          : clamp(next.tx, clientWidth - scaledW, 0),
      ty:
        scaledH <= clientHeight
          ? (clientHeight - scaledH) / 2
          : clamp(next.ty, clientHeight - scaledH, 0),
    };
  }, []);

  const applyView = useCallback(
    (next: MapView) => {
      const clamped = clampView(next);
      viewRef.current = clamped;
      setView(clamped);
    },
    [clampView],
  );

  const centeredView = useCallback((scale: number): MapView => {
    const el = containerRef.current;
    const nat = naturalRef.current;
    if (!el || !nat) return { scale, tx: 0, ty: 0 };
    return {
      scale,
      tx: (el.clientWidth - nat.w * scale) / 2,
      ty: (el.clientHeight - nat.h * scale) / 2,
    };
  }, []);

  /** Zoom che tiene fermo `center` (coordinate relative al contenitore). */
  const zoomTo = useCallback(
    (targetScale: number, center: Point) => {
      const fits = fitsRef.current;
      if (!fits) return;
      userTouchedRef.current = true;
      const v = viewRef.current;
      const scale = clamp(targetScale, fits.min, fits.max);
      const imgX = (center.x - v.tx) / v.scale;
      const imgY = (center.y - v.ty) / v.scale;
      applyView({ scale, tx: center.x - imgX * scale, ty: center.y - imgY * scale });
    },
    [applyView],
  );

  const containerCenter = useCallback((): Point => {
    const el = containerRef.current;
    return { x: (el?.clientWidth ?? 0) / 2, y: (el?.clientHeight ?? 0) / 2 };
  }, []);

  const zoomIn = useCallback(
    () => zoomTo(viewRef.current.scale * ZOOM_STEP, containerCenter()),
    [zoomTo, containerCenter],
  );
  const zoomOut = useCallback(
    () => zoomTo(viewRef.current.scale / ZOOM_STEP, containerCenter()),
    [zoomTo, containerCenter],
  );
  const reset = useCallback(() => {
    const fits = fitsRef.current;
    if (fits) applyView(centeredView(fits.cover));
  }, [applyView, centeredView]);

  /** Da chiamare al cambio piano: la nuova pianta riparte da "riempi schermo". */
  const resetForNewImage = useCallback(() => {
    naturalRef.current = null;
    fitsRef.current = null;
    userTouchedRef.current = false;
    setNatural(null);
  }, []);

  const onImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const nat = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight };
      naturalRef.current = nat;
      const fits = computeFits(nat);
      if (fits) {
        fitsRef.current = fits;
        const initial = clampView(centeredView(fits.cover));
        viewRef.current = initial;
        setView(initial);
      }
      setNatural(nat);
    },
    [computeFits, clampView, centeredView],
  );

  // Fit iniziale autorevole: a pianta caricata aspetta che il layout sia
  // assestato (rAF) e ricentra, così il primo mount non lascia una vista
  // calcolata su un contenitore ancora a dimensione zero.
  useEffect(() => {
    if (!natural) return;
    const id = requestAnimationFrame(() => {
      const fits = computeFits(natural);
      if (!fits) return;
      fitsRef.current = fits;
      if (!userTouchedRef.current) applyView(centeredView(fits.cover));
    });
    return () => cancelAnimationFrame(id);
  }, [natural, computeFits, applyView, centeredView]);

  // Rotazione del dispositivo / cambio di viewport.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const nat = naturalRef.current;
      if (!nat) return;
      const fits = computeFits(nat);
      if (!fits) return;
      fitsRef.current = fits;
      // Se l'utente ha già mosso la mappa ci limitiamo a ri-vincolare la sua
      // vista ai nuovi bordi, senza riportarla al fit iniziale.
      applyView(userTouchedRef.current ? viewRef.current : centeredView(fits.cover));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [computeFits, applyView, centeredView]);

  // Rotellina/trackpad: listener non passivo, serve il preventDefault per non
  // far scorrere la pagina sotto.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!naturalRef.current) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      zoomTo(viewRef.current.scale * factor, {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  // --- Gesti: pan a un dito, pinch a due, doppio-tap ---
  const pointers = useRef<Map<number, Point>>(new Map());
  const drag = useRef<{ sx: number; sy: number; lx: number; ly: number; moved: boolean } | null>(
    null,
  );
  const pinch = useRef<{
    startDist: number;
    startScale: number;
    imgX: number;
    imgY: number;
  } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);

  const rel = useCallback((clientX: number, clientY: number): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Tap su un pin: lo gestisce il bottone, qui non deve partire un pan.
      if ((e.target as HTMLElement).closest("[data-pin]")) return;
      userTouchedRef.current = true;
      const p = rel(e.clientX, e.clientY);
      pointers.current.set(e.pointerId, p);

      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const v = viewRef.current;
        pinch.current = {
          startDist: dist(a, b) || 1,
          startScale: v.scale,
          imgX: (mid.x - v.tx) / v.scale,
          imgY: (mid.y - v.ty) / v.scale,
        };
        drag.current = null;
      } else if (pointers.current.size === 1) {
        drag.current = { sx: p.x, sy: p.y, lx: p.x, ly: p.y, moved: false };
      }
    },
    [rel],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      const p = rel(e.clientX, e.clientY);
      pointers.current.set(e.pointerId, p);

      if (pinch.current && pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const pc = pinch.current;
        const scale = pc.startScale * (dist(a, b) / pc.startDist);
        applyView({ scale, tx: mid.x - pc.imgX * scale, ty: mid.y - pc.imgY * scale });
        return;
      }

      const d = drag.current;
      if (d && pointers.current.size === 1) {
        if (!d.moved && Math.hypot(p.x - d.sx, p.y - d.sy) > DRAG_THRESHOLD) {
          d.moved = true;
          try {
            containerRef.current?.setPointerCapture(e.pointerId);
          } catch {
            // Il capture è un'ottimizzazione: se il browser lo rifiuta, il pan
            // funziona comunque finché il dito resta sul contenitore.
          }
        }
        if (d.moved) {
          const v = viewRef.current;
          applyView({ scale: v.scale, tx: v.tx + (p.x - d.lx), ty: v.ty + (p.y - d.ly) });
          d.lx = p.x;
          d.ly = p.y;
        }
      }
    },
    [rel, applyView],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const wasTap = !pinch.current && !!drag.current && !drag.current.moved;
      pointers.current.delete(e.pointerId);
      try {
        containerRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        // Nessun capture attivo: niente da rilasciare.
      }

      if (pointers.current.size < 2) pinch.current = null;

      if (pointers.current.size === 1) {
        // Rimasto un dito dopo il pinch: prosegue come pan, senza salti.
        const [p] = [...pointers.current.values()];
        drag.current = { sx: p.x, sy: p.y, lx: p.x, ly: p.y, moved: true };
        return;
      }

      if (pointers.current.size > 0) return;
      drag.current = null;
      if (!wasTap) return;

      const pos = rel(e.clientX, e.clientY);
      const now = Date.now();
      const prev = lastTap.current;
      if (
        prev &&
        now - prev.t < DOUBLE_TAP_MS &&
        Math.hypot(pos.x - prev.x, pos.y - prev.y) < DOUBLE_TAP_PX
      ) {
        const fits = fitsRef.current;
        if (fits) {
          const zoomed = viewRef.current.scale > fits.cover * 1.4;
          zoomTo(zoomed ? fits.cover : fits.cover * 2.2, pos);
        }
        lastTap.current = null;
      } else {
        lastTap.current = { t: now, x: pos.x, y: pos.y };
      }
    },
    [rel, zoomTo],
  );

  return {
    containerRef,
    view,
    natural,
    onImageLoad,
    resetForNewImage,
    zoomIn,
    zoomOut,
    reset,
    pointerHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}
