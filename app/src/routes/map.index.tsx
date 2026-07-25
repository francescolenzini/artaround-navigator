import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useApp } from "../lib/AppContext";
import { MapView } from "../components/MapView";
import { backLabelFrom, parseMapSearch, type MapSearch } from "../lib/mapSearch";

/**
 * Mappa senza visita attiva: dalla home la pianta del museo è consultabile anche
 * prima di scegliere un itinerario, senza pin di percorso.
 */
export const Route = createFileRoute("/map/")({
  component: MuseumMapPage,
  validateSearch: (search): MapSearch => parseMapSearch(search),
});

function MuseumMapPage() {
  const { from } = Route.useSearch();
  const { token } = useApp();

  if (!token) return <Navigate to="/login" />;

  return (
    <MapView
      visit={null}
      currentStepIndex={null}
      backLabel={backLabelFrom(from)}
      onBack={() => window.history.back()}
    />
  );
}
