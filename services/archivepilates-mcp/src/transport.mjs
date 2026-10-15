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
    { capabilities: { tools: {} }, instructions: 'ARCHIVE PILATES 운영자용 조회 전용 도구입니다. members_find로 실시간 검색 후 선택한 원본 회원 ID를 members_get_overview에 전달하세요. 두 도구는 맥미니 StudioMate 화면을 읽으며 로그인·잠금·조회 실패 시 저장 자료로 대체하지 않습니다. 예약·계약·알림톡·작업 도구는 저장 원장 조회이며 실시간으로 단정하지 마세요. 각 결과의 liveReadback·checkedAt·coverage를 확인하세요. 후보·큐·접수·최종 전달·서명은 다릅니다. 오류·한도를 빈 결과로 해석하지 마세요. 회원 변경·예약·취소·발송은 지원하지 않습니다. 개인정보는 최소한만 요약하세요.' },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => {
    try {
      return { tools: listTools() };
    } catch {
      throw new McpError(ErrorCode.InternalError, 'Tool discovery failed.');
    }
  });

  server.setRequestHandler(CallToolRequestSchema, async ({ params }, extra) => {
    try {
      if (!listTools().some((tool) => tool.name === params.name)) {
        return result(
          { ok: false, error: { code: 'UNKNOWN_TOOL', message: 'Unknown tool.' } },
          true,
        );
      }
      return result(await callTool(params.name, params.arguments ?? {}, { signal: extra.signal }));
    } catch (error) {
      return result({ ok: false, error: toolError(error) }, true);
    }
  });

  return server;
}
