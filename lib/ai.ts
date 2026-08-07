import OpenAI from 'openai';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import { loadTrackingConfig, detectAvailabilityPattern, detectContentArtifact } from './tracking';

interface LLMConfig {
  provider: {
    base_url: string;
  };
  model: {
    name: string;
    max_tokens: number;
    temperature: number;
    reasoning_effort?: string;
  };
  prompts: {
    system: string;
    user_template: string;
  };
}

let openai: OpenAI | null = null;
let config: LLMConfig | null = null;

function loadConfig(): LLMConfig {
  if (!config) {
    const configPath = path.join(process.cwd(), 'llm.yaml');
    const fileContents = fs.readFileSync(configPath, 'utf8');
    config = yaml.load(fileContents) as LLMConfig;
  }
  return config;
}

function getOpenAI(): OpenAI | null {
  if (!openai && process.env.LLM_API_KEY) {
    const cfg = loadConfig();
    openai = new OpenAI({
      apiKey: process.env.LLM_API_KEY,
      baseURL: cfg.provider.base_url,
    });
  }
  return openai;
}

export interface AISummaryResult {
  isMinorChange: boolean;
  summary: string;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Exponential backoff between attempts: 1s, 2s, 4s (capped at 10s).
function retryDelay(attempt: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt), 10000)));
}

// The single definition of "usable content", shared by the retry loop and the
// caller's fallback branch. The two must agree: a response the loop declines to
// retry must not then land on the caller's fallback. Type predicate so the caller
// still narrows.
function hasUsableContent(text: string | undefined): text is string {
  return !!text && text !== '{}';
}

// The user-facing text for every failure where the LLM could not produce a usable
// summary. A reader cannot act on WHY it failed, so the row points at the diff and
// the specific cause goes to the server log. scripts/regen-summaries.ts finds rows
// to reprocess by matching the "AI analysis temporarily unavailable." substring.
function analysisUnavailable(service: string, documentType: string): AISummaryResult {
  return {
    isMinorChange: false,
    summary: `${service} updated their ${documentType}. AI analysis temporarily unavailable. See diff for details.`,
  };
}

// A 429 arrives as a rejected promise; an empty completion arrives as a RESOLVED
// one carrying no usable content. Rethrowing the empty case as a sentinel routes
// both into the same catch, so "is this retryable?" is decided in one place.
// It carries the response so an exhausted retry can still hand it to the caller.
class EmptyCompletionError extends Error {
  constructor(readonly response: OpenAI.Chat.Completions.ChatCompletion) {
    super('empty completion');
    this.name = 'EmptyCompletionError';
  }
}

async function makeAPICallWithRetry(
  client: OpenAI,
  requestBody: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & { reasoning_effort?: 'low' | 'medium' | 'high' | 'minimal' },
  label = '',
  maxRetries = 3
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const isLastAttempt = attempt === maxRetries - 1;

    try {
      const response = await client.chat.completions.create(requestBody as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

      // An empty completion is an HTTP success carrying no usable content. It is
      // retryable: nothing re-runs a change once it is stored except a manual
      // script, so an un-retried empty draw becomes the row's permanent summary.
      const content = response.choices[0]?.message?.content?.trim();
      if (!hasUsableContent(content)) {
        // This branch conflates a token-budget overrun (finish_reason "length" —
        // with reasoning enabled the reasoning pass can consume all of max_tokens,
        // leaving none for the message) with an upstream provider hiccup. They want
        // different fixes and are indistinguishable from the response alone, so the
        // deciding fields are logged here.
        console.error('[ai] empty completion', {
          label,
          attempt: attempt + 1,
          maxRetries,
          finish_reason: response.choices[0]?.finish_reason,
          usage: response.usage,
        });
        throw new EmptyCompletionError(response);
      }

      return response;
    } catch (error: unknown) {
      lastError = error;

      // One retry decision for both retryable conditions: rate limits (429) and
      // empty completions.
      const err = error as { status?: number; statusCode?: number };
      const isRateLimit = err.status === 429 || err.statusCode === 429;
      const isEmpty = error instanceof EmptyCompletionError;

      if ((isRateLimit || isEmpty) && !isLastAttempt) {
        await retryDelay(attempt);
        continue;
      }

      // Attempts exhausted on an empty completion: return the response rather than
      // throw, so the caller reaches its own empty check and the summary path.
      if (error instanceof EmptyCompletionError) {
        return error.response;
      }

      // For non-retryable errors, or once retries are exhausted, throw immediately
      throw error;
    }
  }

  throw lastError;
}

