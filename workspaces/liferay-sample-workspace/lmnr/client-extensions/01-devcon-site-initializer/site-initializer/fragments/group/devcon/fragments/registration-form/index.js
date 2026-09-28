/**
 * SPDX-FileCopyrightText: (c) 2000 Liferay, Inc. https://liferay.com
 * SPDX-License-Identifier: LGPL-2.1-or-later OR LicenseRef-Liferay-DXP-EULA-2.0.0-2023-06
 */

(function () {
	const rootElement = fragmentNamespace.element;

	function init(rootElement) {
		const form = rootElement.querySelector(
			'[data-devcon-registration-form]'
		);
		const messageElement = rootElement.querySelector(
			'[data-devcon-registration-message]'
		);

		if (!form) {
			return;
		}

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
			const eventERC = form.querySelector(
				'[name="eventExternalReferenceCode"]'
			).value;

			const dietaryRestrictions = Array.prototype.slice
				.call(
					form.querySelectorAll(
						'[name="dietaryRestrictions"]:checked'
					)
				)
				.map((checkbox) => {
					return {key: checkbox.value};
				});

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
				name,
				emailAddress,
				company,
				dietaryRestrictions,
				registrationStatus: {key: 'pending'},
				r_eventRegistrations_c_eventERC: eventERC,
			};

			submitButton.disabled = true;

			const fetchFn =
				window.Liferay && Liferay.Util && Liferay.Util.fetch
					? Liferay.Util.fetch
					: window.fetch;

			fetchFn('/o/c/registrations', {
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

	if (rootElement) {
		init(rootElement);
	}
})();
