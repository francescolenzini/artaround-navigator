import { describe, expect, it, vi } from "vitest";
import { clearSessionContent } from "./sessionContent";

describe("clearSessionContent", () => {
  it("rimuove visita e item quando cambia la sessione", () => {
    const setVisit = vi.fn();
    const setCurrentItem = vi.fn();

    clearSessionContent(setVisit, setCurrentItem);

    expect(setVisit).toHaveBeenCalledOnce();
    expect(setVisit).toHaveBeenCalledWith(null);
    expect(setCurrentItem).toHaveBeenCalledOnce();
    expect(setCurrentItem).toHaveBeenCalledWith(null);
  });
});
