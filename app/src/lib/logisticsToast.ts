const DEFAULT_LOGISTICS_MESSAGE = "Informazione non disponibile per questo museo";

export function formatLogisticsToast(message?: string | null): string {
  return message?.trim() || DEFAULT_LOGISTICS_MESSAGE;
}
