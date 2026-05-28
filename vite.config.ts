import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const PROXY_PREFIX = "/__proxy/";

/**
 * Dev-only HTTP forwarder: requests to /__proxy/<target-url> are pipelined
 * to <target-url> from the Node side, side-stepping the browser's same-origin
 * fetch restrictions. The path after the prefix is the literal absolute URL
 * (protocol + host + path + query) the client wanted to reach.
 *
 * Headers, method, and body are forwarded verbatim. Response status/headers/
 * body are streamed back. No caching, no rewriting.
 *
 * Production builds and Tauri builds bypass this and call the target directly.
 */
function corsProxyPlugin(): Plugin {
  return {
    name: "api-client-cors-proxy",
    configureServer(server) {
      const handler: Connect.NextHandleFunction = (req, res, next) => {
        if (!req.url || !req.url.startsWith(PROXY_PREFIX)) {
          next();
          return;
        }
        const target = req.url.slice(PROXY_PREFIX.length);
        if (!target) {
          res.statusCode = 400;
          res.end("Missing proxy target");
          return;
        }
        let targetUrl: URL;
        try {
          targetUrl = new URL(target);
        } catch {
          res.statusCode = 400;
          res.end(`Invalid proxy target: ${target}`);
          return;
        }
        if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
          res.statusCode = 400;
          res.end(`Unsupported protocol: ${targetUrl.protocol}`);
          return;
        }

        // Strip hop-by-hop and host-binding headers; forward everything else.
        const forwardHeaders: http.OutgoingHttpHeaders = {};
        for (const [name, value] of Object.entries(req.headers)) {
          if (value === undefined) continue;
          const lower = name.toLowerCase();
          if (
            lower === "host" ||
            lower === "connection" ||
            lower === "content-length" ||
            lower === "accept-encoding" ||
            lower === "origin" ||
            lower === "referer"
          ) {
            continue;
          }
          forwardHeaders[name] = value;
        }
        forwardHeaders.host = targetUrl.host;

        const client = targetUrl.protocol === "https:" ? https : http;
        const upstream = client.request(
          {
            protocol: targetUrl.protocol,
            hostname: targetUrl.hostname,
            port: targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
            path: `${targetUrl.pathname}${targetUrl.search}`,
            method: req.method,
            headers: forwardHeaders,
          },
          (upstreamRes) => {
            res.statusCode = upstreamRes.statusCode ?? 502;
            for (const [name, value] of Object.entries(upstreamRes.headers)) {
              if (value === undefined) continue;
              if (name.toLowerCase() === "content-encoding" || name.toLowerCase() === "transfer-encoding") {
                continue;
              }
              res.setHeader(name, value as string | string[]);
            }
            // Surface real upstream status via custom header so the client can
            // distinguish proxy errors from upstream errors when needed.
            res.setHeader("x-proxy-upstream-status", String(upstreamRes.statusCode ?? 0));
            upstreamRes.pipe(res);
          },
        );
        upstream.on("error", (err) => {
          res.statusCode = 502;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "Proxy upstream failed", message: err.message }));
        });
        req.pipe(upstream);
      };
      server.middlewares.use(handler);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    corsProxyPlugin(),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
