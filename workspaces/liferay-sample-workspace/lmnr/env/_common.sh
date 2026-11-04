#!/bin/bash

function combine_properties_files {
	local target_file=${1}

	local temp_properties_file

	temp_properties_file=$(mktemp)

	if [[ ! -f ${temp_properties_file} ]]
	then
		echo "Unable to create a temporary file to combine the properties into ${target_file}." >&2

		exit 1
	fi

	echo "" > "${temp_properties_file}"

	local properties_file

	for properties_file in "${@}"
	do
		if [[ ! -f ${properties_file} ]]
		then
			continue
		fi

		echo -e "\n# From ${properties_file}\n" >> "${temp_properties_file}"

		local property_name
		local property_value

		while IFS="=" read -r property_name property_value || [[ -n ${property_name} ]]
		do
			property_name=${property_name%$'\r'}
			property_value=${property_value%$'\r'}

			if [[ ${property_name} =~ ^[[:space:]]*(#|!|//|$) ]]
			then
				continue
			fi

			property_name=$( \
				echo "${property_name}" | \
					replace_text "s/^[[:space:]]*//" | \
					replace_text "s/[[:space:]]*$//")
			property_value=$( \
				echo "${property_value}" | \
					replace_text "s/^[[:space:]]*//" | \
					replace_text "s/[[:space:]]*$//")

			local property_value_next

			while [[ ${property_value} =~ \\$ ]]
			do
				property_value=${property_value%\\}

				if ! read -r property_value_next && [[ -z ${property_value_next} ]]
				then
					break
				fi

				property_value=${property_value}${property_value_next%$'\r'}
			done

			local escaped_property_name

			escaped_property_name=$(echo "${property_name}" | replace_text "s/[][\.*^$/]/\\\\&/g")

			if ! delete_property_line "${escaped_property_name}" "${temp_properties_file}"
			then
				echo "Unable to replace ${property_name} while combining the properties into ${target_file}." >&2

				exit 1
			fi

			echo "${property_name}=${property_value}" >> "${temp_properties_file}"
		done < "${properties_file}"
	done

	if ! mv "${temp_properties_file}" "${target_file}"
	then
		echo "Unable to write the combined properties to ${target_file}." >&2

		exit 1
	fi
}

function copy_directory_contents {
	if [[ $(uname) == Darwin ]]
	then
		cp -R "${1}/." "${2}"
	else
		cp --recursive "${1}/." "${2}"
	fi
}

function count_lines {
	if [[ $(uname) == Darwin ]]
	then
		wc -l
	else
		wc --lines
	fi
}

function create_directories {
	if [[ $(uname) == Darwin ]]
	then
		mkdir -p "${@}"
	else
		mkdir --parents "${@}"
	fi
}

function default_set_up {
	init_bundle

	deploy_license

	update_env_portal_ext_properties

	deploy_env_osgi_configs

	start_liferay

	deploy_env_client_extensions
}

function default_tear_down {
	stop_liferay
}

function delete_eval_generated_paths {
	if [[ ! -f ${_UNTRACKED_PATHS_FILE} ]]
	then
		echo "Unable to find ${_UNTRACKED_PATHS_FILE}, so no generated files are deleted."

		return 0
	fi

	local untracked_path

	for untracked_path in $( \
		get_untracked_paths | \
			grep \
				--file="${_UNTRACKED_PATHS_FILE}" \
				--fixed-strings \
				--invert-match \
				--line-regexp)
	do
		echo "Deleting ${_WORKSPACE_DIR}/${untracked_path}."

		if ! delete_paths "${_WORKSPACE_DIR:?}/${untracked_path}"
		then
			echo "Unable to delete ${_WORKSPACE_DIR}/${untracked_path}." >&2

			exit 1
		fi
	done

	if ! rm "${_UNTRACKED_PATHS_FILE}"
	then
		echo "Unable to delete ${_UNTRACKED_PATHS_FILE}." >&2

		exit 1
	fi
}

function delete_osgi_config {
	local osgi_config_file=${LIFERAY_HOME}/osgi/configs/${1}

	if [[ ! -f ${osgi_config_file} ]]
	then
		echo "Unable to find ${osgi_config_file}." >&2

		exit 1
	fi

	if ! rm "${osgi_config_file}"
	then
		echo "Unable to delete ${osgi_config_file}." >&2

		exit 1
	fi

	echo "${osgi_config_file} was deleted."
}

function delete_osgi_configs {
	local delete_osgi_configs_list_file=${1}

	local osgi_config_file_name

	for osgi_config_file_name in $( \
		grep \
			--extended-regexp \
			--invert-match \
			"^[[:space:]]*(#|$)" \
			"${delete_osgi_configs_list_file}")
	do
		delete_osgi_config "${osgi_config_file_name}"
	done
}

function delete_paths {
	if [[ $(uname) == Darwin ]]
	then
		rm -fr "${@}"
	else
		rm --force --recursive "${@}"
	fi
}

function delete_properties {
	local delete_properties_list_file=${1}

	local property_name

	for property_name in $( \
		grep \
			--extended-regexp \
			--invert-match \
			"^[[:space:]]*(#|$)" \
			"${delete_properties_list_file}")
	do
		delete_property "${property_name}"
	done
}

function delete_property {
	local properties_file=${LIFERAY_HOME}/portal-ext.properties
	local property_name=${1}

	local escaped_property_name

	escaped_property_name=$(echo "${property_name}" | replace_text "s/[][\.*^$/]/\\\\&/g")

	if ! grep --quiet "^${escaped_property_name}=" "${properties_file}"
	then
		echo "Unable to find ${property_name} in ${properties_file}." >&2

		exit 1
	fi

	if ! delete_property_line "${escaped_property_name}" "${properties_file}"
	then
		echo "Unable to delete ${property_name} from ${properties_file}." >&2

		exit 1
	fi

	echo "${property_name} was deleted from ${properties_file}."
}

function delete_property_line {
	local escaped_property_name=${1}
	local properties_file=${2}

	if [[ $(uname) == Darwin ]]
	then
		sed -e "/^${escaped_property_name}=/d" -i "" "${properties_file}"
	else
		sed \
			--expression "/^${escaped_property_name}=/d" \
			--in-place \
			"${properties_file}"
	fi
}

function deploy_client_extensions {
	echo "Deploying client extensions."

	local client_extensions_list_file=${1}

	local client_extensions_relative_dir

	client_extensions_relative_dir=$(echo "${_CLIENT_EXTENSIONS_DIR}" | replace_text "s|^${_WORKSPACE_DIR}/||")

	local client_extension_dir

	for client_extension_dir in $(get_client_extension_dirs "${client_extensions_list_file}")
	do
		if [[ ! -d ${client_extension_dir} ]]
		then
			echo "Unable to find client extension in ${client_extension_dir}." >&2

			exit 1
		fi

		echo "Deploying ${client_extension_dir}."

		if ! (cd "${client_extension_dir}" && blade gw clean deploy "-Pliferay.workspace.client-extension.dir=${client_extensions_relative_dir}")
		then
			echo "Unable to deploy ${client_extension_dir}." >&2

			exit 1
		fi

		wait_for_portal_log_inactivity
	done
}

function deploy_env_client_extensions {
	local env_dir

	for env_dir in $(get_env_dirs)
	do
		local client_extensions_list_file=${env_dir}/client-extensions.list

		if [[ -f ${client_extensions_list_file} ]]
		then
			deploy_client_extensions "${client_extensions_list_file}"

			wait_for_client_extensions "${client_extensions_list_file}"
		fi
	done
}

function deploy_env_osgi_configs {
	local env_dir

	for env_dir in $(get_env_dirs)
	do
		deploy_osgi_configs "${env_dir}"

		local delete_osgi_configs_list_file=${env_dir}/delete-osgi-configs.list

		if [[ -f ${delete_osgi_configs_list_file} ]]
		then
			delete_osgi_configs "${delete_osgi_configs_list_file}"
		fi
	done
}

function deploy_license {
	if [[ ! $(get_workspace_product) =~ dxp ]]
	then
		return 0
	fi

	if [[ -z ${LICENSE_XML_URL} ]]
	then
		echo "Set the environment variable LICENSE_XML_URL to the URL or path of a DXP license." >&2

		exit 1
	fi

	local deploy_dir=${LIFERAY_HOME}/deploy

	if ! create_directories "${deploy_dir}"
	then
		echo "Unable to create ${deploy_dir}." >&2

		exit 1
	fi

	local deployed_license_xml_file=${deploy_dir}/license.xml

	if [[ ${LICENSE_XML_URL} =~ ^https?:// ]]
	then
		if ! curl \
				--fail \
				--location \
				--output "${deployed_license_xml_file}" \
				--silent \
				"${LICENSE_XML_URL}"
		then
			echo "Unable to download the license from ${LICENSE_XML_URL}." >&2

			exit 1
		fi
	else
		local license_xml_file

		license_xml_file=$(echo "${LICENSE_XML_URL}" | replace_text "s|^~|${HOME}|")

		if ! cp "${license_xml_file}" "${deployed_license_xml_file}"
		then
			echo "Unable to copy the license from ${license_xml_file}." >&2

			exit 1
		fi
	fi

	echo "Deployed the license to ${deployed_license_xml_file}."
}

function deploy_osgi_configs {
	local osgi_configs_dir=${LIFERAY_HOME}/osgi/configs

	if ! create_directories "${osgi_configs_dir}"
	then
		echo "Unable to create ${osgi_configs_dir}." >&2

		exit 1
	fi

	local env_osgi_configs_dir=${1}/osgi/configs

	if [[ ! -d ${env_osgi_configs_dir} ]]
	then
		return 0
	fi

	echo "Deploying OSGi configs in ${env_osgi_configs_dir}."

	if ! copy_directory_contents "${env_osgi_configs_dir}" "${osgi_configs_dir}"
	then
		echo "Unable to copy the OSGi configs in ${env_osgi_configs_dir}." >&2

		exit 1
	fi
}

function get_client_extension_dirs {
	local client_extensions_list_file=${1}

	local client_extension_name

	for client_extension_name in $( \
		grep \
			--extended-regexp \
			--invert-match \
			"^[[:space:]]*(#|$)" \
			"${client_extensions_list_file}")
	do
		echo "${_CLIENT_EXTENSIONS_DIR}/${client_extension_name}"
	done
}

function get_env_dirs {
	echo "${_LMNR_DIR}/env"

	local current_dir=${_EVALS_DIR}
	local relative_path

	relative_path=$(echo "${EVAL_DIR}" | replace_text "s|^${_EVALS_DIR}/||")

	local segment

	for segment in $(echo "${relative_path}" | replace_text "s|/| |g")
	do
		current_dir=${current_dir}/${segment}

		local env_dir=${current_dir}/env

		if [[ -d ${env_dir} ]]
		then
			echo "${env_dir}"
		fi
	done
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

function get_portal_log_line_count {
	cat "${LIFERAY_HOME}"/logs/liferay.*.log 2> /dev/null | count_lines
}

function get_untracked_paths {
	(
		cd "${_WORKSPACE_DIR}" && \
			git ls-files \
				--directory \
				--exclude-standard \
				--others \
				-- \
				. \
				":!lmnr"
	)
}

function get_values_after_prefix {
	local file=${1}
	local prefix=${2}

	if [[ $(uname) == Darwin ]]
	then
		sed \
			-e "s/^[[:space:]]*${prefix}//p" \
			-n \
			"${file}"
	else
		grep \
			--only-matching \
			--perl-regexp \
			"^[[:space:]]*${prefix}\K.*" \
			"${file}"
	fi
}

function get_workspace_product {
	get_values_after_prefix "${_WORKSPACE_DIR}/gradle.properties" "liferay\.workspace\.product="
}

function init_bundle {
	stop_liferay

	echo "Removing ${LIFERAY_HOME}."

	if ! delete_paths "${LIFERAY_HOME:?}"
	then
		echo "Unable to remove ${LIFERAY_HOME}." >&2

		exit 1
	fi

	if ! (cd "${_WORKSPACE_DIR}" && blade server init)
	then
		echo "Unable to initialize the bundle in ${LIFERAY_HOME} with blade server init." >&2

		exit 1
	fi

	if ! delete_paths "${LIFERAY_HOME}/data" "${LIFERAY_HOME}/osgi/state" "${LIFERAY_HOME}/portal-env.properties"
	then
		echo "Unable to clear the seeded database and portal-env.properties from ${LIFERAY_HOME}." >&2

		exit 1
	fi
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

function is_liferay_available {
	curl \
		--fail \
		--output /dev/null \
		--silent \
		"${LIFERAY_PORTAL_URL}"
}

function is_liferay_running {
	is_process_running "${LIFERAY_HOME}/tomcat"
}

function is_liferay_stopped {
	! is_liferay_running && ! curl \
		--output /dev/null \
		--silent \
		"${LIFERAY_PORTAL_URL}"
}

function is_object_definition_published {
	curl \
		--fail \
		--silent \
		--user "${LIFERAY_USER_CREDENTIALS}" \
		"${LIFERAY_PORTAL_URL}/o/object-admin/v1.0/object-definitions/by-external-reference-code/${1}" | \
		jq --exit-status ".status.code == 0" > /dev/null
}

function is_process_running {
	if [[ $(uname) == Darwin ]]
	then
		pgrep -f "${1}" > /dev/null
	else
		pgrep --full "${1}" > /dev/null
	fi
}

function is_site_present {
	curl \
		--fail \
		--output /dev/null \
		--silent \
		--user "${LIFERAY_USER_CREDENTIALS}" \
		"${LIFERAY_PORTAL_URL}/o/headless-admin-site/v1.0/sites/${1}"
}

function record_untracked_paths {
	if ! get_untracked_paths > "${_UNTRACKED_PATHS_FILE}"
	then
		echo "Unable to record the untracked paths in ${_UNTRACKED_PATHS_FILE}, so tear down could not delete what the eval generates." >&2

		exit 1
	fi
}

function replace_text {
	if [[ $(uname) == Darwin ]]
	then
		sed -e "${1}"
	else
		sed --expression "${1}"
	fi
}

function set_variables {
	_LMNR_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

	_CLIENT_EXTENSIONS_DIR=${_LMNR_DIR}/client-extensions
	_COMPOSE_DIR=${_LMNR_DIR}/compose
	_EVALS_DIR=${_LMNR_DIR}/evals
	_UNTRACKED_PATHS_FILE=${_LMNR_DIR}/untracked-paths.list
	_WORKSPACE_DIR=$(dirname "${_LMNR_DIR}")

	LAMINAR_URL=${LAMINAR_URL:-http://localhost:9667}
	LIFERAY_HOME=${_WORKSPACE_DIR}/bundles
	LIFERAY_PORTAL_URL=${LIFERAY_PORTAL_URL:-http://localhost:8080}
	LIFERAY_USER_CREDENTIALS=${LIFERAY_USER_CREDENTIALS:-test@liferay.com:test}
}

function start_laminar {
	if is_laminar_ready
	then
		echo "Laminar is already running."

		return 0
	fi

	if ! (cd "${_COMPOSE_DIR}" && docker compose up --detach)
	then
		echo "Unable to start Laminar with docker compose in ${_COMPOSE_DIR}." >&2

		exit 1
	fi

	wait_for "Laminar is ready at ${LAMINAR_URL}" 900 is_laminar_ready
}

function start_liferay {
	if ! (cd "${_WORKSPACE_DIR}" && blade server start)
	then
		echo "Unable to start Liferay with blade server start." >&2

		exit 1
	fi

	wait_for "${LIFERAY_PORTAL_URL} is available" 1200 is_liferay_available

	wait_for_portal_log_inactivity
}

function stop_laminar {
	if ! (cd "${_COMPOSE_DIR}" && docker compose down)
	then
		echo "Unable to stop Laminar with docker compose in ${_COMPOSE_DIR}." >&2

		exit 1
	fi
}

function stop_liferay {
	if ! is_liferay_running
	then
		echo "Liferay is not running."

		return 0
	fi

	if ! (cd "${_WORKSPACE_DIR}" && blade server stop)
	then
		echo "Unable to stop Liferay with blade server stop." >&2

		exit 1
	fi

	wait_for "Liferay is stopped" 300 is_liferay_stopped
}

function update_env_portal_ext_properties {
	local properties_file=${LIFERAY_HOME}/portal-ext.properties

	if ! touch "${properties_file}"
	then
		echo "Unable to create ${properties_file}." >&2

		exit 1
	fi

	local env_dir

	for env_dir in $(get_env_dirs)
	do
		update_portal_ext_properties "${env_dir}"

		local delete_properties_list_file=${env_dir}/delete-properties.list

		if [[ -f ${delete_properties_list_file} ]]
		then
			delete_properties "${delete_properties_list_file}"
		fi
	done

	echo ""
	echo "##"
	echo "## ${properties_file}"
	echo "##"
	echo ""

	cat "${properties_file}"

	echo ""
}

function update_portal_ext_properties {
	local env_portal_ext_properties_file=${1}/portal-ext.properties

	if [[ -f ${env_portal_ext_properties_file} ]]
	then
		combine_properties_files "${LIFERAY_HOME}/portal-ext.properties" "${env_portal_ext_properties_file}"
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
	local client_extensions_list_file=${1}

	local client_extension_dir

	for client_extension_dir in $(get_client_extension_dirs "${client_extensions_list_file}")
	do
		local client_extension_name

		client_extension_name=$(basename "${client_extension_dir}")

		wait_for "${client_extension_name}.zip is in osgi/client-extensions" 300 test -f "${LIFERAY_HOME}/osgi/client-extensions/${client_extension_name}.zip"

		local object_definition_external_reference_code

		for object_definition_external_reference_code in $(get_object_definition_external_reference_codes "${client_extension_dir}")
		do
			wait_for "Object definition ${object_definition_external_reference_code} is published" 300 is_object_definition_published "${object_definition_external_reference_code}"
		done

		local site_external_reference_code

		for site_external_reference_code in $(get_values_after_prefix "${client_extension_dir}/client-extension.yaml" "siteExternalReferenceCode: ")
		do
			wait_for "Site ${site_external_reference_code} exists" 300 is_site_present "${site_external_reference_code}"
		done
	done
}

function wait_for_portal_log_inactivity {
	local elapsed=0
	local line_count

	line_count=$(get_portal_log_line_count)

	sleep 15

	while [[ ${line_count} != $(get_portal_log_line_count) ]]
	do
		line_count=$(get_portal_log_line_count)

		if [ ${elapsed} -ge 180 ]
		then
			break
		fi

		echo "Waiting for portal log inactivity..."

		sleep 15

		elapsed=$((elapsed + 15))
	done

	echo "No portal log activity in 15s."
}

set_variables