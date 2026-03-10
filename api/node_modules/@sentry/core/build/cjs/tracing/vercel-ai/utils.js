Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const genAiAttributes = require('../ai/gen-ai-attributes.js');
const utils = require('../ai/utils.js');
const constants = require('./constants.js');
const vercelAiAttributes = require('./vercel-ai-attributes.js');

/**
 * Accumulates token data from a span to its parent in the token accumulator map.
 * This function extracts token usage from the current span and adds it to the
 * accumulated totals for its parent span.
 */
function accumulateTokensForParent(span, tokenAccumulator) {
  const parentSpanId = span.parent_span_id;
  if (!parentSpanId) {
    return;
  }

  const inputTokens = span.data[genAiAttributes.GEN_AI_USAGE_INPUT_TOKENS_ATTRIBUTE];
  const outputTokens = span.data[genAiAttributes.GEN_AI_USAGE_OUTPUT_TOKENS_ATTRIBUTE];

  if (typeof inputTokens === 'number' || typeof outputTokens === 'number') {
    const existing = tokenAccumulator.get(parentSpanId) || { inputTokens: 0, outputTokens: 0 };

    if (typeof inputTokens === 'number') {
      existing.inputTokens += inputTokens;
    }
    if (typeof outputTokens === 'number') {
      existing.outputTokens += outputTokens;
    }

    tokenAccumulator.set(parentSpanId, existing);
  }
}

/**
 * Applies accumulated token data to the `gen_ai.invoke_agent` span.
 * Only immediate children of the `gen_ai.invoke_agent` span are considered,
 * since aggregation will automatically occur for each parent span.
 */
function applyAccumulatedTokens(
  spanOrTrace,
  tokenAccumulator,
) {
  const accumulated = tokenAccumulator.get(spanOrTrace.span_id);
  if (!accumulated || !spanOrTrace.data) {
    return;
  }

  if (accumulated.inputTokens > 0) {
    spanOrTrace.data[genAiAttributes.GEN_AI_USAGE_INPUT_TOKENS_ATTRIBUTE] = accumulated.inputTokens;
  }
  if (accumulated.outputTokens > 0) {
    spanOrTrace.data[genAiAttributes.GEN_AI_USAGE_OUTPUT_TOKENS_ATTRIBUTE] = accumulated.outputTokens;
  }
  if (accumulated.inputTokens > 0 || accumulated.outputTokens > 0) {
    spanOrTrace.data['gen_ai.usage.total_tokens'] = accumulated.inputTokens + accumulated.outputTokens;
  }
}

/**
 * Get the span associated with a tool call ID
 */
function _INTERNAL_getSpanForToolCallId(toolCallId) {
  return constants.toolCallSpanMap.get(toolCallId);
}

/**
 * Clean up the span mapping for a tool call ID
 */
function _INTERNAL_cleanupToolCallSpan(toolCallId) {
  constants.toolCallSpanMap.delete(toolCallId);
}

/**
 * Convert an array of tool strings to a JSON string
 */
function convertAvailableToolsToJsonString(tools) {
  const toolObjects = tools.map(tool => {
    if (typeof tool === 'string') {
      try {
        return JSON.parse(tool);
      } catch {
        return tool;
      }
    }
    return tool;
  });
  return JSON.stringify(toolObjects);
}

/**
 * Filter out invalid entries in messages array
 * @param input - The input array to filter
 * @returns The filtered array
 */
function filterMessagesArray(input) {
  return input.filter(
    (m) =>
      !!m && typeof m === 'object' && 'role' in m && 'content' in m,
  );
}

/**
 * Normalize the user input (stringified object with prompt, system, messages) to messages array
 */
function convertUserInputToMessagesFormat(userInput) {
  try {
    const p = JSON.parse(userInput);
    if (!!p && typeof p === 'object') {
      let { messages } = p;
      const { prompt, system } = p;
      const result = [];

      // prepend top-level system instruction if present
      if (typeof system === 'string') {
        result.push({ role: 'system', content: system });
      }

      // stringified messages array
      if (typeof messages === 'string') {
        try {
          messages = JSON.parse(messages);
        } catch {
          // ignore parse errors
        }
      }

      // messages array format: { messages: [...] }
      if (Array.isArray(messages)) {
        result.push(...filterMessagesArray(messages));
        return result;
      }

      // prompt array format: { prompt: [...] }
      if (Array.isArray(prompt)) {
        result.push(...filterMessagesArray(prompt));
        return result;
      }

      // prompt string format: { prompt: "..." }
      if (typeof prompt === 'string') {
        result.push({ role: 'user', content: prompt });
      }

      if (result.length > 0) {
        return result;
      }
    }
    // eslint-disable-next-line no-empty
  } catch {}
  return [];
}

/**
 * Generate a request.messages JSON array from the prompt field in the
 * invoke_agent op
 */
