/**
 * SPDX-FileCopyrightText: (c) 2025 Liferay, Inc. https://liferay.com
 * SPDX-License-Identifier: LGPL-2.1-or-later OR LicenseRef-Liferay-DXP-EULA-2.0.0-2023-06
 */

package com.liferay.gradle.plugins.workspace.internal.util;

import com.liferay.gradle.plugins.workspace.WorkspaceExtension;
import com.liferay.project.templates.extensions.util.VersionUtil;

import com.liferay.release.util.ReleaseEntry;
import com.liferay.release.util.ReleaseUtil;
import org.gradle.api.Project;
import org.gradle.api.plugins.ExtensionAware;

/**
 * @author Drew Brokke
 */
public class JakartaCompatibilityUtil {

	public static boolean isUseJakarta(Project project) {
		WorkspaceExtension workspaceExtension = GradleUtil.getExtension(
			(ExtensionAware)project.getGradle(), WorkspaceExtension.class);

		if (workspaceExtension.getJavaEEUseJakarta()) {
			return true;
		}

		String targetPlatformVersion =
			workspaceExtension.getTargetPlatformVersion();

		if (StringUtil.isBlank(targetPlatformVersion)) {
			return false;
		}

		String product = workspaceExtension.getProduct();

		return VersionUtil.isJakartaCompatibleVersion(
			ReleaseUtil.getFromReleaseEntry(
				product, ReleaseEntry::getProduct), targetPlatformVersion);
	}

}