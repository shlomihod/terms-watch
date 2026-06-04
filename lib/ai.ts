import OpenAI from 'openai';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import { loadTrackingConfig, detectAvailabilityPattern } from './tracking';

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

async function makeAPICallWithRetry(
  client: OpenAI,
  requestBody: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & { reasoning_effort?: 'low' | 'medium' | 'high' | 'minimal' },
  maxRetries = 3
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  let lastError: unknown;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await client.chat.completions.create(requestBody as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
    } catch (error: unknown) {
      lastError = error;
      
      // Check if it's a rate limit error (429)
      const err = error as { status?: number; statusCode?: number };
      if (err.status === 429 || err.statusCode === 429) {
        if (attempt < maxRetries - 1) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      
      // For non-429 errors or if we've exhausted retries, throw immediately
      throw error;
    }
  }
  
  throw lastError;
}

export async function generateSummary(diff: string, service: string, documentType: string): Promise<AISummaryResult> {
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

  const client = getOpenAI();
  if (!client) {
    return {
      isMinorChange: false,
      summary: `${service} updated their ${documentType}. AI summary not available.`
    };
  }

  try {
    const cfg = loadConfig();
    
    // Replace template variables in the user prompt
    const userPrompt = cfg.prompts.user_template
      .replace('{service}', service)
      .replace('{documentType}', documentType)
      .replace('{diff}', diff); // Full diff, no truncation

    const requestBody: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & { reasoning_effort?: 'low' | 'medium' | 'high' | 'minimal' } = {
      model: cfg.model.name,
      max_tokens: cfg.model.max_tokens,
      temperature: cfg.model.temperature,
      response_format: { type: 'json_object' }, // Enforce JSON response
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

    // Make API call with retry logic for rate limits
    const response = await makeAPICallWithRetry(client, requestBody);

    const responseText = response.choices[0]?.message?.content?.trim();
    
    // Handle empty response properly
    if (!responseText || responseText === '{}') {
      return {
        isMinorChange: false,
        summary: `${service} updated their ${documentType}. AI analysis temporarily unavailable.`
      };
    }
    
    try {
      const result = JSON.parse(responseText) as AISummaryResult;
      
      // Validate the result has required fields
      if (!result.summary) {
        return {
          isMinorChange: false,
          summary: `${service} updated their ${documentType}. AI analysis incomplete.`
        };
      }
      
      // Check if LLM returned the generic unavailable message pattern
      const genericPattern = new RegExp(
        `${service}\\s+${documentType}\\s+page was temporarily unavailable or returned an error when archived\\.?`,
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
      return {
        isMinorChange: false,
        summary: `${service} updated their ${documentType}. AI response was invalid.`
      };
    }
  } catch (error: unknown) {
    // Log different error types
    const err = error as { status?: number; message?: string };
    if (err.status === 429) {
      return {
        isMinorChange: false,
        summary: `${service} updated their ${documentType}. Analysis rate limited - try again later.`
      };
    }
    
    return {
      isMinorChange: false,
      summary: `${service} updated their ${documentType}. See diff for details.`
    };
  }
}

