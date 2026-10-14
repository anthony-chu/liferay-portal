/**
 * SPDX-FileCopyrightText: (c) 2000 Liferay, Inc. https://liferay.com
 * SPDX-License-Identifier: LGPL-2.1-or-later OR LicenseRef-Liferay-DXP-EULA-2.0.0-2023-06
 */

(function () {
	const MONTH_NAMES = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec',
	];

	function formatMonthDay(date) {
		return MONTH_NAMES[date.getUTCMonth()] + ' ' + date.getUTCDate();
	}

	function isSameUTCDay(dateA, dateB) {
		return (
			dateA.toUTCString().slice(0, 16) ===
			dateB.toUTCString().slice(0, 16)
		);
	}

	// DateTime fields are UTC ISO strings representing the venue's own wall clock time — use the
	// UTC getters, not the local ones (see skills/manage-pages/SKILL.md -> "Read DateTime With
	// the UTC Getters").

	function formatDateRange(startDate, endDate) {
		const startYear = startDate.getUTCFullYear();
		const endYear = endDate.getUTCFullYear();

		if (isSameUTCDay(startDate, endDate)) {
			return formatMonthDay(startDate) + ', ' + startYear;
		}

		if (startYear === endYear) {
			return (
				formatMonthDay(startDate) +
				'–' +
				formatMonthDay(endDate) +
				', ' +
				startYear
			);
		}

		return (
			formatMonthDay(startDate) +
			', ' +
			startYear +
			' – ' +
			formatMonthDay(endDate) +
			', ' +
			endYear
		);
	}

	function fetchFn() {
		return window.Liferay && Liferay.Util && Liferay.Util.fetch
			? Liferay.Util.fetch
			: window.fetch;
	}

	function loadEvents(selectElement, hintElement) {
		const preselectERC = new URLSearchParams(window.location.search).get(
			'event'
		);

		return fetchFn()('/o/c/events?pageSize=100&sort=startDate:asc')
			.then((response) => {
				if (!response.ok) {
					throw new Error(
						'Request failed with status ' + response.status
					);
				}

				return response.json();
			})
			.then((data) => {
				const now = new Date();

				const events = (data.items || []).filter((event) => {
					return new Date(event.endDate) >= now;
				});

				events.sort((eventA, eventB) => {
					return (
						new Date(eventA.startDate) - new Date(eventB.startDate)
					);
				});

				selectElement.innerHTML = '';

				if (!events.length) {
					const emptyOption = document.createElement('option');

					emptyOption.value = '';
					emptyOption.textContent =
						'No upcoming events are open for registration';
					emptyOption.disabled = true;
					emptyOption.selected = true;
					selectElement.appendChild(emptyOption);

					return;
				}

				const placeholderOption = document.createElement('option');

				placeholderOption.value = '';
				placeholderOption.textContent = 'Select an event…';
				placeholderOption.disabled = true;
				placeholderOption.selected = true;
				selectElement.appendChild(placeholderOption);

				events.forEach((event) => {
					const option = document.createElement('option');
					const startDate = new Date(event.startDate);
					const endDate = new Date(event.endDate);

					option.value = event.externalReferenceCode;
					option.textContent =
						event.name +
						' — ' +
						formatDateRange(startDate, endDate) +
						(event.location ? ' · ' + event.location : '');

					if (event.externalReferenceCode === preselectERC) {
						option.selected = true;
						placeholderOption.selected = false;
					}

					selectElement.appendChild(option);
				});
			})
			.catch(() => {
				selectElement.innerHTML = '';

				const errorOption = document.createElement('option');

				errorOption.value = '';
				errorOption.textContent =
					'Events could not be loaded — please refresh and try again';
				errorOption.disabled = true;
				errorOption.selected = true;
				selectElement.appendChild(errorOption);

				if (hintElement) {
					hintElement.textContent = '';
				}
			});
	}

	function init(rootElement) {
		const form = rootElement.querySelector(
			'[data-devcon-registration-form]'
		);
		const messageElement = rootElement.querySelector(
			'[data-devcon-registration-message]'
		);
		const eventSelect = rootElement.querySelector(
			'[data-devcon-registration-event]'
		);
		const eventHint = rootElement.querySelector(
			'[data-devcon-registration-event-hint]'
		);

		if (!form || !eventSelect) {
			return;
		}

		loadEvents(eventSelect, eventHint);

		form.addEventListener('submit', (event) => {
			event.preventDefault();

			const submitButton = form.querySelector(
				'.devcon-registration-form__submit'
			);

			const name = form.querySelector('[name="name"]').value.trim();
			const emailAddress = form
				.querySelector('[name="emailAddress"]')
				.value.trim();
			const company = form.querySelector('[name="company"]').value.trim();
			const eventERC = eventSelect.value;
			const dietaryRestrictions = form.querySelector(
				'[name="dietaryRestrictions"]'
			).value;

			messageElement.textContent = '';
			messageElement.className = 'devcon-registration-form__message';

			if (!name || !emailAddress || !eventERC) {
				messageElement.textContent =
					'Please fill in your name, email, and choose an event.';
				messageElement.classList.add(
					'devcon-registration-form__message--error'
				);

				return;
			}

			const payload = {
				company,
				emailAddress,
				name,
				r_eventRegistrations_c_eventERC: eventERC,
				registrationStatus: {
					key: 'pending',
				},
			};

			if (dietaryRestrictions) {
				payload.dietaryRestrictions = [
					{
						key: dietaryRestrictions,
					},
				];
			}

			submitButton.disabled = true;

			fetchFn()('/o/c/registrations', {
				body: JSON.stringify(payload),
				headers: {
					'Content-Type': 'application/json',
				},
				method: 'POST',
			})
				.then((response) => {
					if (!response.ok) {
						throw new Error(
							'Request failed with status ' + response.status
						);
					}

					return response.json();
				})
				.then(() => {
					messageElement.textContent =
						"You're registered! We'll be in touch with confirmation details.";
					messageElement.classList.add(
						'devcon-registration-form__message--success'
					);
					form.reset();
					loadEvents(eventSelect, eventHint);
				})
				.catch(() => {
					messageElement.textContent =
						'Something went wrong submitting your registration. Please try again, or contact us directly.';
					messageElement.classList.add(
						'devcon-registration-form__message--error'
					);
				})
				.finally(() => {
					submitButton.disabled = false;
				});
		});
	}

	const rootElement = fragmentElement;

	if (rootElement) {
		init(rootElement);
	}
})();
