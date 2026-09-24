import type { GeneratedFlashcard, GeneratedQuestion } from '../../types/kit';

/**
 * Truncates text to approximately the first 2-3 sentences at a sentence boundary,
 * capped at maxChars characters.
 */
function truncateToKeyPoints(text: string, maxChars = 400): string {
  if (text.length <= maxChars) return text;

  // Find sentence boundaries (period, exclamation, question mark followed by space or end)
  const sentenceEnd = /[.!?](?:\s|$)/g;
  const sentences: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = sentenceEnd.exec(text)) !== null) {
    sentences.push(match.index + 1); // include the punctuation
    if (sentences.length >= 3) break; // we only need up to 3 sentences
  }

  if (sentences.length >= 2) {
    // Use first 2-3 sentences
    const idx = Math.min(2, sentences.length - 1);
    const cutoff = sentences[idx];
    if (cutoff !== undefined && cutoff <= maxChars) return text.slice(0, cutoff).trim();
  }

  // Fall back to hard char limit at a word boundary
  const truncated = text.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated).trim() + '…';
}

/**
 * flashcardNode — derives flashcards directly from generated questions.
 * One flashcard per question. This is a deliberate cost-saving choice:
 * keeping requirement_ids coverage identical to the question bank, for free.
 * No LLM call required.
 */
export async function flashcardNode(state: {
  questions: GeneratedQuestion[];
}): Promise<{ flashcards: GeneratedFlashcard[] }> {
  const flashcards: GeneratedFlashcard[] = state.questions.map((q, i) => ({
    id: `f${i + 1}`,
    front: q.prompt,
    back: truncateToKeyPoints(q.answer_outline),
    requirement_ids: q.requirement_ids,
  }));

  return { flashcards };
}
