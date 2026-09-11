import { createServer } from "node:http";

const port = Number.parseInt(process.env.CUSTOMER_APP_PORT ?? "3000", 10);

createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ app: "customer", status: "ok" }));
    return;
  }

  response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  response.end("Avero customer app skeleton\n");
}).listen(port, () => {
  console.log(`Customer app listening on http://localhost:${port}`);
});
