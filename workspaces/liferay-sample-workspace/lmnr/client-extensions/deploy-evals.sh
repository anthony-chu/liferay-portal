#!/usr/bin/env bash

#
# deploy-evals.sh — copy the numbered eval deployables into a running workspace and deploy
# them in dependency order.
#
# Usage:
#     ./deploy-evals.sh --through 01      # everything up to and including 01
#     ./deploy-evals.sh 00 01             # the same, listed explicitly
#
# The numbering is the dependency order, so "everything through N" is the usual way to ask
# for a state. Deploying more than a given eval needs is harmless — the plain and themed
# sites carry different external reference codes and coexist.
#
# The target workspace defaults to ${EVAL_WORKSPACE} and must be the one whose bundle is
# actually running: a deploy lands in its own workspace's bundle, not in whichever portal
# happens to answer on the port.
#

set -o errexit
set -o nounset
set -o pipefail

EVAL_WORKSPACE="${EVAL_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
PORT="${PORT:-8080}"
USER_CREDENTIALS="${USER_CREDENTIALS:-test@liferay.com:test}"

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TARGET_DIR="${EVAL_WORKSPACE}/lmnr/client-extensions"

function usage {
	echo "Usage: $(basename "${BASH_SOURCE[0]}") [--through <number> | <number> ...]" >&2
	echo "Example: $(basename "${BASH_SOURCE[0]}") --through 01" >&2

	exit 1
}

if [ $# -eq 0 ]; then
	usage
fi

numbers=()

if [ "${1}" = "--through" ]; then
	[ $# -eq 2 ] || usage

	for project_dir in "${SOURCE_DIR}"/[0-9][0-9]-*/; do
		number=$(basename "${project_dir}")
		number="${number%%-*}"

		numbers+=("${number}")

		[ "${number}" = "${2}" ] && break
	done

	if [ ${#numbers[@]} -eq 0 ] || [ "${numbers[-1]}" != "${2}" ]; then
		echo "No deployable numbered ${2}" >&2

		exit 1
	fi
else
	numbers=("$@")
fi

#
# Gradle has to be pointed at this directory or it builds the workspace's default
# client-extensions instead, and the deploy silently applies to the wrong projects.
#

if ! grep --quiet "^liferay.workspace.client-extension.dir=lmnr/client-extensions" \
		"${EVAL_WORKSPACE}/gradle.properties"; then

	echo "Set liferay.workspace.client-extension.dir=lmnr/client-extensions in" >&2
	echo "${EVAL_WORKSPACE}/gradle.properties first — see lmnr/.claude/skills/run-laminar-eval." >&2

	exit 1
fi

#
# The batch engine publishes the objects asynchronously, so a deploy returning success is
# not the same as the objects existing. An initializer that runs first finds nothing to
# reference and provisions a site whose pages are empty.
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
# Same for a site initializer: deploying only drops a zip, and reporting straight after the
# Gradle build shows the site missing on a run that in fact succeeded moments later.
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

for number in "${numbers[@]}"; do
	project_dir=$(find "${SOURCE_DIR}" -maxdepth 1 -type d -name "${number}-*" | head -1)

	if [ -z "${project_dir}" ]; then
		echo "No deployable numbered ${number}" >&2

		exit 1
	fi

	project=$(basename "${project_dir}")

	echo "==> ${project}"

	#
	# When the deployables already live in the target workspace, build them where they are.
	# Copying would mean deleting the source directory and then copying it onto itself.
	#

	if [ "${SOURCE_DIR}" != "${TARGET_DIR}" ]; then
		rm -rf "${TARGET_DIR:?}/${project}"

		mkdir -p "${TARGET_DIR}"

		cp -rp "${project_dir}" "${TARGET_DIR}/${project}"
	fi

	rm -rf "${TARGET_DIR}/${project}/build" "${TARGET_DIR}/${project}/dist"

	#
	# clean is what forces a new artifact. Gradle's up to date check is content based, so an
	# unchanged source prints BUILD SUCCESSFUL, rewrites nothing, and the file install
	# watcher never sees a changed zip to act on.
	#

	(cd "${TARGET_DIR}/${project}" && blade gw clean deploy)

	if grep --quiet "type: batch" "${project_dir}/client-extension.yaml"; then
		wait_for_objects Event
		wait_for_objects Registration
	fi

	if grep --quiet "type: siteInitializer" "${project_dir}/client-extension.yaml"; then
		site_name=$(
			grep --max-count=1 --only-matching \
				--perl-regexp "(?<=siteName: ).*" "${project_dir}/client-extension.yaml"
		)

		wait_for_site "${site_name}"
	fi
done

echo
echo "Deployed. Sites now present:"

curl \
	--silent \
	--url "http://localhost:${PORT}/o/headless-admin-site/v1.0/sites?pageSize=200" \
	--user "${USER_CREDENTIALS}" \
	| grep --only-matching '"name" : "[^"]*"'
