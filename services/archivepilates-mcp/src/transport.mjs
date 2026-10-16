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
    { capabilities: { tools: {} }, instructions: 'ARCHIVE PILATES 운영자용 조회 전용 도구입니다. members_find로 원본 회원을 선택하세요. 회원·현재 수강권·예약과 members_list_expiring의 기본 조회는 StudioMate 실시간 화면 기준이며 로그인·잠금·조회 실패를 저장 자료로 대체하지 않습니다. 예약은 요청 기간의 출석·취소를 포함한 전체 상태를 확인합니다. 조건별 목록은 원본 회원 총수·페이지·중복을 검증한 조회 시간 구간의 결과이며 단일 시점의 원장 스냅샷이 아닙니다. source=snapshot을 명시한 경우에만 기존 동기화 자료를 조회하며 5분 캐시를 원본 확인시각으로 해석하지 마세요. 계약·알림톡·작업은 저장 원장이며 실시간으로 단정하지 마세요. liveReadback·checkedAt·sourceWindow·coverage·ambiguousMembers를 확인하세요. 모든 도구는 조회 전용이며 결과를 예약·환불·발송 실행 대상으로 직접 사용하지 마세요. 후보·큐·접수·최종 전달·서명은 다릅니다. 오류·한도·부분 조회를 대상 없음으로 해석하지 마세요. 회원 변경·예약·취소·발송은 지원하지 않습니다. 개인정보는 최소한만 요약하세요.' },
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
