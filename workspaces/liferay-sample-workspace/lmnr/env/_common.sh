#!/bin/bash

function build_liferay_image {
	local client_extension_names

	client_extension_names=$(echo "${1}" | paste --delimiters "," --serial -)

	echo "Building the Liferay image with these client extensions: ${client_extension_names:-none}."

	if ! env \
			"ORG_GRADLE_PROJECT_liferay.workspace.client-extension.dir=lmnr/client-extensions" \
			"ORG_GRADLE_PROJECT_liferay.workspace.configs.dir=${_CONFIGS_DIR}" \
			"${_WORKSPACE_DIR}/scripts/bootstrap/build.sh" \
				--init-script "${_LMNR_DIR}/env/exclude-client-extensions.gradle" \
				"-Pclient.extensions.include=${client_extension_names}"
	then
		echo "Unable to build the Liferay image with ${_WORKSPACE_DIR}/scripts/bootstrap/build.sh." >&2

		exit 1
	fi
}

function default_set_up {
	_TEMPORARY_DIR=$(mktemp --directory)

	trap 'rm --force --recursive "${_TEMPORARY_DIR}"' EXIT

	_CONFIGS_DIR=${_TEMPORARY_DIR}/configs
	_EMPTY_CLIENT_EXTENSIONS_DIR=${_TEMPORARY_DIR}/empty-client-extensions

	local client_extension_names

	client_extension_names=$(get_env_client_extension_names)

	stop_liferay

	if ! mkdir --parents "${_CONFIGS_DIR}/local" "${_EMPTY_CLIENT_EXTENSIONS_DIR}"
	then
		echo "Unable to create ${_CONFIGS_DIR} and ${_EMPTY_CLIENT_EXTENSIONS_DIR}." >&2

		exit 1
	fi

	build_liferay_image "${client_extension_names}"

	start_liferay

	wait_for_client_extensions "${client_extension_names}"
}

function default_tear_down {
	stop_liferay
}

function delete_eval_generated_paths {
	if [[ -f ${_GENERATED_PATHS_FILE} ]]
	then
		local generated_path

		for generated_path in $( \
			get_generated_paths | \
				grep \
					--file="${_GENERATED_PATHS_FILE}" \
					--fixed-strings \
					--invert-match \
					--line-regexp)
		do
			echo "Deleting ${_WORKSPACE_DIR}/${generated_path}."

			if ! rm --force --recursive "${_WORKSPACE_DIR:?}/${generated_path}"
			then
				echo "Unable to delete ${_WORKSPACE_DIR}/${generated_path}." >&2

				exit 1
			fi
		done
	else
		echo "Unable to find ${_GENERATED_PATHS_FILE}, so no generated client extensions are deleted."
	fi

	if ! rm --force --recursive "${_WORKSPACE_DIR}/build/docker" "${_GENERATED_PATHS_FILE}"
	then
		echo "Unable to delete ${_WORKSPACE_DIR}/build/docker and ${_GENERATED_PATHS_FILE}." >&2

		exit 1
	fi
}

function get_env_client_extension_names {
	local env_dir

	for env_dir in $(get_env_dirs)
	do
		local client_extensions_list_file=${env_dir}/client-extensions.list

		if [[ -f ${client_extensions_list_file} ]]
		then
			get_list_entries "${client_extensions_list_file}"
		fi
	done
}

