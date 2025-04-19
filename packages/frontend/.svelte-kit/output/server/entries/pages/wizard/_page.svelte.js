import "clsx";
import { A as setContext, F as getContext, I as copy_payload, J as assign_payload, B as pop, z as push } from "../../../chunks/index.js";
import _ from "lodash";
import "../../../chunks/settings.svelte.js";
import "promise-limit";
import "../../../chunks/client.js";
const SvelteMap = globalThis.Map;
const tokensByList = new SvelteMap();
function createContext(defaultValue) {
  var key = Symbol();
  var set = function(value) {
    return setContext(key, value);
  };
  var get = function() {
    var _a2;
    return (_a2 = getContext(key)) !== null && _a2 !== void 0 ? _a2 : defaultValue;
  };
  return [set, get, key];
}
var _a$3;
_a$3 = createContext(), _a$3[0];
_a$3[1];
_a$3[2];
var _a$2;
_a$2 = createContext({
  parent: "none",
  value: "",
  expanded: false
}), _a$2[0];
_a$2[1];
_a$2[2];
var _a$1;
_a$1 = createContext({
  api: {},
  indicatorText: ""
}), _a$1[0];
_a$1[1];
_a$1[2];
var _a;
_a = createContext({
  fluid: false,
  api: {}
}), _a[0];
_a[1];
_a[2];
function _page($$payload, $$props) {
  push();
  let selectedChain = null;
  const list = Array.from(tokensByList.entries());
  const underChain = getListsWithTokensForChain(list, selectedChain);
  underChain.length;
  _(underChain).flatMap(([, tkns]) => tkns).uniqBy((v) => v.address.toLowerCase()).value().length;
  function getListsWithTokensForChain(list2, selectedChain2) {
    return list2.filter(([_2, tokens]) => {
      const tokensForNetwork = tokens.filter((token) => token.chainId === selectedChain2);
      return tokensForNetwork.length > 0;
    });
  }
  let $$settled = true;
  let $$inner_payload;
  function $$render_inner($$payload2) {
    {
      $$payload2.out += "<!--[-->";
      $$payload2.out += `<div class="flex min-h-screen items-center justify-center"><div class="space-y-4 text-center"><div class="loading loading-spinner loading-lg"></div> <p>Initializing...</p></div></div>`;
    }
    $$payload2.out += `<!--]-->`;
  }
  do {
    $$settled = true;
    $$inner_payload = copy_payload($$payload);
    $$render_inner($$inner_payload);
  } while (!$$settled);
  assign_payload($$payload, $$inner_payload);
  pop();
}
export {
  _page as default
};
