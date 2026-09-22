/*
 * Registration Form — submits a new Registration object entry referencing the chosen Event by its
 * external reference code (r_eventRegistrations_c_eventERC), matching the relationship field name
 * used by the Event <-> Registration object relationship (see rules/site-initializer-format.md).
 *
 * Uses Liferay.Util.fetch (not native fetch) so the CSRF token and session context are attached
 * automatically for this write call, per the workspace's documented client runtime pattern.
 *
 * Note: anonymous (Guest) submissions require the Guest role to have "Add Entry" permission on the
 * Registration object; grant this via the manage-roles-permissions skill if public registration
 * (without login) is required.
 */
(function () {
	var rootElement = fragmentNamespace.element;

	function init(rootElement) {
		var form = rootElement.querySelector('[data-devcon-registration-form]');
		var messageElement = rootElement.querySelector('[data-devcon-registration-message]');

		if (!form) {
			return;
		}

		form.addEventListener('submit', function (event) {
			event.preventDefault();

			var submitButton = form.querySelector('.devcon-registration-form__submit');

			var name = form.querySelector('[name="name"]').value.trim();
			var emailAddress = form.querySelector('[name="emailAddress"]').value.trim();
			var company = form.querySelector('[name="company"]').value.trim();
			var eventERC = form.querySelector('[name="eventExternalReferenceCode"]').value;

			var dietaryRestrictions = Array.prototype.slice
				.call(form.querySelectorAll('[name="dietaryRestrictions"]:checked'))
				.map(function (checkbox) {
					return {key: checkbox.value};
				});

			messageElement.textContent = '';
			messageElement.className = 'devcon-registration-form__message';

			if (!name || !emailAddress || !eventERC) {
				messageElement.textContent = 'Please fill in your name, email, and choose an event.';
				messageElement.classList.add('devcon-registration-form__message--error');

				return;
			}

			var payload = {
				name: name,
				emailAddress: emailAddress,
				company: company,
				dietaryRestrictions: dietaryRestrictions,
				registrationStatus: {key: 'pending'},
				r_eventRegistrations_c_eventERC: eventERC,
			};

			submitButton.disabled = true;

			var fetchFn =
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

	if (rootElement) {
		init(rootElement);
	}
})();
