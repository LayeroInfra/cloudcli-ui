// Vite HMR for the CloudUI working copy, served on a unix socket for the
// gateway; the API still goes to the release server on :3002.
// Rendered by infra/vm/install.sh (@REPO@ = the working copy).
import {createServer as createVite} from "@REPO@/node_modules/vite/dist/node/index.js";
import {createServer} from "node:http";
import {rmSync} from "node:fs";
import {homedir} from "node:os";

const root = "@REPO@";
const socket = homedir() + "/.local/state/cloudcli-live/ui.sock";
rmSync(socket, {force: true});
const http = createServer();
const vite = await createVite({
  root,
  server: {
    middlewareMode: {server: http},
    hmr: {server: http, clientPort: 13003},
    warmup: {clientFiles: ["./index.html", "./src/main.tsx"]},
  },
});
http.on("request", vite.middlewares);
http.listen(socket);
console.log("cloudui-live root=" + root);
