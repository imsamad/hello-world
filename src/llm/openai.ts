import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam } from 'openai/resources';

export type OpenAIModel = string;

export const models = {
  gpt4o: 'gpt-4o',
  chatgpt4oLatest: 'chatgpt-4o-latest',
  gpt4Turbo: 'gpt-4-turbo',
  gpt4: 'gpt-4',
  gpt3Turbo: 'gpt-3.5-turbo-0125',
  gpt3_16k: 'gpt-3.5-turbo-16k',
  gpt4oMini: 'gpt-4o-mini',
  o1: 'o1',
  o1Mini: 'o1-mini',
  o3Mini: 'o3-mini',
  o1Pro: 'o1-pro',
  gpt45Preview: 'gpt-4.5-preview',
  gpt4_1: 'gpt-4.1',
  o4Mini: 'o4-mini',
  o3: 'o4',
};
export const modelConfig = {
  [models.gpt4o]: {
    inputRate: 0.15 / 1_000_000,
    outputRate: 0.6 / 1_000_000,
    rpm: 500,
    tpm: 200_000,
  },

  [models.gpt4oMini]: {
    inputRate: 0.015 / 1_000_000,
    outputRate: 0.06 / 1_000_000,
    rpm: 500,
    tpm: 2_000_000,
  },

  [models.gpt4_1]: {
    inputRate: 2.0 / 1_000_000,
    outputRate: 8.0 / 1_000_000,
    rpm: 500,
    tpm: 200_000,
  },

  [models.gpt45Preview]: {
    inputRate: 5.0 / 1_000_000,
    outputRate: 15.0 / 1_000_000,
    rpm: 300,
    tpm: 150_000,
  },

  [models.gpt4Turbo]: {
    inputRate: 10.0 / 1_000_000,
    outputRate: 30.0 / 1_000_000,
    rpm: 300,
    tpm: 150_000,
  },

  [models.gpt4]: {
    inputRate: 30.0 / 1_000_000,
    outputRate: 60.0 / 1_000_000,
    rpm: 200,
    tpm: 100_000,
  },

  [models.gpt3Turbo]: {
    inputRate: 0.5 / 1_000_000,
    outputRate: 1.5 / 1_000_000,
    rpm: 1000,
    tpm: 2_000_000,
  },

  [models.gpt3_16k]: {
    inputRate: 3.0 / 1_000_000,
    outputRate: 4.0 / 1_000_000,
    rpm: 500,
    tpm: 1_000_000,
  },

  [models.o1]: {
    inputRate: 15.0 / 1_000_000,
    outputRate: 60.0 / 1_000_000,
    rpm: 100,
    tpm: 50_000,
  },

  [models.o1Mini]: {
    inputRate: 3.0 / 1_000_000,
    outputRate: 12.0 / 1_000_000,
    rpm: 200,
    tpm: 100_000,
  },

  [models.o3Mini]: {
    inputRate: 1.1 / 1_000_000,
    outputRate: 4.4 / 1_000_000,
    rpm: 500,
    tpm: 200_000,
  },

  [models.o4Mini]: {
    inputRate: 0.5 / 1_000_000,
    outputRate: 2.0 / 1_000_000,
    rpm: 500,
    tpm: 500_000,
  },

  [models.o1Pro]: {
    inputRate: 60.0 / 1_000_000,
    outputRate: 120.0 / 1_000_000,
    rpm: 50,
    tpm: 25_000,
  },
};
const oModelsWithoutInstructions: OpenAIModel[] = [
  models.o1Mini,
  models.o1,
  models.o3Mini,
  models.o4Mini,
  models.o3,
];

const oModelsWithAdjustableReasoningEffort: OpenAIModel[] = [
  models.o1,
  models.o3Mini,
  models.o1Pro,
  models.o4Mini,
  models.o3,
];
const defaultInstructions = 'You are a helpful assistant.';

export const requestToGPT = async ({
  prompt,
  maxTokens,
  temperature,
  responseFormat,
  model,
  instructions,
  topP,
}: {
  prompt: string;
  maxTokens: number;
  temperature: number;
  responseFormat: 'text' | 'json_object';
  model: OpenAIModel;
  instructions?: string;
  topP?: number;
}): Promise<{ content: string; totalCost: number }> => {
  const openAi = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  if (!openAi.apiKey) {
    throw new Error('No API key found for OpenAI');
  }

  const retryDelay = 1000;
  let attemptCount = 0;

  if (oModelsWithoutInstructions.includes(model) && instructions) {
    prompt = `
      ${instructions}

      -------

      ${prompt}
    `;
  }

  const timeoutId = setTimeout(() => {
    throw new Error('OpenAI API request timed out');
  }, 90000);

  try {
    const messagesArray: ChatCompletionMessageParam[] = instructions
      ? [
          { role: 'system', content: instructions || defaultInstructions },
          { role: 'user', content: prompt },
        ]
      : [{ role: 'user', content: prompt }];

    const params: ChatCompletionCreateParamsNonStreaming = {
      model: model,
      messages: messagesArray,
      response_format: { type: responseFormat },
    };

    if (!oModelsWithoutInstructions.includes(model)) {
      params.max_tokens = maxTokens;
      params.temperature = temperature;
      params.top_p = topP || 1;
      params.presence_penalty = 0;
      params.frequency_penalty = 0;
    }

    if (oModelsWithAdjustableReasoningEffort.includes(model)) {
      params.reasoning_effort = 'medium';
    }

    const response = await openAi.chat.completions.create(params);

    if (!response.choices[0]?.message?.content) {
      throw new Error('No content in response');
    }

    const finalResponse = response.choices[0].message.content;

    if (finalResponse.trim().toLowerCase().replace('.', '') === "sorry i can't help you with that") {
      console.error('ChatGPT responded with a generic error');
      throw new Error('Error with OpenAI API');
    }
    const total_input_tokens = response.usage?.prompt_tokens || 0;
    const total_output_tokens = response.usage?.completion_tokens || 0;
    const totalCost =
      total_input_tokens * modelConfig[model].inputRate + total_output_tokens * modelConfig[model].outputRate;

    clearTimeout(timeoutId);

    return { content: finalResponse, totalCost };
  } catch (error: any) {
    console.error('Error with OpenAI API:', error);

    if (attemptCount < 1) {
      console.error(`Retrying after ${retryDelay} milliseconds...`);
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      attemptCount++;

      return requestToGPT({
        prompt,
        maxTokens,
        temperature,
        responseFormat,
        model,
        instructions,
        topP,
      });
    } else {
      console.error('Error with OpenAI after retry');
      throw new Error('Error with OpenAI API');
    }
  }
};
