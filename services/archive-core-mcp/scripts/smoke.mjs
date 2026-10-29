import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const transport = new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL('../src/index.mjs', import.meta.url))],
  env: { PATH: process.env.PATH, HOME: process.env.HOME, ARCHIVE_CORE_MCP_STAFF_ID: '1979746' }, stderr: 'pipe' });
const client = new Client({ name: 'archive-core-mcp-read-smoke', version: '1.0.0' });
let stderr = false;
transport.stderr?.on('data', () => { stderr = true; });
try {
  await client.connect(transport);
  const tools = await client.listTools();
  const catalog = await client.callTool({ name: 'core_catalog', arguments: {} });
  if (catalog.isError) throw Error('Catalog failed');
  const review = await client.callTool({ name: 'core_meal_review', arguments: { requestId: 'meal-test-20261029-3minute-v2' } });
  if (review.isError) throw Error('Authenticated review failed: ' + JSON.stringify(review.structuredContent?.error));
  const result = review.structuredContent;
  if (!result?.ok || !result.responseHash || !result.draft?.revision || !Object.keys(result.preferences || {}).length) throw Error('Review projection incomplete');
  console.log(JSON.stringify({ ok: true, tools: tools.tools.map(t => t.name),
    actions: catalog.structuredContent.result.actions.length, areas: catalog.structuredContent.result.areas.length,
    authenticatedReview: true, publicDraftPresent: !!result.draft?.publicContent,
    published: result.report?.publicationStatus === 'published', rawHealthExcluded: !result.inbody && !result.response,
    stderrObserved: stderr }));
} finally { await client.close(); await transport.close(); }
