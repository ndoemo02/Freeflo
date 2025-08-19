const KEY = "ff_cart_v1";
function load(){ try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } }
function save(a){ localStorage.setItem(KEY, JSON.stringify(a)); window.dispatchEvent(new Event("cart:update")); }

export function getCart(){ return load(); }
export function cartCount(){ return load().length; }
export function addToCart(item){ const a = load(); a.push(item); save(a); }
export function clearCart(){ save([]); }
