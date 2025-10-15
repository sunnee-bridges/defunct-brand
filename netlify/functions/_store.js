// netlify/functions/_store.js
import { createClient } from '@netlify/blobs';

const client = createClient();

function ordersStore() {
  // "orders" is the bucket name inside Blobs; it’s created on first write
  return client.store('orders');
}

export async function getOrder(orderID) {
  const store = ordersStore();
  const text = await store.get(orderID);
  return text ? JSON.parse(text) : null;
}

export async function putOrder(orderID, data) {
  const store = ordersStore();
  await store.set(orderID, JSON.stringify(data), { contentType: 'application/json; charset=utf-8' });
  return data;
}

export async function upsertOrder(orderID, patch) {
  const prev = (await getOrder(orderID)) || {};
  const next = { ...prev, ...patch, updatedAt: Date.now() };
  await putOrder(orderID, next);
  return next;
}
