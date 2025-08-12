// cart.js
const CART_KEY = 'freeflow_cart_v1';

export function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) ?? []; }
  catch { return []; }
}

export function saveCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent('cart:update', { detail: items }));
}

export function addToCart(item) {
  const cart = getCart();
  cart.push({ id: crypto.randomUUID(), qty: 1, ...item });
  saveCart(cart);
}

export function removeFromCart(id) {
  saveCart(getCart().filter(i => i.id !== id));
}

export function clearCart() { saveCart([]); }

export function cartCount() { return getCart().reduce((n,i)=>n+(i.qty||1),0); }
