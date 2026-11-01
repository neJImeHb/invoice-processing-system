import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import type { ProxyOptions } from "vite";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

export function createStreamProxy(target: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    selfHandleResponse: true,
    configure(proxy) {
      proxy.on("proxyRes", (proxyRes, _req, res) => {
        try {
          writeUpstreamChunks(proxyRes, res);
        } catch (error) {
          console.error(error);
          if (!res.writableEnded) {
            res.end();
          }
        }
      });
    },
  };
}

function writeUpstreamChunks(upstream: IncomingMessage, downstream: ServerResponse): void {
  if (downstream.headersSent) {
    console.error(new Error("Stream proxy headers were already sent"));
    return;
  }
  downstream.socket?.setNoDelay(true);
  const headers = responseHeaders(upstream);
  downstream.writeHead(statusCode(upstream), headers);
  // The dev-server response stays corked after writeHead, which holds SSE headers until the body ends.
  downstream.flushHeaders();
  upstream.on("data", (chunk: unknown) => {
    writeChunk(upstream, downstream, chunk);
  });
  upstream.on("end", () => {
    endDownstream(downstream);
  });
  upstream.on("error", (error: Error) => {
    console.error(error);
    endDownstream(downstream);
  });
  downstream.on("error", (error: Error) => {
    console.error(error);
  });
}

function statusCode(upstream: IncomingMessage): number {
  if (upstream.statusCode !== undefined && upstream.statusCode >= 100) {
    return upstream.statusCode;
  }
  return 502;
}

function responseHeaders(upstream: IncomingMessage): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(upstream.headers)) {
    if (value !== undefined && !HOP_BY_HOP.has(name)) {
      headers[name] = value;
    }
  }
  headers["x-accel-buffering"] = "no";
  return headers;
}

function writeChunk(upstream: IncomingMessage, downstream: ServerResponse, chunk: unknown): void {
  if (downstream.writableEnded || !isWritableChunk(chunk)) {
    return;
  }
  if (downstream.write(chunk)) {
    return;
  }
  upstream.pause();
  downstream.once("drain", () => {
    upstream.resume();
  });
}

function endDownstream(downstream: ServerResponse): void {
  if (!downstream.writableEnded) {
    downstream.end();
  }
}

function isWritableChunk(chunk: unknown): chunk is string | Buffer {
  return typeof chunk === "string" || Buffer.isBuffer(chunk);
}
