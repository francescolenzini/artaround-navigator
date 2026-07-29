import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useApp } from "../lib/AppContext";

export const Route = createFileRoute("/visit-complete/$visitId")({
  component: VisitCompletePage,
});

function VisitCompletePage() {
  const { token, visit, setVisit } = useApp();
  const { visitId } = Route.useParams();
  const navigate = useNavigate();

  if (!token) return <Navigate to="/login" />;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center bg-background px-5 text-center text-foreground">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
        Visita conclusa
      </p>
      <h1 className="mt-3 font-display text-3xl font-semibold leading-tight">
        Grazie per aver visitato {visit?.id === visitId ? visit.title : "il museo"}.
      </h1>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground">
        Hai completato il percorso. Puoi scegliere un'altra visita quando vuoi.
      </p>
      <button
        type="button"
        onClick={() => {
          setVisit(null);
          navigate({ to: "/visits" });
        }}
        className="mt-8 min-h-[52px] w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground"
      >
        Torna alle visite
      </button>
    </main>
  );
}
