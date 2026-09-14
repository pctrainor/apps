import { cfg } from './config.js';

/**
 * Thin wrapper over the official Bedrock client. Returns null (with a reason)
 * rather than throwing when Bedrock is unavailable, so the pipeline can fall
 * back to its own analysis instead of failing the run.
 */
export async function askBedrock({ system, prompt, maxTokens = 4000 }) {
  let AnthropicBedrockMantle;
  try {
    ({ AnthropicBedrockMantle } = await import('@anthropic-ai/bedrock-sdk'));
  } catch {
    return { text: null, reason: 'bedrock sdk not installed (npm i @anthropic-ai/bedrock-sdk)' };
  }

  // The Mantle client (Messages-API endpoint) only exists from ~0.33. The older
  // AnthropicBedrock export is the legacy InvokeModel path and takes different
  // model ids, so fail loudly rather than silently switching semantics.
  if (typeof AnthropicBedrockMantle !== 'function') {
    return { text: null, reason: 'bedrock sdk is too old for the Mantle client - npm i @anthropic-ai/bedrock-sdk@latest' };
  }

  try {
    const client = new AnthropicBedrockMantle({ awsRegion: cfg.awsRegion });
    const response = await client.messages.create({
      model: cfg.bedrockModel,
      // The expected output is a short JSON array, so a modest cap is
      // deliberate here rather than an oversight.
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    return {
      text,
      model: cfg.bedrockModel,
      usage: response.usage,
      reason: null,
    };
  } catch (err) {
    return { text: null, reason: `${err.name ?? 'error'}: ${err.message}` };
  }
}

/** LLMs wrap JSON in prose and fences; dig the array back out. */
export function extractJsonArray(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}