export async function generateSummary(diff: string, service: string, documentType: string): Promise<AISummaryResult> {
  // Known "flip-flop" scraping artifact (exact net-change block match). Checked FIRST: it
  // is the most specific, highest-confidence signal, so it must win over the fuzzy
  // availability heuristic below — a block that incidentally contains availability phrasing
  // should still be labeled as the content artifact, not routed to the availability branch.
  if (detectContentArtifact(diff, service, documentType)) {
    return {
      isMinorChange: true,
      summary: `Unstable content (tracking error).`
    };
  }

  // Check if this service has "all" condition (mark all changes as minor)
  const tracking = loadTrackingConfig();
  const problematicService = tracking.problematic_services.find(ps => ps.name === service);

  if (problematicService?.condition === 'all') {
    return {
      isMinorChange: true,
      summary: `Unstable content (tracking error).`
    };
  }

  // Check for page availability patterns
  const availabilityPattern = detectAvailabilityPattern(diff);

  if (availabilityPattern) {
    // Check if this service has "availability" condition
    if (problematicService?.condition === 'availability') {
      return {
        isMinorChange: true,
        summary: `Page availability issue (tracking error).`
      };
    }

    // For other services, handle normally
    if (availabilityPattern === 'becoming_unavailable') {
      // Page became unavailable - this is a tracking issue
      return {
        isMinorChange: true,
        summary: `Page became unavailable (tracking issue).`
      };
    }

    // becoming_available falls through to normal LLM processing below: the page
    // may now have real content worth summarizing.
  }

  // Identifies the row in every log line below; a cron run interleaves many.
  const label = `${service} — ${documentType}`;

  const client = getOpenAI();
  if (!client) {
    console.error('[ai] LLM_API_KEY not configured', { label });
    return analysisUnavailable(service, documentType);
  }

  try {
    const cfg = loadConfig();

    // Defang <diff>-tag lookalikes in the scraped content so it can't pose as
    // the template's delimiter (best-effort; the JSON response format and
    // render-layer escaping are the real guardrails).
    const safeDiff = diff.replace(/<\s*(\/?)\s*diff\b/gi, '[$1diff');

    // Single-pass, function-form substitution: string-form .replace() would
    // expand $-patterns ($&, $`, $') occurring in the scraped diff into the
    // template, and chained calls could re-expand placeholders.
    const values: Record<string, string> = { service, documentType, diff: safeDiff }; // Full diff, no truncation
    const userPrompt = cfg.prompts.user_template.replace(
      /\{(service|documentType|diff)\}/g,
      (_match, key: string) => values[key]
    );

    const requestBody: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & { reasoning_effort?: 'low' | 'medium' | 'high' | 'minimal' } = {
      model: cfg.model.name,
      max_tokens: cfg.model.max_tokens,
      temperature: cfg.model.temperature,
      // Schema-constrained decoding: the model cannot emit prose around the JSON
      // or omit fields. The brace-slice + shape validation below stay as a safety
      // net in case a provider falls back to unconstrained output.
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'diff_summary',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              isMinorChange: { type: 'boolean' },
              summary: { type: 'string' },
            },
            required: ['isMinorChange', 'summary'],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: 'system',
          content: cfg.prompts.system
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    };

    // Add reasoning_effort if configured (for Gemini models)
    if (cfg.model.reasoning_effort) {
      requestBody.reasoning_effort = cfg.model.reasoning_effort as 'low' | 'medium' | 'high' | 'minimal';
    }

    // Make API call with retry logic for rate limits and empty completions
    const response = await makeAPICallWithRetry(client, requestBody, label);

    const responseText = response.choices[0]?.message?.content?.trim();

    // Still empty after makeAPICallWithRetry spent its full attempt budget.
    if (!hasUsableContent(responseText)) {
      return analysisUnavailable(service, documentType);
    }
    
    try {
      // Even with response_format json_object, the model occasionally prefixes
      // prose (e.g. "Here is the JSON requested{...}") — parse the outermost
      // {...} instead of the raw text. No '{' found → empty string → parse
      // throws → existing invalid-response fallback below.
      const jsonText = responseText.slice(responseText.indexOf('{'), responseText.lastIndexOf('}') + 1);
      const result = JSON.parse(jsonText) as AISummaryResult;
      
      // Require the full expected shape, not just a truthy summary: the brace-slice
      // above can extract JSON the model merely quoted from the untrusted diff (e.g.
      // in a refusal), and an undefined isMinorChange would silently store as
      // non-minor via the Prisma column default.
      if (typeof result.summary !== 'string' || !result.summary || typeof result.isMinorChange !== 'boolean') {
        console.error('[ai] response missing required fields', { label });
        return analysisUnavailable(service, documentType);
      }
      
      // Check if LLM returned the generic unavailable message pattern
      // escapeRegExp: a service/documentType containing a regex metachar (e.g.
      // "(", "+") would make new RegExp throw, and the catch below would then
      // discard every valid LLM summary for that service.
      const genericPattern = new RegExp(
        `${escapeRegExp(service)}\\s+${escapeRegExp(documentType)}\\s+page was temporarily unavailable or returned an error when archived\\.?`,
        'i'
      );
      if (genericPattern.test(result.summary)) {
        // Replace with our cleaner message
        result.summary = 'Page availability issue (tracking error).';
        result.isMinorChange = true;
      }
      
      // Ensure summary length is within target range for content changes
      if (!result.isMinorChange && result.summary.length > 450) {
        const lastPeriod = result.summary.substring(0, 450).lastIndexOf('.');
        if (lastPeriod > 300) {
          result.summary = result.summary.substring(0, lastPeriod + 1);
        } else {
          const lastSpace = result.summary.substring(0, 447).lastIndexOf(' ');
          result.summary = result.summary.substring(0, lastSpace) + '...';
        }
      }
      
      return result;
    } catch {
      console.error('[ai] response was not parseable JSON', { label });
      return analysisUnavailable(service, documentType);
    }
  } catch (error: unknown) {
    // status is what separates a rate limit from an auth failure, a 5xx, or a
    // malformed request — the row itself reads the same for all of them.
    const err = error as { status?: number; message?: string };
    console.error('[ai] request failed', { label, status: err.status, message: err.message });
    return analysisUnavailable(service, documentType);
  }
}

