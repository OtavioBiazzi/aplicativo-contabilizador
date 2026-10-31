const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
const methodLabels = (method?: string) => method ? [method, "Cartao " + method, "Cartao de " + method].map(normalized) : [];
/** Change only generated labels; arbitrary text and payment identification are preserved. */
export function adaptAutomaticDescription(value: string, previous: {table?: string | number; method?: string}, next: {table?: string | number; method?: string}): string {
  return value.split(" · ").map(part => {
    if (previous.method && next.method && previous.method !== next.method && methodLabels(previous.method).includes(normalized(part))) return next.method;
    const mesa = part.match(/^Mesa\s+(\d+)$/i);
    if (mesa && previous.table && Number(mesa[1]) === Number(previous.table) && String(next.table || "") !== String(previous.table)) return next.table ? "Mesa " + Number(next.table) : "Venda direta";
    return part;
  }).join(" · ");
}
