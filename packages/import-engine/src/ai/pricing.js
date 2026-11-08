'use strict';

// Prices in US dollars per million tokens, from Anthropic's published price list (November 2026).
// A model without a price here cannot run: the cost cap could not be enforced.
// Claude Haiku 5.5's price applies to prompts of 100,000 tokens or fewer; chunks stay under that.

const PRICES = {
    'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
    'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }
};

function priceOf(model) {
    const price = PRICES[model];
    if (!price) throw new Error(`No price is known for the model “${model}”, so the cost cap cannot be enforced. Choose one of: ${Object.keys(PRICES).join(', ')}`);
    return price;
}

function costOf(model, usage) {
    const price = priceOf(model);
    const perToken = (dollarsPerMillion) => dollarsPerMillion / 1e6;
    return (
        (usage.input_tokens || 0) * perToken(price.input) +
        (usage.output_tokens || 0) * perToken(price.output) +
        (usage.cache_read_input_tokens || 0) * perToken(price.cacheRead) +
        (usage.cache_creation_input_tokens || 0) * perToken(price.cacheWrite)
    );
}

// The most a call can cost: every input token at the cache-write price (the highest input price)
// and every allowed output token.
function worstCase(model, inputTokens, maxTokens) {
    const price = priceOf(model);
    return (inputTokens * Math.max(price.input, price.cacheWrite) + maxTokens * price.output) / 1e6;
}

module.exports = { PRICES, priceOf, costOf, worstCase };
