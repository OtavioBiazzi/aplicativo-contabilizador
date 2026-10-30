/* Isolated app fixture. All OS print jobs and external PDF opening are intercepted. */
const {app, shell, dialog, protocol} = require("electron");
protocol.registerSchemesAsPrivileged([{scheme:"app",privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
protocol.registerSchemesAsPrivileged = () => {};
const fs = require("node:fs");
const path = require("node:path");
const data = path.resolve(process.env.CAIXA_DATA_DIR || "");
if (!data.replaceAll("\\", "/").includes("/outputs/qa-ledger-actions/")) throw Error("Isolated receipt test directory required");
const logs = path.join(data, "print-probe");
fs.mkdirSync(logs, {recursive:true});
app.getVersion = () => require("../package.json").version;
shell.openPath = async file => {
  fs.appendFileSync(path.join(logs, "opened.jsonl"), JSON.stringify({file}) + "\n");
  return "";
};
dialog.showSaveDialog = async () => ({canceled:false,filePath:path.join(logs,"saved-receipt.pdf")});
app.on("web-contents-created", (_event, wc) => {
  wc.getPrintersAsync = async () => [{name:"QA_QUEUE_NO_PAPER",displayName:"Impressora QA (simulada)",isDefault:true}];
  wc.print = (options, callback) => {
    fs.appendFileSync(path.join(logs,"jobs.jsonl"),JSON.stringify(options)+"\n");
    const failed = fs.existsSync(path.join(logs,"fail-print"));
    callback(!failed, failed ? "Impressora QA indisponivel" : "");
  };
});
void import("../dist-electron/electron/main.js");
