import { useRef, type SelectHTMLAttributes } from "react";
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
/** Prefix search resets after a pause; arrows, Tab and native screen-reader semantics remain intact. */
export function KeyboardSelect({onKeyDown, ...props}: SelectHTMLAttributes<HTMLSelectElement>) {
  const typed = useRef({text: "", at: 0});
  return <select {...props} onKeyDown={event => {
    onKeyDown?.(event);
    if (event.key === "F2") {
      const button = event.currentTarget.closest(".financial-customer-picker")?.querySelector<HTMLButtonElement>(".lookup-manage-button");
      if (button && !button.disabled) { event.preventDefault(); event.stopPropagation(); button.click(); return; }
    }
    if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.key.length !== 1 || event.key === " ") { if(event.key === "Tab") typed.current.text = ""; return; }
    const now = Date.now(), letter = normalize(event.key);
    const prefix = now - typed.current.at > 900 ? letter : typed.current.text + letter;
    typed.current = {text: prefix, at: now};
    const option = [...event.currentTarget.options].find(item => !item.disabled && normalize(item.text).startsWith(prefix));
    if (!option) return;
    event.preventDefault();
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    setter.call(event.currentTarget, option.value);
    event.currentTarget.dispatchEvent(new Event("change", {bubbles: true}));
  }} />;
}