function requestMessagesFromPrompt(span, attributes) {
  if (
    typeof attributes[vercelAiAttributes.AI_PROMPT_ATTRIBUTE] === 'string' &&
    !attributes[genAiAttributes.GEN_AI_INPUT_MESSAGES_ATTRIBUTE] &&
    !attributes[vercelAiAttributes.AI_PROMPT_MESSAGES_ATTRIBUTE]
  ) {
    // No messages array is present, so we need to convert the prompt to the proper messages format
    // This is the case for ai.generateText spans
    // The ai.prompt attribute is a stringified object with prompt, system, messages attributes
    // The format of these is described in the vercel docs, for instance: https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-object#parameters
    const userInput = attributes[vercelAiAttributes.AI_PROMPT_ATTRIBUTE];
    const messages = convertUserInputToMessagesFormat(userInput);
    if (messages.length) {
      const { systemInstructions, filteredMessages } = utils.extractSystemInstructions(messages);

      if (systemInstructions) {
        span.setAttribute(genAiAttributes.GEN_AI_SYSTEM_INSTRUCTIONS_ATTRIBUTE, systemInstructions);
      }

      const filteredLength = Array.isArray(filteredMessages) ? filteredMessages.length : 0;
      const truncatedMessages = utils.getTruncatedJsonString(filteredMessages);

      span.setAttributes({
        [vercelAiAttributes.AI_PROMPT_ATTRIBUTE]: truncatedMessages,
        [genAiAttributes.GEN_AI_INPUT_MESSAGES_ATTRIBUTE]: truncatedMessages,
        [genAiAttributes.GEN_AI_INPUT_MESSAGES_ORIGINAL_LENGTH_ATTRIBUTE]: filteredLength,
      });
    }
  } else if (typeof attributes[vercelAiAttributes.AI_PROMPT_MESSAGES_ATTRIBUTE] === 'string') {
    // In this case we already get a properly formatted messages array, this is the preferred way to get the messages
    // This is the case for ai.generateText.doGenerate spans
    try {
      const messages = JSON.parse(attributes[vercelAiAttributes.AI_PROMPT_MESSAGES_ATTRIBUTE]);
      if (Array.isArray(messages)) {
        const { systemInstructions, filteredMessages } = utils.extractSystemInstructions(messages);

        if (systemInstructions) {
          span.setAttribute(genAiAttributes.GEN_AI_SYSTEM_INSTRUCTIONS_ATTRIBUTE, systemInstructions);
        }

        const filteredLength = Array.isArray(filteredMessages) ? filteredMessages.length : 0;
        const truncatedMessages = utils.getTruncatedJsonString(filteredMessages);

        span.setAttributes({
          [vercelAiAttributes.AI_PROMPT_MESSAGES_ATTRIBUTE]: truncatedMessages,
          [genAiAttributes.GEN_AI_INPUT_MESSAGES_ATTRIBUTE]: truncatedMessages,
          [genAiAttributes.GEN_AI_INPUT_MESSAGES_ORIGINAL_LENGTH_ATTRIBUTE]: filteredLength,
        });
      }
      // eslint-disable-next-line no-empty
    } catch {}
  }
}

/**
 * Maps a Vercel AI span name to the corresponding Sentry op.
 */
function getSpanOpFromName(name) {
  switch (name) {
    case 'ai.generateText':
    case 'ai.streamText':
    case 'ai.generateObject':
    case 'ai.streamObject':
    case 'ai.embed':
    case 'ai.embedMany':
    case 'ai.rerank':
      return genAiAttributes.GEN_AI_INVOKE_AGENT_OPERATION_ATTRIBUTE;
    case 'ai.generateText.doGenerate':
      return genAiAttributes.GEN_AI_GENERATE_TEXT_DO_GENERATE_OPERATION_ATTRIBUTE;
    case 'ai.streamText.doStream':
      return genAiAttributes.GEN_AI_STREAM_TEXT_DO_STREAM_OPERATION_ATTRIBUTE;
    case 'ai.generateObject.doGenerate':
      return genAiAttributes.GEN_AI_GENERATE_OBJECT_DO_GENERATE_OPERATION_ATTRIBUTE;
    case 'ai.streamObject.doStream':
      return genAiAttributes.GEN_AI_STREAM_OBJECT_DO_STREAM_OPERATION_ATTRIBUTE;
    case 'ai.embed.doEmbed':
      return genAiAttributes.GEN_AI_EMBED_DO_EMBED_OPERATION_ATTRIBUTE;
    case 'ai.embedMany.doEmbed':
      return genAiAttributes.GEN_AI_EMBED_MANY_DO_EMBED_OPERATION_ATTRIBUTE;
    case 'ai.rerank.doRerank':
      return genAiAttributes.GEN_AI_RERANK_DO_RERANK_OPERATION_ATTRIBUTE;
    case 'ai.toolCall':
      return genAiAttributes.GEN_AI_EXECUTE_TOOL_OPERATION_ATTRIBUTE;
    default:
      if (name.startsWith('ai.stream')) {
        return 'ai.run';
      }
      return undefined;
  }
}

exports._INTERNAL_cleanupToolCallSpan = _INTERNAL_cleanupToolCallSpan;
exports._INTERNAL_getSpanForToolCallId = _INTERNAL_getSpanForToolCallId;
exports.accumulateTokensForParent = accumulateTokensForParent;
exports.applyAccumulatedTokens = applyAccumulatedTokens;
exports.convertAvailableToolsToJsonString = convertAvailableToolsToJsonString;
exports.convertUserInputToMessagesFormat = convertUserInputToMessagesFormat;
exports.getSpanOpFromName = getSpanOpFromName;
exports.requestMessagesFromPrompt = requestMessagesFromPrompt;
//# sourceMappingURL=utils.js.map
