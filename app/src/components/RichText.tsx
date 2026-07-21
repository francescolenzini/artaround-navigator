import { useMemo } from "react";
import { isRichText, sanitizeRichText } from "../lib/richtext";

// Resa tipografica del markup minimo, coerente con l'editor del Marketplace.
const RICH_TEXT_CLASS =
  "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 " +
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 " +
  "[&_a]:text-primary [&_a]:underline [&_strong]:font-semibold";

/**
 * Renderizza un campo editoriale: HTML minimo sanitizzato se il valore viene
 * dall'editor del Marketplace, testo semplice pre-wrap se è un valore legacy.
 */
export function RichText({
  value,
  className = "",
  fallback,
}: {
  value?: string;
  className?: string;
  fallback?: string;
}) {
  const rich = isRichText(value);
  const html = useMemo(() => (rich ? sanitizeRichText(value ?? "") : ""), [rich, value]);

  if (!value) {
    return fallback ? <p className={className}>{fallback}</p> : null;
  }
  if (!rich) {
    return <p className={`whitespace-pre-wrap ${className}`}>{value}</p>;
  }
  return (
    <div
      className={`${RICH_TEXT_CLASS} ${className}`}
      // Sicuro: html è passato da sanitizeRichText (whitelist p/br/strong/em/ul/li/a).
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
