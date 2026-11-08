'use strict';

// The only network call in the engine: one Messages API request per chunk, through Anthropic's
// official SDK. The key comes from the lab (an untracked .env file in development, or the key the
// producer saved in Settings); it never ships inside the app.

const Anthropic = require('@anthropic-ai/sdk');

const AnthropicClient = Anthropic.default || Anthropic;

function createClaudeClient({ apiKey, timeoutMs = 120000 }) {
    if (!apiKey) throw new Error('No AI key: add ANTHROPIC_API_KEY to the .env file, or save a key in Settings');
    const client = new AnthropicClient({ apiKey, timeout: timeoutMs, maxRetries: 2 });
    return {
        describeError,
        async ask({ model, system, user, schema, maxTokens }) {
            const response = await client.messages.create({
                model,
                max_tokens: maxTokens,
                system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
                messages: [{ role: 'user', content: user }],
                output_config: { effort: 'low', format: { type: 'json_schema', schema } }
            });
            const text = response.content
                .filter((block) => block.type === 'text')
                .map((block) => block.text)
                .join('');
            return { text, usage: response.usage, stopReason: response.stop_reason, model: response.model };
        }
    };
}

// A short, plain message for the scan log; never the key.
function describeError(error) {
    if (error instanceof AnthropicClient.AuthenticationError) return 'The AI key was refused';
    if (error instanceof AnthropicClient.RateLimitError) return 'The AI service is busy (rate limit)';
    if (error instanceof AnthropicClient.APIConnectionError) return 'Could not reach the AI service';
    if (error instanceof AnthropicClient.APIError) return `The AI service answered with an error (${error.status})`;
    return error.message;
}

module.exports = { createClaudeClient, describeError };
