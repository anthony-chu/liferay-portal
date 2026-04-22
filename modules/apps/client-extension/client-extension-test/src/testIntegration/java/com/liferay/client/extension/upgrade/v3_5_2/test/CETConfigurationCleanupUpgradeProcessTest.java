/**
 * SPDX-FileCopyrightText: (c) 2026 Liferay, Inc. https://liferay.com
 * SPDX-License-Identifier: LGPL-2.1-or-later OR LicenseRef-Liferay-DXP-EULA-2.0.0-2023-06
 */

package com.liferay.client.extension.upgrade.v3_5_2.test;

import com.liferay.arquillian.extension.junit.bridge.junit.Arquillian;
import com.liferay.petra.string.StringBundler;
import com.liferay.portal.kernel.upgrade.UpgradeProcess;
import com.liferay.portal.test.rule.Inject;
import com.liferay.portal.test.rule.LiferayIntegrationTestRule;
import com.liferay.portal.upgrade.registry.UpgradeStepRegistrator;

import java.util.Hashtable;
import java.util.Objects;

import org.junit.After;
import org.junit.Assert;
import org.junit.ClassRule;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

import org.osgi.framework.Constants;
import org.osgi.service.cm.Configuration;
import org.osgi.service.cm.ConfigurationAdmin;

/**
 * @author Anthony Chu
 */
@RunWith(Arquillian.class)
public class CETConfigurationCleanupUpgradeProcessTest {

	@ClassRule
	@Rule
	public static final LiferayIntegrationTestRule liferayIntegrationTestRule =
		new LiferayIntegrationTestRule();

	@After
	public void tearDown() throws Exception {
		_deleteConfiguration(_STALE_CET_PID_1);
		_deleteConfiguration(_STALE_CET_PID_2);
		_deleteConfiguration(_UNRELATED_PID);
	}

	@Test
	public void testUpgrade() throws Exception {
		_createConfiguration(_STALE_CET_PID_1);
		_createConfiguration(_STALE_CET_PID_2);
		_createConfiguration(_UNRELATED_PID);

		Assert.assertNotNull(
			"Stale CET configurations must exist before upgrade",
			_configurationAdmin.listConfigurations(
				StringBundler.concat(
					"(", Constants.SERVICE_PID, "=",
					_CET_CONFIGURATION_PID_PREFIX, "*)")));

		UpgradeProcess upgradeProcess = _getUpgradeProcess();

		Assert.assertNotNull(
			"CET configuration cleanup upgrade step must be registered",
			upgradeProcess);

		upgradeProcess.upgrade();

		Assert.assertNull(
			"All stale CET configurations should be deleted",
			_configurationAdmin.listConfigurations(
				StringBundler.concat(
					"(", Constants.SERVICE_PID, "=",
					_CET_CONFIGURATION_PID_PREFIX, "*)")));
		Assert.assertNotNull(
			"Unrelated configuration should survive",
			_configurationAdmin.listConfigurations(
				StringBundler.concat(
					"(", Constants.SERVICE_PID, "=", _UNRELATED_PID, ")")));
	}

	private void _createConfiguration(String pid) throws Exception {
		Configuration configuration = _configurationAdmin.getConfiguration(
			pid, "?");

		configuration.update(new Hashtable<>());
	}

	private void _deleteConfiguration(String pid) throws Exception {
		Configuration[] configurations = _configurationAdmin.listConfigurations(
			StringBundler.concat("(", Constants.SERVICE_PID, "=", pid, ")"));

		if (configurations == null) {
			return;
		}

		for (Configuration configuration : configurations) {
			configuration.delete();
		}
	}

	private UpgradeProcess _getUpgradeProcess() {
		UpgradeProcess[] upgradeProcesses = new UpgradeProcess[1];

		_upgradeStepRegistrator.register(
			(fromSchemaVersionString, toSchemaVersionString, upgradeSteps) -> {
				if (Objects.equals(fromSchemaVersionString, "3.5.1") &&
					Objects.equals(toSchemaVersionString, "3.5.2") &&
					(upgradeSteps.length > 0)) {

					upgradeProcesses[0] = (UpgradeProcess)upgradeSteps[0];
				}
			});

		return upgradeProcesses[0];
	}

	private static final String _CET_CONFIGURATION_PID_PREFIX =
		"com.liferay.client.extension.type.configuration.CETConfiguration~";

	private static final String _STALE_CET_PID_1 =
		_CET_CONFIGURATION_PID_PREFIX + "upgrade-test-cet-1/liferay.com";

	private static final String _STALE_CET_PID_2 =
		_CET_CONFIGURATION_PID_PREFIX + "upgrade-test-cet-2/liferay.com";

	private static final String _UNRELATED_PID =
		"com.liferay.client.extension.upgrade.test.unrelated";

	@Inject
	private ConfigurationAdmin _configurationAdmin;

	@Inject(
		filter = "component.name=com.liferay.client.extension.internal.upgrade.registry.ClientExtensionUpgradeStepRegistrator"
	)
	private UpgradeStepRegistrator _upgradeStepRegistrator;

}