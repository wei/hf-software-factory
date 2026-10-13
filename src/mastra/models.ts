// One open-weight model per role, all served by DigitalOcean inference.
// Swap any id for another from `GET https://inference.do-ai.run/v1/models`.
export const models = {
  triage: 'digitalocean/openai-gpt-oss-20b', // small and fast: classify, label
  planner: 'digitalocean/deepseek-v4-pro', // reasoning: read context, write a plan
  maintainer: 'digitalocean/deepseek-v4.1-flash', // coding: many tool calls in a loop
} as const
