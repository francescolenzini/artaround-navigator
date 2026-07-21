// I campi editoriali (descrizione visita, testo a schermo degli item) possono
// contenere l'HTML minimo prodotto dall'editor del Marketplace (p, br, strong,
// em, ul, li, a) oppure testo semplice legacy. Questi helper riducono qualunque
// input al vocabolario ammesso prima del render e lo spogliano per il TTS.
// Il campo ttsText resta sempre testo semplice e non passa da qui.

const ALLOWED_TAGS = new Set(["P", "BR", "STRONG", "EM", "UL", "LI", "A"]);
const TAG_ALIASES: Record<string, string> = { B: "STRONG", I: "EM", DIV: "P", OL: "UL" };

/** True se il valore contiene markup rich text (vs. testo semplice legacy). */
export function isRichText(value?: string): boolean {
  return /<(p|br|strong|em|ul|li|a)[\s/>]/i.test(value ?? "");
}

/** Riduce HTML arbitrario al vocabolario minimo ammesso. */
export function sanitizeRichText(html: string): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const out = document.createElement("template");
  copySanitized(tpl.content, out.content);
  return out.innerHTML;
}

function copySanitized(source: Node, target: Node) {
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(document.createTextNode(child.nodeValue ?? ""));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const tag = TAG_ALIASES[el.tagName] ?? el.tagName;
    if (!ALLOWED_TAGS.has(tag)) {
      copySanitized(el, target); // unwrap: tieni il contenuto, scarta il tag
      continue;
    }
    const clean = document.createElement(tag);
    if (tag === "A") {
      const href = el.getAttribute("href") ?? "";
      if (/^(https?:|mailto:)/i.test(href)) {
        clean.setAttribute("href", href);
        clean.setAttribute("target", "_blank");
        clean.setAttribute("rel", "noopener");
      }
    }
    copySanitized(el, clean);
    target.appendChild(clean);
  }
}

/** Testo semplice dal valore (rich o legacy): è quello che va dato al TTS. */
export function richTextToPlain(value?: string): string {
  const s = value ?? "";
  if (!/[<>&]/.test(s)) return s;
  const tpl = document.createElement("template");
  // Chiusure di blocco -> newline, così i paragrafi non si incollano.
  tpl.innerHTML = s.replace(/<\/(p|li|ul)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n");
  return (tpl.content.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}
