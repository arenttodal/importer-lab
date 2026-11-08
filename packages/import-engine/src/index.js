'use strict';

const { scanCatalog, ENGINE_VERSION, POLICY_VERSION } = require('./scan');
const { crawl } = require('./crawl');
const { PINNED_COMMIT } = require('./adapters/vendor');
const { createClaudeClient } = require('./ai/claude');
const { PRICES } = require('./ai/pricing');

module.exports = { scanCatalog, crawl, createClaudeClient, AI_MODELS: Object.keys(PRICES), ENGINE_VERSION, POLICY_VERSION, PINNED_COMMIT };
