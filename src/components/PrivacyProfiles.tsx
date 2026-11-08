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
    <section className="privacy-block">
      <header><strong>Total do dia neste computador</strong><small>O que acontece ao clicar em Mostrar ou Esconder valores na caixa do Total do dia.</small></header>
      <fieldset className="privacy-profile-definitions" disabled={readOnly}><div className="privacy-profile-switches">
        <label><span>Ao esconder valores, usar o perfil</span><select value={value.enabledProfileId || "private"} onChange={(event) => { const next = { ...value, profiles, enabledProfileId: event.target.value }; onChange(privacyEnabled(value) ? applyPrivacyProfile(next, event.target.value) : next); }}>{options}</select></label>
        <label><span>Ao mostrar valores, usar o perfil</span><select value={value.disabledProfileId || "normal"} onChange={(event) => { const next = { ...value, profiles, disabledProfileId: event.target.value }; onChange(!privacyEnabled(value) ? applyPrivacyProfile(next, event.target.value) : next); }}>{options}</select></label>
      </div></fieldset>
      <label className="privacy-option">
        <input type="checkbox" checked={Boolean(value.totalInMenuOnly)} onChange={(event) => onChange({ ...value, totalInMenuOnly: event.target.checked })} />
        <span><strong>Mostrar o valor só dentro da caixinha</strong><small>O topo mostra Hoje e os lançamentos; o valor (ou Privado) fica embaixo, na caixa que abre ao clicar. Vale só para este computador.</small></span>
      </label>
    </section>
    <section className="privacy-block">
      <header><strong>Perfis de privacidade</strong><small>Cada perfil diz o que fica escondido. {readOnly ? "Neste cliente, os perfis vêm do servidor." : "Os perfis são enviados aos clientes."}</small></header>
      <div className="privacy-profile-toolbar"><label><span>Perfil para editar</span><select value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>{options}</select></label><button disabled={readOnly} onClick={() => createProfile(false)}><Plus size={15} /> Novo</button><button disabled={readOnly} onClick={() => createProfile(true)}><Copy size={15} /> Duplicar</button><button disabled={readOnly || profiles.length <= 1} onClick={remove}><Trash2 size={15} /> Excluir</button></div>
      <div className="privacy-profile-editor">
        <label><span>Nome do perfil</span><input disabled={readOnly} value={selected.name} onChange={(event) => patchProfile({ name: event.target.value })} /></label>
        <label><span>Valores no Caixa / Histórico</span><select disabled={readOnly} value={selected.historyValues} onChange={(event) => patchProfile({ historyValues: event.target.value as HistoryPrivacyMode })}><option value="show">Sempre visíveis</option><option value="search">Visíveis somente durante uma pesquisa</option><option value="hide">Sempre ocultos</option></select></label>
        <label className="privacy-profile-check"><input disabled={readOnly} type="checkbox" checked={selected.hideHeaderTotal} onChange={(event) => patchProfile({ hideHeaderTotal: event.target.checked })} /> Ocultar Total do Dia</label>
        <label className="privacy-profile-check"><input disabled={readOnly} type="checkbox" checked={selected.hideReportTotals} onChange={(event) => patchProfile({ hideReportTotals: event.target.checked })} /> Ocultar totais no Histórico, relatórios e Visão Geral</label>
        <div className="privacy-profile-apply"><span><ShieldCheck size={16} />{currentId === selected.id ? "Este perfil está em uso" : "Alterações salvas automaticamente"}</span><button onClick={() => onChange(applyPrivacyProfile(value, selected.id, selected.id !== (value.disabledProfileId || "normal")))}>Usar este perfil agora</button></div>
      </div>
      <p className="settings-note">O padrão esconde os totais e mantém lançamentos, detalhes e recibos acessíveis. "Valores no Caixa / Histórico" vale para cada lançamento; a pesquisa considera Buscar e Mesa exata. As permissões do servidor continuam valendo.</p>
    </section>
  </div>;
}
