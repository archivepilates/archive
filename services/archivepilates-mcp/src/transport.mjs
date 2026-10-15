import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

function toolError(error) {
  // Only an explicit safe marker permits business-layer error text on the wire.
  try {
    if (error?.safe === true) {
      const { code, message } = error;
      if (
        typeof code === 'string' && code.length > 0 &&
        typeof message === 'string' && message.length > 0
      ) {
        return { code, message };
      }
    }
  } catch {
    // Thrown values can have getters that throw; those are also private errors.
  }
  return { code: 'INTERNAL_ERROR', message: 'Tool execution failed.' };
}

function result(payload, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * Create an unconnected server for the caller's local StdioServerTransport.
 * callTool may throw { safe: true, code, message } for public business errors.
 * Execution authorization and concurrency belong to the injected business layer.
 */
export function createMcpServer({ listTools, callTool }) {
  const server = new Server(
    { name: 'archivepilates-mcp', version: '0.1.0' },
    { capabilities: { tools: {} }, instructions: 'ARCHIVE PILATES 운영자용 업무 도구입니다. 운영 연결은 조회 전용입니다. 먼저 members_find로 정확한 회원을 선택하세요. 동기화 원장과 StudioMate 실시간 원본을 구분하고 freshness=unknown을 최신으로 단정하지 마세요. 후보·큐·공급자 접수·최종 전달·서명 완료는 서로 다릅니다. 조회 오류·한도·불완전한 ID 연결을 빈 결과로 해석하지 마세요. 회원 변경·예약·취소·발송은 지원하지 않습니다. 응답의 개인정보는 최소한만 요약하세요.' },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => {
    try {
      return { tools: listTools() };
    } catch {
      throw new McpError(ErrorCode.InternalError, 'Tool discovery failed.');
    }
  });

  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      if (!listTools().some((tool) => tool.name === params.name)) {
        return result(
          { ok: false, error: { code: 'UNKNOWN_TOOL', message: 'Unknown tool.' } },
          true,
        );
      }
      return result(await callTool(params.name, params.arguments ?? {}));
    } catch (error) {
      return result({ ok: false, error: toolError(error) }, true);
    }
  });

  return server;
}
