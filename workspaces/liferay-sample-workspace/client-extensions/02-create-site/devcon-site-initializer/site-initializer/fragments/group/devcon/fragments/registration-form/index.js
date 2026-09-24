/*
 * Registration Form — submits a new Registration object entry referencing the chosen Event by
 * its external reference code (r_eventRegistrations_c_eventERC), matching the field the
 * Event <-> Registration object relationship puts on Registration (see
 * rules/site-initializer-format.md -> "object-relationships/<name>.json").
 *
 * The Event and Registration object definitions already existed before this site was built (the
 * user's own instance had them published — this tree only reuses them; it never created or
 * redefined them). VERIFIED against the live objects themselves
 * (GET /o/object-admin/v1.0/object-definitions/{id}/object-fields, and a live GET of an existing
 * registration entry), NOT against any file in this workspace — a stale, never-deployed
 * event-registration-batch CET sitting alongside this initializer describes a DIFFERENT, INCORRECT
 * schema (name/emailAddress) and must not be used as a reference. The real Registration fields are:
 * name, emailAddress, company, dietaryRestrictions (MultiselectPicklist — takes an array of
 * {key} entries, not a single object), registrationStatus. These happen to match this form's own
 * <input>/<select> "name" attributes, which is a coincidence of this form's authoring, not a rule —
 * always verify a payload's keys against the live object definition, never against a comment or
 * another file that merely looks authoritative.
 *
 * The event <select> is populated from a live fetch of /o/c/events, which Guest may read (see
 * resource-permissions.json). Registration itself is write only for Guest — ADD_OBJECT_ENTRY but
 * not VIEW — so this fragment never reads back the registrations collection, only the events one.
 *
 * Uses Liferay.Util.fetch (not native fetch) so the CSRF token and session context are attached
 * automatically for this write call, per the workspace's documented client runtime pattern.
 */
