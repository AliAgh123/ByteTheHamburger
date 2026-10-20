const KEY = 'btb-cart';
const money = (cents) => `$${(cents / 100).toFixed(2)}`;

// Menu data comes from the cards the server rendered.
const menu = new Map(
	[...document.querySelectorAll('.menu-card')].map((card) => [
		Number(card.dataset.id),
		{ name: card.dataset.name, priceCents: Number(card.dataset.price) },
	]),
);

const load = () => {
	try {
		const saved = JSON.parse(localStorage.getItem(KEY)) || {};
		return Object.fromEntries(Object.entries(saved).filter(([id, q]) => menu.has(Number(id)) && q > 0));
	} catch {
		return {};
	}
};
let cart = load();
const save = () => {
	try {
		localStorage.setItem(KEY, JSON.stringify(cart));
	} catch {
		// Private mode or blocked storage: the cart still works for this visit.
	}
};

const drawer = document.querySelector('[data-cart]');
const openButton = document.querySelector('[data-cart-open]');
const linesEl = drawer.querySelector('[data-cart-lines]');
const form = drawer.querySelector('[data-cart-form]');
const errorEl = drawer.querySelector('[data-cart-error]');
const tableField = drawer.querySelector('[data-table-field]');
const deliveryFields = drawer.querySelectorAll('[data-delivery-field]');
const PAYMENT = {
	delivery: ['Cash on delivery', 'Pay the driver in cash. Delivery is free.'],
	pickup: ['Cash at the counter', 'Pay in cash when you collect your order.'],
	table: ['Cash at the counter', 'Pay in cash at the counter before you leave.'],
};

function render() {
	const entries = Object.entries(cart);
	const count = entries.reduce((s, [, q]) => s + q, 0);
	const total = entries.reduce((s, [id, q]) => s + q * menu.get(Number(id)).priceCents, 0);
	openButton.hidden = count === 0;
	document.querySelectorAll('[data-cart-count]').forEach((el) => (el.textContent = count));
	document.querySelectorAll('[data-cart-total]').forEach((el) => (el.textContent = money(total)));
	linesEl.innerHTML = entries.length
		? entries
				.map(([id, q]) => {
					const item = menu.get(Number(id));
					return `<li>
						<div><strong>${item.name}</strong><span>${money(item.priceCents * q)}</span></div>
						<div class="qty">
							<button type="button" data-step="-1" data-id="${id}" aria-label="One less ${item.name}">−</button>
							<span>${q}</span>
							<button type="button" data-step="1" data-id="${id}" aria-label="One more ${item.name}">+</button>
						</div>
					</li>`;
				})
				.join('')
		: '<li class="cart-empty">Nothing here yet. Add something from the menu.</li>';
	form.querySelector('.cart-submit').disabled = count === 0;
}

function change(id, step) {
	const q = Math.min(20, (cart[id] || 0) + step);
	if (q > 0) cart[id] = q;
	else delete cart[id];
	save();
	render();
}

const open = () => {
	drawer.hidden = false;
	requestAnimationFrame(() => drawer.classList.add('is-open'));
	form.querySelector('input[name="name"]').focus({ preventScroll: true });
};
const close = () => {
	drawer.classList.remove('is-open');
	setTimeout(() => (drawer.hidden = true), 300);
};

document.querySelectorAll('.menu-add').forEach((button) => {
	button.addEventListener('click', () => {
		change(button.closest('.menu-card').dataset.id, 1);
		openButton.classList.remove('is-bumped');
		void openButton.offsetWidth;
		openButton.classList.add('is-bumped');
	});
});
linesEl.addEventListener('click', (e) => {
	const button = e.target.closest('[data-step]');
	if (button) change(button.dataset.id, Number(button.dataset.step));
});
openButton.addEventListener('click', open);
drawer.querySelectorAll('[data-cart-close]').forEach((el) => el.addEventListener('click', close));
document.addEventListener('keydown', (e) => e.key === 'Escape' && !drawer.hidden && close());
function showFulfilment() {
	const way = form.fulfilment.value;
	tableField.hidden = way !== 'table';
	form.tableNumber.required = way === 'table';
	deliveryFields.forEach((field) => {
		field.hidden = way !== 'delivery';
		field.querySelector('input').required = way === 'delivery';
	});
	drawer.querySelector('[data-payment]').textContent = PAYMENT[way][0];
	drawer.querySelector('[data-payment-note]').textContent = PAYMENT[way][1];
}
form.addEventListener('change', showFulfilment);
showFulfilment();

form.addEventListener('submit', async (e) => {
	e.preventDefault();
	errorEl.textContent = '';
	const submit = form.querySelector('.cart-submit');
	submit.disabled = true;
	try {
		const res = await fetch('/api/orders', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: form.name.value,
				fulfilment: form.fulfilment.value,
				tableNumber: form.tableNumber.value ? Number(form.tableNumber.value) : undefined,
				address: form.address.value,
				phone: form.phone.value,
				note: form.note.value,
				items: Object.entries(cart).map(([id, quantity]) => ({ id: Number(id), quantity })),
			}),
		});
		const body = await res.json();
		if (!res.ok) throw new Error(body.error || 'The order could not be placed.');
		cart = {};
		save();
		window.location.href = `/orders/${body.code}`;
	} catch (err) {
		errorEl.textContent = err.message;
		submit.disabled = false;
	}
});

render();
