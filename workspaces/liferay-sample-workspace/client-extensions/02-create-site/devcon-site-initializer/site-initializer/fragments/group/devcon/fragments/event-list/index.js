/*
 * Event List — fetches Events directly from the public headless object API and renders them
 * client side. A server side Collection element cannot do this job because it cannot filter by
 * date or format a DateTime value (see skills/manage-pages/SKILL.md -> "When a Collection Element
 * Cannot Do the Job").
 *
 * Requires Guest to hold company scope VIEW on the Event object (see resource-permissions.json).
 * Registration is intentionally NOT fetched here — Guest is write only on Registration, and a
 * fetch against data the visitor cannot read would silently return an empty/zero result rather
 * than an error (rules/guest-access.md -> "Never Compute From Data the Visitor Cannot Read").
 *
 * Remaining capacity is read from the Event object's own "spotsRemaining" field rather than
 * counted from registration rows. Guest is write only on Registration, so counting client side
 * would silently return zero rather than fail — the denormalized value on the public object is
 * what rules/guest-access.md -> "Never Compute From Data the Visitor Cannot Read" calls for.
 * The field is defined by the event-registration-batch client extension, alongside the Event
 * and Registration objects this site expects to already exist.
 */
(function () {
	var MONTH_NAMES = [
		'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
		'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
	];

	function pad(value) {
		return value < 10 ? '0' + value : String(value);
	}

	// DateTime fields are stored/returned as UTC ISO strings representing the venue's own wall
	// clock time. Read them with the UTC getters — the local getters would shift the displayed
	// time into whatever timezone the visitor's browser happens to be in (see
	// skills/manage-pages/SKILL.md -> "Read DateTime With the UTC Getters").
	function formatTime(date) {
		return pad(date.getUTCHours()) + ':' + pad(date.getUTCMinutes());
	}

	function formatMonthDay(date) {
		return MONTH_NAMES[date.getUTCMonth()] + ' ' + date.getUTCDate();
	}

	function isSameUTCDay(dateA, dateB) {
		return dateA.toUTCString().slice(0, 16) === dateB.toUTCString().slice(0, 16);
	}

	function formatDateRange(startDate, endDate) {
		var startYear = startDate.getUTCFullYear();
		var endYear = endDate.getUTCFullYear();

		if (isSameUTCDay(startDate, endDate)) {
			return (
				formatMonthDay(startDate) + ', ' + startYear + ' · ' +
				formatTime(startDate) + '–' + formatTime(endDate)
			);
		}

		if (startYear === endYear) {
			return formatMonthDay(startDate) + '–' + formatMonthDay(endDate) + ', ' + startYear;
		}

		return (
			formatMonthDay(startDate) + ', ' + startYear + ' – ' +
			formatMonthDay(endDate) + ', ' + endYear
		);
	}

	// Object field values arrive as strings often enough that comparing or subtracting one raw
	// is a silent wrong answer rather than an error, so parse before any arithmetic.
	function parseCount(value) {
		var parsed = parseInt(value, 10);

		return isNaN(parsed) ? 0 : parsed;
	}

	function escapeHtml(value) {
		var div = document.createElement('div');

		div.textContent = value === null || value === undefined ? '' : String(value);

		return div.innerHTML;
	}

	function renderCard(event, showCapacity) {
		var startDate = new Date(event.startDate);
		var endDate = new Date(event.endDate);

		var capacityMarkup = '';

		if (showCapacity && typeof event.capacity === 'number' && event.spotsRemaining !== undefined) {
			var remaining = parseCount(event.spotsRemaining);
			var isFull = remaining <= 0;

			capacityMarkup =
				'<span class="devcon-event-list__card-capacity' +
				(isFull ? ' devcon-event-list__card-capacity--full' : '') + '">' +
				(isFull
					? 'Fully booked'
					: escapeHtml(remaining) + ' of ' + escapeHtml(event.capacity) + ' spots remaining') +
				'</span>';
		}

		return (
			'<div class="devcon-event-list__card">' +
				'<h3 class="devcon-event-list__card-name">' + escapeHtml(event.name) + '</h3>' +
				'<p class="devcon-event-list__card-date">' + escapeHtml(formatDateRange(startDate, endDate)) + '</p>' +
				(event.location
					? '<p class="devcon-event-list__card-location">' + escapeHtml(event.location) + '</p>'
					: '') +
				capacityMarkup +
				'<a class="devcon-event-list__card-cta" href="/register?event=' +
					encodeURIComponent(event.externalReferenceCode || '') + '">Register &rarr;</a>' +
			'</div>'
		);
	}

	function init(rootElement) {
		var statusElement = rootElement.querySelector('[data-devcon-event-list-status]');
		var itemsElement = rootElement.querySelector('[data-devcon-event-list-items]');

		if (!statusElement || !itemsElement) {
			return;
		}

		var maxItems = parseCount(rootElement.getAttribute('data-max-items')) || 5;
		var upcomingOnly = rootElement.getAttribute('data-upcoming-only') === 'true';
		var showCapacity = rootElement.getAttribute('data-show-capacity') === 'true';
		var excludeERC = rootElement.getAttribute('data-exclude-erc') || '';

		var fetchFn =
			window.Liferay && Liferay.Util && Liferay.Util.fetch
				? Liferay.Util.fetch
				: window.fetch;

		fetchFn('/o/c/events?pageSize=100&sort=startDate:asc')
			.then(function (response) {
				if (!response.ok) {
					throw new Error('Request failed with status ' + response.status);
				}

				return response.json();
			})
			.then(function (data) {
				var now = new Date();

				var events = (data.items || []).filter(function (event) {
					if (excludeERC && event.externalReferenceCode === excludeERC) {
						return false;
					}

					if (!upcomingOnly) {
						return true;
					}

					return new Date(event.endDate) >= now;
				});

				events.sort(function (eventA, eventB) {
					return new Date(eventA.startDate) - new Date(eventB.startDate);
				});

				events = events.slice(0, maxItems);

				if (!events.length) {
					statusElement.textContent = 'No upcoming events at this time. Check back soon!';
					statusElement.removeAttribute('hidden');
					itemsElement.innerHTML = '';

					return;
				}

				statusElement.setAttribute('hidden', 'hidden');
				itemsElement.innerHTML = events
					.map(function (event) {
						return renderCard(event, showCapacity);
					})
					.join('');
			})
			.catch(function () {
				statusElement.textContent = 'Events could not be loaded right now. Please try again later.';
				statusElement.removeAttribute('hidden');
				itemsElement.innerHTML = '';
			});
	}

	var rootElement = fragmentNamespace.element.querySelector('.devcon-event-list-wrapper');

	if (rootElement) {
		init(rootElement);
	}
})();
