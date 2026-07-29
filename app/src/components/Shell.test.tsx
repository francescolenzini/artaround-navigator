import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ErrorScreen } from "./Shell";

describe("ErrorScreen", () => {
  it("offre il cambio account quando il chiamante fornisce il logout", () => {
    const markup = renderToStaticMarkup(
      <ErrorScreen
        message="Il museo configurato non è disponibile per questo account."
        onRetry={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    expect(markup).toContain("Riprova");
    expect(markup).toContain("Esci e cambia account");
  });

  it("non mostra il cambio account per gli errori senza una sessione", () => {
    const markup = renderToStaticMarkup(<ErrorScreen message="Configurazione non disponibile." />);

    expect(markup).not.toContain("Esci e cambia account");
  });
});