function get_env_dirs {
	echo "${_LMNR_DIR}/env"

	local current_dir=${_EVALS_DIR}
	local relative_path

	relative_path=${EVAL_DIR#"${_EVALS_DIR}/"}

	local segment

	for segment in ${relative_path//\// }
	do
		current_dir=${current_dir}/${segment}

		local env_dir=${current_dir}/env

		if [[ -d ${env_dir} ]]
		then
			echo "${env_dir}"
		fi
	done
}

function get_generated_paths {
	(
		cd "${_WORKSPACE_DIR}" && \
			git ls-files \
				--directory \
				--exclude-standard \
				--others \
				-- \
				client-extensions
	)

	if [[ -d ${_WORKSPACE_DIR}/bundles ]]
	then
		echo "bundles"
	fi
}

function get_list_entries {
	grep \
		--extended-regexp \
		--invert-match \
		"^[[:space:]]*(#|$)" \
		"${1}"
}

function get_object_definition_external_reference_codes {
	local client_extension_dir=${1}

	find \
		"${client_extension_dir}" \
		-name "*.batch-engine-data.json" \
		-not -path "*/build/*" \
		-not -path "*/dist/*" \
		-not -path "*/node_modules/*" \
		-exec jq --raw-output 'select(.configuration.className == "com.liferay.object.admin.rest.dto.v1_0.ObjectDefinition") | .items[].externalReferenceCode' {} +
}

function is_laminar_ready {
	curl \
		--data '{"email": "test@liferay.com", "name": "Test"}' \
		--header "Content-Type: application/json" \
		--request POST \
		--silent \
		"${LAMINAR_URL}/api/auth/sign-in/local-email" | \
		grep --quiet '"token"'
}

function is_object_definition_published {
	curl \
		--fail \
		--silent \
		--user "${LIFERAY_USER_CREDENTIALS}" \
		"${LIFERAY_PORTAL_URL}/o/object-admin/v1.0/object-definitions/by-external-reference-code/${1}" | \
		jq --exit-status ".status.code == 0" > /dev/null
}

function is_site_present {
	curl \
		--fail \
		--output /dev/null \
		--silent \
		--user "${LIFERAY_USER_CREDENTIALS}" \
		"${LIFERAY_PORTAL_URL}/o/headless-admin-site/v1.0/sites/${1}"
}

function record_generated_paths {
	if ! get_generated_paths > "${_GENERATED_PATHS_FILE}"
	then
		echo "Unable to record the generated paths in ${_GENERATED_PATHS_FILE}, so tear down could not delete what the eval generates." >&2

		exit 1
	fi
}

function run_workspace_docker_compose {
	(
		source "${_WORKSPACE_DIR}/scripts/_common.sh" && \
			docker_compose "${@}"
	)
}

function set_compose_overrides {
	LIFERAY_COMPOSE_OVERRIDES=lmnr

	local eval_compose_file=${EVAL_DIR}/env/docker-compose.yaml

	if [[ -n ${EVAL_DIR} ]] && [[ -f ${eval_compose_file} ]]
	then
		LIFERAY_COMPOSE_OVERRIDES=${LIFERAY_COMPOSE_OVERRIDES},${eval_compose_file#"${_WORKSPACE_DIR}/"}
	fi

	export LIFERAY_COMPOSE_OVERRIDES
}

function set_variables {
	_LMNR_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

	_CLIENT_EXTENSIONS_DIR=${_LMNR_DIR}/client-extensions
	_EVALS_DIR=${_LMNR_DIR}/evals
	_GENERATED_PATHS_FILE=${_LMNR_DIR}/generated-paths.list
	_WORKSPACE_DIR=$(dirname "${_LMNR_DIR}")

	LAMINAR_URL=${LAMINAR_URL:-http://localhost:9667}
	LIFERAY_PORTAL_URL=${LIFERAY_PORTAL_URL:-http://localhost:8080}
	LIFERAY_USER_CREDENTIALS=${LIFERAY_USER_CREDENTIALS:-test@liferay.com:test}
}

function start_laminar {
	if is_laminar_ready
	then
		echo "Laminar is already running."

		return 0
	fi

	if ! run_workspace_docker_compose up --detach app-server frontend
	then
		echo "Unable to start Laminar with docker compose in ${_WORKSPACE_DIR}." >&2

		exit 1
	fi

	wait_for "Laminar is ready at ${LAMINAR_URL}" 900 is_laminar_ready
}

function start_liferay {
	if ! env \
			"ORG_GRADLE_PROJECT_liferay.workspace.client-extension.dir=${_EMPTY_CLIENT_EXTENSIONS_DIR}" \
			"${_WORKSPACE_DIR}/scripts/bootstrap/start.sh"
	then
		echo "Unable to start Liferay with ${_WORKSPACE_DIR}/scripts/bootstrap/start.sh." >&2

		exit 1
	fi
}

function stop_laminar {
	if ! run_workspace_docker_compose down
	then
		echo "Unable to stop Laminar with docker compose in ${_WORKSPACE_DIR}." >&2

		exit 1
	fi
}

function stop_liferay {
	if ! run_workspace_docker_compose down --volumes database liferay
	then
		echo "Unable to remove the Liferay containers and volumes with docker compose in ${_WORKSPACE_DIR}." >&2

		exit 1
	fi
}

function validate_eval {
	if [[ -z ${EVAL_NAME} ]]
	then
		echo "Pass the eval name, for example: create-site." >&2

		exit 1
	fi

	EVAL_DIR=${_EVALS_DIR}/${EVAL_NAME}

	if ! compgen -G "${EVAL_DIR}/*.eval.ts" > /dev/null
	then
		echo "Unable to find an eval in ${EVAL_DIR}." >&2

		exit 1
	fi

	export EVAL_DIR EVAL_NAME

	set_compose_overrides
}

function wait_for {
	local description=${1}
	local timeout=${2}

	shift 2

	local elapsed=0

	until "${@}"
	do
		if [ ${elapsed} -ge ${timeout} ]
		then
			echo "Timed out after ${timeout}s waiting until ${description}." >&2

			exit 1
		fi

		sleep 5

		elapsed=$((elapsed + 5))
	done

	echo "${description}."
}

function wait_for_client_extensions {
	local client_extension_name

	for client_extension_name in ${1}
	do
		local client_extension_dir=${_CLIENT_EXTENSIONS_DIR}/${client_extension_name}

		if [[ ! -d ${client_extension_dir} ]]
		then
			echo "Unable to find client extension in ${client_extension_dir}." >&2

			exit 1
		fi

		local object_definition_external_reference_code

		for object_definition_external_reference_code in $(get_object_definition_external_reference_codes "${client_extension_dir}")
		do
			wait_for "Object definition ${object_definition_external_reference_code} is published" 600 is_object_definition_published "${object_definition_external_reference_code}"
		done

		local site_external_reference_code

		for site_external_reference_code in $( \
			grep \
				--only-matching \
				--perl-regexp \
				"^[[:space:]]*siteExternalReferenceCode: \K.*" \
				"${client_extension_dir}/client-extension.yaml")
		do
			wait_for "Site ${site_external_reference_code} exists" 600 is_site_present "${site_external_reference_code}"
		done
	done
}

set_variables

set_compose_overrides