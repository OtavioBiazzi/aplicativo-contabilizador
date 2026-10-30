import { useState } from "react";
import { Copy, Plus, ShieldCheck, Trash2 } from "lucide-react";
import type { HistoryPrivacyMode, PrivacyProfile, PrivacySettings } from "../shared/types";
import { applyPrivacyProfile, privacyEnabled, privacyProfiles } from "../shared/privacy";

export function PrivacyProfiles({ value, onChange, readOnly = false }: { readOnly?: boolean; value: PrivacySettings; onChange: (value: PrivacySettings) => void }) {
  const profiles = privacyProfiles(value);
  const [selectedId, setSelectedId] = useState(value.activeProfileId || "current");
  const selected = profiles.find((item) => item.id === selectedId) || profiles[0];
  const currentId = value.activeProfileId || "current";
  const patchProfile = (patch: Partial<PrivacyProfile>) => {
    const next = { ...value, profiles: profiles.map((item) => item.id === selected.id ? { ...item, ...patch } : item) };
    onChange(currentId === selected.id ? applyPrivacyProfile(next, selected.id) : next);
  };
  const createProfile = (duplicate: boolean) => {
    const profile: PrivacyProfile = { ...selected, id: crypto.randomUUID(), name: duplicate ? `${selected.name} (cópia)` : `Meu perfil ${profiles.length + 1}` };
    onChange({ ...value, profiles: [...profiles, profile] }); setSelectedId(profile.id);
  };
  const remove = () => {
    if (profiles.length <= 1) return;
    const remaining = profiles.filter((item) => item.id !== selected.id);
    const fallback = remaining[0].id;
    const next = { ...value, profiles: remaining, disabledProfileId: (value.disabledProfileId || "normal") === selected.id ? fallback : value.disabledProfileId, enabledProfileId: (value.enabledProfileId || "private") === selected.id ? fallback : value.enabledProfileId };
    onChange(currentId === selected.id ? applyPrivacyProfile(next, fallback) : next); setSelectedId(fallback);
  };
  const options = profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name || "Sem nome"}</option>);
  return <div className="privacy-profiles">
    <fieldset className="privacy-profile-definitions" disabled={readOnly}><div className="privacy-profile-switches">
      <label><span>Ao ativar privacidade no Total do Dia</span><select value={value.enabledProfileId || "private"} onChange={(event) => { const next = { ...value, profiles, enabledProfileId: event.target.value }; onChange(privacyEnabled(value) ? applyPrivacyProfile(next, event.target.value) : next); }}>{options}</select></label>
      <label><span>Ao desativar privacidade no Total do Dia</span><select value={value.disabledProfileId || "normal"} onChange={(event) => { const next = { ...value, profiles, disabledProfileId: event.target.value }; onChange(!privacyEnabled(value) ? applyPrivacyProfile(next, event.target.value) : next); }}>{options}</select></label>
    </div>
    </fieldset>
    <div className="privacy-profile-toolbar"><label><span>Perfil para editar</span><select value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>{options}</select></label><button disabled={readOnly} onClick={() => createProfile(false)}><Plus size={15} /> Novo</button><button disabled={readOnly} onClick={() => createProfile(true)}><Copy size={15} /> Duplicar</button><button disabled={readOnly || profiles.length <= 1} onClick={remove}><Trash2 size={15} /> Excluir</button></div>
    <section className="privacy-profile-editor">
      <label><span>Nome do perfil</span><input disabled={readOnly} value={selected.name} onChange={(event) => patchProfile({ name: event.target.value })} /></label>
      <label><span>Valores no Caixa / Histórico</span><select disabled={readOnly} value={selected.historyValues} onChange={(event) => patchProfile({ historyValues: event.target.value as HistoryPrivacyMode })}><option value="show">Sempre visíveis</option><option value="search">Visíveis somente durante uma pesquisa</option><option value="hide">Sempre ocultos</option></select></label>
      <label className="privacy-profile-check"><input disabled={readOnly} type="checkbox" checked={selected.hideHeaderTotal} onChange={(event) => patchProfile({ hideHeaderTotal: event.target.checked })} /> Ocultar Total do Dia</label>
      <label className="privacy-profile-check"><input disabled={readOnly} type="checkbox" checked={selected.hideReportTotals} onChange={(event) => patchProfile({ hideReportTotals: event.target.checked })} /> Ocultar totais no Histórico, relatórios e Visão Geral</label>
      <div className="privacy-profile-apply"><span><ShieldCheck size={16} />{currentId === selected.id ? "Este perfil está em uso" : "Alterações salvas automaticamente"}</span><button onClick={() => onChange(applyPrivacyProfile(value, selected.id, selected.id !== (value.disabledProfileId || "normal")))}>Usar este perfil agora</button></div>
    </section>
    <p className="settings-note">{readOnly ? "O servidor define os perfis. Ativar ou desativar a privacidade neste computador é independente dos outros computadores. " : "As definições dos perfis são enviadas aos clientes, que ativam a privacidade de forma independente. "}O padrão oculta os totais e mantém os lançamentos, detalhes e recibos acessíveis. A opção de valores do Histórico controla cada lançamento; a pesquisa considera Buscar e Mesa exata. As permissões do servidor continuam valendo.</p>
  </div>;
}
