import { useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import type { UpdateInfo } from "../shared/types";

/** Updates this installation through local IPC; never calls the PDV server. */
export function IndependentUpdater() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const run = async (install: boolean) => {
    if (busy) return;
    setBusy(true); setMessage(install ? "Baixando atualizacao..." : "Verificando atualizacao...");
    try {
      const next = install && info?.hasUpdate ? info : await window.caixa.checkForUpdates();
      setInfo(next);
      if (install && next.hasUpdate) {
        const result = await window.caixa.installUpdate(); setMessage(result.message);
      } else setMessage(next.message || (next.hasUpdate ? `Versao ${next.latestVersion} disponivel.` : "Este aplicativo esta atualizado."));
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Nao foi possivel atualizar. Confira a conexao com a internet."); }
    finally { setBusy(false); }
  };
  return <section className="startup-independent-updater" aria-label="Atualizacao deste computador">
    <strong>Atualizar este aplicativo</strong><p>A atualização usa a internet deste computador e funciona mesmo com o servidor desligado.</p>
    {info && <p>Versão instalada: {info.currentVersion} · Última versão: {info.latestVersion}</p>}
    <div className="startup-role-actions"><button disabled={busy} onClick={() => void run(false)}><RefreshCw size={16} /> Verificar atualização</button>{info?.hasUpdate && <button disabled={busy || !info.downloadUrl} onClick={() => void run(true)}><Download size={16} /> Baixar e instalar</button>}</div>
    {message && <p role="status">{message}</p>}
  </section>;
}
