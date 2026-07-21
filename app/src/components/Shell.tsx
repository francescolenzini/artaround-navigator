import type { ReactNode } from "react";

export function ErrorScreen({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
      <h1 className="text-2xl font-semibold text-primary">Errore</h1>
      <p className="text-lg text-muted-foreground max-w-md">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="min-h-[44px] rounded-lg bg-primary px-6 py-3 text-lg font-semibold text-primary-foreground"
        >
          Riprova
        </button>
      )}
    </div>
  );
}

export function LoadingScreen({ label = "Caricamento…" }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-lg text-muted-foreground">
      {label}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-xl font-bold text-primary">{title}</h2>
        <div className="text-lg leading-relaxed">{children}</div>
        <button
          onClick={onClose}
          className="mt-6 min-h-[44px] w-full rounded-lg bg-primary px-4 py-3 text-lg font-semibold text-primary-foreground"
        >
          Chiudi
        </button>
      </div>
    </div>
  );
}

export function Toast({ message }: { message: string }) {
  return (
    <div className="fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-full bg-card px-5 py-3 text-card-foreground shadow-lg border border-border">
      {message}
    </div>
  );
}
