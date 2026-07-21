import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useApp } from "../lib/AppContext";

export const Route = createFileRoute("/visit-complete/$visitId")({
  component: VisitCompletePage,
});

function VisitCompletePage() {
  const { token, museum } = useApp();
  const navigate = useNavigate();

  if (!token) return <Navigate to="/login" />;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center text-foreground">
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
  );
}
