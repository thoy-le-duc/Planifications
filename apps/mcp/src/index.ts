import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { creerServeur } from './serveur.ts';

await creerServeur().connect(new StdioServerTransport());
