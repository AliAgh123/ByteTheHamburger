const board = document.querySelector('[data-kitchen]');
const live = board.querySelector('[data-kitchen-live]');
const orders = new Map();

const NEXT = {
	received: () => ['cooking', 'Start cooking'],
	cooking: () => ['ready', 'Mark ready'],
	ready: (o) => (o.fulfilment === 'delivery' ? ['out_for_delivery', 'Send out'] : ['collected', 'Collected']),
	out_for_delivery: () => ['delivered', 'Delivered'],
};
const WHERE = (o) =>
	o.fulfilment === 'delivery' ? 'Delivery, cash' : o.fulfilment === 'table' ? `Table ${o.tableNumber}` : 'Pickup';
const escape = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const minutesAgo = (iso) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));

function render() {
	board.querySelectorAll('[data-column]').forEach((column) => {
		const list = [...orders.values()].filter((o) => o.status === column.dataset.column);
		column.querySelector('[data-count]').textContent = list.length;
		column.querySelector('.kitchen-cards').innerHTML = list
			.map((o) => {
				const [next, label] = NEXT[o.status](o);
				return `<article class="ticket">
					<header><strong>#${o.number}</strong><span>${minutesAgo(o.createdAt)} min</span></header>
					<p class="ticket-who">${escape(o.name)} · ${WHERE(o)}</p>
					${o.fulfilment === 'delivery' ? `<p class="ticket-address">${escape(o.address)}<br>${escape(o.phone)}</p>` : ''}
					<ul>${o.items.map((i) => `<li><b>${i.quantity}×</b> ${escape(i.name)}</li>`).join('')}</ul>
					${o.note ? `<p class="ticket-note">${escape(o.note)}</p>` : ''}
					<div class="ticket-actions">
						<button class="btn btn-small" data-code="${o.code}" data-status="${next}">${label}</button>
						${['received', 'cooking'].includes(o.status) ? `<button class="btn btn-small btn-ghost" data-code="${o.code}" data-status="cancelled">Cancel</button>` : ''}
					</div>
				</article>`;
			})
			.join('') || '<p class="kitchen-empty">No orders</p>';
	});
}

function upsert(order) {
	if (['received', 'cooking', 'ready', 'out_for_delivery'].includes(order.status)) orders.set(order.code, order);
	else orders.delete(order.code);
	render();
}

board.addEventListener('click', async (e) => {
	const button = e.target.closest('button[data-code]');
	if (!button) return;
	button.disabled = true;
	const res = await fetch(`/api/kitchen/orders/${button.dataset.code}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ status: button.dataset.status }),
	});
	if (res.ok) upsert(await res.json());
	else button.disabled = false;
});

async function refresh() {
	const res = await fetch('/api/kitchen/orders');
	orders.clear();
	(await res.json()).forEach((o) => orders.set(o.code, o));
	render();
}

const events = new EventSource('/api/kitchen/events');
events.onopen = () => {
	live.textContent = 'Live';
	live.classList.add('is-live');
	refresh();
};
events.onerror = () => {
	live.textContent = 'Reconnecting…';
	live.classList.remove('is-live');
};
events.onmessage = (e) => upsert(JSON.parse(e.data));
setInterval(render, 30000);
