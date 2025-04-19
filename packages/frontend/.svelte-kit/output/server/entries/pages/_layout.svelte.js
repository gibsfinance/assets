import "clsx";
import { C as store_get, E as unsubscribe_stores, B as pop, z as push } from "../../chunks/index.js";
import "../../chunks/client.js";
import { w as writable } from "../../chunks/exports.js";
import { e as escape_html } from "../../chunks/escaping.js";
import { p as page } from "../../chunks/index2.js";
const replacements = {
  translate: /* @__PURE__ */ new Map([
    [true, "yes"],
    [false, "no"]
  ])
};
function attr(name, value, is_boolean = false) {
  if (value == null || !value && is_boolean) return "";
  const normalized = name in replacements && replacements[name].get(value) || value;
  const assignment = is_boolean ? "" : `="${escape_html(normalized, true)}"`;
  return ` ${name}${assignment}`;
}
function createThemeStore() {
  const { subscribe, set, update } = writable(false);
  return {
    subscribe,
    toggle: () => update((n) => !n),
    set: (value) => set(value)
  };
}
const isDark = createThemeStore();
function ThemeToggle($$payload, $$props) {
  push();
  var $$store_subs;
  const darkModeMessages = [
    "Embrace the darkness...",
    "Join the dark side!",
    "Time to go stealth",
    "Night mode activated",
    "Going incognito...",
    "Welcome to the shadows",
    "Dark mode is the way",
    "Stealth mode engaged",
    "Eyes will thank you",
    "Darkness beckons..."
  ];
  const lightModeMessages = [
    "MY EYES NEED THE LIGHT!",
    "Let there be light!",
    "Time to shine ✨",
    "Brightness intensifies",
    "Hello sunshine!",
    "Illumination activated",
    "Light side prevails",
    "Photons into my ojos",
    "Embrace the glow",
    "Power of the light!"
  ];
  const getRandomMessage = (messages) => {
    return messages[Math.floor(Math.random() * messages.length)];
  };
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", store_get($$store_subs ??= {}, "$isDark", isDark));
  }
  $$payload.out += `<button class="variant-ghost-surface btn-icon svelte-nwbosb"${attr("title", getRandomMessage(store_get($$store_subs ??= {}, "$isDark", isDark) ? lightModeMessages : darkModeMessages))}>`;
  if (store_get($$store_subs ??= {}, "$isDark", isDark)) {
    $$payload.out += "<!--[-->";
    $$payload.out += `<i class="fas fa-sun text-xl"></i>`;
  } else {
    $$payload.out += "<!--[!-->";
    $$payload.out += `<i class="fas fa-moon text-xl"></i>`;
  }
  $$payload.out += `<!--]--></button>`;
  if ($$store_subs) unsubscribe_stores($$store_subs);
  pop();
}
function _layout($$payload, $$props) {
  push();
  const { children } = $$props;
  const isWizardPage = page.url.pathname === "/wizard" || page.url.hash === "#/wizard";
  $$payload.out += `<div class="app min-h-full overflow-x-hidden bg-gradient-to-br from-gray-50 to-gray-100 dark:from-[#1a1f2b] dark:to-[#151821] svelte-11qgeaj"><header class="sticky top-0 z-50 border-b border-gray-200/50 bg-white/70 backdrop-blur-lg dark:border-surface-700/20 dark:bg-[#1a1f2b]/70 svelte-11qgeaj"><nav class="mx-auto p-4 svelte-11qgeaj"><div class="flex items-center justify-between svelte-11qgeaj"><a href="#/" class="font-space-grotesk group text-2xl font-bold tracking-tight transition-colors hover:text-[#00DC82] dark:text-white svelte-11qgeaj"><span class="transition-colors group-hover:text-[#00DC82] svelte-11qgeaj">Gib</span><span class="text-[#00DC82] svelte-11qgeaj">.Show</span></a> <div class="flex items-center gap-4 svelte-11qgeaj">`;
  if (!isWizardPage) {
    $$payload.out += "<!--[-->";
    $$payload.out += `<button class="btn bg-[#00DC82] text-black shadow-lg transition-all hover:-translate-y-0.5 hover:bg-[#00DC82]/80 svelte-11qgeaj"><i class="fas fa-hat-wizard mr-2 svelte-11qgeaj"></i> Wizard</button>`;
  } else {
    $$payload.out += "<!--[!-->";
  }
  $$payload.out += `<!--]--> `;
  ThemeToggle($$payload);
  $$payload.out += `<!----></div></div></nav></header> <main class="mx-auto svelte-11qgeaj">`;
  children?.($$payload);
  $$payload.out += `<!----></main></div>`;
  pop();
}
export {
  _layout as default
};
