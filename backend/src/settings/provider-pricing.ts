/** Only explicitly free OpenRouter routes are exempt from paid budgets. */
export function isFreeOpenRouterModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized === 'openrouter/free' || normalized.endsWith(':free');
}
