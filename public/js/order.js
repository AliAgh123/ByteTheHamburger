const page = document.querySelector('[data-order]');
const steps = page.querySelector('[data-status]');
const title = page.querySelector('[data-status-title]');

// Same headlines as TITLES in src/orders.js.
const TITLES = {
	received: 'Order <em>received.</em>',
	cooking: 'On the <em>grill.</em>',
	ready: 'Ready to <em>go.</em>',
	out_for_delivery: 'On the <em>way.</em>',
	delivered: 'Enjoy <em>it.</em>',
	collected: 'Enjoy <em>it.</em>',
	cancelled: 'Order <em>cancelled.</em>',
};
const DONE = ['delivered', 'collected', 'cancelled'];

// EventSource reconnects by itself if the connection drops.
const events = new EventSource(`/api/orders/${page.dataset.order}/events`);
events.onmessage = (e) => {
	const order = JSON.parse(e.data);
	if (order.status === steps.dataset.status) return;
	steps.dataset.status = order.status;
	title.innerHTML = TITLES[order.status];
	// fromTo with overwrite: a quick second update must not start from a half-faded title.
	window.gsap?.fromTo(title, { yPercent: 30, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.6, ease: 'power3.out', overwrite: true });
	if (DONE.includes(order.status)) events.close();
};
