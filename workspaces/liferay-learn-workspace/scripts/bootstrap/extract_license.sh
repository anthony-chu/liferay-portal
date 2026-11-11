#!/usr/bin/env bash

cd "$(dirname "${BASH_SOURCE[0]}")"

source ../_common.sh

function main {
	local force=false

	if [[ ${1:-} == -f ]] ||
	   [[ ${1:-} == --force ]]
	then
		force=true
	fi

	local license_file=../../build/docker/deploy/license.xml

	if [[ ${force} == false ]] &&
	   _is_valid_license "${license_file}"
	then
		echo "A valid trial license already exists at ${license_file}."

		exit 0
	fi

	mkdir --parents "$(dirname "${license_file}")"

	if docker image inspect liferay/dxp:latest &> /dev/null &&
	   _copy_license "${license_file}"
	then
		exit 0
	fi

	echo "Pulling \"liferay/dxp:latest\" to get a valid trial license."

	if ! docker pull --quiet liferay/dxp:latest > /dev/null
	then
		_die "Unable to pull \"liferay/dxp:latest\". Add an unexpired license to ${license_file}."
	fi

	if ! _copy_license "${license_file}"
	then
		_die "Unable to find a valid trial license in \"liferay/dxp:latest\". Add an unexpired license to ${license_file}."
	fi
}

function _copy_license {
	local license_file=${1}

	echo "Extracting the trial license from \"liferay/dxp:latest\"."

	if ! docker run \
			--entrypoint sh \
			--rm \
			--user root \
			--volume "$(dirname "${license_file}"):/mnt/deploy" \
			liferay/dxp:latest \
			-c \
			"cp /opt/liferay/osgi/modules/trial-dxp-license*.xml /mnt/deploy/license.xml 2> /dev/null || cp /opt/liferay/deploy/trial-dxp-license*.xml /mnt/deploy/license.xml" ||
	   ! _is_valid_license "${license_file}"
	then
		return 1
	fi

	echo "A trial license that expires on $(_get_expiration_date "${license_file}") was extracted."
}

function _get_expiration_date {
	grep --only-matching --perl-regexp "(?<=<expiration-date>)[^<]+" "${1}"
}

function _is_valid_license {
	local license_file=${1}

	if [ ! -f ${license_file} ]
	then
		return 1
	fi

	local expiration_date

	expiration_date=$(_get_expiration_date "${license_file}")

	local expiration_time

	if [[ -z ${expiration_date} ]] ||
	   ! expiration_time=$(date --date "${expiration_date}" +%s)
	then
		echo "Unable to read the expiration date of ${license_file}."

		return 1
	fi

	if [ ${expiration_time} -le $(date +%s) ]
	then
		echo "The trial license expired on ${expiration_date}."

		return 1
	fi

	return 0
}

main "${@}"