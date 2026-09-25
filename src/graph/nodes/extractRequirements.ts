import { z } from 'zod';
import type { ExtractedRole } from '../../types/kit';
import { openrouter } from '../../llm/openrouterClient';
// import { config } from '../../config/env';

export class ExtractionFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionFailedError';
  }
}

const RequirementSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: z.enum(['technical', 'behavioural', 'domain']),
  priority: z.enum(['must', 'nice']),
});

const ExtractedRoleSchema = z.object({
  title: z.string(),
  seniority: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(RequirementSchema),
});

export async function extractRequirements(jd: string): Promise<ExtractedRole> {
  const start = Date.now();
  // Cap very large JDs — LLMs handle context better with focused inputs, and this avoids slow completions
  const cappedJd = jd.length > 6000 ? jd.slice(0, 6000) + '\n\n[Job description truncated for processing]' : jd;

  const prompt = `You are an expert HR and technical recruiter. Read the following Job Description (JD) carefully and extract the role details and requirements.

Job Description:
"""
${cappedJd}
"""

Return ONLY a JSON object with this EXACT structure (no markdown fences, no conversational text):
{
  "title": "Job Title",
  "seniority": "e.g. Senior, Mid, Junior, Lead, Staff, or Not Specified",
  "responsibilities": ["Responsibility 1", "Responsibility 2"],
  "requirements": [
    {
      "id": "r1",
      "text": "Requirement text",
      "kind": "technical" | "behavioural" | "domain",
      "priority": "must" | "nice"
    }
  ]
}

Rules:
1. Assign "id" as "r1", "r2", "r3"... in the exact order requirements appear.
2. Set "kind" to "technical" for coding/tools/stack/architecture, "behavioural" for soft skills/communication/teamwork, "domain" for industry/domain knowledge.
3. Set "priority" to "must" ONLY for explicit required/must-have language (e.g. "5+ years", "required", "must have", "proficiency in"). Everything else must be "nice".
4. Never invent requirements or responsibilities not present in the text.`;

  async function callLlm(messages: any[]) {
    const response = await openrouter.chat.send({
      chatRequest: {
        model: "openrouter/free",
        messages,
        temperature: 0.1,
      },
    });
    if ("choices" in response && Array.isArray(response.choices)) {
      const choice = response.choices[0];
      const content = choice?.message?.content;
      if (typeof content === 'string') {
        return content;
      }
      if (Array.isArray(content)) {
        return content.map((c: any) => (typeof c === 'string' ? c : (c as any).text || '')).join('');
      }
    }
    return '';
  }

  let rawContent = '';
  const messages: any[] = [{ role: 'user', content: prompt }];

  try {
    rawContent = await callLlm(messages);
  } catch (err: any) {
    throw new ExtractionFailedError(`LLM API call failed: ${err.message}`);
  }

  const parseJson = (text: string) => {
    let clean = text.trim();
    if (clean.startsWith('```json')) clean = clean.slice(7);
    if (clean.startsWith('```')) clean = clean.slice(3);
    if (clean.endsWith('```')) clean = clean.slice(0, -3);
    clean = clean.trim();
    return JSON.parse(clean);
  };

  const count = 1;
  try {
    const jsonObj = parseJson(rawContent);
    const validated = ExtractedRoleSchema.parse(jsonObj);
    console.log(`Done in loop ${count} and took : ${(Date.now() - start)/1000}s`);
    
    return validated;
  } catch (firstErr) {
    // Retry once with clarification prompt
    messages.push({ role: 'assistant', content: rawContent });
    messages.push({
      role: 'user',
      content:
        'Your last response was invalid JSON or did not strictly conform to the required JSON schema. Return ONLY a raw valid JSON object adhering strictly to the schema with title, seniority, responsibilities, and requirements.',
    });

    try {
      const retryContent = await callLlm(messages);
      const jsonObj = parseJson(retryContent);
      const validated = ExtractedRoleSchema.parse(jsonObj);
      return validated;
    } catch (secondErr: any) {
      throw new ExtractionFailedError(
        `Failed to parse role requirements after retry: ${secondErr.message}`
      );
    }
  }
}
