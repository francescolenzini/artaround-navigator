import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VisitCompletionDialog } from "./VisitCompletionDialog";

describe("VisitCompletionDialog", () => {
  it("non renderizza nulla finché la conclusione non viene richiesta", () => {
    const markup = renderToStaticMarkup(
      <VisitCompletionDialog open={false} onConfirm={vi.fn()} onStay={vi.fn()} />,
    );

    expect(markup).toBe("");
  });

  it("annuncia il completamento e offre conferma e ritorno alla tappa", () => {
    const markup = renderToStaticMarkup(
      <VisitCompletionDialog open onConfirm={vi.fn()} onStay={vi.fn()} />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Grazie per aver completato la visita!");
    expect(markup).toContain("Torna alle visite");
    expect(markup).toContain("Resta qui");
  });
});
