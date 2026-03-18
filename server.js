const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8080;
const ROOT = __dirname;

const MIME = {
  ".html": "text/html",
  ".js":   "text/javascript",
  ".css":  "text/css",
  ".csv":  "text/csv",
  ".json": "application/json",
};

http.createServer((req, res) => {
  if (req.url === "/api/csvs") {
    fs.readdir(path.join(ROOT, "data"), (err, files) => {
      if (err) { res.writeHead(500); res.end("Could not read data directory"); return; }
      const csvs = files.filter((f) => f.endsWith(".csv")).sort();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(csvs));
    });
    return;
  }

  const filePath = path.join(ROOT, req.url === "/" ? "index.html" : req.url);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Timeline running at http://localhost:${PORT}`));