(function () {
	var MONTH_NAMES = [
		'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
		'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
	];

	function formatMonthDay(date) {
		return MONTH_NAMES[date.getUTCMonth()] + ' ' + date.getUTCDate();
	}

	function isSameUTCDay(dateA, dateB) {
		return dateA.toUTCString().slice(0, 16) === dateB.toUTCString().slice(0, 16);
	}

	// DateTime fields are UTC ISO strings representing the venue's own wall clock time — use the
	// UTC getters, not the local ones (see skills/manage-pages/SKILL.md -> "Read DateTime With
	// the UTC Getters").
	function formatDateRange(startDate, endDate) {
		var startYear = startDate.getUTCFullYear();
		var endYear = endDate.getUTCFullYear();

		if (isSameUTCDay(startDate, endDate)) {
			return formatMonthDay(startDate) + ', ' + startYear;
		}

		if (startYear === endYear) {
			return formatMonthDay(startDate) + '–' + formatMonthDay(endDate) + ', ' + startYear;
		}

		return formatMonthDay(startDate) + ', ' + startYear + ' – ' + formatMonthDay(endDate) + ', ' + endYear;
	}

	function fetchFn() {
		return window.Liferay && Liferay.Util && Liferay.Util.fetch
			? Liferay.Util.fetch
			: window.fetch;
	}

	function loadEvents(selectElement, hintElement) {
		var preselectERC = new URLSearchParams(window.location.search).get('event');

		return fetchFn()('/o/c/events?pageSize=100&sort=startDate:asc')
			.then(function (response) {
				if (!response.ok) {
					throw new Error('Request failed with status ' + response.status);
				}

				return response.json();
			})
			.then(function (data) {
				var now = new Date();

				var events = (data.items || []).filter(function (event) {
					return new Date(event.endDate) >= now;
				});

				events.sort(function (eventA, eventB) {
					return new Date(eventA.startDate) - new Date(eventB.startDate);
				});

				selectElement.innerHTML = '';

				if (!events.length) {
					var emptyOption = document.createElement('option');

					emptyOption.value = '';
					emptyOption.textContent = 'No upcoming events are open for registration';
					emptyOption.disabled = true;
					emptyOption.selected = true;
					selectElement.appendChild(emptyOption);

					return;
				}

				var placeholderOption = document.createElement('option');

				placeholderOption.value = '';
				placeholderOption.textContent = 'Select an event…';
				placeholderOption.disabled = true;
				placeholderOption.selected = true;
				selectElement.appendChild(placeholderOption);

				events.forEach(function (event) {
					var option = document.createElement('option');
					var startDate = new Date(event.startDate);
					var endDate = new Date(event.endDate);

					option.value = event.externalReferenceCode;
					option.textContent =
						event.name + ' — ' + formatDateRange(startDate, endDate) +
						(event.location ? ' · ' + event.location : '');

					if (event.externalReferenceCode === preselectERC) {
						option.selected = true;
						placeholderOption.selected = false;
					}

					selectElement.appendChild(option);
				});
			})
			.catch(function () {
				selectElement.innerHTML = '';

				var errorOption = document.createElement('option');

				errorOption.value = '';
				errorOption.textContent = 'Events could not be loaded — please refresh and try again';
				errorOption.disabled = true;
				errorOption.selected = true;
				selectElement.appendChild(errorOption);

				if (hintElement) {
					hintElement.textContent = '';
				}
			});
	}

	function init(rootElement) {
		var form = rootElement.querySelector('[data-devcon-registration-form]');
		var messageElement = rootElement.querySelector('[data-devcon-registration-message]');
		var eventSelect = rootElement.querySelector('[data-devcon-registration-event]');
		var eventHint = rootElement.querySelector('[data-devcon-registration-event-hint]');

		if (!form || !eventSelect) {
			return;
		}

		loadEvents(eventSelect, eventHint);

		form.addEventListener('submit', function (event) {
			event.preventDefault();

			var submitButton = form.querySelector('.devcon-registration-form__submit');

			var name = form.querySelector('[name="name"]').value.trim();
			var emailAddress = form.querySelector('[name="emailAddress"]').value.trim();
			var company = form.querySelector('[name="company"]').value.trim();
			var eventERC = eventSelect.value;
			var dietaryRestrictions = form.querySelector('[name="dietaryRestrictions"]').value;

			messageElement.textContent = '';
			messageElement.className = 'devcon-registration-form__message';

			if (!name || !emailAddress || !eventERC) {
				messageElement.textContent = 'Please fill in your name, email, and choose an event.';
				messageElement.classList.add('devcon-registration-form__message--error');

				return;
			}

			var payload = {
				company: company,
				emailAddress: emailAddress,
				name: name,
				r_eventRegistrations_c_eventERC: eventERC,
				registrationStatus: {
					key: 'pending'
				}
			};

			if (dietaryRestrictions) {
				payload.dietaryRestrictions = [
					{
						key: dietaryRestrictions
					}
				];
			}

			submitButton.disabled = true;

			fetchFn()('/o/c/registrations', {
				body: JSON.stringify(payload),
				headers: {
					'Content-Type': 'application/json'
				},
				method: 'POST'
			})
				.then(function (response) {
					if (!response.ok) {
						throw new Error('Request failed with status ' + response.status);
					}

					return response.json();
				})
				.then(function () {
					messageElement.textContent = "You're registered! We'll be in touch with confirmation details.";
					messageElement.classList.add('devcon-registration-form__message--success');
					form.reset();
					loadEvents(eventSelect, eventHint);
				})
				.catch(function () {
					messageElement.textContent =
						'Something went wrong submitting your registration. Please try again, or contact us directly.';
					messageElement.classList.add('devcon-registration-form__message--error');
				})
				.finally(function () {
					submitButton.disabled = false;
				});
		});
	}

	var rootElement = fragmentNamespace.element;

	if (rootElement) {
		init(rootElement);
	}
})();
