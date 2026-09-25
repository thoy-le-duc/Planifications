import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Serveur MCP qui exposera la ferme à l'agent.
 * Règle : toute action d'écriture passera par une PROPOSITION à valider.
 */
export function creerServeur(): McpServer {
  return new McpServer({ name: 'planifications', version: '0.0.0' });
}
