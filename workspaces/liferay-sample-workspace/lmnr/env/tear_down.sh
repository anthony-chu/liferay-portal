#!/bin/bash

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

function main {
	local stop_laminar=false

	local argument

	for argument in "${@}"
	do
		if [[ ${argument} == --laminar ]]
		then
			stop_laminar=true
		else
			EVAL_NAME=${argument}
		fi
	done

	if [[ -n ${EVAL_NAME} ]]
	then
		validate_eval
	fi

	if [[ -n ${EVAL_NAME} ]] && [[ -f ${EVAL_DIR}/env/tear_down.sh ]]
	then
		if ! /bin/bash "${EVAL_DIR}/env/tear_down.sh"
		then
			echo "Unable to tear down the eval with ${EVAL_DIR}/env/tear_down.sh." >&2

			exit 1
		fi
	else
		default_tear_down
	fi

	delete_eval_generated_paths

	if [[ ${stop_laminar} == true ]]
	then
		stop_laminar
	fi
}

main "${@}"