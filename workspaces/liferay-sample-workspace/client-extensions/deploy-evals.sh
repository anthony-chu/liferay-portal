#!/usr/bin/env bash

#
# deploy-evals.sh — copy the numbered eval deployables into a running workspace and deploy
# them in dependency order.
#
# Usage:
#     ./deploy-evals.sh 01 02          # the starting state for eval 3
#     ./deploy-evals.sh 01 03          # the state after eval 3
#
# The target workspace defaults to ${EVAL_WORKSPACE} and must be the one whose bundle is
# actually running — a deploy lands in its own workspace's bundle, not in whichever portal
# happens to answer on the port.
#

set -o errexit
set -o nounset
set -o pipefail

EVAL_WORKSPACE="${EVAL_WORKSPACE:-/home/me/dev/projects/workspaces/liferay-q3-workspace}"
PORT="${PORT:-8080}"
USER_CREDENTIALS="${USER_CREDENTIALS:-test@liferay.com:test}"

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ $# -eq 0 ]; then
	echo "Usage: $(basename "${BASH_SOURCE[0]}") <number> [number ...]" >&2
	echo "Example: $(basename "${BASH_SOURCE[0]}") 01 02" >&2
	exit 1
fi

#
# Wait for the batch engine to publish the objects. The initializer's pages and permissions
# reference the Event object, so deploying it first only helps if provisioning finished —
# both deploys merely drop a zip, and the portal picks them up asynchronously.
#

function wait_for_objects {
	local name="${1}"

	for _ in $(seq 1 60); do
		if curl \
				--silent \
				--url "http://localhost:${PORT}/o/object-admin/v1.0/object-definitions?filter=name%20eq%20%27${name}%27" \
				--user "${USER_CREDENTIALS}" \
			| grep --quiet "\"name\" : \"${name}\""; then

			echo "    ${name} is published"

			return 0
		fi

		sleep 3
	done

	echo "    timed out waiting for ${name}" >&2

	return 1
}

#
# Wait for a site initializer to finish. Deploying only drops a zip; the portal picks it up
# asynchronously, so reporting straight after the Gradle build shows the site missing on a
# run that in fact succeeded moments later.
#

function wait_for_site {
	local name="${1}"

	for _ in $(seq 1 60); do
		if curl \
				--silent \
				--url "http://localhost:${PORT}/o/headless-admin-site/v1.0/sites?pageSize=200" \
				--user "${USER_CREDENTIALS}" \
			| grep --quiet "\"name\" : \"${name}\""; then

			echo "    site ${name} is provisioned"

			return 0
		fi

		sleep 3
	done

	echo "    timed out waiting for site ${name}" >&2

	return 1
}

for number in "$@"; do
	group_dir=$(find "${SOURCE_DIR}" -maxdepth 1 -type d -name "${number}-*" | head -1)

	if [ -z "${group_dir}" ]; then
		echo "No deployable group matches ${number}" >&2

		exit 1
	fi

	echo "==> $(basename "${group_dir}")"

	for project_dir in "${group_dir}"/*/; do
		project=$(basename "${project_dir}")

		echo "  ${project}"

		rm -rf "${EVAL_WORKSPACE}/client-extensions/${project}"

		cp -rp "${project_dir%/}" "${EVAL_WORKSPACE}/client-extensions/${project}"

		rm -rf \
			"${EVAL_WORKSPACE}/client-extensions/${project}/build" \
			"${EVAL_WORKSPACE}/client-extensions/${project}/dist"

		#
		# clean is what forces a new artifact. Gradle's up to date check is content based,
		# so an unchanged source prints BUILD SUCCESSFUL, rewrites nothing, and the file
		# install watcher never sees a changed zip to act on.
		#

		(cd "${EVAL_WORKSPACE}/client-extensions/${project}" && blade gw clean deploy)

		if grep --quiet "type: siteInitializer" "${project_dir}client-extension.yaml"; then
			site_name=$(
				grep --max-count=1 --only-matching \
					--perl-regexp "(?<=siteName: ).*" "${project_dir}client-extension.yaml"
			)

			wait_for_site "${site_name}"
		fi
	done

	if [ "${number}" = "01" ]; then
		wait_for_objects Event
		wait_for_objects Registration
	fi
done

echo
echo "Deployed. Sites now present:"

curl \
	--silent \
	--url "http://localhost:${PORT}/o/headless-admin-site/v1.0/sites?pageSize=200" \
	--user "${USER_CREDENTIALS}" \
	| grep --only-matching '"name" : "[^"]*"'
