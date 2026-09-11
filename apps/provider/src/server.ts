import { createServer } from "node:http";

const port = Number.parseInt(process.env.PROVIDER_APP_PORT ?? "3001", 10);

createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ app: "provider", status: "ok" }));
    return;
  }

  response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  response.end("Avero provider app skeleton\n");
}).listen(port, () => {
  console.log(`Provider app listening on http://localhost:${port}`);
});
