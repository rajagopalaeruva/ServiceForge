// No tokenizer is available. Estimate: characters / 4, rounded up.
// The audit report must state this.
export function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}
