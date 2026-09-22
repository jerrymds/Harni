/**
 * Mock MCP server used by the agent-core test suite.
 * Implements the MCP protocol over stdio (Content-Length framed JSON-RPC 2.0):
 *   initialize        → { protocolVersion, capabilities, serverInfo }
 *   notifications/initialized → (no response)
 *   tools/list        → two demo tools: `add` and `echo`
 *   tools/call        → executes the demo tool and returns an MCP result
 *
 * Run directly with: node tests/mockMcpServer.js
 */

'use strict';

let buffer = '';
let nextId = 0;

function writeMessage(obj) {
  const json = JSON.stringify(obj);
  process.stdout.write(`${json}\n`);
}

function handlePayload(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (!msg || typeof msg !== 'object') return;

  const method = msg.method;
  const id = msg.id;

  // Notifications don't carry an id and never get a response.
  if (id === undefined || id === null) {
    return;
  }

  try {
    switch (method) {
      case 'initialize':
        writeMessage({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'mock-mcp-server', version: '1.0.0' },
          },
        });
        break;

      case 'tools/list':
        writeMessage({
          jsonrpc: '2.0',
          id,
          result: {
            tools: [
              {
                name: 'add',
                description: 'Adds two numbers and returns the sum',
                inputSchema: {
                  type: 'object',
                  properties: {
                    a: { type: 'number', description: 'First operand' },
                    b: { type: 'number', description: 'Second operand' },
                  },
                  required: ['a', 'b'],
                },
              },
              {
                name: 'echo',
                description: 'Echoes the provided text back',
                inputSchema: {
                  type: 'object',
                  properties: {
                    text: { type: 'string', description: 'Text to echo' },
                  },
                  required: ['text'],
                },
              },
            ],
          },
        });
        break;

      case 'tools/call': {
        const name = msg.params && msg.params.name;
        const args = (msg.params && msg.params.arguments) || {};
        if (name === 'add') {
          const sum = Number(args.a) + Number(args.b);
          writeMessage({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: String(sum) }],
              structuredContent: { sum },
            },
          });
        } else if (name === 'echo') {
          writeMessage({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: String(args.text || '') }],
            },
          });
        } else {
          writeMessage({
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: `Unknown tool: ${name}` },
          });
        }
        break;
      }

      default:
        writeMessage({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
    }
  } catch (err) {
    writeMessage({
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: err.message || String(err) },
    });
  }
}

function tryParse() {
  while (buffer.length > 0) {
    const trimmedStart = buffer.search(/\S/);
    if (trimmedStart === -1) {
      buffer = '';
      return;
    }
    if (trimmedStart > 0) {
      buffer = buffer.slice(trimmedStart);
    }

    if (/^content-length:/i.test(buffer)) {
      const headerEndMatch = /(\r?\r?\n\r?\r?\n)/.exec(buffer);
      if (!headerEndMatch) return;

      const headerEnd = headerEndMatch.index;
      const sepLen = headerEndMatch[0].length;
      const header = buffer.slice(0, headerEnd);
      const m = /^content-length:\s*(\d+)/i.exec(header);
      if (!m) {
        buffer = buffer.slice(headerEnd + sepLen);
        continue;
      }

      const len = parseInt(m[1], 10);
      const start = headerEnd + sepLen;
      if (Buffer.byteLength(buffer.slice(start), 'utf8') < len) return;

      const byteBuf = Buffer.from(buffer, 'utf8');
      const headerBytes = Buffer.byteLength(buffer.slice(0, start), 'utf8');
      const payload = byteBuf.subarray(headerBytes, headerBytes + len).toString('utf8');
      buffer = byteBuf.subarray(headerBytes + len).toString('utf8');
      handlePayload(payload);
      continue;
    }

    const newlineIdx = buffer.indexOf('\n');
    if (newlineIdx === -1) return;

    const line = buffer.slice(0, newlineIdx).trim();
    buffer = buffer.slice(newlineIdx + 1);
    if (line.startsWith('{') && line.endsWith('}')) {
      handlePayload(line);
    }
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  tryParse();
});
process.stdin.on('end', () => process.exit(0));
process.stdin.on('error', () => process.exit(0));