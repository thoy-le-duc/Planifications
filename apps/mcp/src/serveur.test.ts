import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { creerServeur } from './serveur.ts';

describe('serveur MCP', () => {
  it('accepte une connexion et se présente', async () => {
    const [cote, coteServeur] = InMemoryTransport.createLinkedPair();
    await creerServeur().connect(coteServeur);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(cote);
    expect(client.getServerVersion()?.name).toBe('planifications');
    await client.close();
  });
});
