import OpenAI from 'openai';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';

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

interface TrackingConfig {
  problematic_services: string[];
}

let openai: OpenAI | null = null;
let config: LLMConfig | null = null;
let trackingConfig: TrackingConfig | null = null;

function loadConfig(): LLMConfig {
  if (!config) {
    const configPath = path.join(process.cwd(), 'llm.yaml');
    const fileContents = fs.readFileSync(configPath, 'utf8');
    config = yaml.load(fileContents) as LLMConfig;
  }
  return config;
}

function loadTrackingConfig(): TrackingConfig {
  if (!trackingConfig) {
    const configPath = path.join(process.cwd(), 'tracking-issues.yaml');
    try {
      const fileContents = fs.readFileSync(configPath, 'utf8');
      trackingConfig = yaml.load(fileContents) as TrackingConfig;
    } catch {
      // If file doesn't exist or has issues, use empty config
      trackingConfig = { problematic_services: [] };
    }
  }
  return trackingConfig;
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

// Detect page availability issues in diffs
function detectAvailabilityPattern(diff: string): 'becoming_unavailable' | 'becoming_available' | null {
  // Error phrases that indicate page unavailability (case-insensitive)
  const errorPatterns = [
    /this page (?:isn't|is not|isn't) available/i,
    /page not found/i,
    /(?<![\w\/])404(?![\w\.\/])/i,  // 404 not in URLs or filenames
    /the (?:link|page) may (?:be broken|have been removed)/i,
    /an? unexpected error (?:has )?occurred/i,
    /try reloading the page/i,
    /come back later/i,
    /temporarily unavailable/i,
    /error loading/i,
    /page cannot be displayed/i,
    /service unavailable/i
  ];

  // Check each line of the diff
  const lines = diff.split('\n');
  let hasAddedError = false;
  let hasRemovedError = false;

  for (const line of lines) {
    // Check if line adds an error message (starts with +)
    if (line.match(/^\+/)) {
      for (const pattern of errorPatterns) {
        if (pattern.test(line)) {
          hasAddedError = true;
          break;
        }
      }
    }
    // Check if line removes an error message (starts with -)
    else if (line.match(/^-/)) {
      for (const pattern of errorPatterns) {
        if (pattern.test(line)) {
          hasRemovedError = true;
          break;
        }
      }
    }
  }

  // Determine the pattern
  if (hasAddedError && !hasRemovedError) {
    return 'becoming_unavailable';
  } else if (hasRemovedError && !hasAddedError) {
    return 'becoming_available';
  }
  
  return null;
}

export async function generateSummary(diff: string, service: string, documentType: string): Promise<AISummaryResult> {
  // First check for page availability patterns
  const availabilityPattern = detectAvailabilityPattern(diff);
  
  if (availabilityPattern) {
    // Check if this service is known to have frequent availability issues
    const tracking = loadTrackingConfig();
    if (tracking.problematic_services.includes(service)) {
      // This is a known problematic service with availability issues
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
    
    if (availabilityPattern === 'becoming_available') {
      // Page became available - might have real content but note the tracking issue
      // Continue to LLM processing but we could add a note
      }
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

