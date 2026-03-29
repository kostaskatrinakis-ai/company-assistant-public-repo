import { createServer, Server } from "node:http";
import { env } from "@/shared/config/env";

// Keep a global reference to avoid memory leaks during Next.js hot reloads (dev mode)
const globalForServer = globalThis as unknown as {
  __codexCallbackServer?: Server;
};

export function ensureCodexCallbackServerRunning() {
  if (globalForServer.__codexCallbackServer) {
    return;
  }

  const appBase = env.appBaseUrl ?? "http://localhost:3000";

  const server = createServer((req, res) => {
    try {
      if (!req.url) {
        res.writeHead(404);
        res.end();
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host}`);

      // OpenAI Codex OAuth redirects here
      if (url.pathname === "/auth/callback") {
        // Forward the code and state to our Next.js API route
        const target = `${appBase.replace(
          /\/$/,
          "",
        )}/api/assistant/codex-auth-callback${url.search}`;
        
        // Return an HTML page that redirects the browser to the target
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta http-equiv="refresh" content="0;url=${target}">
              <title>Redirecting...</title>
            </head>
            <body>
              <p>Authentication successful. Redirecting back to app...</p>
              <script>window.location.href = "${target}";</script>
            </body>
          </html>
        `);
      } else {
        res.writeHead(404);
        res.end();
      }
    } catch (err) {
      console.error("[codex-callback-server] Error handling request:", err);
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.log(
        "[codex-callback-server] Port 1455 is already in use. Assuming it is our callback server.",
      );
    } else {
      console.error(
        "[codex-callback-server] Failed to start callback server on 1455:",
        err,
      );
    }
  });

  server.listen(1455, "localhost", () => {
    console.log(
      "[codex-callback-server] Listening for OpenAI redirects on http://localhost:1455/auth/callback",
    );
  });

  globalForServer.__codexCallbackServer = server;
}
