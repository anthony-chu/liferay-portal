#!/bin/bash

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

function main {
	EVAL_NAME=${1:-${EVAL_NAME}}

	validate_eval

	delete_eval_generated_paths

	start_laminar

	if [[ -f ${EVAL_DIR}/env/set_up.sh ]]
	then
		if ! /bin/bash "${EVAL_DIR}/env/set_up.sh"
		then
			echo "Unable to set up the eval with ${EVAL_DIR}/env/set_up.sh." >&2

			exit 1
		fi
	else
		default_set_up
	fi

	record_untracked_paths

	echo ""
	echo "Ready. From ${_WORKSPACE_DIR}, run:"
	echo ""

	local eval_file

	for eval_file in "${EVAL_DIR}"/*.eval.ts
	do
		echo "    lmnr/evals/node_modules/.bin/tsx $(echo "${eval_file}" | replace_text "s|^${_WORKSPACE_DIR}/||")"
	done
}

main "${@}"