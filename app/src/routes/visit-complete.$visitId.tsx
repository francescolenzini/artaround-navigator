import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useApp } from "../lib/AppContext";
import { HeaderActions } from "../components/Nav";

export const Route = createFileRoute("/visit-complete/$visitId")({
  component: VisitCompletePage,
});

function VisitCompletePage() {
  const { token, museum } = useApp();
  const navigate = useNavigate();

  if (!token) return <Navigate to="/login" />;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-background text-foreground">
      <header className="flex justify-end px-5 pt-4 pb-3">
        <HeaderActions onMap={() => navigate({ to: "/map", search: { from: "visits" } })} />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="mb-6 text-6xl">✓</div>
        <h1 className="mb-3 text-3xl font-bold text-primary">Visita completata</h1>
        <p className="mb-10 text-lg text-muted-foreground">
          Grazie per aver esplorato{museum ? ` ${museum.name}` : " il museo"}.
        </p>
        <button
          onClick={() => navigate({ to: "/visits" })}
          className="min-h-[52px] w-full max-w-sm rounded-lg bg-primary text-lg font-semibold text-primary-foreground"
        >
          Torna alle visite
        </button>
      </div>
    </div>
  );
}
