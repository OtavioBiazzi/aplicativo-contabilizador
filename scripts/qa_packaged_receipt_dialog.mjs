/* Test-only native save dialog on an explicitly isolated packaged application. */
const port = Number(process.argv[2]);
if (![9441, 9442].includes(port)) throw Error("Expected isolated release inspector port");
const targets = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
try {
  const expression = String.raw`(() => {
    const load = process.getBuiltinModule("module").createRequire(process.cwd() + "/qa-release.cjs");
    const {app, dialog} = load("electron");
    const fs = load("node:fs"), path = load("node:path");
    const userData = app.getPath("userData");
    if (!userData.replaceAll("\\", "/").includes("/outputs/qa-release-0.4.13/")) throw Error("Isolated release profile required");
    if (app.getVersion() !== "0.4.13") throw Error("Wrong packaged version");
    const out = path.join(userData, "receipt-output");
    fs.mkdirSync(out, {recursive:true});
    let count = 0;
    dialog.showSaveDialog = async () => ({canceled:false,filePath:path.join(out, "receipt-" + (++count) + ".pdf")});
    return {version:app.getVersion(),isolated:true};
  })()`;
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Inspector request timed out")), 15000);
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timer);
      if (message.error || message.result?.exceptionDetails) reject(Error(JSON.stringify(message.error || message.result.exceptionDetails)));
      else resolve(message.result?.result?.value);
    };
    socket.send(JSON.stringify({id:1,method:"Runtime.evaluate",params:{expression,returnByValue:true,awaitPromise:true}}));
  });
  console.log(JSON.stringify(result));
} finally { socket.close(); }
