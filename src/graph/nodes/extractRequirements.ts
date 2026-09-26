import { z } from 'zod';
import type { ExtractedRole } from '../../types/kit';
import { openrouter } from '../../llm/openrouterClient';
import { parseJsonFromLLM } from '../../llm/callWithRetry';

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
  
  // Clean JD: remove EEO boilerplate, recruitment scam notices, legal disclaimers, and footer links
  const cleanedJd = jd
    .replace(/(?:Equal Opportunity Employer|Recruitment Scams|Privacy statement|Terms of use|Be aware: Recruitment Scams|All qualified applicants will receive consideration)[\s\S]*/gi, '')
    .trim();

  // Support comprehensive multi-page job postings (up to 25,000 chars) without truncating technical skill sections
  const cappedJd = cleanedJd.length > 25000 ? cleanedJd.slice(0, 25000) + '\n\n[Job description truncated]' : cleanedJd;

  const prompt = `You are an expert HR and technical recruiter. Read the following Job Description (JD) carefully and extract the role details and requirements.

Job Description:
"""
${cappedJd}
"""

Return ONLY a JSON object with this EXACT structure (no markdown fences, no conversational text):
{
  "title": "Job Title",
  "seniority": "e.g. Senior, Mid, Junior, Lead, Staff, Entry Level, or Not Specified",
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
2. Extract ALL distinct technical skills, programming languages, tools, frameworks, operating systems, cloud technologies, domain topics, and soft skills mentioned in the job description.
3. DYNAMIC SCALING RULE: The number of extracted requirements MUST scale naturally with the size, detail, and richness of the input job description.
   - For large, multi-faceted job descriptions (e.g. large enterprise postings with many sub-teams or tools), extract a comprehensive set of 12 to 20+ requirements.
   - For short, concise job descriptions, extract a smaller, focused set of requirements.
   - Do NOT artificially cap or inflate the requirement list. Let the content depth dictate the requirement count.
4. Set "kind" to "technical" for coding/tools/languages/frameworks/architecture, "behavioural" for soft skills/communication/teamwork, "domain" for industry/business domain knowledge.
5. Set "priority" to "must" for core/required qualifications or primary tech stack items. Set to "nice" for secondary preferences.
6. Never invent requirements or responsibilities not present in the text.`;

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

  let count = 1;
  try {
    const jsonObj = parseJsonFromLLM(rawContent);
    const validated = ExtractedRoleSchema.parse(jsonObj);
    console.log(`[extractRequirements] Successfully extracted ${validated.requirements.length} requirements in ${(Date.now() - start)/1000}s`);
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
      const jsonObj = parseJsonFromLLM(retryContent);
      const validated = ExtractedRoleSchema.parse(jsonObj);
      console.log(`[extractRequirements] Retry succeeded, extracted ${validated.requirements.length} requirements in ${(Date.now() - start)/1000}s`);
      return validated;
    } catch (secondErr: any) {
      throw new ExtractionFailedError(
        `Failed to parse role requirements after retry: ${secondErr.message}`
      );
    }
  }
}
