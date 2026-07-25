import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useApp } from "../lib/AppContext";
import { apiFetch } from "../lib/api";
import type { Visit } from "../lib/types";
import { ErrorScreen, LoadingScreen } from "../components/Shell";
import { MapView } from "../components/MapView";
import { backLabelFrom, parseMapSearch, type MapSearch } from "../lib/mapSearch";

export const Route = createFileRoute("/map/$visitId")({
  component: MapPage,
  validateSearch: (search): MapSearch => parseMapSearch(search),
});

function MapPage() {
  const { visitId } = Route.useParams();
  const { from, step } = Route.useSearch();
  const { apiConfig, token, visit: ctxVisit, setVisit } = useApp();
  const navigate = useNavigate();
  const [visit, setLocalVisit] = useState<Visit | null>(
    ctxVisit && ctxVisit.id === visitId ? ctxVisit : null,
  );
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!apiConfig || !token || (visit && visit.id === visitId)) return;
    apiFetch<Visit>(apiConfig, token, `/visits/${visitId}`)
      .then((v) => {
        setLocalVisit(v);
        setVisit(v);
      })
      .catch((e) => setErr(e?.message ?? "Errore"));
  }, [apiConfig, token, visitId, visit, setVisit]);

  if (!token) return <Navigate to="/login" />;
  if (err) return <ErrorScreen message={err} />;
  if (!visit) return <LoadingScreen />;

  return (
    <MapView
      visit={visit}
      currentStepIndex={step ?? null}
      backLabel={backLabelFrom(from, step)}
      // history.back() riporta esattamente alla schermata da cui si è aperta la
      // mappa, che è ciò che l'etichetta dell'indietro promette.
      onBack={() => window.history.back()}
      onGoToStep={(index) =>
        navigate({
          to: "/player/$visitId/$stepIndex",
          params: { visitId, stepIndex: String(index) },
        })
      }
    />
  );
}
