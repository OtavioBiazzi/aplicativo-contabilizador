import type { ReactNode } from "react";

/**
 * 0.4.25: pecas comuns das telas de configuracao, no mesmo estilo da Privacidade:
 * blocos com titulo e explicacao curta, opcoes marcaveis com explicacao e campos com rotulo.
 */
export function SettingsBlock({ title, description, children, className = "" }: { title: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`settings-block ${className}`.trim()}>
    <header><strong>{title}</strong>{description && <small>{description}</small>}</header>
    <div className="settings-block-body">{children}</div>
  </section>;
}

export function SettingsCheck({ checked, onChange, label, hint, disabled, ariaLabel }: { checked: boolean; onChange: (checked: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean; ariaLabel?: string }) {
  return <label className="settings-option">
    <input type="checkbox" aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    <span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
  </label>;
}

export function SettingsField({ label, hint, children, wide }: { label: ReactNode; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  // A dica fica fora do <label> para nao entrar no nome acessivel do campo.
  return <div className={`settings-field ${wide ? "wide" : ""}`.trim()}>
    <label><span>{label}</span>{children}</label>
    {hint && <small>{hint}</small>}
  </div>;
}
