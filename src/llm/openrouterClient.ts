import { OpenRouter } from "@openrouter/sdk";

export const openrouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
  // defaultHeaders: {
  //   'HTTP-Referer': 'http://localhost:3000',
  //   'X-Title': 'AI Interview Prep',
  // },
});
